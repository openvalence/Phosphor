// discovery.rs -- hub discovery for the Phosphor shell: the SPEC 13.8 UDP
// probe, the only native discovery path (RFC-072 retired the DNS-SD browse).
//
// Constraints:
// - Read-only front door. A probe commands nothing; a reply is a candidate
//   address the operator still has to click. Nothing here touches machine
//   state (Ground Truth Doctrine: the shell picks a transport, never a value).
// - Every reply is untrusted input (SPEC 13.7). The parser bounds-checks
//   before it indexes and never panics on hostile bytes.
// - HAND-TRANSCRIBED WIRE NUMBERS. Valence's codegen emits no Rust, so PORT
//   and MAGIC are copies of registry `udp_discovery`, gated by
//   test/check-registry-pins.mjs (T20). The 76-byte reply layout's home is
//   SPEC 13.8.
// - Limited broadcast (255.255.255.255) only: std has no interface
//   enumeration and a discovery convenience does not justify a new crate.
//   Segments that drop it need the manual host field, which SPEC 13.7
//   requires to keep working anyway.

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

#[derive(serde::Serialize, Debug, PartialEq)]
pub struct Hub {
    pub ip: String,
    pub hub_name: String,
    // 16 lowercase hex digits, the session's form (a u64 does not survive
    // JSON's f64); empty when the reply carries 0, a hub with no durable id.
    pub hub_instance_id: String,
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
        hub_instance_id: if inst == 0 { String::new() } else { format!("{:016x}", inst) },
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

fn dedupe_key(h: &Hub) -> String {
    if h.hub_instance_id.is_empty() {
        format!("{}:{}", h.ip, h.ws_port)
    } else {
        h.hub_instance_id.clone()
    }
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
            // 13.8 carries hub_instance_id at all); a hub with none keys on
            // its endpoint, so two of them stay two rows.
            if !found.iter().any(|e| dedupe_key(e) == dedupe_key(&h)) {
                found.push(h);
            }
        }
    })?;
    Ok(found)
}

/// Run the UDP probe for `timeout_ms`. Blocking work runs on the blocking
/// pool and is awaited here, so no thread outlives the command.
#[tauri::command]
pub async fn discover_hubs(timeout_ms: u32) -> Result<Vec<Hub>, String> {
    tauri::async_runtime::spawn_blocking(move || probe_lan(timeout_ms))
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
                hub_instance_id: "0123456789abcdef".into(),
                proto_ver: 1,
                ws_port: 82,
                fw_version: "2.4.99".into(),
                catalog_etag: "deadbeef01020304".into(),
                pairing_window_open: true,
            }
        );
    }

    #[test]
    fn zero_id_is_no_identity_and_keys_on_the_endpoint() {
        let mut b = synth(7);
        b[40..48].copy_from_slice(&0u64.to_le_bytes());
        let a = decode_reply(&b, 7, "10.0.0.5".into()).unwrap();
        let c = decode_reply(&b, 7, "10.0.0.6".into()).unwrap();
        assert_eq!(a.hub_instance_id, "");
        assert_ne!(dedupe_key(&a), dedupe_key(&c));
    }

    #[test]
    fn rejects_foreign_nonce_bad_magic_and_short() {
        assert!(decode_reply(&synth(1), 2, "x".into()).is_none());
        let mut bad = synth(1);
        bad[0] = 0;
        assert!(decode_reply(&bad, 1, "x".into()).is_none());
        assert!(decode_reply(&synth(1)[..75], 1, "x".into()).is_none());
    }
}
