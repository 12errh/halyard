//! The packaged-app launch scenario, checked against this machine.
//!
//! Everything else in `binary`'s unit tests runs inside a developer's shell,
//! where opencode is on `PATH` and every lookup succeeds trivially. That is
//! exactly the environment that hides the bug this file guards: a packaged
//! build launched from the desktop inherits the session manager's environment,
//! not a login shell's.
//!
//! Run it the way the desktop runs the app — a deliberately minimal `PATH`,
//! with `HOME` and `SHELL` kept because that is precisely what a session
//! manager provides:
//!
//! ```sh
//! env PATH=/usr/local/bin:/usr/bin:/bin \
//!     HOME="$HOME" SHELL="$(command -v zsh || command -v bash)" \
//!     cargo test --manifest-path src-tauri/Cargo.toml \
//!       --test desktop_path -- --ignored --nocapture
//! ```
//!
//! It is `#[ignore]`d because it asserts about the machine it runs on: a
//! contributor without opencode installed should see it skip, not fail.

use halyard_lib::binary;

/// A desktop session's `PATH`: the directories a session manager provides
/// before any user profile is sourced.
const DESKTOP_PATH: &str = "/usr/local/bin:/usr/bin:/bin";

#[test]
#[ignore = "asserts about this machine; run it explicitly with a desktop PATH"]
fn opencode_is_found_from_a_desktop_launch() {
    let inherited = std::env::var("PATH").unwrap_or_default();
    assert_ne!(
        inherited, DESKTOP_PATH,
        "this test is only meaningful when PATH has been scrubbed to {DESKTOP_PATH}"
    );

    let resolved = binary::resolve(None, &[]).expect(
        "opencode should still be found without it on PATH — the login shell \
         probe and the well-known install directories are what make this work",
    );

    eprintln!("resolved opencode to: {}", resolved.path.display());
    eprintln!("launch kind: {:?}", resolved.kind);
    assert!(resolved.path.is_file(), "resolved path must exist");
}

#[test]
#[ignore = "asserts about this machine; run it explicitly with a desktop PATH"]
fn a_binary_outside_the_desktop_path_is_still_reachable() {
    let resolved = binary::resolve(None, &[]).expect("opencode should be found");
    // The whole point: the answer is somewhere the desktop `PATH` never named.
    assert!(
        !DESKTOP_PATH
            .split(':')
            .any(|dir| resolved.path.starts_with(dir)),
        "expected a location outside {DESKTOP_PATH}, got {}",
        resolved.path.display()
    );
}

#[test]
#[ignore = "asserts about this machine; run it explicitly with a desktop PATH"]
fn an_explicit_override_still_wins() {
    let resolved = binary::resolve(None, &[]).expect("opencode should be found");
    let via_override = binary::resolve(Some(&resolved.path), &[]).expect("override must resolve");
    assert_eq!(via_override.path, resolved.path);
}
