//! The OS material under the window, for the Mica and Liquid Glass skins
//! (docs/THEMES.md, Materials).
//!
//! Constraints:
//! - The window is created transparent on Windows and macOS (tauri.windows.conf.json,
//!   tauri.macos.conf.json); every other skin paints an opaque body, so the transparency
//!   costs nothing visible. This command only chooses what shows through it.
//! - Never an error to the page: a platform without the material answers "none" and the
//!   skin draws its opaque look.
//! - Windows: Mica (forced dark: MicaDark is apply_mica(Some(true))) needs Windows 11 (window-vibrancy refuses elsewhere, answered "none");
//!   Acrylic runs on 10 and 11. macOS: NSGlassEffectView from macOS 26, else an
//!   NSVisualEffectView material. Linux and Android: none.

/// The materials a skin may ask for.
#[tauri::command]
pub fn window_material(window: tauri::WebviewWindow, kind: String) -> String {
  apply(&window, &kind).to_string()
}

#[cfg(windows)]
fn apply(window: &tauri::WebviewWindow, kind: &str) -> &'static str {
  use tauri::window::{Color, Effect, EffectsBuilder};
  let set = |e: Option<tauri::utils::config::WindowEffectsConfig>| window.set_effects(e).is_ok();
  match kind {
    "mica" => {
      if set(Some(EffectsBuilder::new().effect(Effect::MicaDark).build())) { "mica" } else { let _ = set(None); "none" }
    }
    "glass" | "acrylic" => {
      if set(Some(EffectsBuilder::new().effect(Effect::Acrylic).color(Color(14, 16, 22, 90)).build())) { "acrylic" } else { let _ = set(None); "none" }
    }
    _ => { let _ = set(None); "none" }
  }
}

#[cfg(target_os = "macos")]
fn apply(window: &tauri::WebviewWindow, kind: &str) -> &'static str {
  use tauri::window::{Effect, EffectsBuilder};
  // Mica is Windows 11's; a Mac gets the opaque look of the skin.
  if kind != "glass" {
    let _ = window.set_effects(None);
    mac::glass(window, false);
    return "none";
  }
  if mac::glass(window, true) {
    let _ = window.set_effects(None);
    return "glass";
  }
  // Before macOS 26: the HUD window vibrancy under the transparent web view.
  if window.set_effects(Some(EffectsBuilder::new().effect(Effect::HudWindow).build())).is_ok() { "vibrancy" } else { "none" }
}

#[cfg(not(any(windows, target_os = "macos")))]
fn apply(_window: &tauri::WebviewWindow, _kind: &str) -> &'static str {
  "none"
}

#[cfg(target_os = "macos")]
mod mac {
  //! NSGlassEffectView (AppKit, macOS 26) inserted beneath the web view as the window's
  //! backdrop, the way window-vibrancy places an NSVisualEffectView. Looked up by name at
  //! run time: an older macOS has no such class and the call answers false.
  use objc2::runtime::{AnyClass, AnyObject};
  use objc2::msg_send;
  use objc2_foundation::NSRect;
  use std::sync::Mutex;

  // The one view this module created, as an address; zero when none.
  static VIEW: Mutex<usize> = Mutex::new(0);

  /// Insert (`on`) or remove the glass backdrop; true when it is in place.
  pub fn glass(window: &tauri::WebviewWindow, on: bool) -> bool {
    let Ok(ns) = window.ns_window() else { return false };
    let mut held = VIEW.lock().unwrap_or_else(|e| e.into_inner());
    unsafe {
      if !on {
        if *held != 0 {
          let v = *held as *mut AnyObject;
          let _: () = msg_send![v, removeFromSuperview];
          let _: () = msg_send![v, release];
          *held = 0;
        }
        return false;
      }
      if *held != 0 { return true; }
      let Some(cls) = AnyClass::get(c"NSGlassEffectView") else { return false };
      let win = ns as *mut AnyObject;
      let content: *mut AnyObject = msg_send![win, contentView];
      if content.is_null() { return false; }
      let view: *mut AnyObject = msg_send![cls, alloc];
      let view: *mut AnyObject = msg_send![view, init];
      if view.is_null() { return false; }
      let bounds: NSRect = msg_send![content, bounds];
      let _: () = msg_send![view, setFrame: bounds];
      // NSViewWidthSizable | NSViewHeightSizable
      let _: () = msg_send![view, setAutoresizingMask: 18usize];
      // NSWindowBelow, relative to nothing: under every sibling, the web view included.
      let _: () = msg_send![content, addSubview: view, positioned: -1isize, relativeTo: std::ptr::null_mut::<AnyObject>()];
      *held = view as usize;
      true
    }
  }
}
