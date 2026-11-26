//! Low-level probes used to bring an opencode server up reliably.
//!
//! Both concerns live here, away from the process manager, because they are the
//! parts most likely to flake and the parts easiest to test in isolation.

use std::io::{Read, Write};
use std::net::{Ipv4Addr, SocketAddr, SocketAddrV4, TcpListener, TcpStream};
use std::time::Duration;

use base64::Engine as _;

/// Ask the OS for an unused loopback port.
///
/// There is an unavoidable race between releasing this port and opencode
/// binding it. We shrink the window by handing the port straight to opencode
/// and retrying the whole spawn if the bind fails.
pub fn free_port() -> std::io::Result<u16> {
    let listener = TcpListener::bind(SocketAddr::V4(SocketAddrV4::new(
        Ipv4Addr::LOCALHOST,
        0,
    )))?;
    let port = listener.local_addr()?.port();
    drop(listener);
    Ok(port)
}

/// Result of a single health probe.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Health {
    /// Server answered and reported itself healthy.
    Ready { version: String },
    /// Server answered, but reported unhealthy.
    Unhealthy,
    /// Could not complete the exchange (connection refused, timeout, ...).
    Unreachable,
}

/// Interpret a `GET /api/info` response body.
///
/// v2 answers with `{"version":"2.4.2","pid":123,...}`. The reply is itself the
/// liveness proof: reaching it means the process is up. A missing `version`
/// degrades to `"unknown"` rather than failing the spawn, but an empty or
/// non-string one signals we are talking to something else.
///
/// Kept separate from the socket code so the contract can be tested against
/// literal payloads without standing up a server.
pub fn parse_health(body: &str) -> Health {
    let Ok(value) = serde_json::from_str::<serde_json::Value>(body) else {
        return Health::Unhealthy;
    };
    let Some(object) = value.as_object() else {
        return Health::Unhealthy;
    };
    match object.get("version") {
        None => Health::Ready {
            version: "unknown".to_string(),
        },
        Some(serde_json::Value::String(version)) if !version.is_empty() => Health::Ready {
            version: version.clone(),
        },
        Some(_) => Health::Unhealthy,
    }
}

/// Perform one authenticated `GET /api/info` against `127.0.0.1:port`.
pub fn probe_health(port: u16, password: &str, timeout: Duration) -> Health {
    let addr = SocketAddr::V4(SocketAddrV4::new(Ipv4Addr::LOCALHOST, port));
    let Ok(mut stream) = TcpStream::connect_timeout(&addr, timeout) else {
        return Health::Unreachable;
    };
    let _ = stream.set_read_timeout(Some(timeout));
    let _ = stream.set_write_timeout(Some(timeout));

    // v2 requires Basic auth on every route, including the health check. The
    // username is fixed by opencode; only the password varies per boot.
    let credentials =
        base64::engine::general_purpose::STANDARD.encode(format!("opencode:{password}"));
    let request = format!(
        "GET /api/info HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nAuthorization: Basic {credentials}\r\nConnection: close\r\nAccept: application/json\r\nUser-Agent: halyard\r\n\r\n"
    );
    if stream.write_all(request.as_bytes()).is_err() {
        return Health::Unreachable;
    }

    let mut raw = Vec::new();
    // Bounded so a pathological server cannot exhaust memory. Taking `&mut
    // stream` rather than `stream` keeps the `Read` bound unambiguous, since
    // `TcpStream` also implements `Write`.
    let _ = (&mut stream).take(64 * 1024).read_to_end(&mut raw);
    let text = String::from_utf8_lossy(&raw);

    // Separate headers from body on the first blank line.
    let Some(separator) = text.find("\r\n\r\n") else {
        return Health::Unreachable;
    };
    let (headers, body) = text.split_at(separator);
    let body = &body[4..];

    if !headers.starts_with("HTTP/1.1 200") && !headers.starts_with("HTTP/1.0 200") {
        return Health::Unhealthy;
    }

    parse_health(body)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::net::TcpListener;
    use std::sync::{Arc, Mutex};
    use std::thread;

    /// Serve a single canned HTTP response on an ephemeral port, capturing the
    /// request text so tests can pin the exact wire format.
    fn serve_once_capturing(response: &'static str) -> (u16, Arc<Mutex<String>>) {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        let captured = Arc::new(Mutex::new(String::new()));
        let sink = Arc::clone(&captured);
        thread::spawn(move || {
            if let Ok((mut socket, _)) = listener.accept() {
                // Read until the header block is complete (or the peer closes),
                // so the assertion never sees a half-delivered request.
                let mut request = Vec::new();
                let mut chunk = [0u8; 512];
                loop {
                    match socket.read(&mut chunk) {
                        Ok(0) => break,
                        Ok(n) => {
                            request.extend_from_slice(&chunk[..n]);
                            if request.windows(4).any(|w| w == b"\r\n\r\n") {
                                break;
                            }
                        }
                        Err(_) => break,
                    }
                }
                *sink.lock().unwrap() = String::from_utf8_lossy(&request).into_owned();
                let _ = socket.write_all(response.as_bytes());
                let _ = socket.flush();
            }
        });
        (port, captured)
    }

    fn serve_once(response: &'static str) -> u16 {
        serve_once_capturing(response).0
    }

    #[test]
    fn free_port_returns_a_bindable_port() {
        let port = free_port().unwrap();
        assert!(port > 0);
        // The whole point is that nothing is holding it, so we must be able to
        // bind it ourselves immediately afterwards.
        TcpListener::bind(("127.0.0.1", port)).expect("port should be free");
    }

    #[test]
    fn parses_a_v2_info_payload() {
        let health = parse_health(r#"{"version":"2.4.2","pid":1}"#);
        assert_eq!(
            health,
            Health::Ready {
                version: "2.4.2".to_string()
            }
        );
    }

    #[test]
    fn info_without_version_falls_back_to_unknown() {
        assert_eq!(
            parse_health(r#"{"pid":1}"#),
            Health::Ready {
                version: "unknown".to_string()
            }
        );
    }

    #[test]
    fn empty_version_is_unhealthy() {
        // A blank version means the payload came from something that is not
        // opencode; reporting Ready would make startup spin on a foreign port.
        assert_eq!(parse_health(r#"{"version":""}"#), Health::Unhealthy);
    }

    #[test]
    fn non_string_version_is_unhealthy() {
        assert_eq!(parse_health(r#"{"version":42}"#), Health::Unhealthy);
    }

    #[test]
    fn malformed_json_is_unhealthy_not_unreachable() {
        // A 200 with a garbage body means we reached the server, it is just not
        // the server we expected. Conflating this with "unreachable" would make
        // the caller spin on the wrong condition.
        assert_eq!(parse_health("not json at all"), Health::Unhealthy);
    }

    #[test]
    fn probe_sends_basic_auth_to_api_info() {
        let (port, captured) = serve_once_capturing(
            "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nConnection: close\r\n\r\n{\"version\":\"2.4.2\",\"pid\":1}",
        );
        let health = probe_health(port, "hunter2", Duration::from_secs(2));
        assert_eq!(
            health,
            Health::Ready {
                version: "2.4.2".to_string()
            }
        );

        let request = captured.lock().unwrap().clone();
        let mut lines = request.lines();
        assert_eq!(lines.next(), Some("GET /api/info HTTP/1.1"));
        let headers: Vec<&str> = lines.collect();
        assert!(
            headers.contains(&format!("Host: 127.0.0.1:{port}").as_str()),
            "missing Host header in {request:?}"
        );
        // Literal base64 of `opencode:hunter2`, so the credential shape is
        // pinned rather than recomputed by the same code under test.
        assert!(
            headers.contains(&"Authorization: Basic b3BlbmNvZGU6aHVudGVyMg=="),
            "missing Basic auth in {request:?}"
        );
        assert!(
            headers.contains(&"Connection: close"),
            "missing Connection header in {request:?}"
        );
    }

    #[test]
    fn probe_reports_unhealthy_on_401() {
        let (port, captured) = serve_once_capturing(
            "HTTP/1.1 401 Unauthorized\r\nContent-Type: application/json\r\nConnection: close\r\n\r\n{\"error\":\"unauthorized\"}",
        );
        assert_eq!(
            probe_health(port, "wrong-password", Duration::from_secs(2)),
            Health::Unhealthy
        );
        // The refusal must come from authentication, not from a malformed probe.
        assert!(
            captured
                .lock()
                .unwrap()
                .contains("Authorization: Basic "),
            "probe must still send credentials on a 401 path"
        );
    }

    #[test]
    fn probe_reports_unhealthy_on_non_200() {
        let port = serve_once("HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\n\r\n");
        assert_eq!(
            probe_health(port, "hunter2", Duration::from_secs(2)),
            Health::Unhealthy
        );
    }

    #[test]
    fn probe_reports_unreachable_when_nothing_is_listening() {
        // Bind then drop, so the port is almost certainly closed.
        let port = free_port().unwrap();
        assert_eq!(
            probe_health(port, "hunter2", Duration::from_millis(500)),
            Health::Unreachable
        );
    }
}
