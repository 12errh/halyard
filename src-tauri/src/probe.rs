//! Low-level probes used to bring an opencode server up reliably.
//!
//! Both concerns live here, away from the process manager, because they are the
//! parts most likely to flake and the parts easiest to test in isolation.

use std::io::{Read, Write};
use std::net::{Ipv4Addr, SocketAddr, SocketAddrV4, TcpListener, TcpStream};
use std::time::Duration;

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

/// Interpret a `/global/health` response body.
///
/// Kept separate from the socket code so the contract can be tested against
/// literal payloads without standing up a server.
pub fn parse_health(body: &str) -> Health {
    let Ok(value) = serde_json::from_str::<serde_json::Value>(body) else {
        return Health::Unhealthy;
    };
    match value.get("healthy").and_then(|v| v.as_bool()) {
        Some(true) => Health::Ready {
            version: value
                .get("version")
                .and_then(|v| v.as_str())
                .unwrap_or("unknown")
                .to_string(),
        },
        _ => Health::Unhealthy,
    }
}

/// Perform one `GET /global/health` against `127.0.0.1:port`.
pub fn probe_health(port: u16, timeout: Duration) -> Health {
    let addr = SocketAddr::V4(SocketAddrV4::new(Ipv4Addr::LOCALHOST, port));
    let Ok(mut stream) = TcpStream::connect_timeout(&addr, timeout) else {
        return Health::Unreachable;
    };
    let _ = stream.set_read_timeout(Some(timeout));
    let _ = stream.set_write_timeout(Some(timeout));

    let request = format!(
        "GET /global/health HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nConnection: close\r\nAccept: application/json\r\nUser-Agent: halyard\r\n\r\n"
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
    use std::thread;

    /// Serve a single canned HTTP response on an ephemeral port.
    fn serve_once(response: &'static str) -> u16 {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        thread::spawn(move || {
            if let Ok((mut socket, _)) = listener.accept() {
                let mut buf = [0u8; 2048];
                let _ = socket.read(&mut buf);
                let _ = socket.write_all(response.as_bytes());
                let _ = socket.flush();
            }
        });
        port
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
    fn parses_a_healthy_payload() {
        let health = parse_health(r#"{"healthy":true,"version":"1.18.35"}"#);
        assert_eq!(
            health,
            Health::Ready {
                version: "1.18.35".to_string()
            }
        );
    }

    #[test]
    fn healthy_without_version_falls_back_to_unknown() {
        assert_eq!(
            parse_health(r#"{"healthy":true}"#),
            Health::Ready {
                version: "unknown".to_string()
            }
        );
    }

    #[test]
    fn explicit_false_is_unhealthy() {
        assert_eq!(parse_health(r#"{"healthy":false}"#), Health::Unhealthy);
    }

    #[test]
    fn malformed_json_is_unhealthy_not_unreachable() {
        // A 200 with a garbage body means we reached the server, it is just not
        // the server we expected. Conflating this with "unreachable" would make
        // the caller spin on the wrong condition.
        assert_eq!(parse_health("not json at all"), Health::Unhealthy);
    }

    #[test]
    fn probe_reports_ready_against_a_real_socket() {
        let port = serve_once(
            "HTTP/1.1 200 OK\r\nContent-Length: 39\r\nConnection: close\r\n\r\n{\"healthy\":true,\"version\":\"1.18.35\"}",
        );
        let short = Duration::from_secs(2);
        assert_eq!(probe_health(port, short).is_ready(), Some("1.18.35"));
    }

    #[test]
    fn probe_reports_unhealthy_on_non_200() {
        let port = serve_once("HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\n\r\n");
        assert_eq!(
            probe_health(port, Duration::from_secs(2)),
            Health::Unhealthy
        );
    }

    #[test]
    fn probe_reports_unreachable_when_nothing_is_listening() {
        // Bind then drop, so the port is almost certainly closed.
        let port = free_port().unwrap();
        assert_eq!(
            probe_health(port, Duration::from_millis(500)),
            Health::Unreachable
        );
    }

    impl Health {
        fn is_ready(&self) -> Option<&str> {
            match self {
                Health::Ready { version } => Some(version.as_str()),
                _ => None,
            }
        }
    }
}
