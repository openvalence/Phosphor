//! Portable mode (docs/DESIGN.md §10.18, ph-5fdg): a `phosphor.portable` file beside
//! phosphor.exe moves every write into `PhosphorData` beside it.
//! Constraints: Windows only. Only the marker turns it on, never the path.
//! Every app-owned path goes through `or`; the webview's data folder is set
//! where lib.rs builds the window. `init` writes nothing before the user's
//! answer to its dialog; a launch that ends in Quit leaves no file anywhere.

#![cfg_attr(not(windows), allow(dead_code))]

use std::path::{Path, PathBuf};
use std::sync::OnceLock;

pub const MARKER: &str = "phosphor.portable";
pub const DATA: &str = "PhosphorData";
/// Holds the exe folder the user chose to keep a shared folder for.
const ACCEPTED: &str = "location-accepted";

static DIR: OnceLock<PathBuf> = OnceLock::new();

/// The portable data folder; None for an installed build.
pub fn dir() -> Option<&'static Path> {
  DIR.get().map(PathBuf::as_path)
}

/// `default` (a Tauri path resolver result), or the data folder when portable.
pub fn or(default: tauri::Result<PathBuf>) -> tauri::Result<PathBuf> {
  dir().map_or(default, |d| Ok(d.to_path_buf()))
}

/// The data folder for Settings > About; null for an installed build.
#[tauri::command]
pub fn portable_dir() -> Option<String> {
  dir().map(|d| d.display().to_string())
}

#[derive(Debug, PartialEq)]
enum Poor {
  /// A shared folder: a drive root or a known user folder's root.
  Shared,
  /// The temporary folder, where Windows runs an exe opened inside a zip.
  Temp,
}

/// Why `exe_dir` is not a folder of its own. All paths canonical.
fn poor_place(exe_dir: &Path, shared: &[PathBuf], temp: &Path) -> Option<Poor> {
  if exe_dir.starts_with(temp) {
    Some(Poor::Temp)
  } else if exe_dir.parent().is_none() || shared.iter().any(|s| s == exe_dir) {
    Some(Poor::Shared)
  } else {
    None
  }
}

/// Creates and removes one probe file in `dir`.
fn writable(dir: &Path) -> std::io::Result<()> {
  let probe = dir.join(format!(".phosphor-probe-{}", std::process::id()));
  std::fs::OpenOptions::new().write(true).create_new(true).open(&probe)?;
  std::fs::remove_file(probe)
}

/// Moves `names` (those present) from `dir` into a new `dir\Phosphor` (or
/// `Phosphor (2)`, ...); the new folder. On failure, moves back what moved.
fn move_to_own_folder(dir: &Path, names: &[&str]) -> std::io::Result<PathBuf> {
  let mut n = 1;
  let to = loop {
    let to = dir.join(if n == 1 { "Phosphor".into() } else { format!("Phosphor ({n})") });
    match std::fs::create_dir(&to) {
      Ok(()) => break to,
      Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists && n < 100 => n += 1,
      Err(e) => return Err(e),
    }
  };
  let mut moved = vec![];
  for name in names.iter().filter(|n| dir.join(n).exists()) {
    if let Err(e) = std::fs::rename(dir.join(name), to.join(name)) {
      for m in moved.iter().rev() {
        let _ = std::fs::rename(to.join(m), dir.join(m));
      }
      let _ = std::fs::remove_dir(&to);
      return Err(e);
    }
    moved.push(name);
  }
  Ok(to)
}

/// `p` resolved, without the `\\?\` prefix that WebView2 and the dialogs must not get.
#[cfg(windows)]
fn canon(p: PathBuf) -> Option<PathBuf> {
  let s = p.canonicalize().ok()?.into_os_string().into_string().ok()?;
  Some(PathBuf::from(match s.strip_prefix(r"\\?\UNC\") {
    Some(unc) => format!(r"\\{unc}"),
    None => s.strip_prefix(r"\\?\").unwrap_or(&s).to_string(),
  }))
}

/// Detects the marker, asks when the exe is not in a folder of its own,
/// creates the data folder. Quits the process on the user's word, after a
/// move (the moved exe starts instead), or on an unwritable folder.
#[cfg(windows)]
pub fn init() {
  let Some(exe) = std::env::current_exe().ok().and_then(canon) else { return };
  let (Some(exe_dir), Some(exe_name)) = (exe.parent(), exe.file_name().and_then(|n| n.to_str())) else { return };
  if !exe_dir.join(MARKER).is_file() {
    return;
  }
  let data = exe_dir.join(DATA);
  let accepted = data.join(ACCEPTED);
  let here = exe_dir.display().to_string();
  if std::fs::read_to_string(&accepted).ok().as_deref() != Some(here.as_str()) {
    let shared: Vec<PathBuf> =
      [dirs::download_dir(), dirs::desktop_dir(), dirs::document_dir(), dirs::home_dir()].into_iter().flatten().filter_map(canon).collect();
    let temp = canon(std::env::temp_dir()).unwrap_or_else(std::env::temp_dir);
    match poor_place(exe_dir, &shared, &temp) {
      Some(Poor::Temp) => {
        dialog::in_temp(exe_dir);
        std::process::exit(0);
      }
      Some(Poor::Shared) => match dialog::shared(exe_dir) {
        dialog::Choice::Move => {
          let started = move_to_own_folder(exe_dir, &[exe_name, MARKER, DATA])
            .and_then(|to| std::process::Command::new(to.join(exe_name)).current_dir(&to).spawn().map(|_| ()));
          if let Err(e) = started {
            dialog::cannot_move(exe_dir, &e);
            std::process::exit(1);
          }
          std::process::exit(0);
        }
        dialog::Choice::Quit => std::process::exit(0),
        dialog::Choice::Continue => {
          // A failure here meets the unwritable check below.
          let _ = std::fs::create_dir_all(&data).and_then(|_| std::fs::write(&accepted, &here));
        }
      },
      None => {}
    }
  }
  // Probed only after the user's word: a launch that ends in Quit writes nothing.
  if let Err(e) = writable(if data.is_dir() { &data } else { exe_dir }) {
    dialog::cannot_write(exe_dir, &e);
    std::process::exit(1);
  }
  if let Err(e) = std::fs::create_dir_all(&data) {
    dialog::cannot_write(exe_dir, &e);
    std::process::exit(1);
  }
  let _ = DIR.set(data);
}

#[cfg(windows)]
mod dialog {
  use std::path::Path;
  use windows_sys::Win32::UI::Controls::*;

  pub enum Choice {
    Move,
    Continue,
    Quit,
  }

  const MOVE: i32 = 100;
  const CONTINUE: i32 = 101;
  const QUIT: i32 = 102;
  const WHY: &str = "Portable Phosphor keeps its data in a folder beside phosphor.exe.";

  fn w(s: &str) -> Vec<u16> {
    s.encode_utf16().chain(Some(0)).collect()
  }

  /// A modal Windows task dialog; the id of the button pressed (QUIT on Esc).
  fn show(icon: windows_sys::core::PCWSTR, head: &str, body: &str, buttons: &[(i32, &str)]) -> i32 {
    let (title, head, body) = (w("Phosphor"), w(head), w(body));
    let texts: Vec<Vec<u16>> = buttons.iter().map(|(_, t)| w(t)).collect();
    let btns: Vec<TASKDIALOG_BUTTON> =
      buttons.iter().zip(&texts).map(|((id, _), t)| TASKDIALOG_BUTTON { nButtonID: *id, pszButtonText: t.as_ptr() }).collect();
    let mut pressed = QUIT;
    unsafe {
      let mut c: TASKDIALOGCONFIG = std::mem::zeroed();
      c.cbSize = std::mem::size_of::<TASKDIALOGCONFIG>() as u32;
      c.dwFlags = TDF_USE_COMMAND_LINKS | TDF_ALLOW_DIALOG_CANCELLATION;
      c.pszWindowTitle = title.as_ptr();
      c.Anonymous1.pszMainIcon = icon;
      c.pszMainInstruction = head.as_ptr();
      c.pszContent = body.as_ptr();
      c.cButtons = btns.len() as u32;
      c.pButtons = btns.as_ptr();
      c.nDefaultButton = btns.first().map_or(0, |b| b.nButtonID);
      if TaskDialogIndirect(&c, &mut pressed, std::ptr::null_mut(), std::ptr::null_mut()) < 0 {
        return QUIT;
      }
    }
    // Esc and the close box report IDCANCEL (2).
    if pressed == 2 { QUIT } else { pressed }
  }

  pub fn shared(dir: &Path) -> Choice {
    let body = format!(
      "{WHY} Put phosphor.exe in a folder of its own so its files stay together.\n\nCurrent folder: {}",
      dir.display()
    );
    match show(TD_WARNING_ICON, "phosphor.exe is not in a folder of its own", &body, &[
      (MOVE, "Move to its own folder\nMoves phosphor.exe into a new Phosphor folder here and restarts"),
      (CONTINUE, "Continue here\nKeeps data in this folder; not asked again here"),
      (QUIT, "Quit"),
    ]) {
      MOVE => Choice::Move,
      CONTINUE => Choice::Continue,
      _ => Choice::Quit,
    }
  }

  pub fn in_temp(dir: &Path) {
    let body = format!(
      "phosphor.exe is running from a temporary folder, as when opened inside a zip file. Windows deletes this folder. \
       Extract the zip, then run phosphor.exe from the extracted Phosphor folder.\n\nCurrent folder: {}",
      dir.display()
    );
    show(TD_WARNING_ICON, "Extract Phosphor before running it", &body, &[(QUIT, "Quit")]);
  }

  pub fn cannot_move(dir: &Path, e: &std::io::Error) {
    let body = format!("{e}\n\nCurrent folder: {}\n\nMove phosphor.exe and phosphor.portable into a new folder by hand.", dir.display());
    show(TD_ERROR_ICON, "Phosphor could not be moved", &body, &[(QUIT, "Quit")]);
  }

  pub fn cannot_write(dir: &Path, e: &std::io::Error) {
    let body = format!(
      "{WHY}\n\n{e}\n\nCurrent folder: {}\n\nMove the Phosphor folder to a location you can write to, such as Documents.",
      dir.display()
    );
    show(TD_ERROR_ICON, "Phosphor cannot write to its folder", &body, &[(QUIT, "Quit")]);
  }
}

#[cfg(test)]
mod tests {
  use super::*;

  const TMP: &str = r"C:\Users\a\AppData\Local\Temp";

  fn shared() -> Vec<PathBuf> {
    [r"C:\Users\a\Downloads", r"C:\Users\a\Desktop", r"C:\Users\a\Documents", r"C:\Users\a"].map(PathBuf::from).to_vec()
  }

  #[test]
  fn shared_folder_roots_are_poor_their_subfolders_are_not() {
    let (s, t) = (shared(), Path::new(TMP));
    for root in &s {
      assert_eq!(poor_place(root, &s, t), Some(Poor::Shared), "{}", root.display());
      assert_eq!(poor_place(&root.join("Phosphor"), &s, t), None, "{}", root.display());
    }
    assert_eq!(poor_place(Path::new(r"C:\Users\a\Downloads2"), &s, t), None);
    assert_eq!(poor_place(Path::new(r"D:\Apps\Phosphor"), &s, t), None);
  }

  #[test]
  #[cfg(windows)]
  fn drive_root_is_poor() {
    assert_eq!(poor_place(Path::new(r"D:\"), &shared(), Path::new(TMP)), Some(Poor::Shared));
  }

  #[test]
  fn zip_extraction_temp_is_poor() {
    let t = Path::new(TMP);
    assert_eq!(poor_place(&t.join("Temp1_Phosphor-portable.zip"), &shared(), t), Some(Poor::Temp));
    assert_eq!(poor_place(&t.join(r"Temp1_Phosphor-portable.zip\Phosphor"), &shared(), t), Some(Poor::Temp));
    assert_eq!(poor_place(Path::new(r"C:\Users\a\AppData\Local\Phosphor"), &shared(), t), None);
  }

  fn scratch(name: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!("phosphor-portable-{name}-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).unwrap();
    dir
  }

  #[test]
  fn unwritable_folder_is_refused_and_probe_leaves_nothing() {
    let dir = scratch("probe");
    writable(&dir).unwrap();
    assert_eq!(std::fs::read_dir(&dir).unwrap().count(), 0);
    let file = dir.join("file");
    std::fs::write(&file, "").unwrap();
    assert!(writable(&file.join("sub")).is_err());
    assert!(writable(&dir.join("missing")).is_err());
    std::fs::remove_dir_all(&dir).unwrap();
  }

  #[test]
  fn move_takes_the_next_free_name_and_leaves_others() {
    let dir = scratch("move");
    for f in ["phosphor.exe", MARKER, "other.txt"] {
      std::fs::write(dir.join(f), f).unwrap();
    }
    std::fs::create_dir(dir.join("Phosphor")).unwrap();
    let to = move_to_own_folder(&dir, &["phosphor.exe", MARKER, DATA]).unwrap();
    assert_eq!(to, dir.join("Phosphor (2)"));
    assert!(to.join("phosphor.exe").is_file() && to.join(MARKER).is_file() && !to.join(DATA).exists());
    assert!(!dir.join("phosphor.exe").exists() && dir.join("other.txt").is_file());
    std::fs::remove_dir_all(&dir).unwrap();
  }

  #[test]
  #[cfg(windows)]
  fn failed_move_puts_back_what_moved() {
    use std::os::windows::fs::OpenOptionsExt;
    let dir = scratch("rollback");
    std::fs::write(dir.join("phosphor.exe"), "").unwrap();
    std::fs::write(dir.join(MARKER), "").unwrap();
    // Held open with no sharing: Windows refuses to rename it.
    let held = std::fs::OpenOptions::new().read(true).share_mode(0).open(dir.join(MARKER)).unwrap();
    assert!(move_to_own_folder(&dir, &["phosphor.exe", MARKER]).is_err());
    drop(held);
    assert!(dir.join("phosphor.exe").is_file() && !dir.join("Phosphor").exists());
    std::fs::remove_dir_all(&dir).unwrap();
  }
}
