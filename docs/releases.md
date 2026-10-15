# Releasing

Pushing a `v*` tag builds both platforms, signs them, and opens a **draft**
release. Publishing that draft is what makes the update available to users.

## One-time setup

The updater signs every artifact with a minisign key. The **public** half is
compiled into the app and lives in `src-tauri/tauri.conf.json` under
`plugins.updater.pubkey`. The **private** half must be a GitHub secret and must
never enter the repository.

```sh
# Already done for this repo; regenerate only if rotating.
pnpm tauri signer generate -w ~/.tauri/halyard.key --ci
```

Then, in the repository settings, add:

| Secret | Value |
|---|---|
| `TAURI_SIGNING_PRIVATE_KEY` | the contents of `~/.tauri/halyard.key` |
| `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | the password the key was created with |

```sh
gh secret set TAURI_SIGNING_PRIVATE_KEY < ~/.tauri/halyard.key
gh secret set TAURI_SIGNING_PRIVATE_KEY_PASSWORD < ~/.tauri/halyard.key.password
```

**Lose this key and updates stop working for everyone already running an
older build.** They will download an artifact, fail signature verification, and
have no way to recover without a manual install. Back it up somewhere that is
not this laptop.

The private key is deliberately *not* in `.gitignore` — it lives outside the
repository, at `~/.tauri/`, so there is nothing to ignore. If you ever generate
one inside the tree, add `*.key` first.

## Cutting a release

1. Bump `version` in `src-tauri/tauri.conf.json` and commit. The tag and this
   version must agree; the workflow refuses to build if they do not.
2. `git tag v0.2.0 && git push origin v0.2.0`
3. Watch the `Release` workflow. The frontend is built once and both platform
   jobs package that same output, so the two ships are byte-equal in the UI.
4. **Publish the draft release** on GitHub.

Step 4 is not optional. The updater reads
`/releases/latest/download/latest.json`, and that URL does not resolve while the
release is a draft.

## What each artifact can do

This is the part that is genuinely different per platform, and getting it
backwards is how you ship a button that does not work.

| Artifact | Self-updates? | Why |
|---|---|---|
| **AppImage** (Linux) | Yes | The updater writes the download over the running executable. |
| **NSIS** (Windows) | Yes | The updater runs the installer. Built `installMode: currentUser`, so it never asks for administrator rights. |
| `.deb` / `.rpm` (Linux) | **No** | Replacing a system package means writing to `/usr`, which only root can do. Updates come from the package manager, which asks for your password in the usual way. |
| `.msi` (Windows) | No | Published for managed deployment and the Windows Installer. Point the updater at an NSIS install, not an MSI one. |

Halyard knows which of these it is: the AppImage runtime sets `APPIMAGE`, and
a `.deb` install does not. When it cannot update itself, Settings says so and
names the package manager, rather than showing a control that would fail or
silently prompt for elevation.

## Where `latest.json` comes from

`tauri build` does not write one. It writes a `.sig` beside each artifact it
signs and stops there.

`scripts/build_update_manifest.py` builds the manifest from those signatures.
It lists **only** the AppImage and the NSIS installer, because the updater's
Linux path swaps the executable and its Windows path runs an installer — a
`.deb` listed there would download and then fail. It also rewrites every
download URL to an absolute, tag-pinned GitHub URL, so a moved asset or a
re-tagged release cannot quietly redirect an install.

It refuses to write anything unless every listed artifact has a signature and
all inputs agree on the version. A manifest that looks valid and installs
nothing is worse than no manifest, and this file only ever runs in CI.

## Verifying a release by hand

```sh
# The manifest a client would fetch.
curl -sL https://github.com/12errh/halyard/releases/latest/download/latest.json | python3 -m json.tool

# The signing chain, against a real build.
export TAURI_SIGNING_PRIVATE_KEY="$(cat ~/.tauri/halyard.key)"
export TAURI_SIGNING_PRIVATE_KEY_PASSWORD="$(cat ~/.tauri/halyard.key.password)"
pnpm tauri build --bundles appimage
python3 scripts/build_update_manifest.py src-tauri/target/release/bundle \
    --tag v0.1.0 --version 0.1.0 --out /tmp/latest.json
HALYARD_MANIFEST=/tmp/latest.json \
    cargo test --manifest-path src-tauri/Cargo.toml \
      --test updater_signing -- --ignored --nocapture
```

The test reads the public key out of `tauri.conf.json` and verifies the real
built artifact against it. It is `#[ignore]`d because it needs a bundle; CI runs
its non-ignored siblings, which check the same key against a committed
signature, a tampered artifact, and an unrelated key.

## Testing an actual upgrade

Nothing above proves the binary swaps itself, because that needs an installed
copy. To test for real:

1. Install the AppImage to `~/bin`, run it once.
2. Tag and publish a new version.
3. Open Settings → General → Check for updates, install it.

The app should download, verify, relaunch, and report the new version. If the
download fails, the signature did not match — check that the key secret and the
`pubkey` in `tauri.conf.json` are the same pair.
