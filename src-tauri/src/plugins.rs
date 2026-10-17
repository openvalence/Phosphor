// plugins.rs -- tier-2 plugin files and the one network service plugins get.
//
// Constraints:
// - Files: lists `<app_data_dir>/plugins/<dir>/manifest.json` and reads the
//   entry module it names. The entry name is untrusted input: a bare file
//   name only, never a path, so a manifest cannot read outside its folder.
//   Sizes are capped; a bad plugin is returned with its error, never skipped
//   silently. Manifest SEMANTICS are validated in JS (src/plugins/host.js),
//   the one home for the schema; this side checks only what file access needs.
// - TCP: loopback only (127.0.0.1). The listener feeds plugin code that can
//   drive motion on a control-tier session, so exposing it to the LAN would
//   be an unauthenticated control path around Valence's token. Widening it is
//   an operator ruling, not a flag.
// - Lines are capped at MAX_LINE bytes; a longer run is discarded up to the
//   next newline rather than buffered without bound.
// - Replies: plugin_tcp_reply writes one line back on the connection a line
//   came from (its `conn`). The queue is REPLY_QUEUE lines; a full queue or a
//   closed connection refuses the reply, never blocks.
// - The webview is the only caller and plugin code runs in it with the
//   page's authority, so manifest permissions are enforced in JS. Rust cannot
//   tell a plugin's invoke from the kernel's.
// See: docs/PLUGINS.md

use std::collections::{BTreeMap, HashMap};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;

use serde::Serialize;
use serde_json::Value;
use tauri::{AppHandle, Emitter, Manager, State};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::net::TcpListener;
use tokio::sync::mpsc;
use tokio::task::JoinSet;

const MAX_MANIFEST: u64 = 64 * 1024;
const MAX_ENTRY: u64 = 2 * 1024 * 1024;
const MAX_LINE: usize = 1024;
const REPLY_QUEUE: usize = 64;

#[derive(Serialize)]
pub struct PluginFiles {
    dir: String,
    path: String,
    manifest: Option<Value>,
    source: Option<String>,
    error: Option<String>,
}

#[derive(Serialize)]
pub struct PluginListing {
    dir: String,
    plugins: Vec<PluginFiles>,
}

fn read_capped(p: &Path, cap: u64) -> Result<String, String> {
    let len = std::fs::metadata(p).map_err(|e| format!("{}: {}", p.display(), e))?.len();
    if len > cap {
        return Err(format!("{} is {} bytes (limit {})", p.display(), len, cap));
    }
    std::fs::read_to_string(p).map_err(|e| format!("{}: {}", p.display(), e))
}

fn is_plain_js_name(s: &str) -> bool {
    !s.is_empty()
        && (s.ends_with(".js") || s.ends_with(".mjs"))
        && s.chars().all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-' || c == '.')
        && !s.starts_with('.')
}

fn load_one(dir: &Path) -> PluginFiles {
    let name = dir.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
    let mut out = PluginFiles {
        dir: name,
        path: dir.display().to_string(),
        manifest: None,
        source: None,
        error: None,
    };
    let manifest: Value = match read_capped(&dir.join("manifest.json"), MAX_MANIFEST)
        .and_then(|t| serde_json::from_str(&t).map_err(|e| format!("manifest.json: {}", e)))
    {
        Ok(v) => v,
        Err(e) => {
            out.error = Some(e);
            return out;
        }
    };
    let entry = manifest.get("entry").and_then(Value::as_str).unwrap_or("index.js").to_string();
    out.manifest = Some(manifest);
    if !is_plain_js_name(&entry) {
        out.error = Some(format!("entry \"{}\" is not a plain .js file name", entry));
        return out;
    }
    match read_capped(&dir.join(&entry), MAX_ENTRY) {
        Ok(src) => out.source = Some(src),
        Err(e) => out.error = Some(e),
    }
    out
}

fn plugins_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = crate::portable::or(app.path().app_data_dir()).map_err(|e| e.to_string())?.join("plugins");
    std::fs::create_dir_all(&dir).map_err(|e| format!("{}: {}", dir.display(), e))?;
    Ok(dir)
}

#[tauri::command]
pub fn plugins_list(app: AppHandle) -> Result<PluginListing, String> {
    let dir = plugins_dir(&app)?;
    let mut dirs: Vec<PathBuf> = std::fs::read_dir(&dir)
        .map_err(|e| format!("{}: {}", dir.display(), e))?
        .filter_map(|e| e.ok().map(|e| e.path()))
        .filter(|p| p.is_dir())
        .collect();
    dirs.sort();
    Ok(PluginListing {
        dir: dir.display().to_string(),
        plugins: dirs.iter().map(|d| load_one(d)).collect(),
    })
}

// ---- loopback TCP line service -----------------------------------------------

/// port -> listener task. Aborting the task drops its JoinSet, which aborts
/// every connection task it spawned.
#[derive(Default)]
pub struct TcpListeners(Mutex<HashMap<u16, tauri::async_runtime::JoinHandle<()>>>);

#[derive(Clone, Serialize)]
struct TcpLine {
    port: u16,
    conn: u64,
    line: String,
}

/// (port, conn) -> that connection's reply queue. Its Conn guard removes the
/// entry when the connection task ends or is aborted.
static REPLIES: Mutex<BTreeMap<(u16, u64), mpsc::Sender<String>>> = Mutex::new(BTreeMap::new());
static NEXT_CONN: AtomicU64 = AtomicU64::new(1);

struct Conn {
    key: (u16, u64),
    writer: tauri::async_runtime::JoinHandle<()>,
}

impl Drop for Conn {
    fn drop(&mut self) {
        if let Ok(mut m) = REPLIES.lock() {
            m.remove(&self.key);
        }
        self.writer.abort();
    }
}

async fn read_lines(app: AppHandle, port: u16, sock: tokio::net::TcpStream) {
    let conn = NEXT_CONN.fetch_add(1, Ordering::Relaxed);
    let (rd, mut wr) = sock.into_split();
    let (tx, mut rx) = mpsc::channel::<String>(REPLY_QUEUE);
    let writer = tauri::async_runtime::spawn(async move {
        while let Some(s) = rx.recv().await {
            if wr.write_all(s.as_bytes()).await.is_err() {
                break;
            }
        }
    });
    if let Ok(mut m) = REPLIES.lock() {
        m.insert((port, conn), tx);
    }
    let _conn = Conn { key: (port, conn), writer };
    let mut rd = BufReader::new(rd);
    let mut buf: Vec<u8> = Vec::with_capacity(128);
    let mut discarding = false;
    loop {
        let chunk = match rd.fill_buf().await {
            Ok(c) if c.is_empty() => return,
            Ok(c) => c,
            Err(_) => return,
        };
        let (take, newline) = match chunk.iter().position(|&b| b == b'\n') {
            Some(i) => (i + 1, true),
            None => (chunk.len(), false),
        };
        if !discarding {
            let body = &chunk[..if newline { take - 1 } else { take }];
            if buf.len() + body.len() > MAX_LINE {
                discarding = true;
                buf.clear();
            } else {
                buf.extend_from_slice(body);
            }
        }
        rd.consume(take);
        if newline {
            if !discarding {
                let line = String::from_utf8_lossy(&buf).trim().to_string();
                if !line.is_empty() {
                    let _ = app.emit("plugin-tcp-line", TcpLine { port, conn, line });
                }
            }
            buf.clear();
            discarding = false;
        }
    }
}

#[tauri::command]
pub async fn plugin_tcp_listen(
    app: AppHandle,
    state: State<'_, TcpListeners>,
    port: u16,
) -> Result<(), String> {
    if port == 0 {
        return Err("port 0 is not a declared port".into());
    }
    // A page reload re-activates the adapter while the old listener still
    // holds the port. Abort it AND wait for the task to drop its socket, or
    // the bind below races it and fails with the port still in use.
    let old = state.0.lock().map_err(|e| e.to_string())?.remove(&port);
    if let Some(old) = old {
        old.abort();
        let _ = old.await;
    }
    let listener = TcpListener::bind(("127.0.0.1", port))
        .await
        .map_err(|e| format!("127.0.0.1:{}: {}", port, e))?;
    let task = tauri::async_runtime::spawn(async move {
        let mut conns = JoinSet::new();
        loop {
            match listener.accept().await {
                Ok((sock, _)) => {
                    conns.spawn(read_lines(app.clone(), port, sock));
                }
                Err(e) => log::warn!("plugin tcp {}: accept: {}", port, e),
            }
            while conns.try_join_next().is_some() {}
        }
    });
    state.0.lock().map_err(|e| e.to_string())?.insert(port, task);
    Ok(())
}

#[tauri::command]
pub fn plugin_tcp_close(state: State<'_, TcpListeners>, port: u16) -> Result<(), String> {
    if let Some(t) = state.0.lock().map_err(|e| e.to_string())?.remove(&port) {
        t.abort();
    }
    Ok(())
}

/// One line back on connection `conn` of `port`: newlines in `text` become
/// spaces, the line is capped at MAX_LINE bytes and ends in a newline.
#[tauri::command]
pub fn plugin_tcp_reply(port: u16, conn: u64, text: String) -> Result<(), String> {
    let mut line = text.replace(['\r', '\n'], " ");
    if line.len() > MAX_LINE {
        let mut i = MAX_LINE;
        while !line.is_char_boundary(i) {
            i -= 1;
        }
        line.truncate(i);
    }
    line.push('\n');
    let m = REPLIES.lock().map_err(|e| e.to_string())?;
    let tx = m.get(&(port, conn)).ok_or("connection closed")?;
    tx.try_send(line).map_err(|e| match e {
        mpsc::error::TrySendError::Full(_) => "reply queue full".to_string(),
        mpsc::error::TrySendError::Closed(_) => "connection closed".to_string(),
    })
}

/// api.net.open (docs/PLUGINS.md): an http or https URL in the system browser.
/// The net.fetch permission and the user's act are checked in JS (host.js).
#[cfg(desktop)]
#[tauri::command]
pub fn plugin_open_url(url: String) -> Result<(), String> {
    let web = url.starts_with("http://") || url.starts_with("https://");
    if !web || url.chars().any(|c| c.is_whitespace() || c.is_control() || c == '"') {
        return Err("not an http or https URL".into());
    }
    crate::report::launch(&url)
}

#[cfg(test)]
mod tests {
    use super::is_plain_js_name;

    #[test]
    fn entry_names_cannot_escape_the_plugin_folder() {
        assert!(is_plain_js_name("index.js"));
        assert!(is_plain_js_name("my-plugin.mjs"));
        assert!(!is_plain_js_name("../index.js"));
        assert!(!is_plain_js_name("sub/index.js"));
        assert!(!is_plain_js_name("..\\index.js"));
        assert!(!is_plain_js_name("C:index.js"));
        assert!(!is_plain_js_name(".hidden.js"));
        assert!(!is_plain_js_name("index.json"));
    }
}
