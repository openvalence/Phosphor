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
// See: docs/BUTTPLUG.md

use std::sync::atomic::{AtomicBool, AtomicU16, AtomicU32, Ordering};
use std::sync::{Arc, Mutex};

use async_trait::async_trait;
use buttplug_core::connector::ButtplugConnector;
use buttplug_core::errors::ButtplugDeviceError;
use buttplug_core::message::{
  ButtplugClientMessageV4, ButtplugDeviceMessage, ButtplugServerMessageV4, DeviceListV4,
  RequestDeviceListV0, StartScanningV0, StopScanningV0,
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
  ButtplugClientMessageV3, ButtplugClientMessageVariant,
};
use buttplug_server::ButtplugServerBuilder;
use buttplug_server_device_config::{
  load_protocol_configs, Endpoint, ProtocolCommunicationSpecifier, WebsocketSpecifier,
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
  name: String,
  kind: &'static str,
  connected: bool,
  features: Vec<String>,
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
    if port == 0 {
      return Err("port 0 is not a listening port".into());
    }
    self.stop().await;
    // The transport binds lazily inside its accept loop; probe here so a busy
    // port is an error to the caller, not a line in the log.
    std::net::TcpListener::bind(("127.0.0.1", port))
      .map_err(|e| format!("127.0.0.1:{}: {}", port, e))?;
    let dcm = load_protocol_configs(&None, &None, false)
      .and_then(|mut b| b.finish())
      .map_err(|e| e.to_string())?;
    let mut b = ServerDeviceManagerBuilder::new(dcm);
    b.comm_manager(MachineManagerBuilder(self.sh.clone()));
    toy_managers(&mut b);
    let dm = Arc::new(b.finish().map_err(|e| e.to_string())?);
    let tasks = vec![
      tokio::spawn(watch_devices(dm.clone(), self.sh.clone())),
      tokio::spawn(serve(dm.clone(), port, self.sh.clone())),
    ];
    *self.run.lock().await = Some(Run { dm, tasks });
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
      Device {
        index: d.device_index(),
        name: d.device_display_name().clone().unwrap_or_else(|| d.device_name().clone()),
        kind: if is_machine(dm, d.device_index()) { "machine" } else { "toy" },
        connected: true,
        features,
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
}
