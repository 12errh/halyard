//! Halyard — a native desktop shell for the opencode coding agent.

pub mod binary;
pub mod probe;
pub mod server;
pub mod settings;

use std::sync::Arc;

use server::ServerManager;
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            // Second launch focuses the existing window instead of spawning a
            // rival server bound to the same project.
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.unminimize();
                let _ = window.set_focus();
            }
        }))
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            None,
        ))
        .manage(Arc::new(ServerManager::new()))
        .invoke_handler(tauri::generate_handler![
            server::start_server,
            server::stop_server,
            server::server_status,
            settings::get_settings,
            settings::save_settings,
            settings::remember_project,
            settings::forget_project,
        ])
        .build(tauri::generate_context!())
        .expect("failed to build Halyard")
        .run(|app, event| {
            // Kill the child server on every exit path. An orphaned
            // `opencode serve` would hold a database lock and confuse the next
            // launch.
            if let tauri::RunEvent::ExitRequested { .. } | tauri::RunEvent::Exit = event {
                server::shutdown_on_exit(app);
            }
        });
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::server::ServerStatus;

    #[tokio::test]
    async fn a_fresh_manager_reports_stopped() {
        let manager = ServerManager::new();
        assert_eq!(manager.status().await, ServerStatus::Stopped);
    }
}
