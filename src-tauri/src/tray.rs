//! The system tray.
//!
//! Two jobs. It gives a running agent somewhere to live when the window is
//! closed, and it is the only route back to the app once the window is hidden —
//! which is why [`Settings::effective_close_to_tray`] refuses to hide the
//! window when there is no tray to return to.

use tauri::{
    AppHandle, Emitter, Manager,
    menu::{Menu, MenuItem, PredefinedMenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Runtime,
};

/// Event the frontend listens for so "Open Halyard" can also select a thread.
pub const OPEN_EVENT: &str = "halyard://open";

pub const MENU_OPEN: &str = "open";
pub const MENU_NEW_THREAD: &str = "new-thread";
pub const MENU_SETTINGS: &str = "settings";
pub const MENU_QUIT: &str = "quit";

/// Identifies the tray so it can be looked up again after start-up.
pub const TRAY_ID: &str = "halyard-tray";

/// Bring the main window back, whether it was hidden, minimised or buried.
pub fn show_main<R: Runtime>(app: &AppHandle<R>) {
    let Some(window) = app.get_webview_window("main") else {
        return;
    };
    let _ = window.unminimize();
    let _ = window.show();
    let _ = window.set_focus();
}

/// Build the tray icon and its menu.
///
/// Returns `None` on platforms without a system tray, or if the platform simply
/// refused — a missing tray must never stop the app from starting.
pub fn build<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<Option<tauri::tray::TrayIcon<R>>> {
    let open = MenuItem::with_id(app, MENU_OPEN, "Open Halyard", true, Some("CmdOrCtrl+O"))?;
    let new_thread = MenuItem::with_id(app, MENU_NEW_THREAD, "New thread", true, None::<&str>)?;
    let settings = MenuItem::with_id(app, MENU_SETTINGS, "Settings…", true, Some("CmdOrCtrl+,"))?;
    let quit = MenuItem::with_id(app, MENU_QUIT, "Quit Halyard", true, Some("CmdOrCtrl+Q"))?;

    let menu = Menu::with_items(
        app,
        &[
            &open,
            &new_thread,
            &PredefinedMenuItem::separator(app)?,
            &settings,
            &PredefinedMenuItem::separator(app)?,
            &quit,
        ],
    )?;

    let mut builder = TrayIconBuilder::with_id(TRAY_ID)
        .menu(&menu)
        .tooltip("Halyard")
        // Left click should surface the window; right click opens the menu.
        .show_menu_on_left_click(false)
        .on_menu_event(handle_menu_event)
        .on_tray_icon_event(handle_tray_event);

    if let Some(icon) = app.default_window_icon() {
        builder = builder.icon(icon.clone());
    }

    let tray = builder.build(app)?;
    Ok(Some(tray))
}

/// Show or hide the tray icon without rebuilding it.
///
/// The tray is built once at start-up; without this, switching "Show tray icon"
/// off would leave the icon sitting there until the next launch, which is
/// exactly the kind of setting that only works "after a restart" nobody should
/// have to accept.
pub fn set_visible<R: Runtime>(app: &AppHandle<R>, visible: bool) {
    if let Some(tray) = app.tray_by_id(TRAY_ID) {
        let _ = tray.set_visible(visible);
    }
}

/// Frontend entry point for the tray-visibility preference.
#[tauri::command]
pub fn set_tray_visible(app: AppHandle, visible: bool) {
    set_visible(&app, visible);
}

fn handle_menu_event<R: Runtime>(app: &AppHandle<R>, event: tauri::menu::MenuEvent) {
    match event.id().0.as_str() {
        MENU_QUIT => {
            // `exit` is the only path that ignores close-to-tray, which is
            // exactly what a Quit menu item should mean.
            app.exit(0);
        }
        MENU_OPEN => {
            show_main(app);
            let _ = app.emit(OPEN_EVENT, Open::Window);
        }
        MENU_NEW_THREAD => {
            show_main(app);
            let _ = app.emit(OPEN_EVENT, Open::NewThread);
        }
        MENU_SETTINGS => {
            show_main(app);
            let _ = app.emit(OPEN_EVENT, Open::Settings);
        }
        _ => {}
    }
}

/// Payload for [`OPEN_EVENT`], so one event can drive several frontend actions.
#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase", tag = "action")]
pub enum Open {
    /// Just bring the window forward.
    Window,
    /// Bring the window forward and start a fresh thread.
    NewThread,
    /// Bring the window forward and open settings.
    Settings,
}

fn handle_tray_event<R: Runtime>(tray: &tauri::tray::TrayIcon<R>, event: TrayIconEvent) {
    let TrayIconEvent::Click {
        button: MouseButton::Left,
        button_state: MouseButtonState::Up,
        ..
    } = event
    else {
        return;
    };

    let app = tray.app_handle();
    let Some(window) = app.get_webview_window("main") else {
        return;
    };

    // Clicking the tray when the window is already in front should not steal
    // focus; it just leaves it where it is.
    let already_front = window.is_visible().unwrap_or(false) && window.is_focused().unwrap_or(false);
    if !already_front {
        show_main(app);
    }
}
