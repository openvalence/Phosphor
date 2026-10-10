#[cfg(not(target_os = "ios"))]
mod buttplug;
mod discovery;
mod estop_udp;
mod plugins;
mod report;

/// The webview's own errors (window.onerror, unhandled rejections, console.error)
/// land in the log plugin's file so a field failure is readable without devtools.
#[tauri::command]
fn js_log(level: String, msg: String) {
  match level.as_str() {
    "error" => log::error!(target: "webview", "{msg}"),
    "warn" => log::warn!(target: "webview", "{msg}"),
    _ => log::info!(target: "webview", "{msg}"),
  }
}

/// Runs once, on the thread that loads this library: the only native context
/// whose FindClass sees the app's classes, which btleplug's init needs.
#[cfg(target_os = "android")]
#[no_mangle]
pub extern "system" fn JNI_OnLoad(vm: *mut jni::sys::JavaVM, _: *mut std::ffi::c_void) -> jni::sys::jint {
  buttplug::android::on_load(vm);
  jni::sys::JNI_VERSION_1_6
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  #[cfg(target_os = "android")]
  buttplug::android::set_runtime();
  // NVIDIA's proprietary driver cannot back WebKitGTK's DMABUF renderer: the
  // window stays blank on X11 and the Wayland connection dies with protocol
  // error 71 (measured on a Quadro RTX 5000, driver 610, 2026-10-04). Must be
  // set before GTK initializes; an explicit value in the environment wins.
  #[cfg(target_os = "linux")]
  if std::path::Path::new("/proc/driver/nvidia").exists()
    && std::env::var_os("WEBKIT_DISABLE_DMABUF_RENDERER").is_none()
  {
    std::env::set_var("WEBKIT_DISABLE_DMABUF_RENDERER", "1");
  }
  let builder = tauri::Builder::default()
    .plugin(tauri_plugin_http::init())
    .plugin(tauri_plugin_clipboard_manager::init())
    .plugin(tauri_plugin_blec::init())
    .manage(plugins::TcpListeners::default());
  builder
    .invoke_handler(tauri::generate_handler![
      js_log,
      discovery::discover_hubs,
      estop_udp::estop_broadcast,
      plugins::plugins_list,
      plugins::plugin_tcp_listen,
      plugins::plugin_tcp_close,
      report::save_report,
      #[cfg(desktop)]
      report::open_report_url,
      #[cfg(not(target_os = "ios"))]
      buttplug::bp_status,
      #[cfg(not(target_os = "ios"))]
      buttplug::bp_start,
      #[cfg(not(target_os = "ios"))]
      buttplug::bp_stop,
      #[cfg(not(target_os = "ios"))]
      buttplug::bp_scan_start,
      #[cfg(not(target_os = "ios"))]
      buttplug::bp_scan_stop,
      #[cfg(not(target_os = "ios"))]
      buttplug::bp_devices,
      #[cfg(not(target_os = "ios"))]
      buttplug::bp_machine_present,
      #[cfg(not(target_os = "ios"))]
      buttplug::bp_toy_scalar,
      #[cfg(not(target_os = "ios"))]
      buttplug::bp_toy_linear,
      #[cfg(not(target_os = "ios"))]
      buttplug::bp_toy_rotate,
      #[cfg(not(target_os = "ios"))]
      buttplug::bp_toy_stop,
      #[cfg(not(target_os = "ios"))]
      buttplug::bp_toy_read,
      #[cfg(not(target_os = "ios"))]
      buttplug::bp_stop_all,
      #[cfg(not(target_os = "ios"))]
      buttplug::bp_settings,
      #[cfg(not(target_os = "ios"))]
      buttplug::bp_settings_set,
      #[cfg(not(target_os = "ios"))]
      buttplug::bp_device_rename,
      #[cfg(not(target_os = "ios"))]
      buttplug::bp_device_forget,
      #[cfg(not(target_os = "ios"))]
      buttplug::bp_device_disconnect,
      #[cfg(not(target_os = "ios"))]
      buttplug::bp_clients,
      #[cfg(not(target_os = "ios"))]
      buttplug::bp_client_disconnect,
    ])
    .setup(|app| {
      // Release builds log too (file + stdout): js_log's webview errors are the
      // only field diagnostics an operator has.
      {
        use tauri_plugin_log::{Target, TargetKind};
        let mut b = tauri_plugin_log::Builder::default()
          .level(log::LevelFilter::Info)
          .targets([Target::new(TargetKind::Stdout), Target::new(TargetKind::LogDir { file_name: None })]);
        if cfg!(debug_assertions) { b = b.target(Target::new(TargetKind::Webview)); }
        app.handle().plugin(b.build())?;
      }
      #[cfg(not(target_os = "ios"))]
      {
        use tauri::Manager;
        app.manage(buttplug::init(app.handle()));
      }
      Ok(())
    })
    .build(tauri::generate_context!())
    .expect("error while running tauri application")
    .run(|_, _| {});
}
