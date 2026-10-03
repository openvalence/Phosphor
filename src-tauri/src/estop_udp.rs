// estop_udp.rs -- RFC-053's connectionless e-stop for the Phosphor shell: the
// 12-byte SPEC 5.5 frame sent as one UDP datagram on every IPv4 interface to
// the SPEC 13.8 port.
//
// Constraints:
// - Takes an ESTOP frame and nothing else: exactly 12 bytes opening with the
//   E5 magic (valence-js estop-datagram.js encodes it, CRC included; the hub
//   checks the CRC). Anything else is refused, so this command is never a
//   general UDP broadcast.
// - One send per call and no receive: the SPEC 11.2 repeat budget is the
//   caller's (broadcastEstop), and a hub never answers a datagram.
// - Every IPv4 interface: a socket bound to each address sends that
//   interface's directed broadcast (the limited broadcast on a point-to-point
//   or /0 link, 127.0.0.1 on loopback), so a hub on any segment this host
//   touches hears it. Every hub that honors RFC-053 there latches, not only
//   the one this window drives.
// - HAND-TRANSCRIBED WIRE NUMBER: PORT is registry udp_discovery.port, the
//   port RFC-053 item 1 puts ESTOP on; gated by test/check-registry-pins.mjs
//   (T20).

use std::net::{Ipv4Addr, UdpSocket};

const PORT: u16 = 22096;
const FRAME_BYTES: usize = 12;
const MAGIC: [u8; 4] = [0xE5, 0xE5, 0xE5, 0xE5];

fn is_estop_frame(b: &[u8]) -> bool {
    b.len() == FRAME_BYTES && b[..4] == MAGIC
}

/// Where one interface's copy goes.
fn destination(ip: Ipv4Addr, prefixlen: u8) -> Ipv4Addr {
    if ip.is_loopback() {
        return Ipv4Addr::LOCALHOST;
    }
    if prefixlen == 0 || prefixlen >= 31 {
        return Ipv4Addr::BROADCAST;
    }
    let host_bits = u32::MAX >> prefixlen;
    Ipv4Addr::from(u32::from(ip) | host_bits)
}

/// (address to bind, destination) for every IPv4 interface the host has now.
fn targets() -> Vec<(Ipv4Addr, Ipv4Addr)> {
    if_addrs::get_if_addrs()
        .unwrap_or_default()
        .into_iter()
        .filter_map(|i| match i.addr {
            if_addrs::IfAddr::V4(a) => Some((a.ip, destination(a.ip, a.prefixlen))),
            _ => None,
        })
        .collect()
}

fn send_everywhere(frame: &[u8]) -> Result<u32, String> {
    let mut sent = 0u32;
    for (local, dest) in targets() {
        // One interface that cannot bind or send costs that interface only.
        let out = UdpSocket::bind((local, 0)).and_then(|s| {
            s.set_broadcast(true)?;
            s.send_to(frame, (dest, PORT))
        });
        if out.is_ok() {
            sent += 1;
        }
    }
    if sent == 0 {
        Err("no IPv4 interface took the datagram".into())
    } else {
        Ok(sent)
    }
}

/// One ESTOP datagram on every IPv4 interface: Ok(interfaces it left on).
/// Blocking work runs on the blocking pool and is awaited here.
#[tauri::command]
pub async fn estop_broadcast(datagram: Vec<u8>) -> Result<u32, String> {
    if !is_estop_frame(&datagram) {
        return Err("not an ESTOP frame (SPEC 5.5)".into());
    }
    tauri::async_runtime::spawn_blocking(move || send_everywhere(&datagram))
        .await
        .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;

    // valence-js's pinned vector: user, watch, seq 0xBEEF.
    const PINNED: [u8; 12] = [0xE5, 0xE5, 0xE5, 0xE5, 0x00, 0x00, 0xEF, 0xBE, 0xEA, 0xCE, 0x08, 0xAC];

    #[test]
    fn takes_only_an_estop_frame() {
        assert!(is_estop_frame(&PINNED));
        assert!(!is_estop_frame(&PINNED[..11]));
        let mut long = PINNED.to_vec();
        long.push(0);
        assert!(!is_estop_frame(&long));
        let mut probe = PINNED;
        probe[..4].copy_from_slice(b"VLNC");
        assert!(!is_estop_frame(&probe));
    }

    #[test]
    fn each_interface_gets_its_own_broadcast() {
        let ip = Ipv4Addr::new(192, 168, 1, 118);
        assert_eq!(destination(ip, 24), Ipv4Addr::new(192, 168, 1, 255));
        assert_eq!(destination(Ipv4Addr::new(10, 1, 2, 3), 8), Ipv4Addr::new(10, 255, 255, 255));
        assert_eq!(destination(Ipv4Addr::new(172, 20, 5, 9), 20), Ipv4Addr::new(172, 20, 15, 255));
        assert_eq!(destination(ip, 32), Ipv4Addr::BROADCAST);
        assert_eq!(destination(ip, 31), Ipv4Addr::BROADCAST);
        assert_eq!(destination(ip, 0), Ipv4Addr::BROADCAST);
        assert_eq!(destination(Ipv4Addr::LOCALHOST, 8), Ipv4Addr::LOCALHOST);
    }

    // Enumerates, never sends: a test must not stop a machine on the LAN.
    #[test]
    fn the_host_lists_its_loopback() {
        assert!(targets().contains(&(Ipv4Addr::LOCALHOST, Ipv4Addr::LOCALHOST)), "{:?}", targets());
    }
}
