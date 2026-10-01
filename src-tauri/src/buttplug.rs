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
// - Upstream's StopCmd ignores its device index and stops every device, so a
//   one-toy stop is zero outputs, never a StopCmd (toy_stop).
// See: docs/BUTTPLUG.md

use std::sync::atomic::{AtomicBool, AtomicU16, AtomicU32, Ordering};
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
  load_protocol_configs, Endpoint, ProtocolCommunicationSpecifier, SimulatedDeviceConfigEntry,
  WebsocketSpecifier,
};
use buttplug_transport_websocket_tungstenite::ButtplugWebsocketServerTransportBuilder;
use futures::future::{self, BoxFuture, FutureExt};
use futures::StreamExt;
use serde::Serialize;
use serde_json::{json, Value};
use tauri::{AppHandle, Emitter, State};
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

#[derive(Clone, Serialize)]
pub struct Device {
  index: u32,
  /// Stable across sessions (protocol plus address), for layout keys (law 10).
  key: String,
  name: String,
  kind: &'static str,
  connected: bool,
  features: Vec<String>,
  controls: Vec<ToyControl>,
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

  fn log(&self, level: &str, msg: String) {
    (self.sink)("bp://log", json!({ "level": level, "msg": msg }));
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

pub struct Buttplug {
  sh: Arc<Shared>,
  run: tokio::sync::Mutex<Option<Run>>,
}

impl Buttplug {
  pub fn new(sink: Sink) -> Self {
    Self {
      sh: Arc::new(Shared {
        sink,
        running: AtomicBool::new(false),
        port: AtomicU16::new(DEFAULT_PORT),
        clients: AtomicU32::new(0),
        scanning: AtomicBool::new(false),
        present: AtomicBool::new(false),
        found: Mutex::new(None),
        machine: Mutex::new(None),
      }),
      run: tokio::sync::Mutex::new(None),
    }
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
    let dcm = load_protocol_configs(&None, &None, false)
      .and_then(|mut b| b.simulated_devices(sim).finish())
      .map_err(|e| e.to_string())?;
    let mut b = ServerDeviceManagerBuilder::new(dcm);
    b.comm_manager(MachineManagerBuilder(self.sh.clone()));
    if real {
      toy_managers(&mut b);
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
    self.sh.log("info", format!("buttplug server on 127.0.0.1:{}", port));
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
    self.sh.scanning.store(false, Ordering::Relaxed);
    self.sh.emit_status();
    (self.sh.sink)("bp://devices", json!([]));
  }

  pub fn status(&self) -> Status {
    self.sh.status()
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
    self.dm().await?.parse_message(msg).await.map(|_| ()).map_err(|e| format!("{:?}", e))
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

  /// Zero every stoppable output on one toy (upstream's per-device stop set);
  /// position outputs hold, as upstream's stop leaves them.
  pub async fn toy_stop(&self, index: u32) -> Result<(), String> {
    let (op, d) = self.toy(index).await?;
    let mut errs = Vec::new();
    for f in d.device_features().values() {
      for t in [OutputType::Rotate].into_iter().chain(SCALAR) {
        if t == OutputType::Position || !f.contains_output(t) {
          continue;
        }
        let cmd = OutputCommand::from_output_type(t, 0).expect("value output");
        let msg = ButtplugClientMessageV4::OutputCmd(OutputCmdV4::new(index, f.feature_index(), cmd));
        if let Err(e) = op_call(&op, msg).await {
          errs.push(format!("feature {} {t}: {e}", f.feature_index()));
        }
      }
    }
    if errs.is_empty() { Ok(()) } else { Err(errs.join("; ")) }
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

fn toy_managers(b: &mut ServerDeviceManagerBuilder) {
  use buttplug_server_hwmgr_btleplug::BtlePlugCommunicationManagerBuilder;
  use buttplug_server_hwmgr_hid::HidCommunicationManagerBuilder;
  use buttplug_server_hwmgr_serial::SerialPortCommunicationManagerBuilder;
  b.comm_manager(BtlePlugCommunicationManagerBuilder::default());
  b.comm_manager(SerialPortCommunicationManagerBuilder::default());
  b.comm_manager(HidCommunicationManagerBuilder::default());
}

fn device_list(dm: &ServerDeviceManager, dl: &DeviceListV4) -> Vec<Device> {
  let mut out: Vec<Device> = dl
    .devices()
    .values()
    .map(|d| {
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
      let id = dm.device_info(d.device_index()).map(|i| i.identifier().clone());
      Device {
        index: d.device_index(),
        key: id.map_or_else(String::new, |i| device_key(i.protocol(), i.address())),
        name: d.device_display_name().clone().unwrap_or_else(|| d.device_name().clone()),
        kind: if is_machine(dm, d.device_index()) { "machine" } else { "toy" },
        connected: true,
        features,
        controls: d.device_features().values().flat_map(controls_of).collect(),
      }
    })
    .collect();
  out.sort_by_key(|d| d.index);
  out
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

/// Applied toy outputs, from any client, as bp://output. The machine is left
/// out: its motion is bp://motion, and an app streams it far faster.
async fn watch_outputs(dm: Arc<ServerDeviceManager>, sh: Arc<Shared>) {
  // A lagged receiver ends the stream; resubscribe. dm (held here) owns the
  // sender, so the stream never ends for good while this task runs.
  while let Some(obs) = dm.output_observation_stream() {
    futures::pin_mut!(obs);
    while let Some(o) = obs.next().await {
      if !is_machine(&dm, o.device_index) {
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
        sh.log("error", format!("buttplug server: {}", e));
        break;
      }
    };
    let mut transport = ButtplugWebsocketServerTransportBuilder::default();
    transport.port(port).listen_on_all_interfaces(false);
    let mut connector =
      ButtplugRemoteServerConnector::<_, ButtplugServerJSONSerializer>::new(transport.finish());
    let (tx, mut rx) = mpsc::channel(256);
    if let Err(e) = connector.connect(tx).await {
      sh.log("error", format!("buttplug listener 127.0.0.1:{}: {}", port, e));
      break;
    }
    sh.clients.store(1, Ordering::Relaxed);
    sh.emit_status();
    let connector = Arc::new(connector);
    let replies = server.event_stream();
    futures::pin_mut!(replies);
    loop {
      tokio::select! {
        msg = rx.recv() => match msg {
          None => break,
          Some(msg) => {
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
      sh.log("info", format!("buttplug client \"{}\" disconnected", name));
    }
    let _ = server.disconnect().await;
    sh.stop_machine();
    sh.clients.store(0, Ordering::Relaxed);
    sh.emit_status();
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

  // Every scan reaches every manager, so this is the scan state for all.
  fn start_scanning(&mut self) -> ButtplugResultFuture {
    self.0.scanning.store(true, Ordering::Relaxed);
    self.0.emit_status();
    self.0.announce();
    future::ready(Ok(())).boxed()
  }

  fn stop_scanning(&mut self) -> ButtplugResultFuture {
    self.0.scanning.store(false, Ordering::Relaxed);
    self.0.emit_status();
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

pub fn init(app: &AppHandle) -> Buttplug {
  let app = app.clone();
  Buttplug::new(Arc::new(move |ev, payload| {
    let _ = app.emit(ev, payload);
  }))
}

#[tauri::command]
pub async fn bp_status(bp: State<'_, Buttplug>) -> Result<Status, String> {
  Ok(bp.status())
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
pub async fn bp_scan_start(bp: State<'_, Buttplug>) -> Result<(), String> {
  bp.scan(true).await
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

    assert_eq!(bp.status().clients, 1);
    bp.machine_present(false);
    for _ in 0..50 {
      if bp.devices().await.iter().all(|d| d.kind != "machine") {
        break;
      }
      tokio::time::sleep(Duration::from_millis(50)).await;
    }
    assert!(bp.devices().await.iter().all(|d| d.kind != "machine"), "hub loss removes the machine");
    bp.stop().await;
    assert!(!bp.status().running);
  }

  /// A running server with the machine and ONE upstream simulated toy
  /// standing in for BLE hardware. One toy per server: upstream allocates
  /// device indices without a lock, so devices connecting together can share
  /// an index and one silently replaces the other (docs/BUTTPLUG.md).
  async fn toy(archetype: &str) -> (Buttplug, Events, Device, Device) {
    let (tx, rx) = mpsc::unbounded_channel();
    let bp = Buttplug::new(Arc::new(move |ev, v| {
      let _ = tx.send((ev, v));
    }));
    let port = std::net::TcpListener::bind("127.0.0.1:0").unwrap().local_addr().unwrap().port();
    bp.start_with(port, vec![SimulatedDeviceConfigEntry::new(archetype, None)]).await.unwrap();
    bp.machine_present(true);
    let mut want = 1;
    for _ in 0..200 {
      let n = bp.devices().await.len();
      if n == want && want == 2 {
        break;
      }
      if n == 1 && want == 1 {
        bp.scan(true).await.unwrap();
        want = 2;
      }
      tokio::time::sleep(Duration::from_millis(25)).await;
    }
    let mut devices = bp.devices().await;
    assert_eq!(devices.len(), 2, "{archetype} and the machine");
    devices.sort_by_key(|d| d.kind != "toy");
    let machine = devices.pop().unwrap();
    let toy = devices.pop().unwrap();
    assert_eq!((toy.kind, machine.kind), ("toy", "machine"));
    for d in [&toy, &machine] {
      assert!(!d.key.is_empty() && d.key.chars().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-'), "key {}", d.key);
    }
    (bp, rx, toy, machine)
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
    let (bp, mut rx, vib, machine) = toy("simulated-2vibe").await;
    // One control per feature, with the feature's own step range.
    assert_eq!(vib.controls.len(), 2);
    assert!(vib.controls.iter().all(|c| c.kind == "scalar" && c.ty == "Vibrate" && c.range == Some([0, 100])));

    bp.toy_scalar(vib.index, 1, 40).await.unwrap();
    assert_eq!(next_output(&mut rx).await, out(vib.index, 1, "Vibrate", 40.0));

    // Refusals resolve as error strings.
    assert!(bp.toy_scalar(vib.index, 0, 101).await.is_err(), "past the step range");
    assert!(bp.toy_rotate(vib.index, 0, 5).await.is_err(), "a vibrator has no rotate output");
    assert!(bp.toy_scalar(vib.index, 9, 5).await.is_err(), "no such feature");
    let e = bp.toy_linear(machine.index, 0, 5000, 100).await.unwrap_err();
    assert!(e.contains("machine"), "the machine is refused: {e}");
    assert!(bp.toy_stop(machine.index).await.is_err());

    // A toy stop zeroes every output of that toy.
    bp.toy_stop(vib.index).await.unwrap();
    let mut got = vec![next_output(&mut rx).await, next_output(&mut rx).await];
    got.sort_by_key(|v| v["feature"].as_u64());
    assert_eq!(got, vec![out(vib.index, 0, "Vibrate", 0.0), out(vib.index, 1, "Vibrate", 0.0)]);
    bp.stop().await;
  }

  #[tokio::test(flavor = "multi_thread")]
  async fn rotate_toy_and_stop_all() {
    let (bp, mut rx, rot, _) = toy("simulated-rotator").await;
    let c = &rot.controls[0];
    assert_eq!((c.kind, c.ty.as_str()), ("rotate", "Rotate"));
    let lo = c.range.unwrap()[0];
    assert!(lo < 0, "rotate range is signed: {:?}", c.range);
    bp.toy_rotate(rot.index, 0, -30).await.unwrap();
    assert_eq!(next_output(&mut rx).await, out(rot.index, 0, "Rotate", -30.0));
    bp.stop_all().await.unwrap();
    assert_eq!(next_output(&mut rx).await, out(rot.index, 0, "Rotate", 0.0));
    bp.stop().await;
  }

  #[tokio::test(flavor = "multi_thread")]
  async fn linear_toy_takes_position_and_duration() {
    let (bp, mut rx, lin, _) = toy("simulated-stroker").await;
    let c = &lin.controls[0];
    assert_eq!((c.kind, c.ty.as_str(), c.range, c.ms), ("linear", "HwPositionWithDuration", Some([0, 1000]), Some([0, 100000])));
    bp.toy_linear(lin.index, 0, 500, 250).await.unwrap();
    assert_eq!(next_output(&mut rx).await, out(lin.index, 0, "HwPositionWithDuration", 500.0));
    assert!(bp.toy_scalar(lin.index, 0, 5).await.is_err(), "linear is not scalar");
    bp.stop().await;
  }
}
