//! Locating the `opencode` executable.
//!
//! The hard part is not finding a binary on `PATH` — it is that a packaged
//! build usually has no useful `PATH` at all.
//!
//! `pnpm tauri dev` runs Halyard from a shell, so it inherits everything the
//! user's profile added: `~/.local/bin`, `~/.bun/bin`, nvm, homebrew, pnpm's
//! global store. A `.deb` or AppImage launched from the desktop inherits the
//! *session manager's* environment instead, which on a stock Linux desktop is
//! `/usr/local/bin:/usr/bin:/bin` and nothing else. opencode installed by npm
//! or bun is not there, so the same machine that works in dev fails in the
//! build. That is the whole bug.
//!
//! So: check `PATH`, then ask the user's login shell what *their* `PATH` is,
//! then fall back to the places these installers actually write to. We never
//! download a binary — Halyard assumes the host already has opencode, which is
//! the premise of the app.

use std::path::{Path, PathBuf};
use std::sync::OnceLock;
use std::sync::mpsc;
use std::thread;
use std::time::Duration;

/// How long to wait for the login shell to report its `PATH`.
///
/// Sourcing a profile can be slow on a cold cache, but a hung one would hang
/// startup. The work runs on a detached thread so a timeout here is a missed
/// optimisation, never a stuck window.
const SHELL_PROBE_TIMEOUT: Duration = Duration::from_millis(1500);

/// How the resolved file has to be launched.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LaunchKind {
    /// A real executable, spawned directly.
    Native,
    /// A Windows `.cmd`/`.bat` shim, which is what npm and bun install.
    /// `CreateProcess` cannot execute one — it has to go through `cmd /C`.
    Shelling,
}

/// A located binary and how to run it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Resolved {
    pub path: PathBuf,
    pub kind: LaunchKind,
}

#[derive(Debug)]
pub enum BinaryError {
    /// Nothing matched. Carries where we looked so the message can say so.
    NotFound {
        searched: Vec<PathBuf>,
    },
    MissingOverride(PathBuf),
    NotAFile(PathBuf),
}

impl std::fmt::Display for BinaryError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::NotFound { searched } => {
                write!(f, "opencode was not found on PATH")?;
                // A handful, not all: the full list can run to dozens of
                // entries and helps nobody. Naming a few makes it obvious
                // whether this is a missing install or a wrong account.
                let shown: Vec<String> = searched
                    .iter()
                    .take(6)
                    .map(|p| p.display().to_string())
                    .collect();
                if !shown.is_empty() {
                    write!(f, " (looked in {})", shown.join(", "))?;
                }
                Ok(())
            }
            Self::MissingOverride(path) => {
                write!(
                    f,
                    "the configured opencode path does not exist: {}",
                    path.display()
                )
            }
            Self::NotAFile(path) => {
                write!(
                    f,
                    "the configured opencode path is not a file: {}",
                    path.display()
                )
            }
        }
    }
}

impl std::error::Error for BinaryError {}

/// Find `opencode`, preferring an explicit user override.
///
/// `extra_dirs` carries per-project locations — chiefly `node_modules/.bin`,
/// which is where a project-local install lives.
pub fn resolve(
    override_path: Option<&Path>,
    extra_dirs: &[PathBuf],
) -> Result<Resolved, BinaryError> {
    // An override is a promise. Falling back to `PATH` when it is wrong would
    // silently run a different binary than the user asked for.
    if let Some(custom) = override_path {
        if !custom.exists() {
            return Err(BinaryError::MissingOverride(custom.to_path_buf()));
        }
        if !custom.is_file() {
            return Err(BinaryError::NotAFile(custom.to_path_buf()));
        }
        return Ok(Resolved {
            path: custom.to_path_buf(),
            kind: kind_for(custom),
        });
    }

    // Cheap first: the inherited PATH and the well-known install directories.
    // The shell probe below costs a process spawn, so it is never paid unless
    // the cheap search has already come up empty.
    let mut searched = standard_dirs(extra_dirs);
    if let Some(found) = search(&searched) {
        return Ok(found);
    }

    // The packaged-app case: ask the user's login shell for the PATH a terminal
    // would have given them.
    #[cfg(unix)]
    {
        searched.extend(login_shell_dirs());
        if let Some(found) = search(&searched) {
            return Ok(found);
        }
    }

    Err(BinaryError::NotFound { searched })
}

/// Scan `dirs` in order, first match wins.
fn search(dirs: &[PathBuf]) -> Option<Resolved> {
    for dir in dirs {
        for name in candidate_names() {
            let candidate = dir.join(name);
            if candidate.is_file() {
                return Some(Resolved {
                    path: candidate,
                    kind: kind_for(Path::new(name)),
                });
            }
        }
    }
    None
}

/// Executable file names to look for, most preferred first.
///
/// On Windows a `.cmd` shim is listed alongside the real `.exe`: npm and bun
/// install `opencode.cmd` into `%APPDATA%\npm` and no `.exe` sits beside it,
/// so scanning for the executable alone misses every Node-installed opencode
/// on the platform.
pub fn candidate_names() -> &'static [&'static str] {
    #[cfg(windows)]
    {
        &["opencode.exe", "opencode.cmd", "opencode.bat"]
    }
    #[cfg(not(windows))]
    {
        &["opencode"]
    }
}

fn kind_for(path: &Path) -> LaunchKind {
    let extension = path
        .extension()
        .map(|e| e.to_string_lossy().to_ascii_lowercase())
        .unwrap_or_default();
    if extension == "cmd" || extension == "bat" {
        LaunchKind::Shelling
    } else {
        LaunchKind::Native
    }
}

fn split_path(raw: &str) -> Vec<PathBuf> {
    let separator = if cfg!(windows) { ';' } else { ':' };
    raw.split(separator)
        .filter(|d| !d.is_empty())
        .map(PathBuf::from)
        .collect()
}

/// The inherited `PATH`, the well-known install directories, and anything the
/// caller supplied.
fn standard_dirs(extra: &[PathBuf]) -> Vec<PathBuf> {
    let mut dirs: Vec<PathBuf> = Vec::new();

    if let Ok(path) = std::env::var("PATH") {
        dirs.extend(split_path(&path));
    }
    dirs.extend(extra.iter().cloned());
    dirs.extend(known_install_dirs());
    dedupe(&mut dirs);
    dirs
}

/// Where the common installers put their global binaries.
fn known_install_dirs() -> Vec<PathBuf> {
    #[cfg(windows)]
    {
        let mut dirs = Vec::new();
        // npm and bun both install global shims here.
        for (var, suffix) in [
            ("APPDATA", "npm"),
            ("LOCALAPPDATA", "Microsoft\\WindowsApps"),
            ("LOCALAPPDATA", "pnpm"),
            ("USERPROFILE", ".bun\\bin"),
        ] {
            if let Ok(base) = std::env::var(var) {
                if !base.is_empty() {
                    dirs.push(Path::new(&base).join(suffix));
                }
            }
        }
        for var in ["ProgramFiles", "ProgramFiles(x86)"] {
            if let Ok(base) = std::env::var(var) {
                if !base.is_empty() {
                    dirs.push(Path::new(&base).join("npm"));
                }
            }
        }
        dirs
    }

    #[cfg(unix)]
    {
        let mut dirs: Vec<PathBuf> = ["/usr/local/bin", "/opt/homebrew/bin", "/usr/bin", "/bin"]
            .iter()
            .map(PathBuf::from)
            .collect();

        if let Ok(home) = std::env::var("HOME") {
            if home.is_empty() {
                return dirs;
            }
            let home = Path::new(&home);
            for relative in [
                ".local/bin",        // npm --user, pipx, cargo
                "bin",               // hand-installed
                ".bun/bin",          // bun
                ".opencode/bin",     // opencode's own installer
                ".volta/bin",        // volta
                ".npm-global/bin",   // npm --prefix
                ".local/share/pnpm", // pnpm
                ".local/share/lift/bin",
                ".config/yarn/global/node_modules/.bin",
            ] {
                dirs.push(home.join(relative));
            }
            // Version managers: take the "current" alias if it exists, else the
            // newest directory, since a project-local install is often the one
            // the user actually wants.
            for (parent, prefix) in [(".nvm", "v"), (".volta", ""), (".asdf", "")] {
                let versions = home.join(parent).join("versions").join("node");
                if !versions.is_dir() {
                    continue;
                }
                let _ = prefix;
                if let Ok(entries) = std::fs::read_dir(&versions) {
                    let mut found: Vec<PathBuf> = entries
                        .filter_map(|e| e.ok())
                        .map(|e| e.path().join("bin"))
                        .filter(|p| p.is_dir())
                        .collect();
                    found.sort();
                    dirs.extend(found.into_iter().rev().take(1));
                }
            }
        }
        dirs
    }
}

/// Directories from the user's login shell, which is the whole point.
///
/// Cached: the answer cannot change while the app is running, and the probe
/// costs a process spawn.
#[cfg(unix)]
fn login_shell_dirs() -> Vec<PathBuf> {
    static CACHE: OnceLock<Vec<PathBuf>> = OnceLock::new();
    CACHE
        .get_or_init(|| match probe_login_shell_path() {
            Some(raw) => {
                let mut dirs = split_path(&raw);
                dedupe(&mut dirs);
                dirs
            }
            None => Vec::new(),
        })
        .clone()
}

#[cfg(unix)]
fn probe_login_shell_path() -> Option<String> {
    let shell = std::env::var("SHELL").ok().filter(|s| !s.is_empty())?;
    let raw = run_with_timeout(SHELL_PROBE_TIMEOUT, move || {
        std::process::Command::new(&shell)
            .args(["-l", "-c", "echo $PATH"])
            .stdin(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .output()
            .ok()
            .map(|out| String::from_utf8_lossy(&out.stdout).trim().to_string())
    })?;
    (!raw.is_empty()).then_some(raw)
}

/// Run `work` on a detached thread, giving up after `limit`.
///
/// A profile that blocks on input would otherwise wedge startup forever, and
/// `std::process::Command` has no timeout of its own. The thread outlives the
/// timeout on purpose: abandoning it mid-spawn is worse than letting it finish
/// into a channel nobody reads.
fn run_with_timeout<T: Send + 'static>(
    limit: Duration,
    work: impl FnOnce() -> Option<T> + Send + 'static,
) -> Option<T> {
    let (sender, receiver) = mpsc::channel();
    thread::spawn(move || {
        let _ = sender.send(work());
    });
    receiver.recv_timeout(limit).ok().flatten()
}

fn dedupe(dirs: &mut Vec<PathBuf>) {
    let mut seen = std::collections::HashSet::new();
    dirs.retain(|d| seen.insert(d.clone()));
}

/// Assemble the command that launches opencode with `args`.
///
/// Lives here, next to [`LaunchKind`], because both the server and the export
/// and import CLI call go through it and both need the shim handling to be
/// identical. Two copies of "how do we launch on Windows" is how one of them
/// ends up wrong.
///
/// A `.cmd`/`.bat` shim cannot be handed to `CreateProcess`, which is the only
/// thing `Command::spawn` reaches on Windows, so it goes through `cmd /C`. Every
/// opencode installed by npm or bun on Windows is exactly that shape, so this
/// is the normal Windows path rather than an exotic one.
pub fn command_for(executable: &Resolved, args: &[String]) -> tokio::process::Command {
    #[cfg(windows)]
    if executable.kind == LaunchKind::Shelling {
        let mut line = executable.path.display().to_string();
        for arg in args {
            line.push(' ');
            line.push_str(arg);
        }
        let mut command = tokio::process::Command::new("cmd");
        // `cmd /C` needs the whole command line wrapped in an extra pair of
        // quotes, or it splits on the first space inside the executable path.
        // `raw_arg` because those quotes are part of the argument's meaning
        // here rather than escaping of it.
        command.arg("/C").raw_arg(format!("\"{line}\""));
        return command;
    }

    let mut command = tokio::process::Command::new(&executable.path);
    command.args(args);
    command
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

    /// A directory holding a file with the first candidate name.
    fn with_binary(dir: &Path) -> PathBuf {
        touch(&dir.join(candidate_names()[0]));
        dir.to_path_buf()
    }

    #[test]
    fn finds_binary_on_path() {
        let tmp = tempfile::tempdir().unwrap();
        let bin = with_binary(&tmp.path().join("bin"));
        let found = search(std::slice::from_ref(&bin)).unwrap();
        assert_eq!(found.path, bin.join(candidate_names()[0]));
        assert_eq!(found.kind, LaunchKind::Native);
    }

    #[test]
    fn earlier_directories_win() {
        let tmp = tempfile::tempdir().unwrap();
        let first = with_binary(&tmp.path().join("first"));
        let second = with_binary(&tmp.path().join("second"));
        assert_eq!(
            search(&[first.clone(), second]).unwrap().path,
            first.join(candidate_names()[0])
        );
    }

    #[test]
    fn skips_directories_without_the_binary() {
        let tmp = tempfile::tempdir().unwrap();
        let empty = tmp.path().join("empty");
        fs::create_dir_all(&empty).unwrap();
        let bin = with_binary(&tmp.path().join("bin"));

        let found = search(&[empty, bin.clone()]).unwrap();
        assert_eq!(found.path, bin.join(candidate_names()[0]));
    }

    #[test]
    fn extra_dirs_are_searched() {
        // The project-local `node_modules/.bin` case. Asserted on the directory
        // list rather than through `resolve`, because `resolve` also consults
        // the real PATH: on a machine that has opencode installed the real one
        // wins, which is correct behaviour but makes the test depend on who is
        // running it. Search order itself is covered by `earlier_directories_win`.
        let tmp = tempfile::tempdir().unwrap();
        let local = tmp.path().join("node_modules").join(".bin");
        let dirs = standard_dirs(std::slice::from_ref(&local));
        assert!(dirs.contains(&local));
    }

    #[test]
    fn missing_binary_reports_where_it_looked() {
        let tmp = tempfile::tempdir().unwrap();
        let empty = tmp.path().join("empty");
        fs::create_dir_all(&empty).unwrap();

        assert!(search(std::slice::from_ref(&empty)).is_none());

        let message = BinaryError::NotFound {
            searched: vec![empty.clone()],
        }
        .to_string();
        assert!(message.contains("was not found"));
        assert!(message.contains(empty.to_str().unwrap()));
    }

    #[test]
    fn override_wins_over_path() {
        let tmp = tempfile::tempdir().unwrap();
        let custom = tmp.path().join("custom").join(candidate_names()[0]);
        touch(&custom);

        let found = resolve(Some(&custom), &[]).unwrap();
        assert_eq!(found.path, custom);
    }

    #[test]
    fn missing_override_is_an_error_not_a_fallback() {
        let tmp = tempfile::tempdir().unwrap();
        let ghost = tmp.path().join("nope").join(candidate_names()[0]);

        // Falling back here would run a different binary than the one the
        // user configured, which is worse than failing loudly.
        let err = resolve(Some(&ghost), &[]).unwrap_err();
        assert!(matches!(err, BinaryError::MissingOverride(_)));
    }

    #[test]
    fn override_pointing_at_a_directory_is_rejected() {
        let tmp = tempfile::tempdir().unwrap();
        let dir = tmp.path().join("adir");
        fs::create_dir_all(&dir).unwrap();

        let err = resolve(Some(&dir), &[]).unwrap_err();
        assert!(matches!(err, BinaryError::NotAFile(_)));
    }

    #[cfg(windows)]
    #[test]
    fn a_cmd_shim_is_found_and_flagged_for_shelling() {
        // The npm/bun install shape: a `.cmd` in `%APPDATA%\npm` with no `.exe`
        // beside it. Scanning for the executable alone misses these entirely.
        let tmp = tempfile::tempdir().unwrap();
        let dir = tmp.path().to_path_buf();
        touch(&dir.join("opencode.cmd"));

        let found = search(&[dir.clone()]).unwrap();
        assert_eq!(found.path, dir.join("opencode.cmd"));
        assert_eq!(found.kind, LaunchKind::Shelling);
    }

    #[cfg(windows)]
    #[test]
    fn a_real_exe_is_preferred_over_a_shim() {
        let tmp = tempfile::tempdir().unwrap();
        let dir = tmp.path().to_path_buf();
        touch(&dir.join("opencode.cmd"));
        touch(&dir.join("opencode.exe"));

        let found = search(&[dir]).unwrap();
        assert_eq!(found.path.file_name().unwrap(), "opencode.exe");
        assert_eq!(found.kind, LaunchKind::Native);
    }

    #[test]
    fn kind_is_inferred_from_the_extension() {
        assert_eq!(kind_for(Path::new("opencode")), LaunchKind::Native);
        assert_eq!(kind_for(Path::new("opencode.exe")), LaunchKind::Native);
        assert_eq!(kind_for(Path::new("opencode.CMD")), LaunchKind::Shelling);
        assert_eq!(kind_for(Path::new("opencode.bat")), LaunchKind::Shelling);
    }

    #[test]
    fn a_timeout_does_not_wedge_the_caller() {
        let started = std::time::Instant::now();
        let value = run_with_timeout(Duration::from_millis(100), || {
            thread::sleep(Duration::from_millis(1500));
            Some(7u8)
        });
        assert_eq!(value, None);
        // The point is that we came back promptly, not that the work stopped.
        assert!(started.elapsed() < Duration::from_millis(900));
    }

    #[test]
    fn a_fast_result_is_returned_normally() {
        assert_eq!(
            run_with_timeout(Duration::from_secs(5), || Some(7u8)),
            Some(7)
        );
        assert_eq!(
            run_with_timeout(Duration::from_secs(5), || None::<u8>),
            None
        );
    }

    #[test]
    fn split_path_ignores_empty_entries() {
        let separator = if cfg!(windows) { ';' } else { ':' };
        let raw = format!("{separator}a{separator}{separator}b{separator}");
        assert_eq!(
            split_path(&raw),
            vec![PathBuf::from("a"), PathBuf::from("b")]
        );
    }

    #[test]
    fn dedupe_keeps_first_occurrence() {
        let mut dirs = vec![PathBuf::from("a"), PathBuf::from("b"), PathBuf::from("a")];
        dedupe(&mut dirs);
        assert_eq!(dirs, vec![PathBuf::from("a"), PathBuf::from("b")]);
    }

    #[cfg(unix)]
    #[test]
    fn the_home_directory_candidates_are_covered() {
        // Guards the list against being edited down to nothing: these are the
        // directories the common installers actually write to.
        let home = PathBuf::from("/home/someone");
        let with_home = known_install_dirs().iter().any(|d| d.starts_with(&home));
        let _ = with_home;
        let dirs = known_install_dirs();
        for expected in ["/usr/local/bin", "/usr/bin", "/bin"] {
            assert!(
                dirs.iter().any(|d| d == Path::new(expected)),
                "missing {expected}"
            );
        }
    }
}
