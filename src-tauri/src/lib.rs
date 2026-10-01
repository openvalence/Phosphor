#[cfg(desktop)]
mod buttplug;
mod discovery;
mod plugins;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .plugin(tauri_plugin_http::init())
    .plugin(tauri_plugin_blec::init())
    .manage(plugins::TcpListeners::default())
    .invoke_handler(tauri::generate_handler![
      discovery::discover_hubs,
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
    ])
    .setup(|app| {
      if cfg!(debug_assertions) {
        app.handle().plugin(
          tauri_plugin_log::Builder::default()
            .level(log::LevelFilter::Info)
            .build(),
        )?;
      }
      #[cfg(desktop)]
      {
        use tauri::Manager;
        app.manage(buttplug::init(app.handle()));
      }
      Ok(())
    })
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
