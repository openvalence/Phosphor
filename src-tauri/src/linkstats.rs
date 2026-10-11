// linkstats.rs -- the client half of the top bar's loss readout: cumulative
// TCP retransmission counters for the hub connection, read without
// elevation, once per call (the page polls about 1 Hz while live).
//
// Constraints:
// - The hub WebSocket belongs to the webview's network process (WebView2,
//   WKWebView's WebKit Networking, WebKitGTK's network process), never this
//   one, so a getsockopt on our own socket cannot see it.
// - Per connection where the OS allows it unprivileged: Linux sock_diag
//   netlink (tcp_info, Flatpak sandbox included), macOS nettop (the system
//   tool over the kernel's per-flow statistics; bytes, not segments).
// - Windows per-connection EStats needs elevation to enable collection
//   (SetPerTcpConnectionEStats answers ERROR_ACCESS_DENIED unelevated), so
//   Windows reports the system-wide TCP counters, `scope: "system"`.
// - macOS system-wide counters read zero unprivileged
//   (net.inet.tcp.disable_access_to_stats), so macOS has no system fallback.
// - Counters only, never a percent: src/model/linkstats.js windows them.
// - Android and iOS answer None.
// See: src/model/linkstats.js

use serde::Serialize;

#[derive(Serialize, Debug, PartialEq)]
pub struct TcpCounters {
  retrans: u64,
  sent: u64,
  /// "connection": the hub's connection only; "system": every TCP connection on this host.
  scope: &'static str,
  /// "segments" or "bytes".
  unit: &'static str,
}

#[tauri::command]
pub async fn link_tcp_counters(host: String, port: u16) -> Option<TcpCounters> {
  tauri::async_runtime::spawn_blocking(move || read(&host, port)).await.ok().flatten()
}

#[cfg(any(target_os = "linux", target_os = "macos"))]
fn resolve(host: &str, port: u16) -> Vec<std::net::IpAddr> {
  use std::net::ToSocketAddrs;
  use std::sync::Mutex;
  // A name resolves once per host, not once a second.
  static CACHE: Mutex<Option<(String, u16, Vec<std::net::IpAddr>)>> = Mutex::new(None);
  let mut c = CACHE.lock().unwrap_or_else(|e| e.into_inner());
  if let Some((h, p, ips)) = c.as_ref() {
    if h == host && *p == port {
      return ips.clone();
    }
  }
  let ips: Vec<_> = (host, port).to_socket_addrs().map(|a| a.map(|s| s.ip()).collect()).unwrap_or_default();
  *c = Some((host.to_string(), port, ips.clone()));
  ips
}

// ---- Linux: sock_diag ----------------------------------------------------------

#[cfg(target_os = "linux")]
fn read(host: &str, port: u16) -> Option<TcpCounters> {
  use std::os::fd::{AsRawFd, FromRawFd, OwnedFd};
  let dst = resolve(host, port);
  let fd = unsafe { libc::socket(libc::AF_NETLINK, libc::SOCK_DGRAM | libc::SOCK_CLOEXEC, libc::NETLINK_SOCK_DIAG) };
  if fd < 0 {
    return None;
  }
  let fd = unsafe { OwnedFd::from_raw_fd(fd) };
  let mut sum: Option<(u64, u64)> = None;
  let mut buf = vec![0u8; 32 * 1024];
  for family in [libc::AF_INET as u8, libc::AF_INET6 as u8] {
    if !dst.iter().any(|ip| ip.is_ipv4() == (family == libc::AF_INET as u8)) {
      continue;
    }
    let req = diag_request(family);
    if unsafe { libc::send(fd.as_raw_fd(), req.as_ptr().cast(), req.len(), 0) } < 0 {
      return None;
    }
    loop {
      let n = unsafe { libc::recv(fd.as_raw_fd(), buf.as_mut_ptr().cast(), buf.len(), 0) };
      if n <= 0 {
        return None;
      }
      let (found, done) = parse_diag(&buf[..n as usize], &dst, port);
      if let Some((r, s)) = found {
        let t = sum.get_or_insert((0, 0));
        t.0 += r;
        t.1 += s;
      }
      if done {
        break;
      }
    }
  }
  sum.map(|(retrans, sent)| TcpCounters { retrans, sent, scope: "connection", unit: "segments" })
}

/// SOCK_DIAG_BY_FAMILY dump of established TCP sockets with INET_DIAG_INFO.
#[cfg(any(target_os = "linux", test))]
fn diag_request(family: u8) -> [u8; 72] {
  let mut r = [0u8; 72];
  r[0..4].copy_from_slice(&72u32.to_ne_bytes()); // nlmsg_len
  r[4..6].copy_from_slice(&20u16.to_ne_bytes()); // SOCK_DIAG_BY_FAMILY
  r[6..8].copy_from_slice(&0x301u16.to_ne_bytes()); // NLM_F_REQUEST | NLM_F_DUMP
  r[8..12].copy_from_slice(&1u32.to_ne_bytes()); // seq
  r[16] = family;
  r[17] = 6; // IPPROTO_TCP
  r[18] = 1 << (2 - 1); // INET_DIAG_INFO
  r[20..24].copy_from_slice(&(1u32 << 1).to_ne_bytes()); // TCP_ESTABLISHED
  r
}

/// One recv's worth of the dump: (total_retrans, data_segs_out) summed over
/// the sockets whose peer is one of `dst` on `port`, and whether NLMSG_DONE or
/// an error ended the dump. tcp_info offsets: total_retrans 100, data_segs_out
/// 156 (Linux 4.6+; an older kernel's shorter tcp_info is skipped).
#[cfg(any(target_os = "linux", test))]
fn parse_diag(buf: &[u8], dst: &[std::net::IpAddr], port: u16) -> (Option<(u64, u64)>, bool) {
  let u16_at = |b: &[u8], o: usize| u16::from_ne_bytes([b[o], b[o + 1]]);
  let u32_at = |b: &[u8], o: usize| u32::from_ne_bytes([b[o], b[o + 1], b[o + 2], b[o + 3]]);
  let mut found: Option<(u64, u64)> = None;
  let mut off = 0;
  while off + 16 <= buf.len() {
    let len = u32_at(buf, off) as usize;
    let kind = u16_at(buf, off + 4);
    if len < 16 || off + len > buf.len() || kind == 2 || kind == 3 {
      return (found, true); // malformed, NLMSG_ERROR, NLMSG_DONE
    }
    let m = &buf[off + 16..off + len];
    if m.len() >= 72 {
      let dport = u16::from_be_bytes([m[6], m[7]]);
      let peer: Option<std::net::IpAddr> = match m[0] {
        2 => Some(std::net::Ipv4Addr::new(m[24], m[25], m[26], m[27]).into()),
        10 => <[u8; 16]>::try_from(&m[24..40]).ok().map(|a| std::net::Ipv6Addr::from(a).into()),
        _ => None,
      };
      if dport == port && peer.is_some_and(|p| dst.contains(&p)) {
        let mut a = 72;
        while a + 4 <= m.len() {
          let alen = u16_at(m, a) as usize;
          if alen < 4 || a + alen > m.len() {
            break;
          }
          if u16_at(m, a + 2) == 2 && alen - 4 >= 160 {
            let info = &m[a + 4..a + alen];
            let t = found.get_or_insert((0, 0));
            t.0 += u64::from(u32_at(info, 100));
            t.1 += u64::from(u32_at(info, 156));
          }
          a += (alen + 3) & !3;
        }
      }
    }
    off += (len + 3) & !3;
  }
  (found, false)
}

// ---- macOS: nettop -------------------------------------------------------------

#[cfg(target_os = "macos")]
fn read(host: &str, port: u16) -> Option<TcpCounters> {
  let dst = resolve(host, port);
  // One sample, cumulative per flow, about 5 ms wall and 4 ms CPU (measured on an M4).
  let out = std::process::Command::new("/usr/bin/nettop")
    .args(["-m", "tcp", "-L", "1", "-n", "-x", "-J", "bytes_out,re-tx"])
    .output()
    .ok()?;
  parse_nettop(&String::from_utf8_lossy(&out.stdout), &dst, port)
    .map(|(retrans, sent)| TcpCounters { retrans, sent, scope: "connection", unit: "bytes" })
}

/// Flow rows look like `tcp4 10.0.0.2:5123<->10.0.0.9:82,4096,0,` (an IPv6
/// port follows a dot). Sums (re-tx, bytes_out) over every flow to one of
/// `dst` on `port`.
#[cfg(any(target_os = "macos", test))]
fn parse_nettop(text: &str, dst: &[std::net::IpAddr], port: u16) -> Option<(u64, u64)> {
  let peers: Vec<String> = dst
    .iter()
    .map(|ip| if ip.is_ipv4() { format!("<->{ip}:{port}") } else { format!("<->{ip}.{port}") })
    .collect();
  let mut found: Option<(u64, u64)> = None;
  for line in text.lines() {
    let mut cols = line.split(',');
    let flow = cols.next().unwrap_or("");
    if !peers.iter().any(|p| flow.ends_with(p.as_str())) {
      continue;
    }
    let (Some(Ok(out)), Some(Ok(rtx))) = (cols.next().map(str::parse::<u64>), cols.next().map(str::parse::<u64>)) else {
      continue;
    };
    let t = found.get_or_insert((0, 0));
    t.0 += rtx;
    t.1 += out;
  }
  found
}

// ---- Windows: system-wide ------------------------------------------------------

#[cfg(windows)]
fn read(_host: &str, _port: u16) -> Option<TcpCounters> {
  use windows_sys::Win32::NetworkManagement::IpHelper::{GetTcpStatisticsEx2, MIB_TCPSTATS2};
  use windows_sys::Win32::Networking::WinSock::{AF_INET, AF_INET6};
  let mut retrans = 0u64;
  let mut sent = 0u64;
  let mut any = false;
  for family in [AF_INET, AF_INET6] {
    let mut st = MIB_TCPSTATS2::default();
    if unsafe { GetTcpStatisticsEx2(&mut st, u32::from(family)) } == 0 {
      retrans += u64::from(st.dwRetransSegs);
      sent += st.dw64OutSegs;
      any = true;
    }
  }
  any.then_some(TcpCounters { retrans, sent, scope: "system", unit: "segments" })
}

#[cfg(not(any(target_os = "linux", target_os = "macos", windows)))]
fn read(_host: &str, _port: u16) -> Option<TcpCounters> {
  None
}

#[cfg(test)]
mod tests {
  use super::*;
  use std::net::IpAddr;

  fn diag_msg(peer: [u8; 4], dport: u16, retrans: u32, data_out: u32) -> Vec<u8> {
    let mut info = vec![0u8; 232];
    info[100..104].copy_from_slice(&retrans.to_ne_bytes());
    info[156..160].copy_from_slice(&data_out.to_ne_bytes());
    let mut m = vec![0u8; 72];
    m[0] = 2;
    m[6..8].copy_from_slice(&dport.to_be_bytes());
    m[24..28].copy_from_slice(&peer);
    m.extend_from_slice(&((info.len() + 4) as u16).to_ne_bytes());
    m.extend_from_slice(&2u16.to_ne_bytes());
    m.extend_from_slice(&info);
    let mut h = Vec::new();
    h.extend_from_slice(&((m.len() + 16) as u32).to_ne_bytes());
    h.extend_from_slice(&20u16.to_ne_bytes());
    h.extend_from_slice(&[0u8; 10]);
    h.extend_from_slice(&m);
    h
  }

  #[test]
  fn diag_sums_only_the_hub_peer_and_stops_at_done() {
    let hub: IpAddr = "192.168.1.118".parse().unwrap();
    let mut buf = diag_msg([192, 168, 1, 118], 82, 3, 400);
    buf.extend(diag_msg([192, 168, 1, 118], 80, 99, 99)); // another port
    buf.extend(diag_msg([10, 0, 0, 1], 82, 99, 99)); // another host
    buf.extend(diag_msg([192, 168, 1, 118], 82, 1, 100)); // a second connection to the hub
    assert_eq!(parse_diag(&buf, &[hub], 82), (Some((4, 500)), false));
    let mut done = vec![0u8; 20];
    done[0..4].copy_from_slice(&20u32.to_ne_bytes());
    done[4..6].copy_from_slice(&3u16.to_ne_bytes());
    assert_eq!(parse_diag(&done, &[hub], 82), (None, true));
    let req = diag_request(2);
    assert_eq!(u32::from_ne_bytes(req[0..4].try_into().unwrap()) as usize, req.len());
  }

  #[test]
  fn nettop_matches_v4_and_v6_peers() {
    let text = ",bytes_out,re-tx,\nWebKit Networking.411,9000,40,\n\
      tcp4 192.168.1.224:58568<->192.168.1.118:82,5000,25,\n\
      tcp4 192.168.1.224:58569<->192.168.1.118:80,7000,99,\n\
      tcp6 fe80::1.50000<->fe80::2.82,1000,5,\n";
    let v4: IpAddr = "192.168.1.118".parse().unwrap();
    let v6: IpAddr = "fe80::2".parse().unwrap();
    assert_eq!(parse_nettop(text, &[v4], 82), Some((25, 5000)));
    assert_eq!(parse_nettop(text, &[v6], 82), Some((5, 1000)));
    assert_eq!(parse_nettop(text, &[v4], 83), None);
  }

  #[cfg(windows)]
  #[test]
  fn windows_reads_system_counters_unelevated() {
    let c = read("192.168.1.118", 82).expect("GetTcpStatisticsEx2 answers without elevation");
    assert_eq!((c.scope, c.unit), ("system", "segments"));
    assert!(c.sent > 0 && c.retrans <= c.sent);
  }
}
