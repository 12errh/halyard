//! The signing pipeline, verified end to end without shipping the private key.
//!
//! Every other updater test can pass while updates silently never install. The
//! failure mode is narrow and fatal: the public key in `tauri.conf.json` does
//! not match the key CI signs with, or the signature is not actually checked,
//! and every download is rejected at install time with an error nobody sees.
//!
//! So this test uses the *real* public key read out of the *real* config, and a
//! signature produced by the *real* private key. Only the signed bytes are
//! checked in — the private key never enters the repository, and cannot be
//! regenerated from anything here.
//!
//! To re-sign the fixture after rotating the key:
//!
//! ```sh
//! export TAURI_SIGNING_PRIVATE_KEY="$(cat ~/.tauri/halyard.key)"
//! export TAURI_SIGNING_PRIVATE_KEY_PASSWORD="$(cat ~/.tauri/halyard.key.password)"
//! pnpm tauri signer sign src-tauri/tests/fixtures/artifact.bin
//! ```

use base64::Engine;
use minisign_verify::{PublicKey, Signature};

/// The bytes the fixture signature covers. Changing them invalidates the
/// signature, which is the point of the tamper test below.
const ARTIFACT: &[u8] = b"halyard updater signing round-trip\n";

/// A signature produced by the private key whose public half is in
/// `tauri.conf.json`. Regenerate with `tauri signer sign` — see the module
/// comment.
const SIGNATURE: &str = "dW50cnVzdGVkIGNvbW1lbnQ6IHNpZ25hdHVyZSBmcm9tIHRhdXJpIHNlY3JldCBrZXkKUlVTVXBwS3Z3dkJKemdwbnVpY3Nmc2YzeGtJTDFVbko4a3R3RHhSTGdhTHBaNGs2VzFadWdNdTYwVEg3eUN0YVQ4blcwWmJ4bU9La1grbjZIZkpZRGhJcHNaS3BDcFFIamdJPQp0cnVzdGVkIGNvbW1lbnQ6IHRpbWVzdGFtcDoxNzkyMDI3MTY3CWZpbGU6YXJ0aWZhY3QuYmluCnRDU1NFd0IvTnJnWEFJcHZPVnhpMXV0NzNQMXV6dkx4Z0Q2YkV0Vkk4d2czUzllRWxzYXprTE56VHplcldlT0wwWEw2WGQrNGo3SkdWVHl0QzYzdUF3PT0K";

/// The public key exactly as Halyard ships it: pulled from the config file
/// rather than copied here, so a wrong key pasted into the config fails this
/// test instead of failing on a user's machine.
fn configured_pubkey() -> String {
    let config = std::fs::read_to_string(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/tauri.conf.json"
    ))
    .expect("tauri.conf.json should be readable");
    let value: serde_json::Value =
        serde_json::from_str(&config).expect("tauri.conf.json should be valid JSON");
    value["plugins"]["updater"]["pubkey"]
        .as_str()
        .expect("plugins.updater.pubkey should be a string")
        .to_string()
}

/// Exactly what `tauri_plugin_updater` does before installing a download.
fn verify(data: &[u8], signature_b64: &str, pubkey_b64: &str) -> bool {
    let decode = |value: &str| {
        base64::engine::general_purpose::STANDARD
            .decode(value)
            .ok()
            .and_then(|bytes| String::from_utf8(bytes).ok())
    };
    let Some(key_text) = decode(pubkey_b64) else {
        return false;
    };
    let Some(sig_text) = decode(signature_b64) else {
        return false;
    };
    let Ok(public_key) = PublicKey::decode(&key_text) else {
        return false;
    };
    let Ok(signature) = Signature::decode(&sig_text) else {
        return false;
    };
    public_key.verify(data, &signature, true).is_ok()
}

#[test]
fn the_configured_public_key_is_a_real_minisign_key() {
    // A truncated or pasted-wrong key would otherwise only show up as an
    // inscrutable decode error on a user's machine.
    let text = base64::engine::general_purpose::STANDARD
        .decode(configured_pubkey())
        .expect("pubkey should be base64");
    let text = String::from_utf8(text).expect("pubkey should decode to text");
    assert!(
        PublicKey::decode(&text).is_ok(),
        "configured pubkey is not a usable minisign public key"
    );
}

#[test]
fn a_genuine_signature_verifies_under_the_configured_key() {
    assert!(
        verify(ARTIFACT, SIGNATURE, &configured_pubkey()),
        "the shipped public key must verify a signature made by the release key"
    );
}

#[test]
fn a_tampered_artifact_is_rejected() {
    // The security property, and the one worth having a test for: if the bytes
    // change after signing, installation must refuse them.
    let tampered = b"halyard updater signing round-trip!\n";
    assert_ne!(ARTIFACT, tampered, "the fixture must actually differ");
    assert!(
        !verify(tampered, SIGNATURE, &configured_pubkey()),
        "a modified artifact must never verify"
    );
}

#[test]
fn a_signature_from_another_key_is_rejected() {
    // Guards the scenario where the signing key is rotated but the old public
    // key is left in the config: nothing would verify, and updates would break
    // silently. The decoy key below was generated for this test and has no
    // other purpose.
    let decoy_pubkey = "dW50cnVzdGVkIGNvbW1lbnQ6IG1pbmlzaWduIHB1YmxpYyBrZXk6IDBCNkYyNEQ4RUM2NTAxREEKUldUYUFXWHMyQ1J2Q3pSdDdvZEN0Y3ZaMGVkZVZQb2I1b3JTSExSdmJiUms4Nys3emgxR2JRQWoK";
    assert_ne!(
        decoy_pubkey,
        configured_pubkey(),
        "the decoy must not be the real key, or this test proves nothing"
    );
    assert!(
        !verify(ARTIFACT, SIGNATURE, decoy_pubkey),
        "an unrelated public key must not verify our signature"
    );
}

#[test]
fn the_signature_covers_this_exact_fixture() {
    // If someone edits ARTIFACT without re-signing, this says so plainly
    // instead of leaving three failures that look like a broken key.
    assert!(
        verify(ARTIFACT, SIGNATURE, &configured_pubkey()),
        "ARTIFACT no longer matches SIGNATURE — re-run `pnpm tauri signer sign`"
    );
}

/// The real thing: a signed bundle produced by an actual `tauri build`.
///
/// The fixture above proves the keypair works. This proves the whole chain --
/// the key in the config signs real release artifacts, the manifest the
/// release job publishes carries that signature, and the bytes a user
/// downloads are the bytes that verify. It is the one check that would catch a
/// signer or manifest step quietly producing something the updater rejects.
///
/// Ignored by default because it needs a built bundle. To run it:
///
/// ```sh
/// export TAURI_SIGNING_PRIVATE_KEY="$(cat ~/.tauri/halyard.key)"
/// export TAURI_SIGNING_PRIVATE_KEY_PASSWORD="$(cat ~/.tauri/halyard.key.password)"
/// pnpm tauri build --bundles appimage
/// python3 scripts/build_update_manifest.py src-tauri/target/release/bundle \
///     --tag v0.1.0 --version 0.1.0 --out /tmp/latest.json
/// HALYARD_MANIFEST=/tmp/latest.json \
///     cargo test --manifest-path src-tauri/Cargo.toml \
///       --test updater_signing -- --ignored --nocapture
/// ```
#[test]
#[ignore = "needs a real built bundle; see the module docs"]
fn a_built_release_artifact_verifies_against_the_shipped_key() {
    let manifest_path = std::env::var("HALYARD_MANIFEST")
        .expect("set HALYARD_MANIFEST to a latest.json built by the release job");
    let manifest: serde_json::Value = serde_json::from_str(
        &std::fs::read_to_string(&manifest_path).expect("manifest should be readable"),
    )
    .expect("manifest should be valid JSON");

    let entry = manifest["platforms"]["linux-x86_64"]["x86_64"]
        .as_object()
        .expect("manifest should list linux-x86_64");
    let signature = entry["signature"].as_str().expect("entry needs a signature");
    let url = entry["url"].as_str().expect("entry needs a url");

    // Resolve the download URL back to the built artifact it names.
    let filename = url.rsplit('/').next().expect("url should end in a filename");
    let manifest_dir = std::path::Path::new(&manifest_path)
        .parent()
        .map(|p| p.to_path_buf())
        .unwrap_or_default();
    let bundle_dir = manifest_dir.clone();
    let artifact = find_artifact(&bundle_dir, filename, Some(&manifest_dir));

    let bytes = std::fs::read(&artifact)
        .unwrap_or_else(|e| panic!("could not read {}: {e}", artifact.display()));
    eprintln!("verifying {} ({} bytes)", artifact.display(), bytes.len());

    assert!(
        verify(&bytes, signature, &configured_pubkey()),
        "a real release artifact must verify under the shipped public key"
    );
}

/// Find the artifact the manifest names, in the bundle tree or beside the
/// manifest.
fn find_artifact(
    bundle_dir: &std::path::Path,
    filename: &str,
    manifest_dir: Option<&std::path::Path>,
) -> std::path::PathBuf {
    let mut searched = Vec::new();
    let roots = [Some(bundle_dir.to_path_buf())]
        .into_iter()
        .flatten()
        .chain(manifest_dir.map(|d| d.to_path_buf()))
        .chain(
            std::env::var("HALYARD_BUNDLES")
                .ok()
                .map(std::path::PathBuf::from),
        );

    for root in roots {
        if !root.is_dir() {
            searched.push(root.display().to_string());
            continue;
        }
        // The bundle tree nests per format (bundle/appimage/...), so walk it.
        if let Some(found) = walk(&root).into_iter().find(|p| {
            p.file_name().and_then(|n| n.to_str()) == Some(filename)
        }) {
            return found;
        }
    }
    panic!(
        "could not find {filename} near the manifest; searched {}",
        searched.join(", ")
    );
}

/// Every file under `root`, depth first. Small trees, so collecting them is
/// simpler than a lazy iterator — and an iterator here would have to hold the
/// read half of each directory open to avoid skipping siblings.
fn walk(root: &std::path::Path) -> Vec<std::path::PathBuf> {
    let mut files = Vec::new();
    let mut stack = vec![root.to_path_buf()];
    while let Some(dir) = stack.pop() {
        let Ok(entries) = std::fs::read_dir(&dir) else {
            continue;
        };
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() {
                stack.push(path);
            } else {
                files.push(path);
            }
        }
    }
    files
}
