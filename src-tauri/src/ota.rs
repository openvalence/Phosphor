//! ota -- POST /ota on the machine with the image streamed, its progress
//! emitted as `ota-progress` (bytes handed to the connection). DESIGN §10.19.
//!
//! Constraints:
//! - The URL is built here from a host and a hex id: the command reaches the
//!   machine's /ota and nothing else (the http capability scopes the page's
//!   fetch, not a command).
//! - Raw body with an explicit Content-Length: the machine sizes its erase
//!   from it and refuses a short body (Nucleus ValenceOta.cpp).
//! - Progress lags the machine by the socket buffers, tens of KB of about
//!   1.5 MB; the 200 is the only evidence the image landed.

use futures::{stream, StreamExt};
use tauri::ipc::{InvokeBody, Request};
use tauri::{AppHandle, Emitter};
use tauri_plugin_http::reqwest;

const CHUNK: usize = 16 * 1024;

/// (status, body) of POST `url` with `image`; `on_sent` sees the bytes handed over so far.
pub async fn post_image(url: &str, image: Vec<u8>, on_sent: impl Fn(usize) + Send + Sync + 'static) -> Result<(u16, String), String> {
    let total = image.len();
    let chunks: Vec<Vec<u8>> = image.chunks(CHUNK).map(<[u8]>::to_vec).collect();
    let mut sent = 0usize;
    let body = stream::iter(chunks).map(move |c| {
        on_sent(sent);
        sent += c.len();
        Ok::<_, std::io::Error>(c)
    });
    let res = reqwest::Client::new()
        .post(url)
        .header(reqwest::header::CONTENT_TYPE, "application/octet-stream")
        .header(reqwest::header::CONTENT_LENGTH, total)
        .body(reqwest::Body::wrap_stream(body))
        .send()
        .await
        .map_err(|e| e.to_string())?;
    let status = res.status().as_u16();
    Ok((status, res.text().await.unwrap_or_default()))
}

/// The page sends the image as the raw body, `x-ota-host` and `x-ota-id` as headers.
#[tauri::command]
pub async fn ota_upload(app: AppHandle, request: Request<'_>) -> Result<(u16, String), String> {
    let InvokeBody::Raw(image) = request.body() else { return Err("expected the image bytes".into()) };
    let header = |k: &str| request.headers().get(k).and_then(|v| v.to_str().ok()).unwrap_or("").to_owned();
    let (host, id) = (header("x-ota-host"), header("x-ota-id"));
    let host_ok = !host.is_empty() && host.chars().all(|c| c.is_ascii_alphanumeric() || c == '.' || c == '-');
    if !host_ok || id.is_empty() || id.len() > 8 || !id.chars().all(|c| c.is_ascii_hexdigit()) {
        return Err("bad host or id".into());
    }
    let image = image.clone();
    post_image(&format!("http://{host}/ota?id={id}"), image, move |n| {
        let _ = app.emit("ota-progress", n);
    })
    .await
}

#[cfg(test)]
mod tests {
    use super::*;
    use tokio::io::{AsyncReadExt, AsyncWriteExt};

    // A one-shot server: reads the head and Content-Length bytes, answers 200.
    #[tokio::test]
    async fn sends_content_length_and_every_byte() {
        let lis = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = lis.local_addr().unwrap();
        let server = tokio::spawn(async move {
            let (mut s, _) = lis.accept().await.unwrap();
            let mut buf = Vec::new();
            let mut tmp = [0u8; 8192];
            let (head, len) = loop {
                let n = s.read(&mut tmp).await.unwrap();
                buf.extend_from_slice(&tmp[..n]);
                if let Some(i) = buf.windows(4).position(|w| w == b"\r\n\r\n") {
                    let head = String::from_utf8_lossy(&buf[..i]).to_lowercase();
                    let len: usize = head.lines().find_map(|l| l.strip_prefix("content-length: ")).unwrap().trim().parse().unwrap();
                    buf.drain(..i + 4);
                    break (head, len);
                }
            };
            while buf.len() < len {
                let n = s.read(&mut tmp).await.unwrap();
                buf.extend_from_slice(&tmp[..n]);
            }
            s.write_all(b"HTTP/1.1 200 OK\r\nContent-Length: 2\r\nConnection: close\r\n\r\nok").await.unwrap();
            (head, buf)
        });
        let image: Vec<u8> = (0..100_000u32).map(|i| (i % 251) as u8).collect();
        let seen = std::sync::Arc::new(std::sync::atomic::AtomicUsize::new(0));
        let s2 = seen.clone();
        let (status, text) = post_image(&format!("http://{addr}/ota?id=1a2b"), image.clone(), move |n| {
            s2.store(n, std::sync::atomic::Ordering::Relaxed);
        })
        .await
        .unwrap();
        let (head, got) = server.await.unwrap();
        assert_eq!((status, text.as_str()), (200, "ok"));
        assert!(head.starts_with("post /ota?id=1a2b "), "{head}");
        assert!(!head.contains("transfer-encoding"), "{head}");
        assert_eq!(got, image);
        assert_eq!(seen.load(std::sync::atomic::Ordering::Relaxed), image.len() - image.len() % CHUNK);
    }

    // The machine's refusal reaches the page while the image is still going out.
    // OTA_BENCH=<ip> OTA_IMAGE=<the .bin the bench runs> cargo test --lib ota -- --ignored
    // An unapproved id: the machine answers 403 before it opens a slot.
    #[tokio::test]
    #[ignore]
    async fn bench_refuses_an_unapproved_id() {
        let ip = std::env::var("OTA_BENCH").unwrap();
        let image = std::fs::read(std::env::var("OTA_IMAGE").unwrap()).unwrap();
        let (status, text) = post_image(&format!("http://{ip}/ota?id=12345678"), image, |_| {}).await.unwrap();
        assert_eq!(status, 403, "{text}");
    }
}
