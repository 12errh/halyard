//! In-app updates.
//!
//! Halyard updates itself where the platform allows it and gets out of the way
//! where it does not. That distinction is the whole design here, because it is
//! not symmetric:
//!
//! - **AppImage (Linux)** — self-updates. The plugin downloads a new AppImage
//!   and swaps it over the running one.
//! - **NSIS (Windows)** — self-updates. The plugin downloads the installer and
//!   runs it. The bundle is configured `installMode: currentUser`, so this
//!   needs no administrator rights.
//! - **`.deb` / `.rpm` (Linux)** — cannot self-update. Replacing a system
//!   package means writing to `/usr`, which is root-only; a GUI app has no
//!   business prompting for that silently. These users update through their
//!   package manager, and the app says so instead of offering a button that
//!   would fail.
//! - **MSI (Windows)** — published for managed deployment. Point the updater at
//!   an NSIS install, not an MSI one.
//!
//! The plugin reports what it can handle; [`Support`] is what we tell the user,
//! derived from how the running copy was installed.


use serde::Serialize;
use tauri::{AppHandle, Emitter};
use tauri_plugin_updater::UpdaterExt;

/// Progress of a download, pushed to the webview.
pub const EVENT_PROGRESS: &str = "halyard://update-progress";

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Os {
    Linux,
    Windows,
    Other,
}

/// Whether this copy of Halyard can replace itself.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Support {
    Supported,
    /// Cannot self-update, with the reason to show the user.
    Manual(&'static str),
}

impl Support {
    pub fn can_self_update(self) -> bool {
        self == Support::Supported
    }

    pub fn reason(self) -> Option<&'static str> {
        match self {
            Support::Supported => None,
            Support::Manual(reason) => Some(reason),
        }
    }
}

/// Decide update support from the platform and how we were launched.
///
/// Pure so the rule is pinned by tests rather than by reading this once and
/// remembering it. The AppImage case keys off `APPIMAGE`, which the AppImage
/// runtime sets and nothing else does.
pub fn support_for(os: Os, is_appimage: bool) -> Support {
    match os {
        // Windows updates by running the NSIS installer. `currentUser` means it
        // installs next to the existing copy, so no elevation prompt.
        Os::Windows => Support::Supported,
        Os::Linux if is_appimage => Support::Supported,
        Os::Linux => Support::Manual(
            "This is a system package. Updates come from your package manager, \
             which asks for your password. The AppImage build updates itself.",
        ),
        Os::Other => Support::Manual("Automatic updates are not available on this platform."),
    }
}

/// What the running process can tell us about its own packaging.
pub fn current_support() -> Support {
    let os = if cfg!(target_os = "windows") {
        Os::Windows
    } else if cfg!(target_os = "linux") {
        Os::Linux
    } else {
        Os::Other
    };
    // Set by the AppImage runtime at launch, and unset everywhere else.
    let is_appimage = std::env::var_os("APPIMAGE").is_some_and(|v| !v.is_empty());
    support_for(os, is_appimage)
}

/// An available update, in the shape the webview wants.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct UpdateSummary {
    pub version: String,
    pub current_version: String,
    pub notes: Option<String>,
    pub date: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct Progress {
    downloaded: u64,
    total: Option<u64>,
}

/// How this install handles updates, for the UI to explain.
///
/// Separate from `check_for_update` because "up to date" and "cannot update"
/// are different answers and collapsing them leaves a dead button with no
/// explanation.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SupportSummary {
    pub can_self_update: bool,
    pub reason: Option<&'static str>,
    /// The version this build reports, so the UI never has to guess it.
    pub current_version: String,
}

#[tauri::command]
pub fn update_support(app: AppHandle) -> SupportSummary {
    let support = current_support();
    SupportSummary {
        can_self_update: support.can_self_update(),
        reason: support.reason(),
        current_version: app.package_info().version.to_string(),
    }
}

/// Check GitHub for a newer release.
///
/// `None` means up to date. A `.deb` install always gets `None`, because there
/// is nothing it could act on — the UI asks for [`current_support`] separately
/// and explains why rather than showing a dead "update" affordance.
#[tauri::command]
pub async fn check_for_update(app: AppHandle) -> Result<Option<UpdateSummary>, String> {
    // A manual check is exactly when to surface a platform that cannot update.
    if !current_support().can_self_update() {
        return Ok(None);
    }

    let updater = app.updater().map_err(|e| e.to_string())?;
    let update = updater.check().await.map_err(|e| e.to_string())?;

    Ok(update.map(|u| UpdateSummary {
        version: u.version.clone(),
        current_version: u.current_version.clone(),
        notes: u.body.clone(),
        date: u.date.map(|d| d.to_string()),
    }))
}

/// Download and install, streaming progress, then relaunch.
///
/// The download is verified against the signing key compiled into the app, so
/// a tampered or truncated artifact fails here rather than at launch.
#[tauri::command]
pub async fn install_update(app: AppHandle) -> Result<(), String> {
    if !current_support().can_self_update() {
        return Err(current_support()
            .reason()
            .unwrap_or("this install cannot update itself")
            .to_string());
    }

    let updater = app.updater().map_err(|e| e.to_string())?;
    let update = updater
        .check()
        .await
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "no update is available".to_string())?;

    let emitter = app.clone();
    update
        .download_and_install(
            move |downloaded, total| {
                let _ = emitter.emit(
                    EVENT_PROGRESS,
                    Progress {
                        downloaded: downloaded as u64,
                        total: total.map(|t| t as u64),
                    },
                );
            },
            || {},
        )
        .await
        .map_err(|e| e.to_string())?;

    // The new binary cannot overwrite itself while this process is still
    // mapped, so the restart is part of installing, not an extra step.
    // `request_restart` runs the same exit path as a normal quit, so the
    // opencode server is still torn down cleanly first.
    app.request_restart();
    Ok(())
}

/// Path the updater would write to, for diagnostics.
pub fn current_executable() -> Option<std::path::PathBuf> {
    std::env::current_exe().ok()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn appimage_updates_itself() {
        assert_eq!(support_for(Os::Linux, true), Support::Supported);
    }

    #[test]
    fn a_linux_system_package_does_not() {
        // The sudo case. `.deb` and `.rpm` live under /usr, which only root can
        // write, so there is nothing for the updater to do.
        let support = support_for(Os::Linux, false);
        assert!(!support.can_self_update());
        let reason = support.reason().unwrap();
        assert!(reason.contains("package manager"), "{reason}");
        assert!(reason.contains("password"), "{reason}");
    }

    #[test]
    fn the_dead_end_explains_the_appimage_alternative() {
        // Telling someone their install cannot update, with nothing to do
        // about it, is the failure mode worth avoiding.
        let reason = support_for(Os::Linux, false).reason().unwrap();
        assert!(reason.contains("AppImage"), "{reason}");
    }

    #[test]
    fn windows_updates_without_elevation() {
        let support = support_for(Os::Windows, false);
        assert!(support.can_self_update());
        assert!(support.reason().is_none());
    }

    #[test]
    fn unsupported_platforms_say_so() {
        let support = support_for(Os::Other, true);
        assert!(!support.can_self_update());
        assert!(support.reason().is_some());
    }

    #[test]
    fn support_is_a_pure_function_of_platform_and_packaging() {
        // Same inputs, same answer: this is the rule, not a snapshot of it.
        for _ in 0..3 {
            assert_eq!(support_for(Os::Linux, true), support_for(Os::Linux, true));
        }
    }

    #[test]
    fn a_summary_serialises_for_the_webview() {
        let summary = UpdateSummary {
            version: "0.2.0".into(),
            current_version: "0.1.0".into(),
            notes: Some("Fixes things".into()),
            date: Some("2026-01-01".into()),
        };
        let json = serde_json::to_string(&summary).unwrap();
        assert!(json.contains(r#""version":"0.2.0""#));
        assert!(json.contains(r#""currentVersion":"0.1.0""#));
    }

    #[test]
    fn progress_serialises_with_a_nullable_total() {
        // `null` total is the "size unknown" case; the UI shows an indeterminate
        // bar rather than a bogus percentage.
        let json = serde_json::to_string(&Progress {
            downloaded: 10,
            total: None,
        })
        .unwrap();
        assert!(json.contains(r#""total":null"#));
    }

    #[test]
    fn the_progress_event_name_is_stable() {
        // The webview subscribes to this string; renaming it silently breaks
        // the progress bar.
        assert_eq!(EVENT_PROGRESS, "halyard://update-progress");
    }

    #[test]
    fn the_running_executable_is_an_absolute_path() {
        // The updater swaps this file on Linux, so it has to be the real one
        // rather than a bare name resolved against PATH.
        let path = current_executable().expect("current_exe should resolve");
        assert!(path.is_absolute(), "expected absolute, got {path:?}");
    }
}
