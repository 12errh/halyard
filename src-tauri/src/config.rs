//! Reading and writing opencode's own configuration files.
//!
//! Why this exists instead of `PATCH /config`: verified against opencode
//! 1.18.35, that endpoint validates the payload, echoes it back with HTTP 200,
//! and writes nothing to disk. Building settings on it would look like it
//! worked while saving nothing. Writing the file is the only path that
//! persists, and the server picks it up on the next start — which the process
//! manager already controls.

use std::path::{Path, PathBuf};

use serde::Serialize;

/// Candidate config filenames, in the order opencode prefers them.
pub const CONFIG_NAMES: [&str; 2] = ["opencode.json", "opencode.jsonc"];

/// Which file a write should target when the user has not chosen one.
pub const DEFAULT_CONFIG_NAME: &str = "opencode.json";

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConfigFile {
    /// Absolute path that was read, or would be written.
    pub path: String,
    /// Raw text, preserved verbatim so comments and formatting survive.
    pub content: String,
    /// False when the file does not exist yet.
    pub exists: bool,
}

/// Find the config file for `directory`, preferring an existing one.
///
/// Falls back to `opencode.json` in the same directory so the returned path is
/// always writable, even on a project that has never been configured.
pub fn resolve_config_path(directory: &Path) -> PathBuf {
    for name in CONFIG_NAMES {
        let candidate = directory.join(name);
        if candidate.is_file() {
            return candidate;
        }
    }
    directory.join(DEFAULT_CONFIG_NAME)
}

/// Global config, which is where credentials and machine-wide settings live.
pub fn global_config_path(home: &Path) -> PathBuf {
    home.join(".config").join("opencode").join("opencode.json")
}

pub fn read_config(path: &Path) -> Result<ConfigFile, String> {
    match std::fs::read_to_string(path) {
        Ok(content) => Ok(ConfigFile {
            path: path.display().to_string(),
            content,
            exists: true,
        }),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(ConfigFile {
            path: path.display().to_string(),
            content: String::new(),
            exists: false,
        }),
        Err(error) => Err(format!("cannot read {}: {error}", path.display())),
    }
}

/// Write atomically: temp file in the same directory, then rename.
///
/// A partial write would leave the user with a corrupt config and an opencode
/// that refuses to start. `rename` within a directory is atomic on Linux.
pub fn write_config(path: &Path, content: &str) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|error| format!("cannot create {}: {error}", parent.display()))?;
    }

    let temp = path.with_extension("halyard-tmp");
    std::fs::write(&temp, content)
        .map_err(|error| format!("cannot write {}: {error}", temp.display()))?;

    if let Err(error) = std::fs::rename(&temp, path) {
        // Leave no debris behind if the rename fails.
        let _ = std::fs::remove_file(&temp);
        return Err(format!("cannot replace {}: {error}", path.display()));
    }

    Ok(())
}

/// Strip comments and trailing commas so JSONC can be validated as JSON.
///
/// opencode's own config files may contain `//` comments and trailing commas;
/// validating them as strict JSON would reject files that opencode itself
/// accepts. Pure so the rules are pinned by tests.
pub fn jsonc_to_json(source: &str) -> String {
    let bytes: Vec<char> = source.chars().collect();
    let mut out = String::with_capacity(source.len());
    let mut i = 0;
    let mut in_string = false;
    let mut escaped = false;

    while i < bytes.len() {
        let c = bytes[i];

        if in_string {
            out.push(c);
            if escaped {
                escaped = false;
            } else if c == '\\' {
                escaped = true;
            } else if c == '"' {
                in_string = false;
            }
            i += 1;
            continue;
        }

        // Line comment.
        if c == '/' && bytes.get(i + 1) == Some(&'/') {
            while i < bytes.len() && bytes[i] != '\n' {
                i += 1;
            }
            continue;
        }

        // Block comment.
        if c == '/' && bytes.get(i + 1) == Some(&'*') {
            i += 2;
            while i < bytes.len() {
                if bytes[i] == '*' && bytes.get(i + 1) == Some(&'/') {
                    i += 2;
                    break;
                }
                // Keep newlines so error line numbers stay meaningful.
                if bytes[i] == '\n' {
                    out.push('\n');
                }
                i += 1;
            }
            continue;
        }

        if c == '"' {
            in_string = true;
        }
        out.push(c);
        i += 1;
    }

    remove_trailing_commas(&out)
}

fn remove_trailing_commas(source: &str) -> String {
    let chars: Vec<char> = source.chars().collect();
    let mut out = String::with_capacity(source.len());
    let mut in_string = false;
    let mut escaped = false;

    for (index, &c) in chars.iter().enumerate() {
        if in_string {
            out.push(c);
            if escaped {
                escaped = false;
            } else if c == '\\' {
                escaped = true;
            } else if c == '"' {
                in_string = false;
            }
            continue;
        }

        if c == '"' {
            in_string = true;
            out.push(c);
            continue;
        }

        if c == ',' {
            // Look ahead past whitespace for a closing bracket.
            let mut j = index + 1;
            while j < chars.len() && chars[j].is_whitespace() {
                j += 1;
            }
            if j < chars.len() && (chars[j] == '}' || chars[j] == ']') {
                // Drop the comma; the whitespace is preserved by the loop.
                continue;
            }
        }

        out.push(c);
    }

    out
}

/// Validate a config document. Returns the parsed value or a message the editor
/// can show next to the offending line.
pub fn validate(source: &str) -> Result<serde_json::Value, String> {
    if source.trim().is_empty() {
        return Ok(serde_json::Value::Object(serde_json::Map::new()));
    }
    serde_json::from_str(&jsonc_to_json(source)).map_err(|error| {
        // serde reports a line in the stripped document; comments may have
        // shifted it, so present the message without a misleading line number.
        format!("{error}")
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn prefers_an_existing_jsonc_over_a_missing_json() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("opencode.jsonc"), "{}").unwrap();
        assert!(resolve_config_path(dir.path()).ends_with("opencode.jsonc"));
    }

    #[test]
    fn prefers_json_when_both_exist() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("opencode.json"), "{}").unwrap();
        std::fs::write(dir.path().join("opencode.jsonc"), "{}").unwrap();
        assert!(resolve_config_path(dir.path()).ends_with("opencode.json"));
    }

    #[test]
    fn falls_back_to_a_writable_path_when_absent() {
        let dir = tempfile::tempdir().unwrap();
        let resolved = resolve_config_path(dir.path());
        assert!(resolved.ends_with(DEFAULT_CONFIG_NAME));
        assert!(!resolved.exists());
    }

    #[test]
    fn global_path_is_under_dot_config() {
        let path = global_config_path(Path::new("/home/me"));
        assert!(path.ends_with(".config/opencode/opencode.json"));
    }

    #[test]
    fn reading_a_missing_file_is_not_an_error() {
        let dir = tempfile::tempdir().unwrap();
        let file = read_config(&dir.path().join("nope.json")).unwrap();
        assert!(!file.exists);
        assert!(file.content.is_empty());
    }

    #[test]
    fn round_trips_content() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("opencode.json");
        write_config(&path, "{\n  \"model\": \"x\"\n}").unwrap();
        let file = read_config(&path).unwrap();
        assert!(file.exists);
        assert_eq!(file.content, "{\n  \"model\": \"x\"\n}");
    }

    #[test]
    fn writing_creates_missing_parent_directories() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("a/b/opencode.json");
        write_config(&path, "{}").unwrap();
        assert!(path.is_file());
    }

    #[test]
    fn write_leaves_no_temp_file_behind() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("opencode.json");
        write_config(&path, "{}").unwrap();
        let leftovers: Vec<_> = std::fs::read_dir(dir.path())
            .unwrap()
            .filter_map(|e| e.ok())
            .filter(|e| e.file_name().to_string_lossy().contains("halyard-tmp"))
            .collect();
        assert!(leftovers.is_empty(), "temp file was not cleaned up");
    }

    #[test]
    fn jsonc_strips_line_comments() {
        let src = "{\n  // a note\n  \"a\": 1\n}";
        assert_eq!(jsonc_to_json(src), "{\n  \n  \"a\": 1\n}");
        assert_eq!(validate(src).unwrap()["a"], 1);
    }

    #[test]
    fn jsonc_strips_block_comments() {
        let src = "{ /* hi */ \"a\": 1 }";
        assert_eq!(validate(src).unwrap()["a"], 1);
    }

    #[test]
    fn jsonc_keeps_comment_markers_inside_strings() {
        // Stripping these would corrupt a command or URL.
        let src = r#"{ "url": "https://example.com/a", "note": "// not a comment" }"#;
        let parsed = validate(src).unwrap();
        assert_eq!(parsed["url"], "https://example.com/a");
        assert_eq!(parsed["note"], "// not a comment");
    }

    #[test]
    fn jsonc_handles_escaped_quotes() {
        let src = r#"{ "q": "he said \"hi\" // still a string" }"#;
        assert_eq!(validate(src).unwrap()["q"], r#"he said "hi" // still a string"#);
    }

    #[test]
    fn jsonc_removes_trailing_commas() {
        assert_eq!(validate("{ \"a\": [1, 2, ], }").unwrap()["a"][1], 2);
    }

    #[test]
    fn block_comments_preserve_line_count_for_error_messages() {
        // A three-line block comment collapses to nothing but must leave the
        // remaining lines at their original numbers, otherwise a parse error
        // points at the wrong line in the file the user is editing.
        let source = "{\n/* one\ntwo\nthree */\n\"a\": 1\n}";
        assert_eq!(
            jsonc_to_json(source).matches('\n').count(),
            source.matches('\n').count()
        );
    }

    #[test]
    fn empty_document_is_valid() {
        assert!(validate("").unwrap().is_object());
        assert!(validate("   \n ").unwrap().is_object());
    }

    #[test]
    fn rejects_invalid_json_with_a_message() {
        let error = validate("{ not json").unwrap_err();
        assert!(!error.is_empty());
    }

    #[test]
    fn rejects_a_broken_document_rather_than_silently_saving_it() {
        assert!(validate("{ \"a\": }").is_err());
        assert!(validate("{ \"a\": 1").is_err());
    }

    #[test]
    fn accepts_a_realistic_config() {
        let src = r#"{
            "$schema": "https://opencode.ai/config.json",
            "model": "opencode/exo-free",
            "permission": { "edit": "ask", "bash": { "*": "allow" } },
            "mcp": { "hf": { "type": "remote", "url": "https://mcp.example" } }
        }"#;
        let parsed = validate(src).unwrap();
        assert_eq!(parsed["model"], "opencode/exo-free");
        assert_eq!(parsed["permission"]["edit"], "ask");
    }
}

// ---------------------------------------------------------------------------
// Tauri commands
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn read_config_file(directory: String) -> Result<ConfigFile, String> {
    read_config(&resolve_config_path(Path::new(&directory)))
}

#[tauri::command]
pub fn write_config_file(path: String, content: String) -> Result<(), String> {
    write_config(Path::new(&path), &content)
}

#[tauri::command]
pub fn global_config() -> Result<ConfigFile, String> {
    let home = std::env::var("HOME")
        .or_else(|_| std::env::var("USERPROFILE"))
        .map_err(|_| "cannot determine the home directory".to_string())?;
    read_config(&global_config_path(Path::new(&home)))
}

/// Validate without writing, so the editor can reject a bad save before it
/// replaces a working config.
#[tauri::command]
pub fn validate_config(content: String) -> Result<(), String> {
    validate(&content).map(|_| ())
}
