// Neutrino -- the dev tool's shell: picks free ports, runs the native device
// twin (the `neutrino-sim` sidecar) on them, restarts it when it reboots, and
// hands the page the ports.
// Constraints:
// - The twin is a console program: on Windows it is spawned with
//   CREATE_NO_WINDOW, or every launch pops a terminal on the operator's screen.
// - The twin's stdout and stderr go to null: it logs every line there and
//   blocks when a pipe fills; the page reads the log off the dev tool channel.
// - The twin holds our stdin pipe (--exit-with-stdin): this process ending,
//   however it ends, ends the twin. Exit also kills it outright.
// - Exit code 75 is the twin's HOME-hold reboot: it is started again on the
//   same ports and state; any other exit is reported to the page and left.
// See: docs/DESIGN.md (10.17 Neutrino, the dev tool), docs/BUILD.md

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::net::{Ipv4Addr, SocketAddr, TcpListener, UdpSocket};
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use tauri::{Emitter, Manager, RunEvent};

const SIM: &str = if cfg!(windows) { "neutrino-sim.exe" } else { "neutrino-sim" };
const REBOOT_EXIT: i32 = 75;
const WS_FIRST: u16 = 82;
const HTTP_FIRST: u16 = 80;

#[derive(Clone, serde::Serialize)]
struct Info {
  ws: u16,
  http: u16,
  devtool: u16,
  host: String,
}

struct Sim {
  info: Info,
  exe: PathBuf,
  args: Vec<String>,
  child: Mutex<Option<Child>>,
}

fn tcp_free(port: u16) -> bool {
  TcpListener::bind((Ipv4Addr::UNSPECIFIED, port)).is_ok() && TcpListener::bind((Ipv4Addr::LOCALHOST, port)).is_ok()
}

fn first_free(from: u16) -> u16 {
  (from..from.saturating_add(200)).find(|&p| tcp_free(p)).unwrap_or(0)
}

// An ephemeral loopback port; released before the twin binds it.
fn ephemeral() -> u16 {
  TcpListener::bind((Ipv4Addr::LOCALHOST, 0)).and_then(|l| l.local_addr()).map(|a| a.port()).unwrap_or(0)
}

// The address other machines reach this one by: the route a UDP "connect"
// picks (nothing is sent), else loopback.
fn lan_host() -> String {
  UdpSocket::bind((Ipv4Addr::UNSPECIFIED, 0))
    .and_then(|s| {
      s.connect(SocketAddr::from(([192, 0, 2, 1], 9)))?;
      s.local_addr()
    })
    .map(|a| a.ip().to_string())
    .unwrap_or_else(|_| "127.0.0.1".into())
}

fn spawn(sim: &Sim) -> std::io::Result<Child> {
  let mut c = Command::new(&sim.exe);
  c.args(&sim.args).stdin(Stdio::piped()).stdout(Stdio::null()).stderr(Stdio::null());
  #[cfg(windows)]
  {
    use std::os::windows::process::CommandExt;
    c.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
  }
  c.spawn()
}

#[tauri::command]
fn info(sim: tauri::State<'_, Arc<Sim>>) -> Info {
  sim.info.clone()
}

// Another window, another machine: the new process takes the next free ports.
#[tauri::command]
fn launch_another() -> Result<(), String> {
  let exe = std::env::current_exe().map_err(|e| e.to_string())?;
  let mut c = Command::new(exe);
  #[cfg(windows)]
  {
    use std::os::windows::process::CommandExt;
    c.creation_flags(0x0800_0000);
  }
  c.spawn().map(|_| ()).map_err(|e| e.to_string())
}

fn main() {
  // Arguments after `--` reach the twin: `neutrino -- --motor-switch`.
  let extra: Vec<String> = std::env::args().skip_while(|a| a != "--").skip(1).collect();
  let ws = first_free(WS_FIRST);
  let http = if tcp_free(HTTP_FIRST) { HTTP_FIRST } else { first_free(ws.saturating_add(8000)) };
  let devtool = ephemeral();
  let exe = std::env::current_exe().ok().and_then(|p| p.parent().map(|d| d.join(SIM))).unwrap_or_else(|| SIM.into());

  tauri::Builder::default()
    .invoke_handler(tauri::generate_handler![info, launch_another])
    .setup(move |app| {
      let dir = app.path().app_local_data_dir()?.join(format!("machine-{ws}"));
      std::fs::create_dir_all(&dir)?;
      let state = dir.join("neutrino").to_string_lossy().into_owned();
      let (ws_s, http_s, dt_s) = (ws.to_string(), http.to_string(), devtool.to_string());
      let mut args: Vec<String> = [
        "machine", "--port", ws_s.as_str(), "--http", http_s.as_str(), "--devtool-port", dt_s.as_str(),
        "--state", state.as_str(), "--homed", "--home-sense-at", "-20", "--exit-with-stdin",
      ]
      .iter()
      .map(|s| s.to_string())
      .collect();
      args.extend(extra.iter().cloned());
      let sim = Arc::new(Sim { info: Info { ws, http, devtool, host: lan_host() }, exe, args, child: Mutex::new(None) });
      *sim.child.lock().unwrap() = Some(spawn(&sim)?);
      if let Some(w) = app.get_webview_window("main") {
        let _ = w.set_title(&format!("Neutrino :{ws}"));
      }
      app.manage(sim.clone());

      let handle = app.handle().clone();
      std::thread::spawn(move || loop {
        std::thread::sleep(Duration::from_millis(200));
        let mut slot = sim.child.lock().unwrap();
        let Some(child) = slot.as_mut() else { return };
        let Ok(Some(status)) = child.try_wait() else { continue };
        if status.code() == Some(REBOOT_EXIT) {
          match spawn(&sim) {
            Ok(c) => {
              *slot = Some(c);
              let _ = handle.emit("sim-rebooted", ());
              continue;
            }
            Err(e) => {
              let _ = handle.emit("sim-exited", format!("restart failed: {e}"));
            }
          }
        } else {
          let _ = handle.emit("sim-exited", format!("exit {}", status.code().map_or("signal".into(), |c| c.to_string())));
        }
        *slot = None;
        return;
      });
      Ok(())
    })
    .build(tauri::generate_context!())
    .expect("the Neutrino window")
    .run(|app, event| {
      if let RunEvent::Exit = event {
        if let Some(sim) = app.try_state::<Arc<Sim>>() {
          if let Some(mut c) = sim.child.lock().unwrap().take() {
            let _ = c.kill();
            let _ = c.wait();
          }
        }
      }
    });
}
