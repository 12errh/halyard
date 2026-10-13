//! Halyard's own persisted preferences.
//!
//! Deliberately small: only state the Rust side genuinely needs to read. Visual
//! preferences live in the webview's local storage so they apply without a
//! round trip, and opencode's own configuration is edited through its API
//! rather than duplicated here.

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};

/// Maximum remembered projects. The quick-switcher should stay a short list,
/// not a history log.
pub const MAX_RECENT_PROJECTS: usize = 12;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", default)]
pub struct Settings {
    pub recent_projects: Vec<PathBuf>,
    pub last_project: Option<PathBuf>,
    /// Explicit `opencode` executable, overriding PATH lookup.
    pub binary_override: Option<PathBuf>,
    /// Show an icon in the system tray. Defaults on: the tray is what makes
    /// close-to-tray survivable.
    pub show_tray: bool,
    /// Hiding the window on close instead of quitting. Only meaningful while a
    /// tray icon is showing; see [`Settings::effective_close_to_tray`].
    pub close_to_tray: bool,
    /// Notify when an agent finishes while the window is not in front.
    pub notify_on_finish: bool,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            recent_projects: Vec::new(),
            last_project: None,
            binary_override: None,
            show_tray: true,
            close_to_tray: true,
            notify_on_finish: true,
        }
    }
}

impl Settings {
    /// Closing can only hide to the tray when there is a tray to return to.
    ///
    /// Otherwise the close button would appear to do nothing at all: the window
    /// would vanish with no icon left to bring it back. Turning the tray off
    /// therefore forces close to mean close.
    pub fn effective_close_to_tray(&self) -> bool {
        self.close_to_tray && self.show_tray
    }

    /// Insert `path` at the front, de-duplicated, capped to `MAX_RECENT_PROJECTS`.
    ///
    /// Pure and separately tested because it is the kind of bookkeeping that
    /// quietly accumulates duplicates if it is not pinned down.
    pub fn touch_project(&mut self, path: PathBuf) {
        self.recent_projects.retain(|p| p != &path);
        self.recent_projects.insert(0, path.clone());
        self.recent_projects.truncate(MAX_RECENT_PROJECTS);
        self.last_project = Some(path);
    }

    pub fn forget_project(&mut self, path: &Path) {
        self.recent_projects.retain(|p| p != path);
        if self.last_project.as_deref() == Some(path) {
            self.last_project = self.recent_projects.first().cloned();
        }
    }
}

pub fn settings_path(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_config_dir()
        .map_err(|e| format!("cannot resolve config directory: {e}"))?;
    std::fs::create_dir_all(&dir).map_err(|e| format!("cannot create config directory: {e}"))?;
    Ok(dir.join("halyard.json"))
}

pub fn load(app: &AppHandle) -> Settings {
    let Ok(path) = settings_path(app) else {
        return Settings::default();
    };
    std::fs::read_to_string(&path)
        .ok()
        .and_then(|raw| serde_json::from_str(&raw).ok())
        // A corrupt preferences file must never stop the app from opening.
        .unwrap_or_default()
}

pub fn save(app: &AppHandle, settings: &Settings) -> Result<(), String> {
    let path = settings_path(app)?;
    let json = serde_json::to_string_pretty(settings).map_err(|e| e.to_string())?;
    std::fs::write(&path, json).map_err(|e| format!("cannot write settings: {e}"))
}

#[tauri::command]
pub fn get_settings(app: AppHandle) -> Settings {
    load(&app)
}

#[tauri::command]
pub fn save_settings(app: AppHandle, settings: Settings) -> Result<(), String> {
    save(&app, &settings)
}

#[tauri::command]
pub async fn remember_project(app: AppHandle, project: PathBuf) -> Result<Settings, String> {
    let mut settings = load(&app);
    settings.touch_project(project);
    save(&app, &settings)?;
    Ok(settings)
}

#[tauri::command]
pub async fn forget_project(app: AppHandle, project: PathBuf) -> Result<Settings, String> {
    let mut settings = load(&app);
    settings.forget_project(&project);
    save(&app, &settings)?;
    Ok(settings)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn most_recent_project_sorts_first() {
        let mut settings = Settings::default();
        settings.touch_project(PathBuf::from("/a"));
        settings.touch_project(PathBuf::from("/b"));
        assert_eq!(settings.recent_projects[0], PathBuf::from("/b"));
        assert_eq!(settings.last_project, Some(PathBuf::from("/b")));
    }

    #[test]
    fn revisiting_moves_a_project_to_the_front_without_duplicating() {
        let mut settings = Settings::default();
        for dir in ["/a", "/b", "/c"] {
            settings.touch_project(PathBuf::from(dir));
        }
        settings.touch_project(PathBuf::from("/a"));

        assert_eq!(
            settings.recent_projects,
            vec![
                PathBuf::from("/a"),
                PathBuf::from("/c"),
                PathBuf::from("/b")
            ]
        );
    }

    #[test]
    fn recent_list_is_capped() {
        let mut settings = Settings::default();
        for i in 0..(MAX_RECENT_PROJECTS + 8) {
            settings.touch_project(PathBuf::from(format!("/p{i}")));
        }
        assert_eq!(settings.recent_projects.len(), MAX_RECENT_PROJECTS);
        assert_eq!(settings.recent_projects[0], PathBuf::from("/p19"));
    }

    #[test]
    fn forgetting_the_active_project_promotes_the_next_one() {
        let mut settings = Settings::default();
        settings.touch_project(PathBuf::from("/a"));
        settings.touch_project(PathBuf::from("/b"));

        settings.forget_project(Path::new("/b"));
        assert!(!settings.recent_projects.contains(&PathBuf::from("/b")));
        assert_eq!(settings.last_project, Some(PathBuf::from("/a")));
    }

    #[test]
    fn forgetting_an_unrelated_project_leaves_the_active_one_alone() {
        let mut settings = Settings::default();
        settings.touch_project(PathBuf::from("/a"));
        settings.forget_project(Path::new("/zzz"));
        assert_eq!(settings.last_project, Some(PathBuf::from("/a")));
    }

    #[test]
    fn settings_round_trip_through_json() {
        let mut settings = Settings::default();
        settings.touch_project(PathBuf::from("/work/api"));
        settings.binary_override = Some(PathBuf::from("/usr/local/bin/opencode"));

        let json = serde_json::to_string(&settings).unwrap();
        let restored: Settings = serde_json::from_str(&json).unwrap();
        assert_eq!(restored, settings);
    }

    #[test]
    fn missing_fields_fall_back_to_defaults() {
        // Forward compatibility: a file written by an older build must load.
        let restored: Settings = serde_json::from_str("{}").unwrap();
        assert_eq!(restored, Settings::default());
    }

    #[test]
    fn garbage_json_degrades_to_defaults() {
        assert!(serde_json::from_str::<Settings>("not json").is_err());
    }

    #[test]
    fn an_older_file_gains_the_window_defaults() {
        // A file written before slice 4 carries no tray keys at all. They must
        // come back as the defaults rather than `false`, or every existing
        // install would silently lose its tray icon.
        let restored: Settings = serde_json::from_str(
            r#"{"recentProjects":["/work/api"],"lastProject":"/work/api"}"#,
        )
        .unwrap();
        assert_eq!(restored.recent_projects, vec![PathBuf::from("/work/api")]);
        assert!(restored.show_tray);
        assert!(restored.close_to_tray);
        assert!(restored.notify_on_finish);
    }

    #[test]
    fn hiding_the_tray_disables_close_to_tray() {
        // Without a tray icon there would be no way back from a hidden window.
        let mut settings = Settings::default();
        settings.show_tray = false;
        assert!(!settings.effective_close_to_tray());
    }

    #[test]
    fn close_to_tray_holds_when_the_tray_is_visible() {
        let mut settings = Settings::default();
        settings.show_tray = true;
        settings.close_to_tray = true;
        assert!(settings.effective_close_to_tray());
    }

    #[test]
    fn a_user_who_wants_close_to_quit_gets_it() {
        let mut settings = Settings::default();
        settings.close_to_tray = false;
        assert!(!settings.effective_close_to_tray());
    }

    #[test]
    fn window_preferences_persist_under_their_camel_case_keys() {
        // The frontend writes these keys by name. A stray serde rename would
        // persist under a different key and the preference would silently
        // reset on every launch — so pin the wire format.
        let settings = Settings::default();
        let value: serde_json::Value = serde_json::to_value(&settings).unwrap();

        assert_eq!(value["showTray"], serde_json::json!(true));
        assert_eq!(value["closeToTray"], serde_json::json!(true));
        assert_eq!(value["notifyOnFinish"], serde_json::json!(true));
    }

    #[test]
    fn reading_the_new_keys_from_disk_works() {
        let restored: Settings = serde_json::from_str(
            r#"{"showTray":false,"closeToTray":false,"notifyOnFinish":false}"#,
        )
        .unwrap();
        assert!(!restored.show_tray);
        assert!(!restored.close_to_tray);
        assert!(!restored.notify_on_finish);
    }
}
