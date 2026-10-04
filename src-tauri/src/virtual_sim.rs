// virtual_sim.rs -- Virtual Valence in the desktop shell: valencesim, the
// Nucleus host simulator, run as a Tauri sidecar (DESIGN section 10.10). The
// page connects to it as to any LAN hub.
//
// Constraints:
// - One sim at a time; virtual_start replaces a running one.
// - Loopback ports picked free per start; the state prefix is fixed under the
//   app data dir, so presets, settings and the hub_instance_id persist.
// - Never broadcasts: discovery, mDNS and the RFC-053 datagram are off on
//   every start, so the sim never answers a Scan or latches on a LAN e-stop.
// - Homed and with the pairing window open at boot (the sim has no PAIR
//   button): the shell's knock lands as push-to-pair, and the pairing
//   persists in the state prefix.
// - Loopback only: --bind 127.0.0.1 for the WS port; /uitoken binds
//   127.0.0.1 on its own. The page mints at the returned `http` port.
// - The rx channel is drained for the child's whole life: an undrained pipe
//   blocks the sim's stdout, and its hub loop with it.
// - Killed on RunEvent::Exit (lib.rs). The shell plugin's own exit kill
//   covers only children its JS spawn command made, never a Rust-side spawn.

use std::net::TcpListener;
use std::sync::Mutex;
use std::time::Duration;

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, Runtime, State};
use tauri_plugin_shell::process::{CommandChild, CommandEvent};
use tauri_plugin_shell::ShellExt;

const READY_TIMEOUT: Duration = Duration::from_secs(10);

#[derive(Default)]
pub struct Sim(Mutex<Option<CommandChild>>);

#[derive(Serialize, Clone, Debug)]
pub struct SimInfo {
  host: &'static str,
  port: u16,
  http: u16,
  version: String,
  etag: String,
}

/// Two distinct free loopback ports: WS, then HTTP (/uitoken).
fn two_ports() -> std::io::Result<(u16, u16)> {
  let a = TcpListener::bind("127.0.0.1:0")?;
  let b = TcpListener::bind("127.0.0.1:0")?;
  Ok((a.local_addr()?.port(), b.local_addr()?.port()))
}

fn sim_args(port: u16, http: u16, state: &str) -> Vec<String> {
  [
    "--port", &port.to_string(), "--bind", "127.0.0.1", "--http", &http.to_string(), "--state", state,
    "--homed", "--pairing-window", "--no-discovery", "--no-mdns", "--no-estop-udp",
  ]
    .iter()
    .map(|s| s.to_string())
    .collect()
}

/// "[I] valencesim: Nucleus 0.1.7, catalog 45 entries, 27684 B, etag 9da9..."
/// -> (version, etag).
fn parse_banner(line: &str) -> Option<(String, String)> {
  let rest = line.split_once("valencesim: ")?.1;
  let (product_version, rest) = rest.split_once(", catalog ")?;
  let version = product_version.rsplit(' ').next()?;
  let etag = rest.split_once(", etag ")?.1.trim();
  Some((version.to_string(), etag.to_string()))
}

/// The sim prints its /uitoken line (served or not) after the WS port listens.
fn is_ready(line: &str) -> bool {
  line.contains("valencesim:") && line.contains("/uitoken")
}

fn kill(sim: &Sim) {
  if let Some(child) = sim.0.lock().unwrap().take() {
    let _ = child.kill();
  }
}

/// RunEvent::Exit (lib.rs).
pub fn stop_on_exit<R: Runtime>(app: &AppHandle<R>) {
  kill(&app.state::<Sim>());
}

#[tauri::command]
pub fn virtual_stop(sim: State<'_, Sim>) {
  kill(&sim);
}

#[tauri::command]
pub async fn virtual_start(app: AppHandle, sim: State<'_, Sim>) -> Result<SimInfo, String> {
  kill(&sim);
  let dir = app.path().app_data_dir().map_err(|e| e.to_string())?.join("valencesim");
  std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
  let state = dir.join("sim");
  let (port, http) = two_ports().map_err(|e| e.to_string())?;
  let (mut rx, child) = app
    .shell()
    .sidecar("valencesim")
    .map_err(|e| e.to_string())?
    .args(sim_args(port, http, &state.to_string_lossy()))
    .spawn()
    .map_err(|e| format!("valencesim did not start: {e}"))?;

  let mut banner = None;
  let mut last_err = String::new();
  let booted = tokio::time::timeout(READY_TIMEOUT, async {
    while let Some(ev) = rx.recv().await {
      match ev {
        CommandEvent::Stdout(b) => {
          let line = String::from_utf8_lossy(&b);
          if banner.is_none() {
            banner = parse_banner(&line);
          } else if is_ready(&line) {
            return Ok(());
          }
        }
        CommandEvent::Stderr(b) => last_err = String::from_utf8_lossy(&b).trim().to_string(),
        CommandEvent::Terminated(t) => return Err(format!("valencesim exited ({:?}): {last_err}", t.code)),
        _ => {}
      }
    }
    Err("valencesim closed its output".to_string())
  })
  .await
  .unwrap_or_else(|_| Err("valencesim gave no banner in 10 s".to_string()));
  let (version, etag) = match (booted, banner) {
    (Ok(()), Some(b)) => b,
    (Err(e), _) => {
      let _ = child.kill();
      return Err(e);
    }
    (Ok(()), None) => unreachable!("ready is only seen after the banner"),
  };

  // Everything after the banner goes to the Log tab as `sim` lines.
  let pid = child.pid();
  *sim.0.lock().unwrap() = Some(child);
  let app_ = app.clone();
  tauri::async_runtime::spawn(async move {
    while let Some(ev) = rx.recv().await {
      let line = match ev {
        CommandEvent::Stdout(b) | CommandEvent::Stderr(b) => String::from_utf8_lossy(&b).trim_end().to_string(),
        CommandEvent::Terminated(t) => format!("[E] valencesim exited ({:?})", t.code),
        _ => continue,
      };
      let _ = app_.emit("virtual-log", line);
    }
    // Ended on its own: forget it, unless a newer sim already replaced it.
    let sim = app_.state::<Sim>();
    let mut held = sim.0.lock().unwrap();
    if held.as_ref().is_some_and(|c| c.pid() == pid) {
      *held = None;
      drop(held);
      let _ = app_.emit("virtual-exit", ());
    }
  });
  Ok(SimInfo { host: "127.0.0.1", port, http, version, etag })
}

#[cfg(test)]
mod tests {
  use super::*;
  use std::io::{BufRead, BufReader};
  use std::process::{Command, Stdio};

  #[test]
  fn banner_parses() {
    let b = parse_banner("[I] valencesim: Nucleus 0.1.7-p4hub, catalog 45 entries, 27684 B, etag 9da9e1142fe55c76");
    assert_eq!(b, Some(("0.1.7-p4hub".into(), "9da9e1142fe55c76".into())));
    assert_eq!(parse_banner("[I] valencesim: hub_instance_id c568e472ce39f393"), None);
    assert!(is_ready("[I] valencesim: GET /uitoken on 127.0.0.1:47812"));
    assert!(is_ready("[W] valencesim: /uitoken unavailable on :1 -- busy"));
    assert!(!is_ready("[I] ws: listening on :47811 (valence.v1)"));
  }

  #[test]
  fn sim_listens_on_loopback_only() {
    let a = sim_args(1, 2, "s");
    assert!(a.windows(2).any(|w| w[0] == "--bind" && w[1] == "127.0.0.1"), "{a:?}");
  }

  #[test]
  fn ports_are_two_and_free() {
    let (a, b) = two_ports().unwrap();
    assert!(a != 0 && b != 0 && a != b);
  }

  // The real binary from binaries/ (npm run sidecar), run with the shell's own
  // arguments; skipped when it is absent.
  #[test]
  fn sidecar_boots_and_prints_its_banner() {
    let bin = std::fs::read_dir(concat!(env!("CARGO_MANIFEST_DIR"), "/binaries"))
      .ok()
      .and_then(|d| d.flatten().map(|e| e.path()).find(|p| p.file_name().is_some_and(|n| n.to_string_lossy().starts_with("valencesim-"))));
    let Some(bin) = bin else {
      eprintln!("SKIP: no binaries/valencesim-<triple>; run npm run sidecar");
      return;
    };
    let dir = std::env::temp_dir().join(format!("phosphor-sim-test-{}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    let (port, http) = two_ports().unwrap();
    let mut child = Command::new(&bin)
      .args(sim_args(port, http, &dir.join("sim").to_string_lossy()))
      .stdout(Stdio::piped())
      .stderr(Stdio::null())
      .spawn()
      .unwrap();
    let mut banner = None;
    let mut ready = false;
    for line in BufReader::new(child.stdout.take().unwrap()).lines().map_while(Result::ok).take(40) {
      if banner.is_none() {
        banner = parse_banner(&line);
      } else if is_ready(&line) {
        ready = true;
        break;
      }
    }
    let ws = std::net::TcpStream::connect(("127.0.0.1", port)).is_ok();
    // A bound-to-all listener would also take a connect on a non-loopback
    // local address; loopback-only refuses it.
    let lan = std::net::UdpSocket::bind("0.0.0.0:0")
      .and_then(|u| u.connect("192.0.2.1:9").and(u.local_addr()))
      .ok()
      .map(|a| a.ip())
      .filter(|ip| !ip.is_loopback() && !ip.is_unspecified());
    let lan_refused = lan.map(|ip| std::net::TcpStream::connect_timeout(&(ip, port).into(), Duration::from_secs(1)).is_err());
    let _ = child.kill();
    let _ = child.wait();
    let _ = std::fs::remove_dir_all(&dir);
    let (version, etag) = banner.expect("banner");
    assert!(!version.is_empty() && etag.len() >= 16, "{version} {etag}");
    assert!(ready, "no /uitoken line after the banner");
    assert!(ws, "WS port {port} not listening once ready");
    assert_ne!(lan_refused, Some(false), "WS port {port} answers on {lan:?}");
  }
}
