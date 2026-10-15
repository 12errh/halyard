#!/usr/bin/env python3
"""Build the `latest.json` the updater endpoint serves.

Two facts drive this file, both established by building and reading the output
rather than by reading documentation:

1. **`tauri build` does not write `latest.json`.** It writes a `.sig` next to
   every artifact it signs and nothing else. The manifest is ours to build.

2. **Only AppImage and NSIS can be installed by the updater.** The plugin's
   Linux path writes the download to a temp `current_app.AppImage` and swaps it
   over the running executable, checking that it landed on the same filesystem.
   There is no `dpkg` path, so listing a `.deb` would download it and then try
   to run a Debian archive as an AppImage. `.deb` and `.rpm` ship as release
   downloads for people updating through their package manager -- which needs
   root, and which the app explains rather than automating.

   This is the whole reason the two platforms are not symmetric, and why the
   app tells a `.deb` user where updates come from instead of showing a button
   that would fail.

Given a directory of built bundles, this discovers the updater-capable
artifacts, pairs each with its signature, and writes a manifest whose download
URLs are absolute and pinned to the release tag.

    python3 scripts/build_update_manifest.py bundles \\
        --tag v0.1.0 --version 0.1.0 --out latest.json
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

REPO = "12errh/halyard"
DOWNLOAD_BASE = f"https://github.com/{REPO}/releases/download"

# Filename fragment -> Tauri's target triple component. Tauri names bundles
# after the architecture it targeted; guessing from the extension alone would
# silently mislabel an aarch64 build as x86_64 and ship it to the wrong users.
ARCHITECTURES = {
    "amd64": "x86_64",
    "x64": "x86_64",
    "x86_64": "x86_64",
    "aarch64": "aarch64",
    "arm64": "aarch64",
    "i686": "i686",
    "i386": "i686",
    "armv7": "armv7",
}

# Only these two are updater-installable. Everything else is a download.
UPDATABLE_SUFFIXES = {".appimage": "linux", ".exe": "windows"}


class ManifestError(Exception):
    """The inputs cannot produce a manifest anyone should install from."""


def architecture_of(filename: str) -> str:
    stem = Path(filename).stem
    for fragment, triple in ARCHITECTURES.items():
        if re.search(rf"(^|[_-]){fragment}([_-]|$)", stem, re.IGNORECASE):
            return triple
    raise ManifestError(
        f"cannot tell the architecture from {filename!r}; "
        f"expected one of {', '.join(sorted(ARCHITECTURES))}"
    )


def platform_of(filename: str) -> str:
    """The OS half, from the file extension. Ties to `UPDATABLE_SUFFIXES`."""
    suffix = Path(filename).suffix.lower()
    for extension, platform in UPDATABLE_SUFFIXES.items():
        if suffix == extension:
            return platform
    raise ManifestError(f"{filename!r} is not an updater-installable artifact")


def release_url(tag: str, filename: str) -> str:
    return f"{DOWNLOAD_BASE}/{tag}/{filename}"


def collect(bundles: Path) -> list[tuple[Path, Path]]:
    """Pair every updater-capable artifact with its signature.

    Raises on an unsigned artifact rather than skipping it: an artifact with no
    signature is one the updater will refuse, so listing it only turns a
    working update into a failed one at the user's machine.
    """
    pairs: list[tuple[Path, Path]] = []
    seen: set[tuple[str, str]] = set()

    for path in sorted(bundles.rglob("*")):
        if not path.is_file() or path.suffix.lower() == ".sig":
            continue
        if path.suffix.lower() not in UPDATABLE_SUFFIXES:
            continue

        signature = path.with_name(path.name + ".sig")
        if not signature.is_file():
            raise ManifestError(
                f"{path.name} has no signature; the updater would refuse to "
                f"install it. Expected {signature.name} beside it."
            )

        key = (platform_of(path.name), architecture_of(path.name))
        if key in seen:
            raise ManifestError(
                f"two artifacts claim {key[0]}-{key[1]}; the manifest cannot "
                f"choose between them"
            )
        seen.add(key)
        pairs.append((path, signature))

    if not pairs:
        raise ManifestError(
            f"no updater-installable artifacts under {bundles} "
            f"(looked for {', '.join(sorted(UPDATABLE_SUFFIXES))} with a .sig)"
        )

    return pairs


def build(
    bundles: Path,
    tag: str,
    version: str,
    notes: str = "",
    pub_date: str | None = None,
) -> dict[str, Any]:
    manifest: dict[str, Any] = {
        "version": version,
        "notes": notes,
        "pub_date": pub_date or datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "platforms": {},
    }

    for artifact, signature_path in collect(bundles):
        platform = platform_of(artifact.name)
        architecture = architecture_of(artifact.name)
        signature = signature_path.read_text(encoding="utf-8").strip()
        if not signature:
            raise ManifestError(f"{signature_path.name} is empty")

        manifest["platforms"].setdefault(f"{platform}-{architecture}", {})[architecture] = {
            "signature": signature,
            "url": release_url(tag, artifact.name),
            "version": version,
        }

    return manifest


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("bundles", type=Path, help="directory of built bundles")
    parser.add_argument("--tag", required=True, help="release tag, e.g. v0.1.0")
    parser.add_argument("--version", required=True, help="version, e.g. 0.1.0")
    parser.add_argument("--out", type=Path, required=True, help="where to write latest.json")
    parser.add_argument("--notes", default="", help="release notes shown in the update prompt")
    args = parser.parse_args(argv)

    try:
        manifest = build(args.bundles, args.tag, args.version, args.notes)
    except ManifestError as error:
        print(f"::error::{error}", file=sys.stderr)
        return 1

    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")

    print(f"wrote {args.out} for {args.version}")
    for name, entries in sorted(manifest["platforms"].items()):
        for target, entry in entries.items():
            print(f"  {name}/{target} -> {Path(entry['url']).name}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
