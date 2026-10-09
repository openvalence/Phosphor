fn main() {
  // tauri-build adds every DEP_<NAME>_ANDROID_LIBRARY_PATH to the Android
  // project as a Gradle module, the way plugins ship their Kotlin. btleplug
  // ships none, so its Java half is named here (android/btleplug).
  if std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("android") {
    let dir = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("android").join("btleplug");
    std::env::set_var("DEP_BTLEPLUG_ANDROID_LIBRARY_PATH", dir);
  }
  tauri_build::build()
}
