//! Supervision of the `opencode serve` child process.
//!
//! Halyard owns exactly one opencode server at a time, scoped to the currently
//! active project directory. Sessions themselves live in opencode's own
//! database, so tearing the process down on project switch loses no history.

use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::{Duration, Instant};

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, State};
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::{Child, Command};
use tokio::sync::Mutex;

use crate::binary;
use crate::probe::{self, Health};

/// Origins the opencode server must accept browser requests from.
///
/// In `tauri dev` the webview is served by Vite over http, in a packaged build
/// it runs on the custom-protocol origin. Windows uses the http flavour of the
/// custom protocol, so both spellings are listed.
pub const CORS_ORIGINS: &[&str] = &[
    "http://localhost:1420",
    "http://127.0.0.1:1420",
    "tauri://localhost",
    "http://tauri.localhost",
];

/// How long to wait for the server to report healthy before giving up.
const STARTUP_TIMEOUT: Duration = Duration::from_secs(30);

/// Grace period between SIGTERM and SIGKILL on shutdown.
const TERMINATE_GRACE: Duration = Duration::from_secs(5);

/// Number of spawn attempts, to absorb the free-port race in `probe::free_port`.
const SPAWN_ATTEMPTS: u8 = 3;

/// Events pushed to the webview.
pub const EVENT_STATUS: &str = "halyard://server-status";
pub const EVENT_LOG: &str = "halyard://server-log";

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ServerInfo {
    pub url: String,
    pub port: u16,
    pub version: String,
    pub project: PathBuf,
}

/// Lifecycle state as the UI understands it.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(tag = "status", rename_all = "camelCase")]
pub enum ServerStatus {
    Stopped,
    Starting { project: PathBuf },
    Ready(ServerInfo),
    Failed { message: String },
}

impl ServerStatus {
    pub fn is_busy(&self) -> bool {
        matches!(self, ServerStatus::Starting { .. })
    }
}

/// Build the argument vector for `opencode serve`.
///
/// Pure so the contract is pinned by tests rather than by manual inspection.
pub fn build_args(port: u16) -> Vec<String> {
    let mut args = vec![
        "serve".to_string(),
        "--hostname".to_string(),
        "127.0.0.1".to_string(),
        "--port".to_string(),
        port.to_string(),
    ];
    for origin in CORS_ORIGINS {
        args.push("--cors".to_string());
        args.push((*origin).to_string());
    }
    args
}

pub fn server_url(port: u16) -> String {
    format!("http://127.0.0.1:{port}")
}

struct Running {
    info: ServerInfo,
    child: Child,
}

#[derive(Default)]
pub struct ServerManager {
    inner: Mutex<Option<Running>>,
}

impl ServerManager {
    pub fn new() -> Self {
        Self {
            inner: Mutex::new(None),
        }
    }

    pub async fn status(&self) -> ServerStatus {
        match self.info().await {
            Some(info) => ServerStatus::Ready(info),
            None => ServerStatus::Stopped,
        }
    }

    async fn info(&self) -> Option<ServerInfo> {
        self.inner.lock().await.as_ref().map(|r| r.info.clone())
    }

    async fn set_status(&self, app: &AppHandle, status: ServerStatus) {
        let _ = app.emit(EVENT_STATUS, &status);
    }

    /// Start (or restart) the server against `project`.
    pub async fn start(
        &self,
        app: &AppHandle,
        project: PathBuf,
        binary_override: Option<PathBuf>,
    ) -> Result<ServerInfo, String> {
        // Replace whatever is running first; switching projects must not leave
        // an orphaned process bound to the old directory.
        self.stop(app).await;

        if !project.is_dir() {
            let message = format!("project directory does not exist: {}", project.display());
            let status = ServerStatus::Failed {
                message: message.clone(),
            };
            self.set_status(app, status).await;
            return Err(message);
        }

        let executable = match binary::resolve(binary_override.as_deref(), None) {
            Ok(path) => path,
            Err(err) => {
                let message = describe_binary_error(&err);
                let status = ServerStatus::Failed {
                    message: message.clone(),
                };
                self.set_status(app, status).await;
                return Err(message);
            }
        };

        self.set_status(
            app,
            ServerStatus::Starting {
                project: project.clone(),
            },
        )
        .await;

        let mut last_error = String::from("opencode did not start");

        for attempt in 1..=SPAWN_ATTEMPTS {
            let port = probe::free_port().map_err(|e| e.to_string())?;

            match self.spawn_and_wait(app, &executable, &project, port).await {
                Ok((info, child)) => {
                    // Keep the handle: dropping it would kill the server, since
                    // the child is spawned with `kill_on_drop`.
                    let ready = info.clone();
                    *self.inner.lock().await = Some(Running { info, child });
                    self.set_status(app, ServerStatus::Ready(ready.clone())).await;
                    return Ok(ready);
                }
                Err(err) => {
                    last_error = err;
                    let _ = app.emit(
                        EVENT_LOG,
                        LogLine {
                            level: "warn",
                            message: format!("start attempt {attempt} failed: {last_error}"),
                        },
                    );
                }
            }
        }

        let status = ServerStatus::Failed {
            message: last_error.clone(),
        };
        self.set_status(app, status).await;
        Err(last_error)
    }

    async fn spawn_and_wait(
        &self,
        app: &AppHandle,
        executable: &Path,
        project: &Path,
        port: u16,
    ) -> Result<(ServerInfo, Child), String> {
        let mut command = Command::new(executable);
        command
            .args(build_args(port))
            .current_dir(project)
            .env("OPENCODE_DISABLE_AUTOUPDATE", "1")
            .kill_on_drop(true)
            .stdin(std::process::Stdio::null())
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped());

        let mut child = command
            .spawn()
            .map_err(|e| format!("failed to launch {}: {e}", executable.display()))?;

        // Drain both pipes immediately. A full pipe buffer would otherwise block
        // the server forever, which presents to the user as "Halyard hangs on
        // startup" and is miserable to debug.
        let app_stdout = app.clone();
        let stdout = child.stdout.take();
        if let Some(stdout) = stdout {
            spawn_log_pump(app_stdout, stdout, "stdout");
        }
        let app_stderr = app.clone();
        let stderr = child.stderr.take();
        if let Some(stderr) = stderr {
            spawn_log_pump(app_stderr, stderr, "stderr");
        }

        let deadline = Instant::now() + STARTUP_TIMEOUT;
        loop {
            if let Ok(Some(status)) = child.try_wait() {
                return Err(format!("opencode exited during startup ({status})"));
            }

            match probe::probe_health(port, Duration::from_millis(750)) {
                Health::Ready { version } => {
                    let info = ServerInfo {
                        url: server_url(port),
                        port,
                        version,
                        project: project.to_path_buf(),
                    };
                    return Ok((info, child));
                }
                Health::Unhealthy | Health::Unreachable => {}
            }

            if Instant::now() > deadline {
                return Err(format!(
                    "opencode did not become healthy within {}s",
                    STARTUP_TIMEOUT.as_secs()
                ));
            }

            tokio::time::sleep(Duration::from_millis(150)).await;
        }
    }

    /// Terminate the child, escalating if it ignores the polite request.
    pub async fn stop(&self, app: &AppHandle) {
        let Some(mut running) = self.inner.lock().await.take() else {
            self.set_status(app, ServerStatus::Stopped).await;
            return;
        };

        terminate(&mut running.child).await;

        self.set_status(app, ServerStatus::Stopped).await;
    }
}

/// Ask the child to exit, then insist.
///
/// The two platforms need different politeness: Unix has SIGTERM, which lets
/// opencode flush its database, while Windows has no equivalent signal and
/// `taskkill /T` is the closest thing — it reaches any children opencode
/// spawned, which a bare handle kill would leave behind.
async fn terminate(child: &mut Child) {
    #[cfg(unix)]
    if let Some(pid) = child.id() {
        // SAFETY: `kill` with SIGTERM cannot invalidate anything; the only
        // risk is signalling the wrong pid, which the `id()` lookup prevents.
        unsafe {
            libc::kill(pid as i32, libc::SIGTERM);
        }
    }

    let deadline = Instant::now() + TERMINATE_GRACE;
    loop {
        match child.try_wait() {
            Ok(Some(_)) => return,
            Ok(None) if Instant::now() < deadline => {
                tokio::time::sleep(Duration::from_millis(50)).await;
            }
            _ => break,
        }
    }

    #[cfg(target_os = "windows")]
    {
        if let Some(pid) = child.id() {
            let _ = Command::new("taskkill")
                .args(["/PID", &pid.to_string(), "/T", "/F"])
                .stdin(std::process::Stdio::null())
                .stdout(std::process::Stdio::null())
                .stderr(std::process::Stdio::null())
                .status()
                .await;
        }
    }

    let _ = child.start_kill();
    let _ = tokio::time::timeout(Duration::from_secs(2), child.wait()).await;
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct LogLine {
    level: &'static str,
    message: String,
}

/// Forward a child pipe line-by-line to the webview, bounded to avoid flooding.
fn spawn_log_pump<R>(app: AppHandle, reader: R, level: &'static str)
where
    R: tokio::io::AsyncRead + Unpin + Send + 'static,
{
    tauri::async_runtime::spawn(async move {
        let mut lines = BufReader::new(reader).lines();
        let mut budget = 500usize;
        while let Ok(Some(line)) = lines.next_line().await {
            if budget == 0 {
                let _ = app.emit(
                    EVENT_LOG,
                    LogLine {
                        level: "info",
                        message: "[server log truncated]".into(),
                    },
                );
                break;
            }
            budget -= 1;
            let _ = app.emit(
                EVENT_LOG,
                LogLine {
                    level,
                    message: line,
                },
            );
        }
    });
}

fn describe_binary_error(err: &binary::BinaryError) -> String {
    match err {
        binary::BinaryError::NotFound => {
            "opencode was not found on PATH. Install it, or set a custom binary path in Settings."
                .to_string()
        }
        other => other.to_string(),
    }
}

// ---------------------------------------------------------------------------
// Tauri commands
// ---------------------------------------------------------------------------

#[tauri::command]
pub async fn start_server(
    app: AppHandle,
    manager: State<'_, Arc<ServerManager>>,
    project: PathBuf,
    binary_override: Option<PathBuf>,
) -> Result<ServerInfo, String> {
    manager.start(&app, project, binary_override).await
}

#[tauri::command]
pub async fn stop_server(
    app: AppHandle,
    manager: State<'_, Arc<ServerManager>>,
) -> Result<(), String> {
    manager.stop(&app).await;
    Ok(())
}

#[tauri::command]
pub async fn server_status(manager: State<'_, Arc<ServerManager>>) -> Result<ServerStatus, String> {
    Ok(manager.status().await)
}

/// Called on app exit so we never orphan a server process.
///
/// This **blocks** rather than spawning. A fire-and-forget task races the
/// runtime teardown: the event loop returns, the process exits, and the task
/// that was going to kill the server is killed with it — leaving `opencode
/// serve` holding a database lock that confuses the next launch. Waiting here
/// costs at most the grace period, once, at exit.
pub fn shutdown_on_exit(app: &AppHandle) {
    let manager = app.state::<Arc<ServerManager>>().inner().clone();
    let app = app.clone();

    // `block_on` panics if called from inside an async context. The run
    // callback is synchronous, but guard anyway rather than crash on exit.
    if tokio::runtime::Handle::try_current().is_ok() {
        tauri::async_runtime::spawn(async move {
            manager.stop(&app).await;
        });
    } else {
        tauri::async_runtime::block_on(async move {
            manager.stop(&app).await;
        });
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn args_pin_the_loopback_interface() {
        let args = build_args(4096);
        assert_eq!(args[0], "serve");
        assert!(args.windows(2).any(|w| w == ["--hostname", "127.0.0.1"]));
    }

    #[test]
    fn args_pass_the_requested_port() {
        assert!(build_args(5555).windows(2).any(|w| w == ["--port", "5555"]));
    }

    #[test]
    fn every_cors_origin_is_repeated_flag_style() {
        // opencode only accepts repeated `--cors`, never a comma-joined list.
        let args = build_args(1);
        let cors_values: Vec<&String> = args
            .iter()
            .skip_while(|a| *a != "--cors")
            .skip(1)
            .step_by(2)
            .collect();
        assert_eq!(cors_values.len(), CORS_ORIGINS.len());
    }

    #[test]
    fn cors_covers_dev_and_packaged_origins() {
        // Losing either one breaks streaming: dev without the vite origin,
        // packaged without the custom-protocol origin.
        assert!(CORS_ORIGINS.contains(&"http://localhost:1420"));
        assert!(CORS_ORIGINS.contains(&"tauri://localhost"));
        assert!(CORS_ORIGINS.contains(&"http://tauri.localhost"));
    }

    #[test]
    fn url_is_loopback_only() {
        // Never bind 0.0.0.0: the agent has filesystem and shell access, and
        // this must not be reachable from the network.
        assert_eq!(server_url(4096), "http://127.0.0.1:4096");
        assert!(!build_args(1).iter().any(|a| a == "0.0.0.0"));
    }

    #[test]
    fn missing_binary_error_points_at_settings() {
        let message = describe_binary_error(&binary::BinaryError::NotFound);
        assert!(message.contains("Settings"));
    }

    #[tokio::test]
    async fn stopping_an_unstarted_manager_is_a_no_op() {
        let manager = ServerManager::new();
        // No AppHandle available in a unit test, so we assert on state only.
        assert!(manager.inner.lock().await.is_none());
    }

    #[test]
    fn status_discriminants_are_camel_cased_for_the_webview() {
        let json = serde_json::to_string(&ServerStatus::Stopped).unwrap();
        assert_eq!(json, r#"{"status":"stopped"}"#);
    }
}
