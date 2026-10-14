//! Halyard — a native desktop shell for the opencode coding agent.

pub mod attention;
pub mod binary;
pub mod config;
pub mod probe;
pub mod server;
pub mod settings;
pub mod transfer;
pub mod tray;

use std::sync::Arc;

use server::ServerManager;
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let manager = Arc::new(ServerManager::new());

    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            // Second launch focuses the existing window instead of spawning a
            // rival server bound to the same project.
            crate::tray::show_main(app);
        }))
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            None,
        ))
        .manage(manager)
        .setup(|app| {
            let handle = app.handle().clone();

            // Tray is optional. Some Linux desktops have no status area at
            // all, and a missing tray must not stop the app from opening.
            if settings::load(&handle).show_tray {
                crate::tray::build(&handle)?;
            }

            // No native menu bar. It cost a 40px row above the app for five
            // items, and the accelerators it owned are better served from the
            // webview, where the clipboard shortcuts work without a menu
            // intercepting them first.

            Ok(())
        })
        .on_window_event(|window, event| {
            // Hiding rather than closing keeps a running agent alive. The
            // `prevent_close` call is what stops Tauri tearing the process
            // down; `hide` alone would still quit.
            let tauri::WindowEvent::CloseRequested { api, .. } = event else {
                return;
            };

            if settings::load(window.app_handle()).effective_close_to_tray() {
                api.prevent_close();
                let _ = window.hide();
            }
        })
        .invoke_handler(tauri::generate_handler![
            config::read_config_file,
            config::write_config_file,
            config::global_config,
            config::validate_config,
            transfer::export_session,
            transfer::import_session,
            server::start_server,
            server::stop_server,
            server::server_status,
            settings::get_settings,
            settings::save_settings,
            settings::remember_project,
            settings::forget_project,
            attention::set_attention_command,
            tray::set_tray_visible,
        ])
        .build(tauri::generate_context!())
        .expect("failed to build Halyard")
        .run(|app, event| {
            // Kill the child server on every exit path. An orphaned
            // `opencode serve` would hold a database lock and confuse the next
            // launch.
            if matches!(
                event,
                tauri::RunEvent::ExitRequested { .. } | tauri::RunEvent::Exit
            ) {
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
