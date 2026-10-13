//! Session export and import.
//!
//! opencode exposes these only as CLI verbs, with no HTTP equivalent. Rather
//! than inventing our own JSON and hoping it stays compatible, Halyard shells
//! out to `opencode export` / `opencode import` so a file produced here is
//! exactly what opencode itself would produce — and imports stay valid across
//! versions.

use std::path::PathBuf;
use std::process::Stdio;

use serde::Serialize;
use tokio::process::Command;

use crate::binary;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportResult {
    pub path: String,
    pub bytes: usize,
}

#[derive(Debug, thiserror::Error)]
enum RunError {
    #[error("opencode was not found on PATH")]
    NoBinary,
    #[error("{0} exited with {1}: {2}")]
    Failed(String, i32, String),
}

/// Run an opencode subcommand, returning stdout.
async fn run(executable: &std::path::Path, args: &[String]) -> Result<String, RunError> {
    let mut command = Command::new(executable);
    command
        .args(args)
        // Keep the child's chatter out of our captured stdout.
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .stdin(Stdio::null())
        // Never let a hung CLI wedge the UI thread.
        .kill_on_drop(true);

    let output = command.output().await.map_err(|error| {
        if error.kind() == std::io::ErrorKind::NotFound {
            RunError::NoBinary
        } else {
            RunError::Failed("opencode".into(), -1, error.to_string())
        }
    })?;

    if !output.status.success() {
        return Err(RunError::Failed(
            args.first().cloned().unwrap_or_default(),
            output.status.code().unwrap_or(-1),
            String::from_utf8_lossy(&output.stderr).trim().to_string(),
        ));
    }

    Ok(String::from_utf8_lossy(&output.stdout).to_string())
}

fn resolve(binary_override: Option<PathBuf>) -> Result<PathBuf, RunError> {
    binary::resolve(binary_override.as_deref(), None).map_err(|error| match error {
        binary::BinaryError::NotFound => RunError::NoBinary,
        other => RunError::Failed("opencode".into(), -1, other.to_string()),
    })
}

/// Export a session to `path` and report what was written.
#[tauri::command]
pub async fn export_session(
    session_id: String,
    path: String,
    binary_override: Option<PathBuf>,
) -> Result<ExportResult, String> {
    let executable = resolve(binary_override).map_err(|e| e.to_string())?;
    let stdout = run(&executable, &["export".into(), session_id.clone()])
        .await
        .map_err(|e| e.to_string())?;

    // `opencode export` writes the file itself; if the caller passed a
    // directory, fall back to writing stdout ourselves.
    let target = PathBuf::from(&path);
    let written = if target.is_dir() {
        target.join(format!("{session_id}.json"))
    } else {
        target.clone()
    };

    if written.exists() {
        let bytes = std::fs::metadata(&written).map(|m| m.len() as usize).unwrap_or(0);
        return Ok(ExportResult {
            path: written.display().to_string(),
            bytes,
        });
    }

    if stdout.trim().is_empty() {
        return Err(format!(
            "opencode export produced no output for {session_id}"
        ));
    }

    if let Some(parent) = written.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|error| format!("cannot create {}: {error}", parent.display()))?;
    }
    std::fs::write(&written, stdout.as_bytes())
        .map_err(|error| format!("cannot write {}: {error}", written.display()))?;

    Ok(ExportResult {
        path: written.display().to_string(),
        bytes: stdout.len(),
    })
}

/// Import a session from an exported JSON file.
#[tauri::command]
pub async fn import_session(
    path: String,
    binary_override: Option<PathBuf>,
) -> Result<bool, String> {
    let executable = resolve(binary_override).map_err(|e| e.to_string())?;
    run(&executable, &["import".into(), path])
        .await
        .map(|_| true)
        .map_err(|e| e.to_string())
}

/// Build the CLI arguments for an export. Pure, so the contract is pinned.
pub fn export_args(session_id: &str, sanitize: bool) -> Vec<String> {
    let mut args = vec!["export".to_string(), session_id.to_string()];
    if sanitize {
        args.push("--sanitize".to_string());
    }
    args
}

pub fn import_args(path: &str) -> Vec<String> {
    vec!["import".to_string(), path.to_string()]
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn export_args_are_ordered_as_the_cli_expects() {
        assert_eq!(export_args("ses_1", false), vec!["export", "ses_1"]);
    }

    #[test]
    fn sanitize_is_a_flag_on_export() {
        assert_eq!(
            export_args("ses_1", true),
            vec!["export", "ses_1", "--sanitize"]
        );
    }

    #[test]
    fn import_takes_the_path_as_a_positional() {
        assert_eq!(import_args("/tmp/a.json"), vec!["import", "/tmp/a.json"]);
    }
}
