#[cfg(desktop)]
mod buttplug;
mod discovery;
mod estop_udp;
mod plugins;

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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
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
      #[cfg(desktop)]
      buttplug::bp_status,
      #[cfg(desktop)]
      buttplug::bp_start,
      #[cfg(desktop)]
      buttplug::bp_stop,
      #[cfg(desktop)]
      buttplug::bp_scan_start,
      #[cfg(desktop)]
      buttplug::bp_scan_stop,
      #[cfg(desktop)]
      buttplug::bp_devices,
      #[cfg(desktop)]
      buttplug::bp_machine_present,
      #[cfg(desktop)]
      buttplug::bp_toy_scalar,
      #[cfg(desktop)]
      buttplug::bp_toy_linear,
      #[cfg(desktop)]
      buttplug::bp_toy_rotate,
      #[cfg(desktop)]
      buttplug::bp_toy_stop,
      #[cfg(desktop)]
      buttplug::bp_toy_read,
      #[cfg(desktop)]
      buttplug::bp_stop_all,
      #[cfg(desktop)]
      buttplug::bp_settings,
      #[cfg(desktop)]
      buttplug::bp_settings_set,
      #[cfg(desktop)]
      buttplug::bp_device_rename,
      #[cfg(desktop)]
      buttplug::bp_device_forget,
      #[cfg(desktop)]
      buttplug::bp_device_disconnect,
      #[cfg(desktop)]
      buttplug::bp_clients,
      #[cfg(desktop)]
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
      #[cfg(desktop)]
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
