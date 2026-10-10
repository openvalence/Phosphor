// lan.rs -- Open to LAN: the Virtual's hub on this PC's LAN. A WebSocket
// listener and the SPEC 13.8 UDP port whose bytes the page carries to the
// Neutrino worker and back (src/shell/lan.svelte.js). Desktop shell only.
//
// Constraints:
// - Carries bytes, never Valence: no frame is parsed or built here. Tiers,
//   pairing, ownership and the discovery reply are the hub's (the integral
//   ABI). The subprotocol, the UDP port and the GOODBYE a remote gets at
//   shutdown (`farewell`) are the page's, from valence-js, so no wire number
//   is transcribed here.
// - One record format both ways (encode/decode): kind u8, id u32 LE, length
//   u32 LE, data. A remote's id counts up from REMOTE_ID_BASE, clear of the
//   page's own socket ids; a datagram's id is its source IPv4 and its data
//   opens with the source port, u16 LE.
// - No polling: records reach the page on one ordered Channel and come back
//   by invoke.
// - Bounded: MAX_REMOTES sockets, QUEUE frames waiting on one slow remote
//   close it (the hub's slow-consumer rule cannot see past the page), DGRAM_MAX
//   bytes per datagram (a probe or an ESTOP frame is far smaller).
// - A remote the page did not close is reported CLOSE exactly once.
// - A port that cannot be bound (taken; under 1024 without privileges on Linux
//   and macOS) falls back to one the OS assigns; the caller reports the bound
//   port and discovery advertises it.

use std::collections::HashMap;
use std::net::{IpAddr, Ipv4Addr, SocketAddr, SocketAddrV4};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use futures::{SinkExt, StreamExt};
use tauri::ipc::{Channel, InvokeBody, InvokeResponseBody, Request};
use tauri::State;
use tokio::net::{TcpListener, TcpStream, UdpSocket};
use tokio::sync::{mpsc, Notify};
use tokio::task::JoinSet;
use tokio_tungstenite::tungstenite::handshake::server::{Request as WsRequest, Response as WsResponse};
use tokio_tungstenite::tungstenite::http::HeaderValue;
use tokio_tungstenite::tungstenite::protocol::frame::coding::CloseCode;
use tokio_tungstenite::tungstenite::protocol::{CloseFrame, WebSocketConfig};
use tokio_tungstenite::tungstenite::Message;

pub const OPEN: u8 = 1;
pub const MSG: u8 = 2;
pub const CLOSE: u8 = 3;
pub const DGRAM: u8 = 4;
const HEAD: usize = 9;
const REMOTE_ID_BASE: u32 = 0x4000_0000;
const MAX_REMOTES: usize = 8;
const QUEUE: usize = 512;
const DGRAM_MAX: usize = 64;
const WS_MAX: usize = 64 * 1024;
const HANDSHAKE: Duration = Duration::from_secs(5);
const DRAIN: Duration = Duration::from_secs(1);

pub fn encode(out: &mut Vec<u8>, kind: u8, id: u32, data: &[u8]) {
    out.push(kind);
    out.extend_from_slice(&id.to_le_bytes());
    out.extend_from_slice(&(data.len() as u32).to_le_bytes());
    out.extend_from_slice(data);
}

/// Every record in `buf`, or None when any is cut short.
pub fn decode(buf: &[u8]) -> Option<Vec<(u8, u32, &[u8])>> {
    let mut out = Vec::new();
    let mut o = 0;
    while o < buf.len() {
        let h = buf.get(o..o + HEAD)?;
        let id = u32::from_le_bytes([h[1], h[2], h[3], h[4]]);
        let n = u32::from_le_bytes([h[5], h[6], h[7], h[8]]) as usize;
        let data = buf.get(o + HEAD..(o + HEAD).checked_add(n)?)?;
        out.push((h[0], id, data));
        o += HEAD + n;
    }
    Some(out)
}

fn dgram_record(from: SocketAddrV4, bytes: &[u8]) -> Vec<u8> {
    let mut data = from.port().to_le_bytes().to_vec();
    data.extend_from_slice(bytes);
    let mut rec = Vec::with_capacity(HEAD + data.len());
    encode(&mut rec, DGRAM, u32::from(*from.ip()), &data);
    rec
}

/// A DGRAM record's destination and payload.
fn dgram_target(id: u32, data: &[u8]) -> Option<(SocketAddrV4, &[u8])> {
    let port = u16::from_le_bytes([*data.first()?, *data.get(1)?]);
    Some((SocketAddrV4::new(Ipv4Addr::from(id), port), &data[2..]))
}

enum Out {
    Msg(Vec<u8>),
    Close,
    Bye,
}

type Conns = Arc<Mutex<HashMap<u32, mpsc::Sender<Out>>>>;

struct Share {
    conns: Conns,
    udp: Option<Arc<UdpSocket>>,
    stop: Arc<Notify>,
    task: tauri::async_runtime::JoinHandle<()>,
}

#[derive(Default)]
pub struct Lan(Mutex<Option<Share>>);

#[derive(serde::Serialize)]
pub struct Up {
    port: u16,
    discovery: bool,
    addrs: Vec<String>,
}

fn emit(events: &Channel<InvokeResponseBody>, kind: u8, id: u32, data: &[u8]) {
    let mut rec = Vec::with_capacity(HEAD + data.len());
    encode(&mut rec, kind, id, data);
    let _ = events.send(InvokeResponseBody::Raw(rec));
}

/// This host's IPv4 addresses a phone could dial, the default route's first.
fn lan_addrs() -> Vec<String> {
    // connect() on UDP only consults the routing table; nothing is sent.
    let primary = std::net::UdpSocket::bind((Ipv4Addr::UNSPECIFIED, 0))
        .and_then(|s| {
            s.connect((Ipv4Addr::new(192, 0, 2, 1), 9))?;
            s.local_addr()
        })
        .ok()
        .and_then(|a| match a.ip() {
            IpAddr::V4(v) if !v.is_unspecified() && !v.is_loopback() => Some(v),
            _ => None,
        });
    let mut out: Vec<Ipv4Addr> = primary.into_iter().collect();
    for i in if_addrs::get_if_addrs().unwrap_or_default() {
        if let if_addrs::IfAddr::V4(a) = i.addr {
            if !a.ip.is_loopback() && !a.ip.is_link_local() && !out.contains(&a.ip) {
                out.push(a.ip);
            }
        }
    }
    out.iter().map(|a| a.to_string()).collect()
}

async fn serve(
    stream: TcpStream,
    id: u32,
    subprotocol: Arc<str>,
    farewell: Arc<[u8]>,
    events: Channel<InvokeResponseBody>,
    conns: Conns,
    mut rx: mpsc::Receiver<Out>,
) {
    // Valence frames are small and latency-bound: Nagle would hold them.
    let _ = stream.set_nodelay(true);
    let echo = |req: &WsRequest, mut resp: WsResponse| {
        let offered = req.headers().get("sec-websocket-protocol").and_then(|v| v.to_str().ok());
        if offered.is_some_and(|s| s.split(',').any(|p| p.trim() == &*subprotocol)) {
            if let Ok(v) = HeaderValue::from_str(&subprotocol) {
                resp.headers_mut().insert("sec-websocket-protocol", v);
            }
        }
        Ok(resp)
    };
    let cfg = WebSocketConfig::default().max_message_size(Some(WS_MAX)).max_frame_size(Some(WS_MAX));
    let ws = match tokio::time::timeout(HANDSHAKE, tokio_tungstenite::accept_hdr_async_with_config(stream, echo, Some(cfg))).await {
        Ok(Ok(ws)) => ws,
        _ => {
            conns.lock().unwrap().remove(&id);
            return;
        }
    };
    emit(&events, OPEN, id, &[]);
    let (mut tx, mut from) = ws.split();
    let page_closed = loop {
        tokio::select! {
            m = from.next() => match m {
                Some(Ok(Message::Binary(b))) => emit(&events, MSG, id, &b),
                Some(Ok(Message::Close(_))) | Some(Err(_)) | None => break false,
                // Pings are answered by tungstenite; text is not Valence.
                Some(Ok(_)) => {}
            },
            o = rx.recv() => match o {
                Some(Out::Msg(b)) => if tx.send(Message::Binary(b.into())).await.is_err() { break false },
                Some(Out::Close) => {
                    let _ = tx.send(Message::Close(None)).await;
                    break true;
                }
                Some(Out::Bye) => {
                    let _ = tx.send(Message::Binary(farewell.to_vec().into())).await;
                    let _ = tx.send(Message::Close(Some(CloseFrame { code: CloseCode::Away, reason: "".into() }))).await;
                    break true;
                }
                // Dropped by lan_send: this remote fell QUEUE frames behind.
                None => {
                    let _ = tx.send(Message::Close(Some(CloseFrame { code: CloseCode::Again, reason: "".into() }))).await;
                    break false;
                }
            },
        }
    };
    conns.lock().unwrap().remove(&id);
    if !page_closed {
        emit(&events, CLOSE, id, &[]);
    }
}

async fn recv(udp: &Option<Arc<UdpSocket>>, buf: &mut [u8]) -> std::io::Result<(usize, SocketAddr)> {
    match udp {
        Some(u) => u.recv_from(buf).await,
        None => std::future::pending().await,
    }
}

/// Every remote gets the farewell and a close, the listener and the UDP port
/// shut, and the connection tasks get DRAIN to flush before they are aborted.
async fn stop(lan: &Lan) {
    let Some(share) = lan.0.lock().unwrap().take() else { return };
    for tx in share.conns.lock().unwrap().values() {
        let _ = tx.try_send(Out::Bye);
    }
    share.stop.notify_one();
    let _ = share.task.await;
}

/// The app is exiting: remotes end with a GOODBYE, not a reset.
pub fn exit(lan: &Lan) {
    tauri::async_runtime::block_on(stop(lan));
}

#[tauri::command]
pub async fn lan_start(
    lan: State<'_, Lan>,
    port: u16,
    udp_port: u16,
    subprotocol: String,
    farewell: Vec<u8>,
    events: Channel<InvokeResponseBody>,
) -> Result<Up, String> {
    stop(&lan).await;
    let listener = match TcpListener::bind((Ipv4Addr::UNSPECIFIED, port)).await {
        Ok(l) => l,
        Err(_) => TcpListener::bind((Ipv4Addr::UNSPECIFIED, 0)).await.map_err(|e| e.to_string())?,
    };
    let bound = listener.local_addr().map_err(|e| e.to_string())?.port();
    let udp = match UdpSocket::bind((Ipv4Addr::UNSPECIFIED, udp_port)).await {
        Ok(u) => Some(Arc::new(u)),
        Err(e) => {
            log::warn!("Open to LAN: UDP {udp_port} unavailable, no discovery: {e}");
            None
        }
    };
    let conns: Conns = Arc::default();
    let stop = Arc::new(Notify::new());
    let subprotocol: Arc<str> = subprotocol.into();
    let farewell: Arc<[u8]> = farewell.into();
    let task = {
        let (conns, udp, stop) = (conns.clone(), udp.clone(), stop.clone());
        tauri::async_runtime::spawn(async move {
            let mut set = JoinSet::new();
            let mut next = REMOTE_ID_BASE;
            let mut buf = [0u8; DGRAM_MAX];
            loop {
                tokio::select! {
                    _ = stop.notified() => break,
                    r = listener.accept() => {
                        let Ok((stream, peer)) = r else { continue };
                        let rx = {
                            let mut c = conns.lock().unwrap();
                            if c.len() >= MAX_REMOTES {
                                continue;
                            }
                            let (tx, rx) = mpsc::channel(QUEUE);
                            c.insert(next, tx);
                            rx
                        };
                        log::info!("Open to LAN: {peer} as remote {next:#x}");
                        set.spawn(serve(stream, next, subprotocol.clone(), farewell.clone(), events.clone(), conns.clone(), rx));
                        next = next.checked_add(1).unwrap_or(REMOTE_ID_BASE);
                    }
                    r = recv(&udp, &mut buf) => {
                        if let Ok((n, SocketAddr::V4(from))) = r {
                            let _ = events.send(InvokeResponseBody::Raw(dgram_record(from, &buf[..n])));
                        }
                    }
                    Some(_) = set.join_next(), if !set.is_empty() => {}
                }
            }
            drop(listener);
            let _ = tokio::time::timeout(DRAIN, async { while set.join_next().await.is_some() {} }).await;
        })
    };
    *lan.0.lock().unwrap() = Some(Share { conns, udp: udp.clone(), stop, task });
    Ok(Up { port: bound, discovery: udp.is_some(), addrs: lan_addrs() })
}

/// The page's records: MSG and CLOSE to a remote, DGRAM to a datagram's source.
/// Never blocks; records that arrive after a stop are dropped.
#[tauri::command]
pub fn lan_send(request: Request<'_>, lan: State<'_, Lan>) -> Result<(), String> {
    let InvokeBody::Raw(buf) = request.body() else { return Err("records are raw bytes".into()) };
    let recs = decode(buf).ok_or("record cut short")?;
    let guard = lan.0.lock().unwrap();
    let Some(share) = guard.as_ref() else { return Ok(()) };
    let mut conns = share.conns.lock().unwrap();
    for (kind, id, data) in recs {
        match kind {
            MSG | CLOSE => {
                let out = if kind == MSG { Out::Msg(data.to_vec()) } else { Out::Close };
                if conns.get(&id).is_some_and(|tx| tx.try_send(out).is_err()) {
                    conns.remove(&id);
                }
            }
            DGRAM => {
                if let (Some(udp), Some((to, bytes))) = (&share.udp, dgram_target(id, data)) {
                    let _ = udp.try_send_to(bytes, SocketAddr::V4(to));
                }
            }
            _ => {}
        }
    }
    Ok(())
}

#[tauri::command]
pub async fn lan_stop(lan: State<'_, Lan>) -> Result<(), String> {
    stop(&lan).await;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn records_round_trip_in_order() {
        let mut b = Vec::new();
        encode(&mut b, OPEN, REMOTE_ID_BASE, &[]);
        encode(&mut b, MSG, REMOTE_ID_BASE, &[1, 2, 3]);
        encode(&mut b, CLOSE, 7, &[]);
        assert_eq!(b.len(), 3 * HEAD + 3);
        assert_eq!(
            decode(&b).unwrap(),
            vec![(OPEN, REMOTE_ID_BASE, &[][..]), (MSG, REMOTE_ID_BASE, &[1, 2, 3][..]), (CLOSE, 7, &[][..])]
        );
        assert_eq!(decode(&[]).unwrap(), vec![]);
    }

    #[test]
    fn a_cut_record_is_refused_whole() {
        let mut b = Vec::new();
        encode(&mut b, MSG, 1, &[9; 10]);
        encode(&mut b, MSG, 2, &[8; 4]);
        for cut in [1, HEAD - 1, HEAD + 9, b.len() - 1] {
            assert!(decode(&b[..cut]).is_none(), "cut at {cut}");
        }
        // A length past the end, and one that would overflow the offset.
        let mut bad = b[..HEAD].to_vec();
        bad[5..9].copy_from_slice(&u32::MAX.to_le_bytes());
        assert!(decode(&bad).is_none());
    }

    #[test]
    fn a_datagram_carries_its_source_and_its_reply_goes_back() {
        let from = SocketAddrV4::new(Ipv4Addr::new(192, 168, 1, 23), 50123);
        let rec = dgram_record(from, b"VLNC\x01abcd");
        let recs = decode(&rec).unwrap();
        let (kind, id, data) = recs[0];
        assert_eq!((kind, id), (DGRAM, u32::from(*from.ip())));
        assert_eq!(dgram_target(id, data), Some((from, &b"VLNC\x01abcd"[..])));
        assert_eq!(dgram_target(id, &[1]), None);
    }
}
