//! The two OS acts a health report needs (ph-9t5l.1, docs/DESIGN.md §10.14).
//! Constraints: open_report_url opens only a URL on the Phosphor repo, handed to
//! the OS launcher as one argument (never through a shell); save_report writes
//! only diag-report-<8 base32>.json, into the user's Downloads folder.

const REPO_URL: &str = "https://github.com/openvalence/Phosphor/";

#[cfg(desktop)]
#[tauri::command]
pub fn open_report_url(url: String) -> Result<(), String> {
  if !url.starts_with(REPO_URL) || url.chars().any(|c| c.is_whitespace() || c == '"') {
    return Err("not a Phosphor issue URL".into());
  }
  let (cmd, pre): (&str, &[&str]) = if cfg!(windows) {
    ("rundll32", &["url.dll,FileProtocolHandler"])
  } else if cfg!(target_os = "macos") {
    ("open", &[])
  } else {
    ("xdg-open", &[])
  };
  std::process::Command::new(cmd).args(pre).arg(&url).spawn().map(|_| ()).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn save_report(app: tauri::AppHandle, name: String, text: String) -> Result<String, String> {
  use tauri::Manager;
  let id = name.strip_prefix("diag-report-").and_then(|r| r.strip_suffix(".json")).unwrap_or("");
  if id.len() != 8 || !id.bytes().all(|b| b.is_ascii_uppercase() || (b'2'..=b'7').contains(&b)) {
    return Err("not a report file name".into());
  }
  let path = app.path().download_dir().map_err(|e| e.to_string())?.join(&name);
  std::fs::write(&path, text).map_err(|e| e.to_string())?;
  Ok(path.to_string_lossy().into_owned())
}
