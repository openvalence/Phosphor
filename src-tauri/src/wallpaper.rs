//! The desktop wallpaper, for the Liquid Glass Theme's backdrop layer
//! (docs/THEMES.md, Materials: the wallpaper layer).
//!
//! Constraints:
//! - Reads only the file the OS names as the current wallpaper, never a screen capture.
//!   `wallpaper_image` takes no path: the page cannot ask for any other file.
//! - A slideshow, spotlight, solid color, video or undecodable wallpaper answers none and the
//!   Theme draws its material or its opaque look; never an error to the page.
//! - One wallpaper for every monitor. Per-monitor paths need `IDesktopWallpaper` (Windows) and
//!   one `NSScreen` per window (macOS); the answer is the one the window sits on where the OS
//!   gives one (macOS) and the primary one otherwise.
//! - Rectangles are physical pixels, the monitor's and the window's client area, so the page
//!   lines the image up with the desktop behind the window by subtraction.

use std::path::{Path, PathBuf};

/// A decoded wallpaper is a few MB as a JPEG and tens as a BMP; a larger file is not sent.
const MAX_BYTES: u64 = 64 * 1024 * 1024;

struct Found {
  path: PathBuf,
  /// center, tile, stretch, fit, fill or span.
  fit: &'static str,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Wallpaper {
  /// Changes when the file does (path, modified time, size); the page refetches on a new key only.
  key: String,
  mime: &'static str,
  fit: &'static str,
  /// x, y, width, height in physical pixels.
  monitor: [i64; 4],
  window: [i64; 4],
  scale: f64,
}

/// What the wallpaper is and where the window sits on it; none when there is nothing to show.
#[tauri::command]
pub fn wallpaper_info(window: tauri::WebviewWindow) -> Option<Wallpaper> {
  let f = find(&window)?;
  let meta = std::fs::metadata(&f.path).ok().filter(|m| m.is_file() && m.len() <= MAX_BYTES)?;
  let mime = sniff(&f.path)?;
  let mon = window.current_monitor().ok()??;
  let (wp, ws) = (window.inner_position().ok()?, window.inner_size().ok()?);
  let (mp, ms) = (mon.position(), mon.size());
  let age = meta.modified().ok().and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok()).map_or(0, |d| d.as_secs());
  Some(Wallpaper {
    key: format!("{}|{}|{}", f.path.display(), age, meta.len()),
    mime,
    fit: f.fit,
    monitor: [mp.x as i64, mp.y as i64, ms.width as i64, ms.height as i64],
    window: [wp.x as i64, wp.y as i64, ws.width as i64, ws.height as i64],
    scale: mon.scale_factor(),
  })
}

/// The wallpaper file's bytes (an IPC response, not JSON), for the page to turn into a blob.
#[tauri::command]
pub fn wallpaper_image(window: tauri::WebviewWindow) -> Result<tauri::ipc::Response, String> {
  let f = find(&window).ok_or("no wallpaper")?;
  if std::fs::metadata(&f.path).map_err(|e| e.to_string())?.len() > MAX_BYTES {
    return Err("wallpaper too large".into());
  }
  std::fs::read(&f.path).map(tauri::ipc::Response::new).map_err(|e| e.to_string())
}

/// The image type by magic number; none for anything a page cannot draw.
fn sniff(path: &Path) -> Option<&'static str> {
  use std::io::Read;
  let mut b = [0u8; 12];
  std::fs::File::open(path).ok()?.read_exact(&mut b).ok()?;
  match &b {
    [0x89, b'P', b'N', b'G', ..] => Some("image/png"),
    [0xFF, 0xD8, 0xFF, ..] => Some("image/jpeg"),
    [b'B', b'M', ..] => Some("image/bmp"),
    [b'G', b'I', b'F', b'8', ..] => Some("image/gif"),
    [b'R', b'I', b'F', b'F', _, _, _, _, b'W', b'E', b'B', b'P'] => Some("image/webp"),
    [_, _, _, _, b'f', b't', b'y', b'p', ..] => Some("image/heic"),
    _ => None,
  }
}

#[cfg(windows)]
fn find(_window: &tauri::WebviewWindow) -> Option<Found> {
  use windows_sys::Win32::System::Registry::{RegGetValueW, HKEY_CURRENT_USER, RRF_RT_REG_DWORD, RRF_RT_REG_SZ};
  use windows_sys::Win32::UI::WindowsAndMessaging::{SystemParametersInfoW, SPI_GETDESKWALLPAPER};

  fn wide(s: &str) -> Vec<u16> { s.encode_utf16().chain(Some(0)).collect() }
  fn reg_sz(key: &str, name: &str) -> Option<String> {
    let (k, n) = (wide(key), wide(name));
    let mut buf = [0u16; 520];
    let mut bytes = (buf.len() * 2) as u32;
    let r = unsafe { RegGetValueW(HKEY_CURRENT_USER, k.as_ptr(), n.as_ptr(), RRF_RT_REG_SZ, std::ptr::null_mut(), buf.as_mut_ptr().cast(), &mut bytes) };
    (r == 0).then(|| String::from_utf16_lossy(&buf[..buf.iter().position(|&c| c == 0).unwrap_or(buf.len())]))
  }
  fn reg_dword(key: &str, name: &str) -> Option<u32> {
    let (k, n) = (wide(key), wide(name));
    let (mut v, mut bytes) = (0u32, 4u32);
    let r = unsafe { RegGetValueW(HKEY_CURRENT_USER, k.as_ptr(), n.as_ptr(), RRF_RT_REG_DWORD, std::ptr::null_mut(), (&mut v as *mut u32).cast(), &mut bytes) };
    (r == 0).then_some(v)
  }

  // BackgroundType: 0 picture, 1 solid color, 2 slideshow, 3 spotlight. Absent is a picture.
  if reg_dword(r"Software\Microsoft\Windows\CurrentVersion\Explorer\Wallpapers", "BackgroundType").is_some_and(|t| t != 0) {
    return None;
  }
  let mut buf = [0u16; 520];
  let ok = unsafe { SystemParametersInfoW(SPI_GETDESKWALLPAPER, buf.len() as u32, buf.as_mut_ptr().cast(), 0) };
  let len = buf.iter().position(|&c| c == 0).unwrap_or(0);
  if ok == 0 || len == 0 { return None; }
  let path = PathBuf::from(String::from_utf16_lossy(&buf[..len]));
  let desk = r"Control Panel\Desktop";
  let tiled = reg_sz(desk, "TileWallpaper").as_deref() == Some("1");
  let fit = match reg_sz(desk, "WallpaperStyle").as_deref() {
    _ if tiled => "tile",
    Some("0") => "center",
    Some("2") => "stretch",
    Some("6") => "fit",
    Some("22") => "span",
    _ => "fill",
  };
  Some(Found { path, fit })
}

#[cfg(target_os = "macos")]
fn find(window: &tauri::WebviewWindow) -> Option<Found> {
  use objc2::msg_send;
  use objc2::runtime::{AnyClass, AnyObject, Bool};
  use std::ffi::{c_char, CStr};

  // The wallpaper of the screen the window is on. NSWorkspace answers a folder for a dynamic or
  // Aerial wallpaper; sniff() then finds no image and the Theme draws its material.
  unsafe {
    let win = window.ns_window().ok()? as *mut AnyObject;
    let screen: *mut AnyObject = msg_send![win, screen];
    if screen.is_null() { return None; }
    let ws: *mut AnyObject = msg_send![AnyClass::get(c"NSWorkspace")?, sharedWorkspace];
    let url: *mut AnyObject = msg_send![ws, desktopImageURLForScreen: screen];
    if url.is_null() { return None; }
    let p: *mut AnyObject = msg_send![url, path];
    if p.is_null() { return None; }
    let c: *const c_char = msg_send![p, UTF8String];
    if c.is_null() { return None; }
    let path = PathBuf::from(CStr::from_ptr(c).to_str().ok()?);

    // NSImageScaling: 0 proportionally down, 1 axes independently (stretch), 2 none (center),
    // 3 proportionally up or down (fit, or fill when clipping is allowed).
    let opts: *mut AnyObject = msg_send![ws, desktopImageOptionsForScreen: screen];
    let nsstring = AnyClass::get(c"NSString")?;
    let get = |key: &CStr| -> *mut AnyObject {
      if opts.is_null() { return std::ptr::null_mut(); }
      let k: *mut AnyObject = msg_send![nsstring, stringWithUTF8String: key.as_ptr()];
      msg_send![opts, objectForKey: k]
    };
    let scaling = get(c"NSWorkspaceDesktopImageScalingKey");
    let clip = get(c"NSWorkspaceDesktopImageAllowClippingKey");
    let scaling: isize = if scaling.is_null() { 3 } else { msg_send![scaling, integerValue] };
    let clipping: bool = if clip.is_null() { true } else { let b: Bool = msg_send![clip, boolValue]; b.as_bool() };
    let fit = match scaling {
      1 => "stretch",
      2 => "center",
      3 if clipping => "fill",
      _ => "fit",
    };
    Some(Found { path, fit })
  }
}

#[cfg(target_os = "linux")]
fn find(_window: &tauri::WebviewWindow) -> Option<Found> {
  // GNOME's background settings (also what Cinnamon and MATE-derived desktops mirror); KDE's
  // plasma config is not read: no gsettings answer means none.
  fn gs(schema: &str, key: &str) -> Option<String> {
    let o = std::process::Command::new("gsettings").args(["get", schema, key]).output().ok()?;
    o.status.success().then(|| String::from_utf8_lossy(&o.stdout).trim().trim_matches('\'').to_string())
  }
  fn unescape(s: &str) -> String {
    let b = s.as_bytes();
    let mut out = Vec::with_capacity(b.len());
    let mut i = 0;
    while i < b.len() {
      let hex = |c: u8| (c as char).to_digit(16);
      match (b[i], b.get(i + 1).copied().and_then(hex), b.get(i + 2).copied().and_then(hex)) {
        (b'%', Some(h), Some(l)) => { out.push((h * 16 + l) as u8); i += 3; }
        (c, ..) => { out.push(c); i += 1; }
      }
    }
    String::from_utf8_lossy(&out).into_owned()
  }
  let bg = "org.gnome.desktop.background";
  let dark = gs("org.gnome.desktop.interface", "color-scheme").is_some_and(|s| s.contains("dark"));
  let uri = gs(bg, if dark { "picture-uri-dark" } else { "picture-uri" }).or_else(|| gs(bg, "picture-uri"))?;
  let path = PathBuf::from(unescape(uri.strip_prefix("file://")?));
  let fit = match gs(bg, "picture-options").as_deref() {
    Some("none") => return None,
    Some("wallpaper") => "tile",
    Some("centered") => "center",
    Some("scaled") => "fit",
    Some("stretched") => "stretch",
    Some("spanned") => "span",
    _ => "fill",
  };
  Some(Found { path, fit })
}

#[cfg(not(any(windows, target_os = "macos", target_os = "linux")))]
fn find(_window: &tauri::WebviewWindow) -> Option<Found> {
  None
}
