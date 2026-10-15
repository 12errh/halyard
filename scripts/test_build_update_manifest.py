"""Tests for the updater manifest builder.

This script is the difference between "the build succeeded" and "people can
update". It runs only in the release job, on a machine nobody is watching, so
every mistake here ships silently. The cases below are the ones that produce a
manifest which looks fine and installs nothing.

Run with `python3 scripts/test_build_update_manifest.py`.
"""

from __future__ import annotations

import json
from contextlib import contextmanager
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from build_update_manifest import (  # noqa: E402
    ManifestError,
    architecture_of,
    build,
    collect,
    main,
    platform_of,
    release_url,
)

APPIMAGE = "Halyard_0.2.0_amd64.AppImage"
NSIS = "Halyard_0.2.0_x64-setup.exe"
DEB = "Halyard_0.2.0_amd64.deb"
RPM = "halyard-0.2.0-1.x86_64.rpm"
MSI = "Halyard_0.2.0_x64_en-US.msi"


@contextmanager
def bundles_with(*names: str, signature: str | None = "c2ln"):
    """A bundle directory holding each named file, signed unless `signature` is None."""
    with tempfile.TemporaryDirectory() as tmp:
        root = Path(tmp)
        for name in names:
            artifact = root / name
            artifact.parent.mkdir(parents=True, exist_ok=True)
            artifact.write_bytes(b"artifact bytes")
            if signature is not None:
                artifact.with_name(name + ".sig").write_text(signature, encoding="utf-8")
        yield root


class Architecture(unittest.TestCase):
    def test_amd64_and_x64_are_both_x86_64(self):
        # Tauri uses both spellings depending on the target; the manifest must
        # agree, or Linux and Windows get different platform keys for one arch.
        self.assertEqual(architecture_of(APPIMAGE), "x86_64")
        self.assertEqual(architecture_of(NSIS), "x86_64")

    def test_aarch64_and_arm64_are_both_aarch64(self):
        self.assertEqual(architecture_of("Halyard_0.2.0_aarch64.AppImage"), "aarch64")
        self.assertEqual(architecture_of("Halyard_0.2.0_arm64-setup.exe"), "aarch64")

    def test_an_unknown_architecture_is_refused(self):
        # Guessing would ship an aarch64 build to every x86_64 user.
        with self.assertRaises(ManifestError):
            architecture_of("Halyard_0.2.0_mips.AppImage")

    def test_platform_comes_from_the_extension(self):
        self.assertEqual(platform_of(APPIMAGE), "linux")
        self.assertEqual(platform_of(NSIS), "windows")

    def test_deb_is_not_an_updater_platform(self):
        with self.assertRaises(ManifestError):
            platform_of(DEB)


class Collection(unittest.TestCase):
    def test_finds_both_platforms(self):
        with bundles_with(APPIMAGE, NSIS) as root:
            found = {p.name for p, _ in collect(root)}
            self.assertEqual(found, {APPIMAGE, NSIS})

    def test_deb_rpm_and_msi_are_left_out(self):
        # The whole point: the updater cannot install these, and offering them
        # produces a download that fails at install time.
        with bundles_with(APPIMAGE, NSIS, DEB, RPM, MSI) as root:
            found = {p.name for p, _ in collect(root)}
            self.assertNotIn(DEB, found)
            self.assertNotIn(RPM, found)
            self.assertNotIn(MSI, found)

    def test_an_unsigned_artifact_is_refused(self):
        # Listing it would give every user an update that cannot install.
        with bundles_with(APPIMAGE, signature=None) as root:
            with self.assertRaises(ManifestError) as caught:
                collect(root)
            self.assertIn("no signature", str(caught.exception))

    def test_no_artifacts_is_an_error(self):
        with tempfile.TemporaryDirectory() as root:
            with self.assertRaises(ManifestError) as caught:
                collect(Path(root))
            self.assertIn("no updater-installable artifacts", str(caught.exception))

    def test_two_artifacts_for_one_platform_are_refused(self):
        # Ambiguity here means the manifest silently picks one.
        with bundles_with(APPIMAGE, "Halyard_0.2.0_x86_64.AppImage") as root:
            with self.assertRaises(ManifestError) as caught:
                collect(root)
            self.assertIn("cannot choose", str(caught.exception))

    def test_nested_directories_are_searched(self):
        # CI downloads artifacts into per-platform subdirectories.
        with tempfile.TemporaryDirectory() as root:
            nested = Path(root) / "appimage"
            nested.mkdir()
            (nested / APPIMAGE).write_bytes(b"x")
            (nested / f"{APPIMAGE}.sig").write_text("c2ln", encoding="utf-8")
            self.assertEqual(len(collect(Path(root))), 1)

    def test_a_signature_is_not_itself_an_artifact(self):
        with bundles_with(APPIMAGE) as root:
            for path, _ in collect(root):
                self.assertNotEqual(path.suffix, ".sig")


class Manifest(unittest.TestCase):
    def test_both_platforms_are_present(self):
        with bundles_with(APPIMAGE, NSIS) as root:
            manifest = build(root, "v0.2.0", "0.2.0")
        self.assertEqual(
            sorted(manifest["platforms"]), ["linux-x86_64", "windows-x86_64"]
        )

    def test_the_version_is_the_one_we_asked_for(self):
        with bundles_with(APPIMAGE) as root:
            self.assertEqual(build(root, "v0.2.0", "0.2.0")["version"], "0.2.0")

    def test_entries_carry_the_release_version(self):
        with bundles_with(APPIMAGE, NSIS) as root:
            manifest = build(root, "v0.2.0", "0.2.0")
        for entries in manifest["platforms"].values():
            for entry in entries.values():
                self.assertEqual(entry["version"], "0.2.0")

    def test_urls_are_absolute_and_tagged(self):
        with bundles_with(APPIMAGE, NSIS) as root:
            manifest = build(root, "v0.2.0", "0.2.0")
        for entries in manifest["platforms"].values():
            for entry in entries.values():
                self.assertTrue(entry["url"].startswith("https://"), entry["url"])
                self.assertIn("/v0.2.0/", entry["url"])

    def test_the_appimage_url_names_the_appimage(self):
        with bundles_with(APPIMAGE) as root:
            manifest = build(root, "v0.2.0", "0.2.0")
        url = manifest["platforms"]["linux-x86_64"]["x86_64"]["url"]
        self.assertEqual(url, release_url("v0.2.0", APPIMAGE))

    def test_signatures_are_carried_through_verbatim(self):
        # The updater compares these byte for byte; trimming or re-wrapping
        # would make every update fail verification.
        with bundles_with(APPIMAGE, signature="  c2ln  ") as root:
            manifest = build(root, "v0.2.0", "0.2.0")
        entry = manifest["platforms"]["linux-x86_64"]["x86_64"]
        self.assertEqual(entry["signature"], "c2ln")

    def test_an_empty_signature_is_refused(self):
        with bundles_with(APPIMAGE, signature="") as root:
            with self.assertRaises(ManifestError):
                build(root, "v0.2.0", "0.2.0")

    def test_pub_date_is_iso8601_utc(self):
        with bundles_with(APPIMAGE) as root:
            manifest = build(root, "v0.2.0", "0.2.0", pub_date="2026-02-01T00:00:00Z")
        self.assertEqual(manifest["pub_date"], "2026-02-01T00:00:00Z")

    def test_pub_date_is_generated_when_not_given(self):
        with bundles_with(APPIMAGE) as root:
            manifest = build(root, "v0.2.0", "0.2.0")
        self.assertTrue(manifest["pub_date"].endswith("Z"))
        self.assertRegex(manifest["pub_date"], r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$")

    def test_notes_pass_through(self):
        with bundles_with(APPIMAGE) as root:
            manifest = build(root, "v0.2.0", "0.2.0", notes="Fixes things")
        self.assertEqual(manifest["notes"], "Fixes things")

    def test_the_manifest_is_json_serialisable(self):
        with bundles_with(APPIMAGE, NSIS) as root:
            manifest = build(root, "v0.2.0", "0.2.0")
        self.assertIn("platforms", json.loads(json.dumps(manifest)))

    def test_an_empty_tag_is_refused(self):
        # The first beta release shipped `"version": ""` and a URL containing
        # `//`, because the publish job did not depend on the job producing
        # them and GitHub resolved the missing output to an empty string. The
        # version check then compared empty against empty and passed, so
        # nothing caught it. An empty tag is always a wiring mistake.
        with bundles_with(APPIMAGE) as root:
            with self.assertRaises(ManifestError) as caught:
                build(root, "", "0.2.0")
            self.assertIn("tag is empty", str(caught.exception))

    def test_an_empty_version_is_refused(self):
        with bundles_with(APPIMAGE) as root:
            with self.assertRaises(ManifestError) as caught:
                build(root, "v0.2.0", "")
            self.assertIn("version is empty", str(caught.exception))

    def test_whitespace_is_not_a_value_either(self):
        with bundles_with(APPIMAGE) as root:
            with self.assertRaises(ManifestError):
                build(root, "   ", "0.2.0")
            with self.assertRaises(ManifestError):
                build(root, "v0.2.0", "  ")

    def test_a_linux_only_run_still_produces_a_usable_manifest(self):
        # One platform failing should not stop the other from publishing.
        with bundles_with(APPIMAGE) as root:
            manifest = build(root, "v0.2.0", "0.2.0")
        self.assertEqual(list(manifest["platforms"]), ["linux-x86_64"])


class Cli(unittest.TestCase):
    def test_writes_the_file_and_reports(self):
        with bundles_with(APPIMAGE, NSIS) as root:
            out = root / "latest.json"
            code = main([str(root), "--tag", "v0.2.0", "--version", "0.2.0", "--out", str(out)])
            self.assertEqual(code, 0)
            self.assertIn("linux-x86_64", json.loads(out.read_text())["platforms"])

    def test_an_unusable_input_exits_nonzero_and_writes_nothing(self):
        # A half-written manifest that the release job then uploads is worse
        # than no manifest: the updater would fetch something that installs
        # nothing, with no visible error.
        with bundles_with(APPIMAGE, signature=None) as root:
            out = root / "latest.json"
            code = main([str(root), "--tag", "v0.2.0", "--version", "0.2.0", "--out", str(out)])
            self.assertEqual(code, 1)
            self.assertFalse(out.exists())


if __name__ == "__main__":
    unittest.main(verbosity=2)
