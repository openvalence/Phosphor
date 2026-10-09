// buttplug.rs -- the embedded buttplug server: an Intiface-compatible
// websocket listener, the machine as one in-process device, toys from the
// btleplug/serial/hid managers.
//
// Constraints:
// - Prime Rule (DESIGN §10.8): the machine is a device whose commands leave as
//   `bp://motion` events for the webview, which owns the one Valence session
//   and feeds them to submitMotion. Nothing here speaks Valence, and the
//   fork's own Valence hardware manager is not linked.
// - Loopback only. LAN exposure is ph-vdk.28's ruling, not a flag.
// - The machine exists only while the webview reports a live hub
//   (bp_machine_present). Its Tx payload is the fork's valence protocol
//   (decode_payload), never Valence wire.
// - Upstream issues no hardware write for a stop on a position-only device,
//   so machine stops are read off the client message stream in serve().
// - Every command is async: buttplug spawns on the ambient tokio runtime, and
//   Tauri runs sync commands on the main thread, outside it.
// - Toy commands (bp_toy_*) enter through `Run::op`, an in-process server over
//   the same device manager, so they get upstream's range checks. They refuse
//   the machine: it moves only through the intent path.
// - Settings persist as settings.json under the app config dir. The port and
//   the hardware managers change only while the server is stopped, so the
//   saved settings always describe the running server.
// See: docs/BUTTPLUG.md

use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicU16, AtomicU32, AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};

use async_trait::async_trait;
use buttplug_core::connector::ButtplugConnector;
use buttplug_core::errors::ButtplugDeviceError;
use buttplug_core::message::{
  ButtplugClientMessageV4, ButtplugDeviceMessage, ButtplugMessageSpecVersion,
  ButtplugServerMessageV4, DeviceFeature, DeviceFeatureInput, DeviceFeatureOutput, DeviceListV4,
  DeviceMessageInfoV4,
  InputCmdV4, InputCommandType, InputType, InputTypeReading, OutputCmdV4, OutputCommand,
  OutputHwPositionWithDuration, OutputType, OutputValue, RequestDeviceListV0, RequestServerInfoV4,
  StartScanningV0, StopCmdV4, StopScanningV0,
};
use buttplug_core::ButtplugResultFuture;
use buttplug_server::connector::ButtplugRemoteServerConnector;
use buttplug_server::device::hardware::communication::{
  HardwareCommunicationManager, HardwareCommunicationManagerBuilder,
  HardwareCommunicationManagerEvent,
};
use buttplug_server::device::hardware::{
  Hardware, HardwareConnector, HardwareEvent, HardwareInternal, HardwareReadCmd, HardwareReading,
  HardwareSpecializer, HardwareSubscribeCmd, HardwareUnsubscribeCmd, HardwareWriteCmd,
};
use buttplug_server::device::protocol_impl::valence::decode_payload;
use buttplug_server::device::{ServerDeviceManager, ServerDeviceManagerBuilder};
use buttplug_server::message::serializer::ButtplugServerJSONSerializer;
use buttplug_server::message::spec_enums::ButtplugCheckedClientMessageV4;
use buttplug_server::message::{
  ButtplugClientMessageV0, ButtplugClientMessageV1, ButtplugClientMessageV2,
  ButtplugClientMessageV3, ButtplugClientMessageVariant, ButtplugServerMessageVariant,
};
use buttplug_server::{ButtplugServer, ButtplugServerBuilder};
use buttplug_server_device_config::{
  load_protocol_configs, save_user_config, Endpoint, ProtocolCommunicationSpecifier,
  ServerDeviceDefinition, ServerDeviceDefinitionBuilder, SimulatedDeviceConfigEntry,
  UserDeviceIdentifier, WebsocketSpecifier,
};
use buttplug_transport_websocket_tungstenite::ButtplugWebsocketServerTransportBuilder;
use futures::future::{self, BoxFuture, FutureExt};
use futures::StreamExt;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::{AppHandle, Emitter, Manager, State};
use tokio::sync::{broadcast, mpsc};
use tokio::task::JoinHandle;

/// Intiface Central's default server port, so apps connect unchanged.
pub const DEFAULT_PORT: u16 = 12345;
const SERVER_NAME: &str = "Phosphor";
/// The fork's protocol name and websocket specifier name (valence.yml).
const MACHINE_PROTOCOL: &str = "valence";
const MACHINE_ADDRESS: &str = "phosphor-machine";

/// (event name, payload) out to the webview; a channel in tests.
pub type Sink = Arc<dyn Fn(&'static str, Value) + Send + Sync>;

#[derive(Clone, Serialize)]
pub struct Status {
  running: bool,
  port: u16,
  clients: u32,
  scanning: bool,
}

/// The operator's server settings (settings.json). A field missing from the
/// file takes its default.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(default)]
pub struct Settings {
  port: u16,
  start_on_launch: bool,
  /// Hardware managers the next start builds.
  ble: bool,
  serial: bool,
  hid: bool,
  machine: bool,
  /// The lowest level bp://log carries: error, warn, info or debug.
  log_level: String,
}

impl Default for Settings {
  fn default() -> Self {
    Self {
      port: DEFAULT_PORT,
      start_on_launch: false,
      ble: true,
      serial: true,
      hid: true,
      machine: true,
      log_level: "info".into(),
    }
  }
}

impl Settings {
  fn managers(&self) -> [bool; 4] {
    [self.ble, self.serial, self.hid, self.machine]
  }
}

/// Unix ms on this host's clock.
fn now_ms() -> u64 {
  std::time::SystemTime::now()
    .duration_since(std::time::UNIX_EPOCH)
    .map_or(0, |d| d.as_millis() as u64)
}

fn parse_level(s: &str) -> Result<log::Level, String> {
  match s {
    "error" | "warn" | "info" | "debug" => Ok(s.parse().expect("a log::Level name")),
    _ => Err(format!("unknown log level \"{s}\"; one of error, warn, info, debug")),
  }
}

fn load_json<T: serde::de::DeserializeOwned>(dir: &Option<PathBuf>, file: &str) -> Option<Result<T, String>> {
  let text = std::fs::read_to_string(dir.as_ref()?.join(file)).ok()?;
  Some(serde_json::from_str(&text).map_err(|e| format!("{file}: {e}")))
}

/// Write-then-rename under one lock: device-list saves run on the watch task
/// while a command saves too, and a reader must never see a truncated file.
fn save_text(dir: &Option<PathBuf>, file: &str, text: &str) -> Result<(), String> {
  static SAVE: Mutex<()> = Mutex::new(());
  let Some(dir) = dir else { return Ok(()) };
  let _held = SAVE.lock().unwrap_or_else(|e| e.into_inner());
  let tmp = dir.join(format!("{file}.tmp"));
  std::fs::create_dir_all(dir)
    .and_then(|_| std::fs::write(&tmp, text))
    .and_then(|_| std::fs::rename(&tmp, dir.join(file)))
    .map_err(|e| format!("saving {file}: {e}"))
}

#[derive(Clone, Serialize)]
pub struct Device {
  index: u32,
  /// Stable across sessions (protocol plus address), for layout keys (law 10).
  key: String,
  /// The saved display name when there is one, else `device_name`.
  name: String,
  kind: &'static str,
  /// False for a device the saved device config remembers but that is not
  /// connected now; such an entry has no features or controls.
  connected: bool,
  features: Vec<String>,
  controls: Vec<ToyControl>,
  protocol: String,
  address: String,
  /// The protocol's own name for the device.
  device_name: String,
  /// The saved name override (devices.json); apps see it from the device's
  /// next connection.
  display_name: Option<String>,
}

/// One feature as a module control. `range` is in the steps the bp_toy_*
/// command takes; `ms` is a linear feature's duration range.
#[derive(Clone, Serialize)]
pub struct ToyControl {
  feature: u32,
  description: String,
  kind: &'static str,
  #[serde(rename = "type")]
  ty: String,
  #[serde(skip_serializing_if = "Option::is_none")]
  range: Option<[i32; 2]>,
  #[serde(skip_serializing_if = "Option::is_none")]
  ms: Option<[i32; 2]>,
}

/// Outputs a plain step value drives, in upstream's stop-command order.
const SCALAR: [OutputType; 7] = [
  OutputType::Constrict,
  OutputType::Temperature,
  OutputType::Spray,
  OutputType::Led,
  OutputType::Oscillate,
  OutputType::Vibrate,
  OutputType::Position,
];
/// Inputs that answer a Read with a value (InputTypeReading).
const READABLE: [InputType; 4] = [InputType::Battery, InputType::Rssi, InputType::Button, InputType::Pressure];

/// The one output a feature's control drives: linear over rotate over scalar.
fn output_of(f: &DeviceFeature) -> Option<(&'static str, OutputType)> {
  if f.contains_output(OutputType::HwPositionWithDuration) {
    return Some(("linear", OutputType::HwPositionWithDuration));
  }
  if f.contains_output(OutputType::Rotate) {
    return Some(("rotate", OutputType::Rotate));
  }
  SCALAR.into_iter().find(|t| f.contains_output(*t)).map(|t| ("scalar", t))
}

fn readable(i: &DeviceFeatureInput) -> bool {
  i.command().contains(InputCommandType::Read)
}

fn controls_of(f: &DeviceFeature) -> Vec<ToyControl> {
  let mut out = Vec::new();
  let control = |kind, ty: String, range, ms| ToyControl {
    feature: f.feature_index(),
    description: f.description().clone(),
    kind,
    ty,
    range,
    ms,
  };
  if let Some((kind, t)) = output_of(f) {
    let r = f.get_output_limits(t).map(|l| l.step_limit()).map(|r| [r.start(), r.end()]);
    let ms = match f.get_output(t) {
      Some(DeviceFeatureOutput::HwPositionWithDuration(p)) => Some([p.duration().start(), p.duration().end()]),
      _ => None,
    };
    out.push(control(kind, t.to_string(), r, ms));
  }
  for t in READABLE {
    if f.get_input(t).is_some_and(readable) {
      out.push(control("sensor", t.to_string(), None, None));
    }
  }
  out
}

/// [a-z0-9-] only: the key lands inside a `hero:plugin:<name>:<id>` layout key.
fn device_key(protocol: &str, address: &str) -> String {
  format!("{protocol}-{address}")
    .to_lowercase()
    .chars()
    .map(|c| if c.is_ascii_alphanumeric() { c } else { '-' })
    .collect()
}

struct Shared {
  sink: Sink,
  running: AtomicBool,
  port: AtomicU16,
  clients: AtomicU32,
  scanning: AtomicBool,
  present: AtomicBool,
  /// The device manager's found-device channel, once it has built our manager.
  found: Mutex<Option<mpsc::Sender<HardwareCommunicationManagerEvent>>>,
  /// The live machine's event channel, for a disconnect on hub loss.
  machine: Mutex<Option<broadcast::Sender<HardwareEvent>>>,
  /// Where settings persist; None keeps them in memory (tests).
  dir: Option<PathBuf>,
  settings: Mutex<Settings>,
  /// settings.log_level as a log::Level, read on every line.
  level: AtomicUsize,
  /// Bumped by every scan request; a timed stop fires only if unchanged.
  scan_gen: AtomicU32,
  /// The connected app, if any (one at a time, as Intiface).
  client: Mutex<Option<Client>>,
  next_client: AtomicU32,
}

/// A connected buttplug client as bp_clients reports it.
#[derive(Clone, Serialize)]
pub struct Client {
  /// Per connection, so a stale disconnect never reaches a newer client.
  id: u32,
  /// From the handshake; null until RequestServerInfo.
  name: Option<String>,
  /// The peer's address and port (loopback while the listener is).
  address: String,
  /// Unix ms at accept, on this host's clock.
  since: u64,
  /// Messages received, counted at each whole second.
  messages: u64,
  /// Messages received in the last whole second.
  rate: u32,
  #[serde(skip)]
  kick: Arc<tokio::sync::Notify>,
}

impl Shared {
  fn status(&self) -> Status {
    Status {
      running: self.running.load(Ordering::Relaxed),
      port: self.port.load(Ordering::Relaxed),
      clients: self.clients.load(Ordering::Relaxed),
      scanning: self.scanning.load(Ordering::Relaxed),
    }
  }

  fn emit_status(&self) {
    (self.sink)("bp://status", json!(self.status()));
  }

  fn clients(&self) -> Vec<Client> {
    self.client.lock().unwrap().iter().cloned().collect()
  }

  fn emit_clients(&self) {
    (self.sink)("bp://clients", json!(self.clients()));
  }

  fn log(&self, level: log::Level, msg: String) {
    if level as usize <= self.level.load(Ordering::Relaxed) {
      (self.sink)("bp://log", json!({ "level": level.as_str().to_lowercase(), "msg": msg, "time": now_ms() }));
    }
  }

  fn stop_machine(&self) {
    if self.present.load(Ordering::Relaxed) {
      (self.sink)("bp://motion", json!({ "stop": true }));
    }
  }

  /// Offer the machine to the device manager. A repeat is dropped there by
  /// address, so this is safe to call on every scan.
  fn announce(self: &Arc<Self>) {
    if !self.present.load(Ordering::Relaxed) {
      return;
    }
    if let Some(tx) = self.found.lock().unwrap().as_ref() {
      let _ = tx.try_send(HardwareCommunicationManagerEvent::DeviceFound {
        name: MACHINE_PROTOCOL.into(),
        address: MACHINE_ADDRESS.into(),
        creator: Box::new(MachineConnector(self.clone())),
      });
    }
  }
}

struct Run {
  dm: Arc<ServerDeviceManager>,
  /// Phosphor's own handshaken server over `dm`, for the bp_toy_* commands.
  op: Arc<ButtplugServer>,
  tasks: Vec<JoinHandle<()>>,
}

#[derive(Clone)]
pub struct Buttplug {
  sh: Arc<Shared>,
  run: Arc<tokio::sync::Mutex<Option<Run>>>,
}

impl Buttplug {
  #[cfg(test)]
  pub fn new(sink: Sink) -> Self {
    Self::new_in(sink, None)
  }

  /// `dir` holds settings.json; an unreadable file starts from the defaults,
  /// with a warning in the log.
  pub fn new_in(sink: Sink, dir: Option<PathBuf>) -> Self {
    let loaded = load_json::<Settings>(&dir, "settings.json");
    let settings = match &loaded {
      Some(Ok(s)) if parse_level(&s.log_level).is_ok() && s.port != 0 => s.clone(),
      _ => Settings::default(),
    };
    let level = parse_level(&settings.log_level).expect("checked above") as usize;
    let bp = Self {
      sh: Arc::new(Shared {
        sink,
        running: AtomicBool::new(false),
        port: AtomicU16::new(settings.port),
        clients: AtomicU32::new(0),
        scanning: AtomicBool::new(false),
        present: AtomicBool::new(false),
        found: Mutex::new(None),
        machine: Mutex::new(None),
        dir,
        settings: Mutex::new(settings),
        level: AtomicUsize::new(level),
        scan_gen: AtomicU32::new(0),
        client: Mutex::new(None),
        next_client: AtomicU32::new(0),
      }),
      run: Arc::new(tokio::sync::Mutex::new(None)),
    };
    match loaded {
      Some(Err(e)) => bp.sh.log(log::Level::Warn, format!("{e}; using the default settings")),
      Some(Ok(s)) if bp.settings() != s => bp.sh.log(log::Level::Warn, "settings.json is out of range; using the default settings".into()),
      _ => {}
    }
    bp
  }

  pub fn settings(&self) -> Settings {
    self.sh.settings.lock().unwrap().clone()
  }

  /// Save and apply. The port and the managers are refused while running;
  /// the log level and start-on-launch apply at once.
  pub fn set_settings(&self, new: Settings) -> Result<Settings, String> {
    if new.port == 0 {
      return Err("port 0 is not a listening port".into());
    }
    let level = parse_level(&new.log_level)?;
    let mut cur = self.sh.settings.lock().unwrap();
    if self.sh.running.load(Ordering::Relaxed) && (new.port != cur.port || new.managers() != cur.managers()) {
      return Err("stop the server to change the port or the hardware managers".into());
    }
    let text = serde_json::to_string_pretty(&new).map_err(|e| e.to_string())?;
    save_text(&self.sh.dir, "settings.json", &text)?;
    self.sh.level.store(level as usize, Ordering::Relaxed);
    *cur = new.clone();
    Ok(new)
  }

  pub async fn start(&self, port: u16) -> Result<(), String> {
    self.start_with(port, vec![]).await
  }

  /// A non-empty `sim` replaces the real toy managers with upstream's
  /// simulated devices (the tests' fake toys).
  async fn start_with(&self, port: u16, sim: Vec<SimulatedDeviceConfigEntry>) -> Result<(), String> {
    if port == 0 {
      return Err("port 0 is not a listening port".into());
    }
    self.stop().await;
    // The transport binds lazily inside its accept loop; probe here so a busy
    // port is an error to the caller, not a line in the log.
    std::net::TcpListener::bind(("127.0.0.1", port))
      .map_err(|e| format!("127.0.0.1:{}: {}", port, e))?;
    let real = sim.is_empty();
    let user = self.sh.dir.as_ref().and_then(|d| std::fs::read_to_string(d.join("devices.json")).ok());
    let base = match load_protocol_configs(&None, &user, false) {
      Err(e) if user.is_some() => {
        self.sh.log(log::Level::Warn, format!("devices.json: {e}; starting without the saved device config"));
        load_protocol_configs(&None, &None, false)
      }
      r => r,
    };
    let dcm = base.and_then(|mut b| b.simulated_devices(sim).finish()).map_err(|e| e.to_string())?;
    let st = self.settings();
    let mut b = ServerDeviceManagerBuilder::new(dcm);
    if st.machine {
      b.comm_manager(MachineManagerBuilder(self.sh.clone()));
    }
    if real {
      toy_managers(&mut b, &st, &self.sh);
    } else {
      b.add_simulated_devices_if_configured();
    }
    b.emit_output_observations(true);
    let dm = Arc::new(b.finish().map_err(|e| e.to_string())?);
    let op = Arc::new(
      ButtplugServerBuilder::with_shared_device_manager(dm.clone())
        .name(SERVER_NAME)
        .finish()
        .map_err(|e| e.to_string())?,
    );
    let rsi = RequestServerInfoV4::new(SERVER_NAME, ButtplugMessageSpecVersion::Version4, 0);
    op.parse_message(ButtplugClientMessageVariant::V4(ButtplugClientMessageV4::RequestServerInfo(rsi)))
      .await
      .map_err(|e| format!("operator handshake: {:?}", e))?;
    let tasks = vec![
      tokio::spawn(watch_devices(dm.clone(), self.sh.clone())),
      tokio::spawn(watch_outputs(dm.clone(), self.sh.clone())),
      tokio::spawn(serve(dm.clone(), port, self.sh.clone())),
    ];
    *self.run.lock().await = Some(Run { dm, op, tasks });
    self.sh.port.store(port, Ordering::Relaxed);
    self.sh.running.store(true, Ordering::Relaxed);
    self.sh.emit_status();
    self.sh.log(log::Level::Info, format!("buttplug server on 127.0.0.1:{}", port));
    Ok(())
  }

  pub async fn stop(&self) {
    let Some(run) = self.run.lock().await.take() else {
      return;
    };
    for t in run.tasks {
      t.abort();
    }
    self.sh.stop_machine();
    if let Ok(server) = ButtplugServerBuilder::with_shared_device_manager(run.dm).finish() {
      let _ = server.shutdown().await;
    }
    *self.sh.found.lock().unwrap() = None;
    *self.sh.machine.lock().unwrap() = None;
    self.sh.running.store(false, Ordering::Relaxed);
    self.sh.clients.store(0, Ordering::Relaxed);
    *self.sh.client.lock().unwrap() = None;
    self.sh.emit_clients();
    self.sh.scanning.store(false, Ordering::Relaxed);
    self.sh.emit_status();
    (self.sh.sink)("bp://devices", json!([]));
  }

  pub fn status(&self) -> Status {
    self.sh.status()
  }

  pub fn clients(&self) -> Vec<Client> {
    self.sh.clients()
  }

  /// Close one client's connection; the listener then takes the next one.
  pub fn disconnect_client(&self, id: u32) -> Result<(), String> {
    match self.sh.client.lock().unwrap().as_ref() {
      Some(c) if c.id == id => {
        c.kick.notify_one();
        Ok(())
      }
      _ => Err(format!("client {id} is not connected")),
    }
  }

  async fn dm(&self) -> Result<Arc<ServerDeviceManager>, String> {
    self
      .run
      .lock()
      .await
      .as_ref()
      .map(|r| r.dm.clone())
      .ok_or_else(|| "buttplug server is not running".into())
  }

  pub async fn scan(&self, on: bool) -> Result<(), String> {
    let msg = if on {
      ButtplugCheckedClientMessageV4::StartScanning(StartScanningV0::default())
    } else {
      ButtplugCheckedClientMessageV4::StopScanning(StopScanningV0::default())
    };
    let dm = self.dm().await?;
    // Any scan request outdates a pending timed stop.
    self.sh.scan_gen.fetch_add(1, Ordering::Relaxed);
    // Set before the request: the device manager runs it later, and a manager
    // that finishes at once reports ScanningFinished (watch_devices) after it.
    // Upstream sends no ScanningFinished after a stop request.
    self.sh.scanning.store(on, Ordering::Relaxed);
    self.sh.emit_status();
    dm.parse_message(msg).await.map(|_| ()).map_err(|e| format!("{:?}", e))
  }

  /// A scan that stops itself after `seconds` unless another scan request
  /// comes first; None or 0 scans until stopped.
  pub async fn scan_for(&self, seconds: Option<u32>) -> Result<(), String> {
    self.scan(true).await?;
    let Some(secs) = seconds.filter(|s| *s > 0) else {
      return Ok(());
    };
    let gen = self.sh.scan_gen.load(Ordering::Relaxed);
    let me = self.clone();
    let timer = tokio::spawn(async move {
      tokio::time::sleep(std::time::Duration::from_secs(secs.into())).await;
      if me.sh.scan_gen.load(Ordering::Relaxed) == gen && me.sh.scanning.load(Ordering::Relaxed) {
        if me.scan(false).await.is_ok() {
          me.sh.log(log::Level::Info, format!("scan stopped after {secs} s"));
        }
      }
    });
    if let Some(r) = self.run.lock().await.as_mut() {
      r.tasks.push(timer);
    }
    Ok(())
  }

  /// The saved device config entry under `key`, refusing the machine.
  async fn device_entry(&self, key: &str) -> Result<(Arc<ServerDeviceManager>, UserDeviceIdentifier, ServerDeviceDefinition), String> {
    let dm = self.dm().await?;
    let found = dm
      .device_configuration_manager()
      .user_device_definitions()
      .iter()
      .find(|kv| device_key(kv.key().protocol(), kv.key().address()) == key)
      .map(|kv| (kv.key().clone(), kv.value().clone()));
    let (id, def) = found.ok_or(format!("no device {key} in the device config"))?;
    if id.protocol() == MACHINE_PROTOCOL {
      return Err("the machine's identity is fixed (docs/BUTTPLUG.md)".into());
    }
    Ok((dm, id, def))
  }

  /// Save the name a device shows to apps from its next connection; None or
  /// blank goes back to the protocol's name.
  pub async fn rename(&self, key: &str, name: Option<String>) -> Result<(), String> {
    let (dm, id, def) = self.device_entry(key).await?;
    let name = name.map(|n| n.trim().to_string()).filter(|n| !n.is_empty());
    let def = ServerDeviceDefinitionBuilder::from_user(&def).display_name(&name).finish();
    dm.device_configuration_manager().add_user_device_definition(&id, &def);
    self.devices_changed(&dm).await
  }

  /// Drop a device's saved config (name, index). Refused while it is connected.
  pub async fn forget(&self, key: &str) -> Result<(), String> {
    let (dm, id, _) = self.device_entry(key).await?;
    if connected(&dm).await.iter().any(|(_, i)| *i == id) {
      return Err(format!("{key} is connected; disconnect it first"));
    }
    dm.device_configuration_manager().remove_user_device_definition(&id);
    self.devices_changed(&dm).await
  }

  /// Disconnect one toy; it returns when a scan finds it again.
  pub async fn disconnect_device(&self, index: u32) -> Result<(), String> {
    let dm = self.dm().await?;
    if is_machine(&dm, index) {
      return Err(format!("device {index} is the machine; it leaves with the hub"));
    }
    dm.disconnect_device(index).await.map_err(|e| format!("{e:?}"))
  }

  async fn devices_changed(&self, dm: &ServerDeviceManager) -> Result<(), String> {
    (self.sh.sink)("bp://devices", json!(self.devices().await));
    save_devices(&self.sh, dm)
  }

  pub async fn devices(&self) -> Vec<Device> {
    let Ok(dm) = self.dm().await else {
      return vec![];
    };
    let msg = ButtplugCheckedClientMessageV4::RequestDeviceList(RequestDeviceListV0::default());
    match dm.parse_message(msg).await {
      Ok(ButtplugServerMessageV4::DeviceList(dl)) => device_list(&dm, &dl),
      _ => vec![],
    }
  }

  /// A toy as the device list reports it, with the operator server; the
  /// machine is refused.
  async fn toy(&self, index: u32) -> Result<(Arc<ButtplugServer>, DeviceMessageInfoV4), String> {
    let (dm, op) = {
      let run = self.run.lock().await;
      let r = run.as_ref().ok_or("buttplug server is not running")?;
      (r.dm.clone(), r.op.clone())
    };
    if is_machine(&dm, index) {
      return Err(format!("device {index} is the machine; it moves only through the intent path"));
    }
    let msg = ButtplugCheckedClientMessageV4::RequestDeviceList(RequestDeviceListV0::default());
    let Ok(ButtplugServerMessageV4::DeviceList(dl)) = dm.parse_message(msg).await else {
      return Err("device list unavailable".into());
    };
    let d = dl.devices().get(&index).ok_or(format!("no device {index}"))?;
    Ok((op, d.clone()))
  }

  async fn toy_feature(&self, index: u32, feature: u32) -> Result<(Arc<ButtplugServer>, DeviceFeature), String> {
    let (op, d) = self.toy(index).await?;
    let f = d.device_features().get(&feature).ok_or(format!("device {index} has no feature {feature}"))?;
    Ok((op, f.clone()))
  }

  /// One OutputCmd through the operator server; resolves on the server's ack.
  async fn toy_output(&self, index: u32, feature: u32, kind: &str, cmd: impl FnOnce(OutputType) -> OutputCommand) -> Result<(), String> {
    let (op, f) = self.toy_feature(index, feature).await?;
    match output_of(&f) {
      Some((k, t)) if k == kind => {
        let msg = ButtplugClientMessageV4::OutputCmd(OutputCmdV4::new(index, feature, cmd(t)));
        op_call(&op, msg).await.map(|_| ())
      }
      _ => Err(format!("device {index} feature {feature} has no {kind} output")),
    }
  }

  pub async fn toy_scalar(&self, index: u32, feature: u32, value: i32) -> Result<(), String> {
    self
      .toy_output(index, feature, "scalar", |t| {
        OutputCommand::from_output_type(t, value).expect("SCALAR holds value outputs only")
      })
      .await
  }

  pub async fn toy_linear(&self, index: u32, feature: u32, position: u32, ms: u32) -> Result<(), String> {
    self
      .toy_output(index, feature, "linear", |_| {
        OutputCommand::HwPositionWithDuration(OutputHwPositionWithDuration::new(position, ms))
      })
      .await
  }

  pub async fn toy_rotate(&self, index: u32, feature: u32, speed: i32) -> Result<(), String> {
    self
      .toy_output(index, feature, "rotate", |_| OutputCommand::Rotate(OutputValue::new(speed)))
      .await
  }

  /// One toy's upstream stop set, outputs only: sensor subscriptions survive.
  /// Resolves on the write ack (bounded at 1 s upstream); position holds.
  pub async fn toy_stop(&self, index: u32) -> Result<(), String> {
    let (op, _) = self.toy(index).await?;
    let msg = ButtplugClientMessageV4::StopCmd(StopCmdV4::new(Some(index), None, false, true));
    op_call(&op, msg).await.map(|_| ())
  }

  /// Every device's stop set, write-acknowledged upstream (bounded at 1 s).
  pub async fn stop_all(&self) -> Result<(), String> {
    let op = self.run.lock().await.as_ref().map(|r| r.op.clone()).ok_or("buttplug server is not running")?;
    op_call(&op, ButtplugClientMessageV4::StopCmd(StopCmdV4::default())).await.map(|_| ())
  }

  /// One reading from a toy sensor (`input` is a type name, e.g. "Battery").
  pub async fn toy_read(&self, index: u32, feature: u32, input: String) -> Result<i64, String> {
    let (op, f) = self.toy_feature(index, feature).await?;
    let t = READABLE
      .into_iter()
      .find(|t| t.to_string() == input && f.get_input(*t).is_some_and(readable))
      .ok_or(format!("device {index} feature {feature} has no readable {input}"))?;
    let msg = ButtplugClientMessageV4::InputCmd(InputCmdV4::new(index, feature, t, InputCommandType::Read));
    match op_call(&op, msg).await? {
      ButtplugServerMessageV4::InputReading(r) => Ok(match r.reading() {
        InputTypeReading::Battery(v) => v.data().into(),
        InputTypeReading::Rssi(v) => v.data().into(),
        InputTypeReading::Button(v) => v.data().into(),
        InputTypeReading::Pressure(v) => v.data().into(),
      }),
      other => Err(format!("unexpected reply {:?}", other)),
    }
  }

  pub fn machine_present(&self, present: bool) {
    if self.sh.present.swap(present, Ordering::Relaxed) == present {
      return;
    }
    if present {
      self.sh.announce();
    } else if let Some(tx) = self.sh.machine.lock().unwrap().take() {
      let _ = tx.send(HardwareEvent::Disconnected(MACHINE_ADDRESS.into()));
    }
  }
}

fn toy_managers(b: &mut ServerDeviceManagerBuilder, st: &Settings, sh: &Shared) {
  use buttplug_server_hwmgr_btleplug::BtlePlugCommunicationManagerBuilder;
  if st.ble {
    #[cfg(target_os = "android")]
    let ready = android::ble();
    #[cfg(not(target_os = "android"))]
    let ready: Result<(), String> = Ok(());
    match ready {
      Ok(()) => {
        b.comm_manager(BtlePlugCommunicationManagerBuilder::default());
      }
      Err(e) => sh.log(log::Level::Warn, format!("BLE toys off: {e}")),
    }
  }
  // Settings keep serial and hid on Android; there they build nothing.
  #[cfg(desktop)]
  {
    use buttplug_server_hwmgr_hid::HidCommunicationManagerBuilder;
    use buttplug_server_hwmgr_serial::SerialPortCommunicationManagerBuilder;
    if st.serial {
      b.comm_manager(SerialPortCommunicationManagerBuilder::default());
    }
    if st.hid {
      b.comm_manager(HidCommunicationManagerBuilder::default());
    }
  }
}

/// btleplug's Android backend calls into Java from whichever thread polls it,
/// through a JNIEnv it never attaches itself, and caches its Java classes in
/// init. So: init runs in JNI_OnLoad (lib.rs), and Tauri's async runtime,
/// where the server and every buttplug task run, attaches each thread.
#[cfg(target_os = "android")]
pub mod android {
  use std::sync::OnceLock;

  static VM: OnceLock<jni::JavaVM> = OnceLock::new();
  static BLE: OnceLock<Result<(), String>> = OnceLock::new();

  pub fn on_load(raw: *mut jni::sys::JavaVM) {
    let r = match unsafe { jni::JavaVM::from_raw(raw) } {
      Ok(vm) => init(VM.get_or_init(|| vm)),
      Err(e) => Err(e.to_string()),
    };
    let _ = BLE.set(r);
  }

  fn init(vm: &jni::JavaVM) -> Result<(), String> {
    let env = vm.get_env().map_err(|e| e.to_string())?;
    // init unwraps its class lookups: a class missing from the APK panics,
    // and a panic must not unwind into the JVM.
    let r = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| btleplug::platform::init(&env)));
    let _ = env.exception_clear();
    match r {
      Ok(r) => r.map_err(|e| e.to_string()),
      Err(_) => Err("btleplug's Java classes are missing from the APK (src-tauri/android/btleplug)".into()),
    }
  }

  /// Why BLE toys are off, if they are.
  pub fn ble() -> Result<(), String> {
    BLE.get().cloned().unwrap_or_else(|| Err("JNI_OnLoad never ran".into()))
  }

  /// Tauri's default runtime with one change: every thread joins the JVM as a
  /// daemon (detached when the thread exits). Must run before anything spawns.
  pub fn set_runtime() {
    static RT: OnceLock<tokio::runtime::Runtime> = OnceLock::new();
    if RT.get().is_some() {
      return;
    }
    let rt = RT.get_or_init(|| {
      tokio::runtime::Builder::new_multi_thread()
        .enable_all()
        .on_thread_start(|| {
          if let Some(vm) = VM.get() {
            let _ = vm.attach_current_thread_as_daemon();
          }
        })
        .build()
        .expect("tokio runtime")
    });
    tauri::async_runtime::set(rt.handle().clone());
  }
}

/// Upstream's own log lines (the `log` facade, targets `buttplug*`) into
/// bp://log at the settings' level. Only one logger exists per process: where
/// another owns it (tauri-plugin-log in debug builds) this one is not installed.
struct BpLogger(Arc<Shared>);

impl log::Log for BpLogger {
  fn enabled(&self, m: &log::Metadata) -> bool {
    m.target().starts_with("buttplug") && m.level() as usize <= self.0.level.load(Ordering::Relaxed)
  }

  fn log(&self, r: &log::Record) {
    if self.enabled(r.metadata()) {
      self.0.log(r.level(), r.args().to_string());
    }
  }

  fn flush(&self) {}
}

/// Connected devices first, then the ones the saved device config remembers.
fn device_list(dm: &ServerDeviceManager, dl: &DeviceListV4) -> Vec<Device> {
  let defs = dm.device_configuration_manager().user_device_definitions();
  let entry = |index, id: &UserDeviceIdentifier, device_name: String, connected| {
    let display_name = defs.get(id).and_then(|d| d.display_name().clone());
    Device {
      index,
      key: device_key(id.protocol(), id.address()),
      name: display_name.clone().unwrap_or_else(|| device_name.clone()),
      kind: if id.protocol() == MACHINE_PROTOCOL { "machine" } else { "toy" },
      connected,
      features: vec![],
      controls: vec![],
      protocol: id.protocol().clone(),
      address: id.address().clone(),
      device_name,
      display_name,
    }
  };
  let mut out = Vec::new();
  let mut seen = Vec::new();
  for d in dl.devices().values() {
    let Some(info) = dm.device_info(d.device_index()) else { continue };
    let mut features: Vec<String> = Vec::new();
    for f in d.device_features().values() {
      if let Ok(Value::Object(m)) = serde_json::to_value(f) {
        for k in ["Output", "Input"] {
          if let Some(Value::Object(o)) = m.get(k) {
            features.extend(o.keys().cloned());
          }
        }
      }
    }
    features.sort();
    features.dedup();
    let mut dev = entry(d.device_index(), info.identifier(), d.device_name().clone(), true);
    dev.features = features;
    dev.controls = d.device_features().values().flat_map(controls_of).collect();
    seen.push(info.identifier().clone());
    out.push(dev);
  }
  for kv in defs.iter().filter(|kv| !seen.contains(kv.key())) {
    out.push(entry(kv.value().index(), kv.key(), kv.value().name().clone(), false));
  }
  out.sort_by_key(|d| (!d.connected, d.index));
  out
}

/// Connected devices' indices and config identities.
async fn connected(dm: &ServerDeviceManager) -> Vec<(u32, UserDeviceIdentifier)> {
  let msg = ButtplugCheckedClientMessageV4::RequestDeviceList(RequestDeviceListV0::default());
  match dm.parse_message(msg).await {
    Ok(ButtplugServerMessageV4::DeviceList(dl)) => dl
      .devices()
      .keys()
      .filter_map(|i| dm.device_info(*i).map(|d| (*i, d.identifier().clone())))
      .collect(),
    _ => vec![],
  }
}

/// The device config (names, reserved indices) to devices.json, as upstream's
/// user config file, which load_protocol_configs reads back at start.
fn save_devices(sh: &Shared, dm: &ServerDeviceManager) -> Result<(), String> {
  let text = save_user_config(dm.device_configuration_manager()).map_err(|e| format!("{e:?}"))?;
  save_text(&sh.dir, "devices.json", &text)
}

fn is_machine(dm: &ServerDeviceManager, index: u32) -> bool {
  dm.device_info(index)
    .is_some_and(|d| d.identifier().protocol() == MACHINE_PROTOCOL)
}

/// A stop the client aimed at the machine, in any message spec version.
fn stops_machine(msg: &ButtplugClientMessageVariant, dm: &ServerDeviceManager) -> bool {
  use ButtplugClientMessageVariant as V;
  let target: Option<Option<u32>> = match msg {
    V::V0(ButtplugClientMessageV0::StopAllDevices(_))
    | V::V1(ButtplugClientMessageV1::StopAllDevices(_))
    | V::V2(ButtplugClientMessageV2::StopAllDevices(_))
    | V::V3(ButtplugClientMessageV3::StopAllDevices(_)) => Some(None),
    V::V0(ButtplugClientMessageV0::StopDeviceCmd(m))
    | V::V1(ButtplugClientMessageV1::StopDeviceCmd(m))
    | V::V2(ButtplugClientMessageV2::StopDeviceCmd(m))
    | V::V3(ButtplugClientMessageV3::StopDeviceCmd(m)) => Some(Some(m.device_index())),
    V::V4(ButtplugClientMessageV4::StopCmd(m)) if m.outputs() => Some(m.device_index()),
    _ => None,
  };
  match target {
    None => false,
    Some(None) => true,
    Some(Some(i)) => is_machine(dm, i),
  }
}

/// One call into the operator server, its error reply as a string.
async fn op_call(op: &ButtplugServer, msg: ButtplugClientMessageV4) -> Result<ButtplugServerMessageV4, String> {
  match op.parse_message(ButtplugClientMessageVariant::V4(msg)).await {
    Ok(ButtplugServerMessageVariant::V4(m)) => Ok(m),
    Err(ButtplugServerMessageVariant::V4(ButtplugServerMessageV4::Error(e))) => Err(e.error_message().clone()),
    other => Err(format!("unexpected reply {:?}", other)),
  }
}

/// Applied outputs, from any client, as bp://output. The machine's position is
/// left out: it is bp://motion, and an app streams it far faster. The
/// machine's Vibrate is in: it moves nothing, and the node graph maps it.
async fn watch_outputs(dm: Arc<ServerDeviceManager>, sh: Arc<Shared>) {
  // A lagged receiver ends the stream; resubscribe. dm (held here) owns the
  // sender, so the stream never ends for good while this task runs.
  while let Some(obs) = dm.output_observation_stream() {
    futures::pin_mut!(obs);
    while let Some(o) = obs.next().await {
      let motion = o.output_type == OutputType::HwPositionWithDuration.to_string();
      if !(motion && is_machine(&dm, o.device_index)) {
        (sh.sink)(
          "bp://output",
          json!({ "index": o.device_index, "feature": o.feature_index, "type": o.output_type, "value": o.value }),
        );
      }
    }
  }
}

async fn watch_devices(dm: Arc<ServerDeviceManager>, sh: Arc<Shared>) {
  let events = dm.event_stream();
  futures::pin_mut!(events);
  while let Some(ev) = events.next().await {
    match ev {
      ButtplugServerMessageV4::DeviceList(dl) => {
        (sh.sink)("bp://devices", json!(device_list(&dm, &dl)));
        // A new device's config entry (its reserved index) persists at once.
        if let Err(e) = save_devices(&sh, &dm) {
          sh.log(log::Level::Warn, e);
        }
      }
      ButtplugServerMessageV4::ScanningFinished(_) => {
        sh.scanning.store(false, Ordering::Relaxed);
        sh.emit_status();
      }
      _ => {}
    }
  }
}

/// One client at a time, as Intiface: a fresh server per connection over the
/// shared device manager, because a server never accepts a second handshake.
async fn serve(dm: Arc<ServerDeviceManager>, port: u16, sh: Arc<Shared>) {
  loop {
    let server = match ButtplugServerBuilder::with_shared_device_manager(dm.clone())
      .name(SERVER_NAME)
      .finish()
    {
      Ok(s) => Arc::new(s),
      Err(e) => {
        sh.log(log::Level::Error, format!("buttplug server: {}", e));
        break;
      }
    };
    let peer = Arc::new(Mutex::new(None::<std::net::SocketAddr>));
    let seen = peer.clone();
    let mut transport = ButtplugWebsocketServerTransportBuilder::default();
    transport
      .port(port)
      .listen_on_all_interfaces(false)
      .on_client_accepted(move |a| *seen.lock().unwrap() = Some(a));
    let mut connector =
      ButtplugRemoteServerConnector::<_, ButtplugServerJSONSerializer>::new(transport.finish());
    let (tx, mut rx) = mpsc::channel(256);
    if let Err(e) = connector.connect(tx).await {
      sh.log(log::Level::Error, format!("buttplug listener 127.0.0.1:{}: {}", port, e));
      break;
    }
    let address = peer.lock().unwrap().map_or_else(String::new, |a| a.to_string());
    let kick = Arc::new(tokio::sync::Notify::new());
    let since = now_ms();
    *sh.client.lock().unwrap() = Some(Client {
      id: sh.next_client.fetch_add(1, Ordering::Relaxed) + 1,
      name: None,
      address: address.clone(),
      since,
      messages: 0,
      rate: 0,
      kick: kick.clone(),
    });
    sh.clients.store(1, Ordering::Relaxed);
    sh.emit_status();
    sh.emit_clients();
    sh.log(log::Level::Info, format!("buttplug client connected from {address}"));
    let connector = Arc::new(connector);
    let replies = server.event_stream();
    futures::pin_mut!(replies);
    let second = std::time::Duration::from_secs(1);
    let mut tick = tokio::time::interval_at(tokio::time::Instant::now() + second, second);
    let mut window = 0u32;
    loop {
      tokio::select! {
        _ = kick.notified() => {
          sh.log(log::Level::Info, format!("buttplug client at {address} disconnected by the operator"));
          let _ = connector.disconnect().await;
          break;
        }
        _ = tick.tick() => {
          let name = server.client_name();
          let changed = sh.client.lock().unwrap().as_mut().is_some_and(|c| {
            let changed = c.rate != window || c.name != name;
            c.messages += u64::from(window);
            c.rate = window;
            c.name = name;
            changed
          });
          window = 0;
          if changed {
            sh.emit_clients();
          }
        }
        msg = rx.recv() => match msg {
          None => break,
          Some(msg) => {
            window += 1;
            if stops_machine(&msg, &dm) {
              sh.stop_machine();
            }
            let fut = server.parse_message(msg);
            let c = connector.clone();
            tokio::spawn(async move {
              let reply = fut.await.unwrap_or_else(|e| e);
              let _ = c.send(reply).await;
            });
          }
        },
        ev = replies.next() => match ev {
          None => break,
          Some(ev) => { let _ = connector.send(ev).await; }
        },
      }
    }
    if let Some(name) = server.client_name() {
      sh.log(log::Level::Info, format!("buttplug client \"{}\" disconnected", name));
    }
    let _ = server.disconnect().await;
    sh.stop_machine();
    sh.clients.store(0, Ordering::Relaxed);
    *sh.client.lock().unwrap() = None;
    sh.emit_status();
    sh.emit_clients();
  }
  sh.running.store(false, Ordering::Relaxed);
  sh.emit_status();
}

// ---- the machine as in-process hardware -------------------------------------

struct MachineManagerBuilder(Arc<Shared>);

impl HardwareCommunicationManagerBuilder for MachineManagerBuilder {
  fn finish(
    &mut self,
    sender: mpsc::Sender<HardwareCommunicationManagerEvent>,
  ) -> Box<dyn HardwareCommunicationManager> {
    *self.0.found.lock().unwrap() = Some(sender);
    self.0.announce();
    Box::new(MachineManager(self.0.clone()))
  }
}

struct MachineManager(Arc<Shared>);

impl HardwareCommunicationManager for MachineManager {
  fn name(&self) -> &'static str {
    "PhosphorMachineCommunicationManager"
  }

  fn start_scanning(&mut self) -> ButtplugResultFuture {
    self.0.announce();
    future::ready(Ok(())).boxed()
  }

  fn stop_scanning(&mut self) -> ButtplugResultFuture {
    future::ready(Ok(())).boxed()
  }

  fn can_scan(&self) -> bool {
    true
  }
}

struct MachineConnector(Arc<Shared>);

impl std::fmt::Debug for MachineConnector {
  fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
    f.write_str("MachineConnector")
  }
}

#[async_trait]
impl HardwareConnector for MachineConnector {
  fn specifier(&self) -> ProtocolCommunicationSpecifier {
    ProtocolCommunicationSpecifier::Websocket(WebsocketSpecifier::new(MACHINE_PROTOCOL))
  }

  async fn connect(&mut self) -> Result<Box<dyn HardwareSpecializer>, ButtplugDeviceError> {
    Ok(Box::new(MachineSpecializer(self.0.clone())))
  }
}

struct MachineSpecializer(Arc<Shared>);

#[async_trait]
impl HardwareSpecializer for MachineSpecializer {
  async fn specialize(
    &mut self,
    _: &[ProtocolCommunicationSpecifier],
  ) -> Result<Hardware, ButtplugDeviceError> {
    let (events, _) = broadcast::channel(16);
    *self.0.machine.lock().unwrap() = Some(events.clone());
    Ok(Hardware::new(
      MACHINE_PROTOCOL,
      MACHINE_ADDRESS,
      &[Endpoint::Tx],
      &None,
      false,
      Box::new(MachineHardware { sh: self.0.clone(), events }),
    ))
  }
}

struct MachineHardware {
  sh: Arc<Shared>,
  events: broadcast::Sender<HardwareEvent>,
}

fn unhandled<T: Send + 'static>(what: &str) -> BoxFuture<'static, Result<T, ButtplugDeviceError>> {
  future::ready(Err(ButtplugDeviceError::UnhandledCommand(format!(
    "the machine does not support {}",
    what
  ))))
  .boxed()
}

impl HardwareInternal for MachineHardware {
  fn disconnect(&self) -> BoxFuture<'static, Result<(), ButtplugDeviceError>> {
    let _ = self.events.send(HardwareEvent::Disconnected(MACHINE_ADDRESS.into()));
    future::ready(Ok(())).boxed()
  }

  fn event_stream(&self) -> broadcast::Receiver<HardwareEvent> {
    self.events.subscribe()
  }

  fn read_value(
    &self,
    _: &HardwareReadCmd,
  ) -> BoxFuture<'static, Result<HardwareReading, ButtplugDeviceError>> {
    unhandled("read")
  }

  fn write_value(&self, msg: &HardwareWriteCmd) -> BoxFuture<'static, Result<(), ButtplugDeviceError>> {
    match decode_payload(msg.data()) {
      Some((position, duration_ms)) => {
        (self.sh.sink)("bp://motion", json!({ "position": position, "ms": duration_ms }));
        future::ready(Ok(())).boxed()
      }
      None => unhandled("this payload"),
    }
  }

  fn subscribe(&self, _: &HardwareSubscribeCmd) -> BoxFuture<'static, Result<(), ButtplugDeviceError>> {
    unhandled("subscribe")
  }

  fn unsubscribe(&self, _: &HardwareUnsubscribeCmd) -> BoxFuture<'static, Result<(), ButtplugDeviceError>> {
    unhandled("unsubscribe")
  }
}

// ---- Tauri IPC (contract: docs/BUTTPLUG.md) ---------------------------------

/// Builds the server from the saved settings and starts it when they say
/// start on launch; the webview reads the result through bp_status.
pub fn init(app: &AppHandle) -> Buttplug {
  let dir = app.path().app_config_dir().ok().map(|d| d.join("buttplug"));
  let app = app.clone();
  let bp = Buttplug::new_in(
    Arc::new(move |ev, payload| {
      let _ = app.emit(ev, payload);
    }),
    dir,
  );
  if log::set_boxed_logger(Box::new(BpLogger(bp.sh.clone()))).is_ok() {
    log::set_max_level(log::LevelFilter::Debug);
  } else {
    bp.sh.log(log::Level::Info, "upstream buttplug log lines go to the dev console in this build".into());
  }
  let st = bp.settings();
  if st.start_on_launch {
    let b = bp.clone();
    tauri::async_runtime::spawn(async move {
      if let Err(e) = b.start(st.port).await {
        b.sh.log(log::Level::Error, format!("start on launch: {e}"));
      }
    });
  }
  bp
}

#[tauri::command]
pub async fn bp_status(bp: State<'_, Buttplug>) -> Result<Status, String> {
  Ok(bp.status())
}

#[tauri::command]
pub async fn bp_device_rename(bp: State<'_, Buttplug>, key: String, name: Option<String>) -> Result<(), String> {
  bp.rename(&key, name).await
}

#[tauri::command]
pub async fn bp_device_forget(bp: State<'_, Buttplug>, key: String) -> Result<(), String> {
  bp.forget(&key).await
}

#[tauri::command]
pub async fn bp_device_disconnect(bp: State<'_, Buttplug>, index: u32) -> Result<(), String> {
  bp.disconnect_device(index).await
}

#[tauri::command]
pub async fn bp_clients(bp: State<'_, Buttplug>) -> Result<Vec<Client>, String> {
  Ok(bp.clients())
}

#[tauri::command]
pub async fn bp_client_disconnect(bp: State<'_, Buttplug>, id: u32) -> Result<(), String> {
  bp.disconnect_client(id)
}

#[tauri::command]
pub async fn bp_settings(bp: State<'_, Buttplug>) -> Result<Settings, String> {
  Ok(bp.settings())
}

#[tauri::command]
pub async fn bp_settings_set(bp: State<'_, Buttplug>, settings: Settings) -> Result<Settings, String> {
  bp.set_settings(settings)
}

#[tauri::command]
pub async fn bp_start(bp: State<'_, Buttplug>, port: u16) -> Result<(), String> {
  bp.start(port).await
}

#[tauri::command]
pub async fn bp_stop(bp: State<'_, Buttplug>) -> Result<(), String> {
  bp.stop().await;
  Ok(())
}

#[tauri::command]
pub async fn bp_scan_start(bp: State<'_, Buttplug>, seconds: Option<u32>) -> Result<(), String> {
  // Android grants Bluetooth at run time; the BLE plugin's check shows the
  // system prompt on first use and answers false until it is granted.
  #[cfg(target_os = "android")]
  if bp.settings().ble && !tauri_plugin_blec::check_permissions(false).map_err(|e| e.to_string())? {
    return Err("Bluetooth not allowed: allow Nearby devices for Phosphor, then scan again".into());
  }
  bp.scan_for(seconds).await
}

#[tauri::command]
pub async fn bp_scan_stop(bp: State<'_, Buttplug>) -> Result<(), String> {
  bp.scan(false).await
}

#[tauri::command]
pub async fn bp_devices(bp: State<'_, Buttplug>) -> Result<Vec<Device>, String> {
  Ok(bp.devices().await)
}

#[tauri::command]
pub async fn bp_toy_scalar(bp: State<'_, Buttplug>, index: u32, feature: u32, value: i32) -> Result<(), String> {
  bp.toy_scalar(index, feature, value).await
}

#[tauri::command]
pub async fn bp_toy_linear(bp: State<'_, Buttplug>, index: u32, feature: u32, position: u32, ms: u32) -> Result<(), String> {
  bp.toy_linear(index, feature, position, ms).await
}

#[tauri::command]
pub async fn bp_toy_rotate(bp: State<'_, Buttplug>, index: u32, feature: u32, speed: i32) -> Result<(), String> {
  bp.toy_rotate(index, feature, speed).await
}

#[tauri::command]
pub async fn bp_toy_stop(bp: State<'_, Buttplug>, index: u32) -> Result<(), String> {
  bp.toy_stop(index).await
}

#[tauri::command]
pub async fn bp_toy_read(bp: State<'_, Buttplug>, index: u32, feature: u32, input: String) -> Result<i64, String> {
  bp.toy_read(index, feature, input).await
}

#[tauri::command]
pub async fn bp_stop_all(bp: State<'_, Buttplug>) -> Result<(), String> {
  bp.stop_all().await
}

#[tauri::command]
pub async fn bp_machine_present(bp: State<'_, Buttplug>, present: bool) -> Result<(), String> {
  bp.machine_present(present);
  Ok(())
}

#[cfg(test)]
mod tests {
  use super::*;
  use futures::SinkExt;
  use std::time::Duration;
  use tokio_tungstenite::tungstenite::Message;

  type Ws = tokio_tungstenite::WebSocketStream<
    tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>,
  >;
  type Events = mpsc::UnboundedReceiver<(&'static str, Value)>;

  /// A running server with the machine present, its event channel standing in
  /// for the webview kernel, and a handshaken v3 client (the spec version
  /// Intiface-targeting apps speak).
  async fn session() -> (Buttplug, Events, Ws, u32) {
    let (tx, rx) = mpsc::unbounded_channel();
    let bp = Buttplug::new(Arc::new(move |ev, v| {
      let _ = tx.send((ev, v));
    }));
    let port = std::net::TcpListener::bind("127.0.0.1:0")
      .unwrap()
      .local_addr()
      .unwrap()
      .port();
    bp.start(port).await.unwrap();
    bp.machine_present(true);
    let mut ws = None;
    for _ in 0..50 {
      if let Ok((s, _)) = tokio_tungstenite::connect_async(format!("ws://127.0.0.1:{port}")).await {
        ws = Some(s);
        break;
      }
      tokio::time::sleep(Duration::from_millis(50)).await;
    }
    let mut ws = ws.expect("client connects to the loopback listener");
    let info = call(
      &mut ws,
      json!([{ "RequestServerInfo": { "Id": 1, "ClientName": "loopback", "MessageVersion": 3 } }]),
    )
    .await;
    assert!(info[0].get("ServerInfo").is_some(), "handshake: {info}");
    let mut index = None;
    for _ in 0..50 {
      let list = call(&mut ws, json!([{ "RequestDeviceList": { "Id": 2 } }])).await;
      index = list[0]["DeviceList"]["Devices"]
        .as_array()
        .and_then(|d| d.iter().find(|d| d["DeviceMessages"].get("LinearCmd").is_some()))
        .map(|d| d["DeviceIndex"].as_u64().unwrap() as u32);
      if index.is_some() {
        break;
      }
      tokio::time::sleep(Duration::from_millis(50)).await;
    }
    (bp, rx, ws, index.expect("RequestDeviceList returns the machine with LinearCmd"))
  }

  /// Send one message array, return the reply array (skipping unsolicited events).
  async fn call(ws: &mut Ws, msg: Value) -> Value {
    let id = msg[0].as_object().unwrap().values().next().unwrap()["Id"].clone();
    ws.send(Message::Text(msg.to_string().into())).await.unwrap();
    loop {
      let reply = tokio::time::timeout(Duration::from_secs(5), ws.next())
        .await
        .expect("reply within 5 s")
        .unwrap()
        .unwrap();
      let v: Value = serde_json::from_str(reply.to_text().unwrap()).unwrap();
      if v[0].as_object().unwrap().values().next().unwrap()["Id"] == id {
        return v;
      }
    }
  }

  async fn next_motion(rx: &mut Events) -> Value {
    loop {
      let (ev, v) = tokio::time::timeout(Duration::from_secs(5), rx.recv())
        .await
        .expect("bp://motion within 5 s")
        .unwrap();
      if ev == "bp://motion" {
        return v;
      }
    }
  }

  /// The TCode adapter's L0 mapping (plugins/examples/tcode-adapter parseL0):
  /// the digits are a fraction, `I` is the duration in ms.
  fn tcode_l0(digits: &str, interval: u32) -> (f64, u32) {
    (format!("0.{digits}").parse().unwrap(), interval)
  }

  #[tokio::test(flavor = "multi_thread")]
  async fn linear_cmd_maps_like_the_tcode_adapter() {
    let (bp, mut rx, mut ws, index) = session().await;
    for (n, (digits, interval)) in [("5", 100), ("25", 40), ("9999", 1000), ("0", 0), ("333", 250)]
      .into_iter()
      .enumerate()
    {
      let (pos, dur) = tcode_l0(digits, interval);
      let id = 10 + n as u32;
      let r = call(
        &mut ws,
        json!([{ "LinearCmd": { "Id": id, "DeviceIndex": index,
          "Vectors": [{ "Index": 0, "Duration": dur, "Position": pos }] } }]),
      )
      .await;
      assert!(r[0].get("Ok").is_some(), "LinearCmd: {r}");
      let m = next_motion(&mut rx).await;
      let got = m["position"].as_f64().unwrap();
      // One step: upstream rounds a float position UP to the device's step.
      let step = 1.0 / f64::from(buttplug_server::device::protocol_impl::valence::POSITION_STEPS);
      assert!((got - pos).abs() <= step, "L0{digits}I{interval}: {got} vs {pos}");
      assert_eq!(m["ms"].as_u64().unwrap() as u32, dur);
    }
    bp.stop().await;
  }

  #[tokio::test(flavor = "multi_thread")]
  async fn loopback_client_reaches_the_fake_kernel() {
    let (bp, mut rx, mut ws, index) = session().await;
    let devices = bp.devices().await;
    let machines: Vec<_> = devices.iter().filter(|d| d.kind == "machine").collect();
    assert_eq!(machines.len(), 1, "exactly one machine");
    assert_eq!(machines[0].index, index);
    assert!(machines[0].features.iter().any(|f| f == "HwPositionWithDuration"));

    let r = call(
      &mut ws,
      json!([{ "LinearCmd": { "Id": 5, "DeviceIndex": index,
        "Vectors": [{ "Index": 0, "Duration": 100, "Position": 0.5 }] } }]),
    )
    .await;
    assert!(r[0].get("Ok").is_some(), "LinearCmd: {r}");
    assert_eq!(next_motion(&mut rx).await, json!({ "position": 0.5, "ms": 100 }));

    let r = call(&mut ws, json!([{ "StopDeviceCmd": { "Id": 6, "DeviceIndex": index } }])).await;
    assert!(r[0].get("Ok").is_some(), "StopDeviceCmd: {r}");
    assert_eq!(next_motion(&mut rx).await, json!({ "stop": true }));

    // The machine's Vibrate is an observation only: bp://output, never motion.
    let m = bp.devices().await.into_iter().find(|d| d.kind == "machine").unwrap();
    let vib = m.controls.iter().find(|c| c.ty == "Vibrate").expect("the machine has a Vibrate control");
    assert_eq!((vib.kind, vib.range), ("scalar", Some([0, 100])));
    let r = call(
      &mut ws,
      json!([{ "ScalarCmd": { "Id": 7, "DeviceIndex": index,
        "Scalars": [{ "Index": 0, "Scalar": 0.5, "ActuatorType": "Vibrate" }] } }]),
    )
    .await;
    assert!(r[0].get("Ok").is_some(), "ScalarCmd: {r}");
    loop {
      let (ev, v) = tokio::time::timeout(Duration::from_secs(5), rx.recv()).await.expect("bp://output").unwrap();
      assert_ne!(ev, "bp://motion", "vibrate never moves the machine: {v}");
      // The StopDeviceCmd above zeroed it first.
      if ev == "bp://output" && v["value"] != 0.0 {
        assert_eq!(v, json!({ "index": index, "feature": vib.feature, "type": "Vibrate", "value": 50.0 }));
        break;
      }
    }

    assert_eq!(bp.status().clients, 1);
    bp.machine_present(false);
    let live_machine = |d: &Device| d.kind == "machine" && d.connected;
    for _ in 0..50 {
      if !bp.devices().await.iter().any(live_machine) {
        break;
      }
      tokio::time::sleep(Duration::from_millis(50)).await;
    }
    let devices = bp.devices().await;
    assert!(!devices.iter().any(live_machine), "hub loss disconnects the machine");
    assert!(devices.iter().any(|d| d.kind == "machine" && d.controls.is_empty()), "the config remembers it");
    bp.stop().await;
    assert!(!bp.status().running);
  }

  /// A running server with the machine and three upstream simulated toys
  /// (2-motor vibrator, rotator, stroker) standing in for BLE hardware, all
  /// connecting together: the machine is announced as the scan starts.
  struct Toys {
    bp: Buttplug,
    rx: Events,
    vib: Device,
    rot: Device,
    lin: Device,
    machine: Device,
  }

  async fn toys() -> Toys {
    toys_in(None).await
  }

  async fn toys_in(dir: Option<PathBuf>) -> Toys {
    let (tx, rx) = mpsc::unbounded_channel();
    let bp = Buttplug::new_in(
      Arc::new(move |ev, v| {
        let _ = tx.send((ev, v));
      }),
      dir,
    );
    let port = std::net::TcpListener::bind("127.0.0.1:0").unwrap().local_addr().unwrap().port();
    let sim = ["simulated-2vibe", "simulated-rotator", "simulated-stroker"]
      .map(|a| SimulatedDeviceConfigEntry::new(a, None))
      .to_vec();
    bp.start_with(port, sim).await.unwrap();
    bp.machine_present(true);
    bp.scan(true).await.unwrap();
    for _ in 0..200 {
      if bp.devices().await.iter().filter(|d| d.connected).count() == 4 {
        break;
      }
      tokio::time::sleep(Duration::from_millis(25)).await;
    }
    let devices: Vec<Device> = bp.devices().await.into_iter().filter(|d| d.connected).collect();
    assert_eq!(devices.len(), 4, "three toys and the machine, distinct indices: {:?}",
      devices.iter().map(|d| (d.index, &d.name)).collect::<Vec<_>>());
    for d in &devices {
      assert!(!d.key.is_empty() && d.key.chars().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-'), "key {}", d.key);
    }
    let with = |kind: &str| devices.iter().find(|d| d.kind == "toy" && d.controls.iter().any(|c| c.kind == kind)).unwrap().clone();
    let machine = devices.iter().find(|d| d.kind == "machine").unwrap().clone();
    Toys { vib: with("scalar"), rot: with("rotate"), lin: with("linear"), machine, bp, rx }
  }

  async fn next_output(rx: &mut Events) -> Value {
    loop {
      let (ev, v) = tokio::time::timeout(Duration::from_secs(5), rx.recv())
        .await
        .expect("bp://output within 5 s")
        .unwrap();
      if ev == "bp://output" {
        return v;
      }
    }
  }

  fn out(index: u32, feature: u32, ty: &str, value: f64) -> Value {
    json!({ "index": index, "feature": feature, "type": ty, "value": value })
  }

  #[tokio::test(flavor = "multi_thread")]
  async fn scalar_toy_commands_and_stops() {
    let Toys { bp, mut rx, vib, rot, machine, .. } = toys().await;
    // One control per feature, with the feature's own step range.
    assert_eq!(vib.controls.len(), 2);
    assert!(vib.controls.iter().all(|c| c.kind == "scalar" && c.ty == "Vibrate" && c.range == Some([0, 100])));

    bp.toy_scalar(vib.index, 1, 40).await.unwrap();
    assert_eq!(next_output(&mut rx).await, out(vib.index, 1, "Vibrate", 40.0));
    bp.toy_rotate(rot.index, 0, 30).await.unwrap();
    assert_eq!(next_output(&mut rx).await, out(rot.index, 0, "Rotate", 30.0));

    // Refusals resolve as error strings.
    assert!(bp.toy_scalar(vib.index, 0, 101).await.is_err(), "past the step range");
    assert!(bp.toy_rotate(vib.index, 0, 5).await.is_err(), "a vibrator has no rotate output");
    assert!(bp.toy_scalar(vib.index, 9, 5).await.is_err(), "no such feature");
    let e = bp.toy_linear(machine.index, 0, 5000, 100).await.unwrap_err();
    assert!(e.contains("machine"), "the machine is refused: {e}");
    assert!(bp.toy_stop(machine.index).await.is_err());

    // A toy stop zeroes that toy's outputs and leaves the rotator turning:
    // nothing for the rotator arrives before the marker write after it.
    bp.toy_stop(vib.index).await.unwrap();
    bp.toy_scalar(vib.index, 0, 7).await.unwrap();
    let mut got = Vec::new();
    loop {
      let o = next_output(&mut rx).await;
      if o == out(vib.index, 0, "Vibrate", 7.0) {
        break;
      }
      got.push(o);
    }
    got.sort_by_key(|v| v["feature"].as_u64());
    assert_eq!(got, vec![out(vib.index, 0, "Vibrate", 0.0), out(vib.index, 1, "Vibrate", 0.0)]);
    bp.stop().await;
  }

  #[tokio::test(flavor = "multi_thread")]
  async fn rotate_toy_and_stop_all() {
    let Toys { bp, mut rx, vib, rot, machine, .. } = toys().await;
    let c = &rot.controls[0];
    assert_eq!((c.kind, c.ty.as_str()), ("rotate", "Rotate"));
    assert!(c.range.unwrap()[0] < 0, "rotate range is signed: {:?}", c.range);
    bp.toy_rotate(rot.index, 0, -30).await.unwrap();
    assert_eq!(next_output(&mut rx).await, out(rot.index, 0, "Rotate", -30.0));
    bp.toy_scalar(vib.index, 0, 20).await.unwrap();
    assert_eq!(next_output(&mut rx).await, out(vib.index, 0, "Vibrate", 20.0));
    bp.stop_all().await.unwrap();
    let mut got = Vec::new();
    for _ in 0..4 {
      got.push(next_output(&mut rx).await);
    }
    got.sort_by_key(|v| (v["index"].as_u64(), v["feature"].as_u64()));
    // The machine's Vibrate is stopped too; its position is not an output here.
    let mv = machine.controls.iter().find(|c| c.ty == "Vibrate").unwrap().feature;
    let mut want = vec![
      out(rot.index, 0, "Rotate", 0.0),
      out(vib.index, 0, "Vibrate", 0.0),
      out(vib.index, 1, "Vibrate", 0.0),
      out(machine.index, mv, "Vibrate", 0.0),
    ];
    want.sort_by_key(|v| (v["index"].as_u64(), v["feature"].as_u64()));
    assert_eq!(got, want, "stop-all zeroes every toy and the machine's vibrate");
    bp.stop().await;
  }

  #[tokio::test(flavor = "multi_thread")]
  async fn linear_toy_takes_position_and_duration() {
    let Toys { bp, mut rx, lin, .. } = toys().await;
    let c = &lin.controls[0];
    assert_eq!((c.kind, c.ty.as_str(), c.range, c.ms), ("linear", "HwPositionWithDuration", Some([0, 1000]), Some([0, 100000])));
    bp.toy_linear(lin.index, 0, 500, 250).await.unwrap();
    assert_eq!(next_output(&mut rx).await, out(lin.index, 0, "HwPositionWithDuration", 500.0));
    assert!(bp.toy_scalar(lin.index, 0, 5).await.is_err(), "linear is not scalar");
    bp.stop().await;
  }

  fn temp_dir(name: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!("phosphor-bp-{name}-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    dir
  }

  #[tokio::test(flavor = "multi_thread")]
  async fn settings_persist_and_gate_the_managers() {
    let dir = temp_dir("settings");
    let (tx, mut rx) = mpsc::unbounded_channel();
    let sink: Sink = Arc::new(move |ev, v| {
      let _ = tx.send((ev, v));
    });
    let bp = Buttplug::new_in(sink.clone(), Some(dir.clone()));
    assert_eq!(bp.settings(), Settings::default());
    let port = std::net::TcpListener::bind("127.0.0.1:0").unwrap().local_addr().unwrap().port();
    let st = Settings { port, machine: false, log_level: "warn".into(), ..Settings::default() };
    assert_eq!(bp.set_settings(st.clone()).unwrap(), st);
    assert!(bp.set_settings(Settings { log_level: "loud".into(), ..st.clone() }).is_err());
    assert!(bp.set_settings(Settings { port: 0, ..st.clone() }).is_err());
    assert_eq!(bp.settings(), st, "a refused write changes nothing");
    assert_eq!(Buttplug::new_in(sink.clone(), Some(dir.clone())).settings(), st, "read back from the file");

    // The machine manager is off: a live hub adds no machine.
    bp.start_with(port, vec![SimulatedDeviceConfigEntry::new("simulated-2vibe", None)]).await.unwrap();
    bp.machine_present(true);
    bp.scan(true).await.unwrap();
    for _ in 0..200 {
      if !bp.devices().await.is_empty() {
        break;
      }
      tokio::time::sleep(Duration::from_millis(25)).await;
    }
    tokio::time::sleep(Duration::from_millis(200)).await;
    let devices = bp.devices().await;
    assert_eq!(devices.len(), 1, "the simulated toy only");
    assert!(devices.iter().all(|d| d.kind != "machine"));

    let e = bp.set_settings(Settings { machine: true, ..st.clone() }).unwrap_err();
    assert!(e.contains("stop the server"), "{e}");
    assert!(bp.set_settings(Settings { port: port + 1, ..st.clone() }).is_err());
    assert!(bp.set_settings(Settings { start_on_launch: true, ..st.clone() }).is_ok(), "start on launch applies while running");
    bp.stop().await;
    let mut levels = Vec::new();
    while let Ok((ev, v)) = rx.try_recv() {
      if ev == "bp://log" {
        levels.push(v["level"].as_str().unwrap().to_string());
      }
    }
    assert!(levels.iter().all(|l| l == "warn" || l == "error"), "below the level is dropped: {levels:?}");
    std::fs::remove_dir_all(&dir).ok();
  }

  async fn device(bp: &Buttplug, key: &str) -> Option<Device> {
    bp.devices().await.into_iter().find(|d| d.key == key)
  }

  #[tokio::test(flavor = "multi_thread")]
  async fn device_config_rename_disconnect_forget() {
    let dir = temp_dir("devices");
    let Toys { bp, vib, rot, machine, .. } = toys_in(Some(dir.clone())).await;
    assert_eq!((vib.connected, vib.display_name.as_deref()), (true, None));
    assert!(!vib.protocol.is_empty() && !vib.address.is_empty() && vib.name == vib.device_name);

    bp.rename(&vib.key, Some("  Bedside  ".into())).await.unwrap();
    let d = device(&bp, &vib.key).await.unwrap();
    assert_eq!((d.name.as_str(), d.display_name.as_deref(), d.connected), ("Bedside", Some("Bedside"), true));
    assert!(bp.rename(&machine.key, Some("x".into())).await.is_err(), "the machine keeps its identity");
    assert!(bp.rename("no-such-key", None).await.is_err());
    let e = bp.forget(&vib.key).await.unwrap_err();
    assert!(e.contains("disconnect it first"), "{e}");
    assert!(bp.disconnect_device(machine.index).await.is_err(), "the machine leaves with the hub");

    bp.disconnect_device(vib.index).await.unwrap();
    for _ in 0..100 {
      if !device(&bp, &vib.key).await.unwrap().connected {
        break;
      }
      tokio::time::sleep(Duration::from_millis(20)).await;
    }
    let d = device(&bp, &vib.key).await.unwrap();
    assert!(!d.connected && d.controls.is_empty(), "remembered, not connected");
    assert_eq!(d.name, "Bedside", "the saved name stays");
    assert!(device(&bp, &rot.key).await.unwrap().connected, "only that toy");

    // The name survives a restart through devices.json.
    bp.stop().await;
    let text = std::fs::read_to_string(dir.join("devices.json")).unwrap();
    assert!(text.contains("Bedside"), "devices.json: {text}");
    let again = toys_in(Some(dir.clone())).await;
    assert_eq!(device(&again.bp, &vib.key).await.unwrap().name, "Bedside");
    again.bp.rename(&vib.key, Some(" ".into())).await.unwrap();
    assert_eq!(device(&again.bp, &vib.key).await.unwrap().display_name, None, "blank resets");

    again.bp.disconnect_device(again.vib.index).await.unwrap();
    for _ in 0..100 {
      if !device(&again.bp, &vib.key).await.unwrap().connected {
        break;
      }
      tokio::time::sleep(Duration::from_millis(20)).await;
    }
    again.bp.forget(&vib.key).await.unwrap();
    assert!(device(&again.bp, &vib.key).await.is_none(), "forgotten");
    again.bp.stop().await;
    std::fs::remove_dir_all(&dir).ok();
  }

  #[tokio::test(flavor = "multi_thread")]
  async fn timed_scan_stops_itself() {
    // The machine manager alone: simulated toys finish scanning at once, and
    // the machine never does, so only the timer can end this scan.
    let (tx, mut rx) = mpsc::unbounded_channel();
    let bp = Buttplug::new(Arc::new(move |ev, v| {
      let _ = tx.send((ev, v));
    }));
    let port = std::net::TcpListener::bind("127.0.0.1:0").unwrap().local_addr().unwrap().port();
    bp.set_settings(Settings { port, ble: false, serial: false, hid: false, ..Settings::default() }).unwrap();
    bp.start(port).await.unwrap();
    bp.scan_for(Some(1)).await.unwrap();
    tokio::time::sleep(Duration::from_millis(300)).await;
    assert!(bp.status().scanning, "the machine manager alone keeps scanning");
    let stopped = tokio::time::timeout(Duration::from_secs(3), async {
      while let Some((ev, v)) = rx.recv().await {
        if ev == "bp://log" && v["msg"] == "scan stopped after 1 s" {
          return;
        }
      }
    });
    stopped.await.expect("the timer stops the scan");
    assert!(!bp.status().scanning);
    // A later scan request outdates the timer.
    bp.scan_for(Some(1)).await.unwrap();
    bp.scan(true).await.unwrap();
    tokio::time::sleep(Duration::from_millis(1500)).await;
    assert!(bp.status().scanning, "an outdated timer leaves a newer scan alone");
    bp.stop().await;
  }

  #[tokio::test(flavor = "multi_thread")]
  async fn clients_list_rate_and_operator_disconnect() {
    let (bp, mut rx, mut ws, _) = session().await;
    for n in 0..5 {
      call(&mut ws, json!([{ "RequestDeviceList": { "Id": 20 + n } }])).await;
    }
    // Name and counts land at the next whole second.
    let mut c = bp.clients();
    for _ in 0..60 {
      c = bp.clients();
      if c.len() == 1 && c[0].messages > 0 {
        break;
      }
      tokio::time::sleep(Duration::from_millis(50)).await;
    }
    assert_eq!(c.len(), 1);
    assert_eq!(c[0].name.as_deref(), Some("loopback"), "the handshake's name");
    assert!(c[0].address.starts_with("127.0.0.1:"), "{}", c[0].address);
    assert!(c[0].since > 0 && c[0].messages >= 5, "messages {}", c[0].messages);
    let id = c[0].id;

    assert!(bp.disconnect_client(id + 1).is_err(), "a stale id reaches nobody");
    bp.disconnect_client(id).unwrap();
    let closed = tokio::time::timeout(Duration::from_secs(5), async {
      while let Some(m) = ws.next().await {
        if matches!(m, Ok(Message::Close(_)) | Err(_)) {
          return;
        }
      }
    });
    closed.await.expect("the operator's disconnect closes the socket");
    for _ in 0..100 {
      if bp.status().clients == 0 {
        break;
      }
      tokio::time::sleep(Duration::from_millis(20)).await;
    }
    assert_eq!(bp.status().clients, 0);
    assert!(bp.clients().is_empty());
    let mut emptied = false;
    while let Ok((ev, v)) = rx.try_recv() {
      if ev == "bp://clients" && v == json!([]) {
        emptied = true;
      }
    }
    assert!(emptied, "bp://clients announces the empty list");

    // The listener takes the next client.
    let port = bp.status().port;
    let mut again = None;
    for _ in 0..50 {
      if let Ok((s, _)) = tokio_tungstenite::connect_async(format!("ws://127.0.0.1:{port}")).await {
        again = Some(s);
        break;
      }
      tokio::time::sleep(Duration::from_millis(50)).await;
    }
    let mut again = again.expect("reconnects");
    let info = call(&mut again, json!([{ "RequestServerInfo": { "Id": 1, "ClientName": "second", "MessageVersion": 3 } }])).await;
    assert!(info[0].get("ServerInfo").is_some());
    for _ in 0..60 {
      if bp.clients().first().is_some_and(|c| c.id > id) {
        break;
      }
      tokio::time::sleep(Duration::from_millis(50)).await;
    }
    assert!(bp.clients()[0].id > id, "a new connection gets a new id");
    bp.stop().await;
    assert!(bp.clients().is_empty());
  }
}
