//! The application menu bar.
//!
//! Windows and Linux draw a menu bar across the top of the window, and its
//! value is not cosmetic: the standard Edit items are what make Ctrl+C,
//! Ctrl+V and Ctrl+A work inside the webview. Without them those shortcuts
//! silently do nothing, which reads as a broken app.
//!
//! macOS gets an app menu instead, where these same items are expected under
//! the application menu, so the menu is still built there but not attached to
//! the window.

use tauri::{
    AppHandle, Emitter,
    menu::{MenuBuilder, MenuItemBuilder, SubmenuBuilder},
    Runtime,
};

/// Menu ids are forwarded to the webview under this event name.
pub const MENU_EVENT: &str = "__halyard_menu__";

pub fn build<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<()> {
    let file = SubmenuBuilder::new(app, "File")
        .item(
            &MenuItemBuilder::with_id("new-thread", "New thread")
                .accelerator("CmdOrCtrl+T")
                .build(app)?,
        )
        .item(
            &MenuItemBuilder::with_id("open-settings", "Settings…")
                .accelerator("CmdOrCtrl+,")
                .build(app)?,
        )
        .separator()
        .quit()
        .build()?;

    // The predefined items are what make clipboard shortcuts work in the
    // webview; hand-rolled equivalents would only look right.
    let edit = SubmenuBuilder::new(app, "Edit")
        .undo()
        .redo()
        .separator()
        .cut()
        .copy()
        .paste()
        .select_all()
        .build()?;

    let view = SubmenuBuilder::new(app, "View")
        .item(
            &MenuItemBuilder::with_id("command-palette", "Command palette")
                .accelerator("CmdOrCtrl+K")
                .build(app)?,
        )
        .separator()
        .fullscreen()
        .build()?;

    let menu = MenuBuilder::new(app).items(&[&file, &edit, &view]).build()?;

    // macOS puts items under the application menu instead of a bar, and
    // attaching one there would replace the standard menu.
    #[cfg(not(target_os = "macos"))]
    app.set_menu(menu)?;
    #[cfg(target_os = "macos")]
    let _ = menu;

    app.on_menu_event(|app, event| {
        let _ = app.emit(MENU_EVENT, event.id().0.as_str());
    });

    Ok(())
}
