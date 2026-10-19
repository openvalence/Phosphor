//! The health report's file act (ph-9t5l.1, docs/DESIGN.md §10.14); its link opens
//! through the shared confirm and the opener plugin (src/ui/external.js).
//! Constraints: save_report writes only diag-report-<8 base32>.json, into the
//! user's Downloads folder (portable: the data folder).

#[tauri::command]
pub fn save_report(app: tauri::AppHandle, name: String, text: String) -> Result<String, String> {
  use tauri::Manager;
  let id = name.strip_prefix("diag-report-").and_then(|r| r.strip_suffix(".json")).unwrap_or("");
  if id.len() != 8 || !id.bytes().all(|b| b.is_ascii_uppercase() || (b'2'..=b'7').contains(&b)) {
    return Err("not a report file name".into());
  }
  let path = crate::portable::or(app.path().download_dir()).map_err(|e| e.to_string())?.join(&name);
  std::fs::write(&path, text).map_err(|e| e.to_string())?;
  Ok(path.to_string_lossy().into_owned())
}
