//! Locating the `opencode` executable.
//!
//! Resolution order is deliberate: an explicit user override always wins, then
//! `$PATH`. We never download a binary — Halyard assumes the host machine
//! already has opencode installed, which is the premise of the whole app.

use std::path::{Path, PathBuf};

#[derive(Debug, thiserror::Error)]
pub enum BinaryError {
    #[error("no opencode binary found on PATH")]
    NotFound,
    #[error("the configured opencode path does not exist: {0}")]
    MissingOverride(PathBuf),
    #[error("the configured opencode path is not a file: {0}")]
    NotAFile(PathBuf),
}

/// Find `opencode` using `override_path` when set, otherwise scanning `PATH`.
///
/// `path_var` is injected rather than read from the environment so this is
/// testable without mutating process-global state.
pub fn resolve(
    override_path: Option<&Path>,
    path_var: Option<&str>,
) -> Result<PathBuf, BinaryError> {
    if let Some(custom) = override_path {
        if !custom.exists() {
            return Err(BinaryError::MissingOverride(custom.to_path_buf()));
        }
        if !custom.is_file() {
            return Err(BinaryError::NotAFile(custom.to_path_buf()));
        }
        return Ok(custom.to_path_buf());
    }

    let raw = match path_var {
        Some(explicit) => explicit.to_string(),
        None => std::env::var("PATH").unwrap_or_default(),
    };
    let separator = if cfg!(windows) { ';' } else { ':' };

    for dir in raw.split(separator).filter(|d| !d.is_empty()) {
        let candidate = Path::new(dir).join(exe_name());
        if candidate.is_file() {
            return Ok(candidate);
        }
    }

    Err(BinaryError::NotFound)
}

/// Platform-specific executable filename.
pub fn exe_name() -> &'static str {
    if cfg!(windows) {
        "opencode.exe"
    } else {
        "opencode"
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn touch(path: &Path) {
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).unwrap();
        }
        fs::write(path, b"#!/bin/sh\n").unwrap();
    }

    #[test]
    fn finds_binary_on_path() {
        let tmp = tempfile::tempdir().unwrap();
        let bin_dir = tmp.path().join("bin");
        touch(&bin_dir.join(exe_name()));

        let found = resolve(None, Some(bin_dir.to_str().unwrap())).unwrap();
        assert_eq!(found, bin_dir.join(exe_name()));
    }

    #[test]
    fn skips_path_entries_without_the_binary() {
        let tmp = tempfile::tempdir().unwrap();
        let empty = tmp.path().join("empty");
        let bin_dir = tmp.path().join("bin");
        fs::create_dir_all(&empty).unwrap();
        touch(&bin_dir.join(exe_name()));

        let joined = format!(
            "{}{}{}",
            empty.to_str().unwrap(),
            if cfg!(windows) { ';' } else { ':' },
            bin_dir.to_str().unwrap()
        );
        let found = resolve(None, Some(&joined)).unwrap();
        assert_eq!(found, bin_dir.join(exe_name()));
    }

    #[test]
    fn returns_not_found_when_path_is_empty() {
        assert!(matches!(
            resolve(None, Some("")),
            Err(BinaryError::NotFound)
        ));
    }

    #[test]
    fn override_wins_over_path() {
        let tmp = tempfile::tempdir().unwrap();
        let bin_dir = tmp.path().join("bin");
        let custom_dir = tmp.path().join("custom");
        touch(&bin_dir.join(exe_name()));
        let custom = custom_dir.join(exe_name());
        touch(&custom);

        let found = resolve(Some(&custom), Some(bin_dir.to_str().unwrap())).unwrap();
        assert_eq!(found, custom);
    }

    #[test]
    fn missing_override_is_an_error_not_a_fallback() {
        let tmp = tempfile::tempdir().unwrap();
        let bin_dir = tmp.path().join("bin");
        touch(&bin_dir.join(exe_name()));
        let ghost = tmp.path().join("nope").join(exe_name());

        // Falling back to PATH here would silently run a different binary than
        // the user configured, which is worse than failing loudly.
        let err = resolve(Some(&ghost), Some(bin_dir.to_str().unwrap())).unwrap_err();
        assert!(matches!(err, BinaryError::MissingOverride(_)));
    }

    #[test]
    fn override_pointing_at_a_directory_is_rejected() {
        let tmp = tempfile::tempdir().unwrap();
        let dir = tmp.path().join("adir");
        fs::create_dir_all(&dir).unwrap();

        let err = resolve(Some(&dir), None).unwrap_err();
        assert!(matches!(err, BinaryError::NotAFile(_)));
    }
}
