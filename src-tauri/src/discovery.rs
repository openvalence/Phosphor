// discovery.rs -- hub discovery for the Phosphor shell: SPEC 13.8 UDP probe
// plus SPEC 13.7 mDNS `_valence._tcp`, merged into one list.
//
// Constraints:
// - Read-only front door. A probe commands nothing; a reply is a candidate
//   address the operator still has to click. Nothing here touches machine
//   state (Ground Truth Doctrine: the shell picks a transport, never a value).
// - Every reply is untrusted input (SPEC 13.7). Parsers index through
//   `get`, bound every loop, and never panic on hostile bytes.
// - HAND-TRANSCRIBED WIRE NUMBERS. Valence's codegen emits no Rust, so PORT,
//   MAGIC and MDNS_SERVICE are copies of registry `udp_discovery` and
//   `limits.mdns_service`, gated by test/check-registry-pins.mjs (T20). The
//   76-byte reply layout's home is SPEC 13.8.
// - Limited broadcast (255.255.255.255) and one multicast send on the
//   default-route interface only: std has no interface enumeration and a
//   discovery convenience does not justify a new crate. Segments that drop
//   both need the manual host field, which SPEC 13.7 requires to keep
//   working anyway.
// - mDNS is a legacy-unicast one-shot query (RFC 6762 section 6.7): sent from
//   an ephemeral port, so responders answer by unicast. Nothing binds 5353,
//   which the OS responder already holds on Windows, and Android needs no
//   MulticastLock because no multicast is ever received.
// - The UDP reply carries the durable hub_instance_id; mDNS TXT carries none
//   (TODO(RFC-072): TXT `id`). An mDNS hit is merged into a UDP hit on the
//   same ip:port and otherwise listed with no id.

use std::collections::HashMap;
use std::net::{IpAddr, Ipv4Addr, UdpSocket};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

const PORT: u16 = 22096;
const MAGIC: [u8; 4] = [0x56, 0x4C, 0x4E, 0x43]; // "VLNC" (registry udp_discovery.magic)
const PROTO_VER: u8 = 1;
const FLAG_PAIRING_WINDOW_OPEN: u8 = 0x01;
const HUB_NAME_BYTES: usize = 32;
const FW_VERSION_BYTES: usize = 16;
const ETAG_BYTES: usize = 8;
const REPLY_BYTES: usize = 4 + 4 + HUB_NAME_BYTES + 8 + 1 + 2 + FW_VERSION_BYTES + ETAG_BYTES + 1;

const MDNS_SERVICE: &str = "_valence._tcp"; // registry limits.mdns_service
const MDNS_GROUP: Ipv4Addr = Ipv4Addr::new(224, 0, 0, 251); // RFC 6762, not a Valence number
const MDNS_PORT: u16 = 5353;
const DNS_PTR: u16 = 12;
const DNS_TXT: u16 = 16;
const DNS_A: u16 = 1;
const DNS_SRV: u16 = 33;

#[derive(serde::Serialize, Debug, PartialEq)]
pub struct Hub {
    pub ip: String,
    pub hub_name: String,
    // Hex: a u64 does not survive JSON's f64. None for an mDNS-only hit.
    pub hub_instance_id: Option<String>,
    pub proto_ver: u8,
    pub ws_port: u16,
    pub fw_version: String,
    pub catalog_etag: String, // hex
    pub pairing_window_open: bool,
}

fn fixed_string(b: &[u8]) -> String {
    let end = b.iter().position(|&c| c == 0).unwrap_or(b.len());
    String::from_utf8_lossy(&b[..end]).into_owned()
}

fn hex(b: &[u8]) -> String {
    b.iter().map(|c| format!("{:02x}", c)).collect()
}

/// Decode a DISCOVER_REPLY. None for anything that is not ours: wrong length,
/// wrong magic, or another probe's nonce.
fn decode_reply(buf: &[u8], nonce: u32, ip: String) -> Option<Hub> {
    if buf.len() != REPLY_BYTES || buf[0..4] != MAGIC {
        return None;
    }
    let u32at = |o: usize| u32::from_le_bytes([buf[o], buf[o + 1], buf[o + 2], buf[o + 3]]);
    if u32at(4) != nonce {
        return None;
    }
    let mut o = 8;
    let hub_name = fixed_string(&buf[o..o + HUB_NAME_BYTES]);
    o += HUB_NAME_BYTES;
    let inst = u64::from_le_bytes(buf[o..o + 8].try_into().ok()?);
    o += 8;
    let proto_ver = buf[o];
    o += 1;
    let ws_port = u16::from_le_bytes([buf[o], buf[o + 1]]);
    o += 2;
    let fw_version = fixed_string(&buf[o..o + FW_VERSION_BYTES]);
    o += FW_VERSION_BYTES;
    let catalog_etag = hex(&buf[o..o + ETAG_BYTES]);
    o += ETAG_BYTES;
    Some(Hub {
        ip,
        hub_name,
        hub_instance_id: Some(format!("{:#018x}", inst)),
        proto_ver,
        ws_port,
        fw_version,
        catalog_etag,
        pairing_window_open: buf[o] & FLAG_PAIRING_WINDOW_OPEN != 0,
    })
}

/// No `rand` dependency for entropy the protocols only use to tell one of our
/// own probes from another.
fn entropy() -> u32 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.subsec_nanos() ^ d.as_secs() as u32)
        .unwrap_or(1)
        ^ std::process::id()
}

/// Send `packet` to `dest` once a second and hand every datagram to
/// `on_reply` until the deadline. Bounded: a caller cannot park the thread
/// for longer than 15 s.
fn probe_loop(
    sock: &UdpSocket,
    packet: &[u8],
    dest: (Ipv4Addr, u16),
    timeout_ms: u32,
    mut on_reply: impl FnMut(&[u8], IpAddr),
) -> Result<(), String> {
    sock.set_read_timeout(Some(Duration::from_millis(200)))
        .map_err(|e| e.to_string())?;
    let deadline = Instant::now() + Duration::from_millis(timeout_ms.clamp(200, 15_000) as u64);
    let mut next_probe = Instant::now();
    let mut buf = [0u8; 1500];
    while Instant::now() < deadline {
        if Instant::now() >= next_probe {
            // A send failure on one segment is not a discovery failure: keep
            // listening for whatever an earlier probe already reached.
            let _ = sock.send_to(packet, dest);
            // A hub answers at most once per source per second (SPEC 13.8),
            // so reprobing faster only costs packets.
            next_probe = Instant::now() + Duration::from_secs(1);
        }
        // Err is the read timeout in the overwhelming case; either way the
        // deadline, not the error, ends the loop.
        if let Ok((n, addr)) = sock.recv_from(&mut buf) {
            on_reply(&buf[..n], addr.ip());
        }
    }
    Ok(())
}

fn probe_lan(timeout_ms: u32) -> Result<Vec<Hub>, String> {
    let sock = UdpSocket::bind((Ipv4Addr::UNSPECIFIED, 0)).map_err(|e| e.to_string())?;
    sock.set_broadcast(true).map_err(|e| e.to_string())?;
    let nonce = entropy();
    let mut probe = Vec::with_capacity(9);
    probe.extend_from_slice(&MAGIC);
    probe.push(PROTO_VER);
    probe.extend_from_slice(&nonce.to_le_bytes());

    let mut found: Vec<Hub> = Vec::new();
    probe_loop(&sock, &probe, (Ipv4Addr::BROADCAST, PORT), timeout_ms, |b, ip| {
        if let Some(h) = decode_reply(b, nonce, ip.to_string()) {
            // Dedupe on the durable identity, first IP seen wins (the reason
            // 13.8 carries hub_instance_id at all).
            if !found.iter().any(|e| e.hub_instance_id == h.hub_instance_id) {
                found.push(h);
            }
        }
    })?;
    Ok(found)
}

// ---- mDNS (SPEC 13.7) ------------------------------------------------------

/// PTR query for `_valence._tcp.local`, class IN, unicast-response bit clear:
/// the ephemeral source port alone makes it a legacy query.
fn mdns_query(id: u16) -> Vec<u8> {
    let mut q = Vec::with_capacity(40);
    q.extend_from_slice(&id.to_be_bytes());
    q.extend_from_slice(&[0, 0, 0, 1, 0, 0, 0, 0, 0, 0]); // flags 0, qdcount 1
    for label in MDNS_SERVICE.split('.').chain(["local"]) {
        q.push(label.len() as u8);
        q.extend_from_slice(label.as_bytes());
    }
    q.push(0);
    q.extend_from_slice(&DNS_PTR.to_be_bytes());
    q.extend_from_slice(&1u16.to_be_bytes());
    q
}

/// A possibly compressed name at `off`, and the offset just past it where it
/// sits. None on truncation, reserved label types, over-long names, or a
/// pointer loop (the step bound covers the longest legal name).
fn read_name(msg: &[u8], mut off: usize) -> Option<(String, usize)> {
    let mut name = String::new();
    let mut end = None;
    for _ in 0..256 {
        let len = *msg.get(off)? as usize;
        match len & 0xC0 {
            0xC0 => {
                end.get_or_insert(off + 2);
                off = ((len & 0x3F) << 8) | *msg.get(off + 1)? as usize;
            }
            0 if len == 0 => return Some((name, end.unwrap_or(off + 1))),
            0 => {
                let label = msg.get(off + 1..off + 1 + len)?;
                if !name.is_empty() {
                    name.push('.');
                }
                name.push_str(&String::from_utf8_lossy(label));
                if name.len() > 255 {
                    return None;
                }
                off += 1 + len;
            }
            _ => return None,
        }
    }
    None
}

/// TXT rdata as lowercase-keyed pairs; the first occurrence of a key wins
/// (RFC 6763 section 6.4).
fn parse_txt(rd: &[u8]) -> HashMap<String, String> {
    let mut m = HashMap::new();
    let mut i = 0;
    while let Some(&len) = rd.get(i) {
        let Some(s) = rd.get(i + 1..i + 1 + len as usize) else { break };
        let s = String::from_utf8_lossy(s);
        let (k, v) = s.split_once('=').unwrap_or((&s[..], ""));
        m.entry(k.to_ascii_lowercase()).or_insert_with(|| v.to_string());
        i += 1 + len as usize;
    }
    m
}

/// Every `_valence._tcp` instance in one response that has an SRV record.
/// The address is the SRV target's A record, else the responder's own.
fn decode_mdns(msg: &[u8], id: u16, src: IpAddr) -> Vec<Hub> {
    let u16at = |o: usize| Some(u16::from_be_bytes([*msg.get(o)?, *msg.get(o + 1)?]));
    let is_response = msg.get(2).is_some_and(|f| f & 0x80 != 0);
    let (Some(qd), Some(an), Some(ns), Some(ar)) = (u16at(4), u16at(6), u16at(8), u16at(10)) else {
        return vec![];
    };
    if u16at(0) != Some(id) || !is_response {
        return vec![];
    }
    let mut off = 12;
    for _ in 0..qd {
        let Some((_, o)) = read_name(msg, off) else { return vec![] };
        off = o + 4;
    }
    let service = format!("{MDNS_SERVICE}.local");
    let mut instances = Vec::new();
    let mut srv: HashMap<String, (u16, String)> = HashMap::new();
    let mut txt: HashMap<String, HashMap<String, String>> = HashMap::new();
    let mut addr: HashMap<String, Ipv4Addr> = HashMap::new();
    for _ in 0..(an as u32 + ns as u32 + ar as u32) {
        let Some((name, o)) = read_name(msg, off) else { break };
        let (Some(rtype), Some(rdlen)) = (u16at(o), u16at(o + 8)) else { break };
        let rd = o + 10;
        let Some(rdata) = msg.get(rd..rd + rdlen as usize) else { break };
        off = rd + rdlen as usize;
        let key = name.to_ascii_lowercase();
        match rtype {
            DNS_PTR if key == service => {
                if let Some((inst, _)) = read_name(msg, rd) {
                    instances.push(inst);
                }
            }
            DNS_SRV if rdata.len() > 6 => {
                if let Some((target, _)) = read_name(msg, rd + 6) {
                    let port = u16::from_be_bytes([rdata[4], rdata[5]]);
                    srv.insert(key, (port, target.to_ascii_lowercase()));
                }
            }
            DNS_TXT => {
                txt.insert(key, parse_txt(rdata));
            }
            DNS_A if rdata.len() == 4 => {
                addr.insert(key, Ipv4Addr::new(rdata[0], rdata[1], rdata[2], rdata[3]));
            }
            _ => {}
        }
    }
    let suffix = format!(".{service}");
    instances
        .into_iter()
        .filter_map(|inst| {
            let key = inst.to_ascii_lowercase();
            let (port, target) = srv.get(&key)?;
            let t = txt.get(&key);
            let get = |k: &str| t.and_then(|m| m.get(k)).cloned();
            // ASCII lowercasing keeps byte offsets, so the cut lands on the
            // suffix's leading '.', a char boundary.
            let label = if key.ends_with(&suffix) { &inst[..inst.len() - suffix.len()] } else { &inst[..] };
            Some(Hub {
                ip: addr.get(target).map_or_else(|| src.to_string(), |a| a.to_string()),
                hub_name: get("name").unwrap_or_else(|| label.to_string()),
                hub_instance_id: None,
                proto_ver: get("v").and_then(|v| v.parse().ok()).unwrap_or(0),
                ws_port: *port,
                fw_version: String::new(),
                catalog_etag: get("etag").unwrap_or_default(),
                pairing_window_open: get("pairing").as_deref() == Some("open"),
            })
        })
        .collect()
}

/// The address of the interface the default route leaves by; connect() on a
/// UDP socket only picks a route, nothing is sent. Binding the query socket to
/// it is what steers the multicast send: an unbound socket leaves by the OS's
/// default multicast interface, which measured as a dead VPN adapter on the
/// dev host and reached nothing.
// ponytail: default route only; per-interface sends need interface enumeration.
fn default_route_addr() -> Ipv4Addr {
    UdpSocket::bind((Ipv4Addr::UNSPECIFIED, 0))
        .and_then(|s| {
            s.connect((Ipv4Addr::new(192, 0, 2, 1), 9))?; // TEST-NET-1: routed, never reached
            s.local_addr()
        })
        .ok()
        .and_then(|a| match a.ip() {
            IpAddr::V4(v) => Some(v),
            IpAddr::V6(_) => None,
        })
        .unwrap_or(Ipv4Addr::UNSPECIFIED)
}

fn browse_mdns(timeout_ms: u32) -> Result<Vec<Hub>, String> {
    let sock = UdpSocket::bind((default_route_addr(), 0)).map_err(|e| e.to_string())?;
    // RFC 6762 section 11: mDNS packets go out with IP TTL 255.
    sock.set_multicast_ttl_v4(255).map_err(|e| e.to_string())?;
    let id = (entropy() as u16) | 1; // nonzero: a legacy responder echoes it
    let query = mdns_query(id);
    let mut found: Vec<Hub> = Vec::new();
    probe_loop(&sock, &query, (MDNS_GROUP, MDNS_PORT), timeout_ms, |b, ip| {
        for h in decode_mdns(b, id, ip) {
            if !found.iter().any(|e| e.ip == h.ip && e.ws_port == h.ws_port) {
                found.push(h);
            }
        }
    })?;
    Ok(found)
}

/// UDP hits lead: they carry the durable id. An mDNS hit on an ip:port a UDP
/// hit already names adds nothing; any other is listed without an id.
fn merge(mut hubs: Vec<Hub>, mdns: Vec<Hub>) -> Vec<Hub> {
    for m in mdns {
        if !hubs.iter().any(|h| h.ip == m.ip && h.ws_port == m.ws_port) {
            hubs.push(m);
        }
    }
    hubs
}

/// Run the UDP probe and the mDNS browse side by side for `timeout_ms` and
/// return one merged list. Blocking work runs on the blocking pool and both
/// probes are JOINED here, so no thread outlives the command.
#[tauri::command]
pub async fn discover_hubs(timeout_ms: u32) -> Result<Vec<Hub>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        std::thread::scope(|s| {
            let mdns = s.spawn(|| browse_mdns(timeout_ms));
            let udp = probe_lan(timeout_ms);
            // mDNS is the lesser path (SPEC 13.7): it never fails discovery.
            let mdns = match mdns.join() {
                Ok(Ok(v)) => v,
                Ok(Err(e)) => {
                    log::warn!("mdns browse: {e}");
                    Vec::new()
                }
                Err(_) => Vec::new(),
            };
            match udp {
                Err(e) if mdns.is_empty() => Err(e),
                udp => Ok(merge(udp.unwrap_or_default(), mdns)),
            }
        })
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;

    fn synth(nonce: u32) -> Vec<u8> {
        let mut b = Vec::new();
        b.extend_from_slice(&MAGIC);
        b.extend_from_slice(&nonce.to_le_bytes());
        let mut name = [0u8; HUB_NAME_BYTES];
        name[..8].copy_from_slice(b"Phosphor");
        b.extend_from_slice(&name);
        b.extend_from_slice(&0x0123_4567_89ab_cdefu64.to_le_bytes());
        b.push(1); // proto_ver
        b.extend_from_slice(&82u16.to_le_bytes());
        let mut fw = [0u8; FW_VERSION_BYTES];
        fw[..6].copy_from_slice(b"2.4.99");
        b.extend_from_slice(&fw);
        b.extend_from_slice(&[0xde, 0xad, 0xbe, 0xef, 0x01, 0x02, 0x03, 0x04]);
        b.push(FLAG_PAIRING_WINDOW_OPEN | 0x02);
        b
    }

    #[test]
    fn reply_is_76_bytes() {
        assert_eq!(REPLY_BYTES, 76);
        assert_eq!(synth(0).len(), 76);
    }

    #[test]
    fn decodes_field_for_field() {
        let h = decode_reply(&synth(0xa1b2c3d4), 0xa1b2c3d4, "10.0.0.5".into()).unwrap();
        assert_eq!(
            h,
            Hub {
                ip: "10.0.0.5".into(),
                hub_name: "Phosphor".into(),
                hub_instance_id: Some("0x0123456789abcdef".into()),
                proto_ver: 1,
                ws_port: 82,
                fw_version: "2.4.99".into(),
                catalog_etag: "deadbeef01020304".into(),
                pairing_window_open: true,
            }
        );
    }

    #[test]
    fn rejects_foreign_nonce_bad_magic_and_short() {
        assert!(decode_reply(&synth(1), 2, "x".into()).is_none());
        let mut bad = synth(1);
        bad[0] = 0;
        assert!(decode_reply(&bad, 1, "x".into()).is_none());
        assert!(decode_reply(&synth(1)[..75], 1, "x".into()).is_none());
    }

    fn rr(b: &mut Vec<u8>, name: &[u8], rtype: u16, rdata: &[u8]) -> usize {
        b.extend_from_slice(name);
        b.extend_from_slice(&rtype.to_be_bytes());
        b.extend_from_slice(&[0x80, 0x01, 0, 0, 0x11, 0x94]); // class IN + cache-flush, ttl
        b.extend_from_slice(&(rdata.len() as u16).to_be_bytes());
        let at = b.len();
        b.extend_from_slice(rdata);
        at
    }

    /// PTR answer plus SRV/TXT/A additionals, every later name a compression
    /// pointer, the shape an ESP-IDF or Avahi responder sends.
    fn synth_mdns(id: u16) -> Vec<u8> {
        let q = mdns_query(id);
        let mut b = id.to_be_bytes().to_vec();
        b.extend_from_slice(&[0x84, 0x00, 0, 1, 0, 1, 0, 0, 0, 3]);
        b.extend_from_slice(&q[12..]);
        let local = 12 + 1 + 8 + 1 + 4; // offset of the "local" label
        let inst = rr(&mut b, &[0xC0, 12], DNS_PTR, b"\x09Bench Hub\xC0\x0C");
        let inst_ptr = [0xC0 | (inst >> 8) as u8, inst as u8];
        let srv = [0, 0, 0, 0, 0, 82, 3, b's', b'i', b'm', 0xC0, local as u8];
        let target = rr(&mut b, &inst_ptr, DNS_SRV, &srv) + 6;
        rr(&mut b, &inst_ptr, DNS_TXT, b"\x03v=1\x0Bname=Bench1\x09etag=abcd\x0Cpairing=open\x0Aname=later");
        rr(&mut b, &[0xC0 | (target >> 8) as u8, target as u8], DNS_A, &[10, 0, 0, 9]);
        b
    }

    #[test]
    fn mdns_decodes_through_compression() {
        let hubs = decode_mdns(&synth_mdns(0x1235), 0x1235, "10.0.0.77".parse().unwrap());
        assert_eq!(
            hubs,
            vec![Hub {
                ip: "10.0.0.9".into(),
                hub_name: "Bench1".into(),
                hub_instance_id: None,
                proto_ver: 1,
                ws_port: 82,
                fw_version: String::new(),
                catalog_etag: "abcd".into(),
                pairing_window_open: true,
            }]
        );
    }

    #[test]
    fn mdns_rejects_foreign_id_and_queries() {
        let src: IpAddr = "10.0.0.77".parse().unwrap();
        assert!(decode_mdns(&synth_mdns(0x1235), 0x1237, src).is_empty());
        assert!(decode_mdns(&mdns_query(0x1235), 0x1235, src).is_empty());
    }

    #[test]
    fn mdns_never_panics_on_hostile_bytes() {
        let src: IpAddr = "10.0.0.77".parse().unwrap();
        let good = synth_mdns(7);
        for cut in 0..good.len() {
            let _ = decode_mdns(&good[..cut], 7, src);
        }
        for i in 0..good.len() {
            for v in [0x00, 0x3F, 0xC0, 0xFF] {
                let mut m = good.clone();
                m[i] = v;
                let _ = decode_mdns(&m, 7, src);
            }
        }
        // A pointer to itself is a loop, not a name.
        assert!(read_name(&[0xC0, 0x00], 0).is_none());
    }

    #[test]
    fn merge_keeps_udp_identity_and_adds_mdns_only_hubs() {
        let udp = decode_reply(&synth(9), 9, "10.0.0.9".into()).unwrap();
        let src: IpAddr = "10.0.0.77".parse().unwrap();
        let same = decode_mdns(&synth_mdns(7), 7, src);
        let mut other = decode_mdns(&synth_mdns(7), 7, src);
        other[0].ip = "10.0.0.10".into();
        let merged = merge(vec![udp], same.into_iter().chain(other).collect());
        assert_eq!(merged.len(), 2);
        assert_eq!(merged[0].hub_instance_id.as_deref(), Some("0x0123456789abcdef"));
        assert_eq!(merged[0].fw_version, "2.4.99");
        assert_eq!((merged[1].ip.as_str(), merged[1].hub_instance_id.as_deref()), ("10.0.0.10", None));
    }

    /// Live: needs a `_valence._tcp` responder on the LAN.
    /// `cargo test live_mdns -- --ignored --nocapture`
    #[test]
    #[ignore]
    fn live_mdns() {
        let hubs = browse_mdns(2500).unwrap();
        println!("{hubs:?}");
        assert!(!hubs.is_empty());
    }
}
