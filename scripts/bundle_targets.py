#!/usr/bin/env python3
"""Decide which bundles a given version can actually be built into.

Discovered by trying: the first beta release, `0.1.0-beta.1`, built NSIS fine
and failed MSI with

    optional pre-release identifier in app version must be numeric-only and
    cannot be greater than 65535 for msi target

An MSI carries a four-part numeric ProductVersion. Semver's pre-release part is
a dotted string, so `-beta.1` simply has nowhere to go in `1.0.0.0`. The
bundler refuses rather than silently truncating it, which is the right
behaviour and not something to work around.

So prereleases ship NSIS only. That costs nothing operationally: NSIS is the
format the updater installs over, and MSI exists for managed deployment, which
a beta is not. Final releases get both.

The AppImage and `.deb` are unaffected -- both take a version string -- so this
is a Windows-only constraint.

    python3 scripts/bundle_targets.py 0.1.0-beta.1   # -> nsis
    python3 scripts/bundle_targets.py 0.1.0         # -> nsis,msi
"""

from __future__ import annotations

import argparse
import re
import sys

# Semver with an optional pre-release and build metadata.
SEMVER = re.compile(
    r"^(\d+)\.(\d+)\.(\d+)"
    r"(?:-([0-9A-Za-z.-]+))?"
    r"(?:\+([0-9A-Za-z.-]+))?$"
)

# MSI's fourth component is a 16-bit number, which is the whole ceiling.
MSI_PRERELEASE_CEILING = 65535


class VersionError(Exception):
    """The version cannot be built, and it is not the bundler's fault."""


def parse(version: str) -> tuple[int, int, int, str | None, str | None]:
    match = SEMVER.match(version.strip())
    if not match:
        raise VersionError(f"{version!r} is not a semantic version")
    major, minor, patch, prerelease, build = match.groups()
    return int(major), int(minor), int(patch), prerelease, build


def msi_supported(version: str) -> bool:
    """Whether this version can be expressed as an MSI ProductVersion."""
    _, _, _, prerelease, _ = parse(version)
    if prerelease is None:
        return True
    # A purely numeric pre-release, e.g. `0.1.0-1`, is just the fourth field.
    if prerelease.isdigit():
        return int(prerelease) <= MSI_PRERELEASE_CEILING
    return False


def windows_bundles(version: str) -> list[str]:
    return ["nsis", "msi"] if msi_supported(version) else ["nsis"]


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("version", help="version from tauri.conf.json")
    parser.add_argument(
        "--platform",
        choices=["windows", "linux"],
        default="windows",
        help="which platform's bundle list to print",
    )
    args = parser.parse_args(argv)

    try:
        if args.platform == "windows":
            bundles = windows_bundles(args.version)
        else:
            # AppImage, deb and rpm all take the version as a string.
            parse(args.version)
            bundles = ["appimage", "deb", "rpm"]
    except VersionError as error:
        print(f"::error::{error}", file=sys.stderr)
        return 1

    print(",".join(bundles))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
