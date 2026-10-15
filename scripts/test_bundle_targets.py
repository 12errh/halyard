"""Tests for the bundle-target decision.

This exists because the first beta release failed at the MSI step with an
error about a pre-release identifier nobody on the project had met before. The
fix is a rule; the rule needs a test, or it is a memory instead of a guarantee.

Run with `python3 scripts/test_bundle_targets.py`.
"""

from __future__ import annotations

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from bundle_targets import (  # noqa: E402
    MSI_PRERELEASE_CEILING,
    VersionError,
    main,
    msi_supported,
    parse,
    windows_bundles,
)


class MsiSupport(unittest.TestCase):
    def test_a_final_release_supports_msi(self):
        self.assertTrue(msi_supported("0.1.0"))
        self.assertTrue(msi_supported("1.0.0"))
        self.assertTrue(msi_supported("10.20.30"))

    def test_a_worded_prerelease_does_not(self):
        # The exact case that broke the first beta release.
        self.assertFalse(msi_supported("0.1.0-beta.1"))
        self.assertFalse(msi_supported("1.0.0-rc.2"))

    def test_a_numeric_prerelease_does(self):
        # `0.1.0-1` is just `1.0.0.1` to MSI, so it fits.
        self.assertTrue(msi_supported("0.1.0-1"))
        self.assertTrue(msi_supported("1.2.3-42"))

    def test_a_numeric_prerelease_past_the_ceiling_does_not(self):
        # MSI's fourth field is 16-bit.
        self.assertFalse(msi_supported(f"1.0.0-{MSI_PRERELEASE_CEILING + 1}"))
        self.assertTrue(msi_supported(f"1.0.0-{MSI_PRERELEASE_CEILING}"))

    def test_build_metadata_is_not_a_prerelease(self):
        # `+build.7` does not make it a prerelease, so MSI is fine.
        self.assertTrue(msi_supported("0.1.0+build.7"))

    def test_a_non_numeric_prerelease_with_a_digit_still_does_not(self):
        # `beta1` is not `1`.
        self.assertFalse(msi_supported("1.0.0-beta1"))


class WindowsBundles(unittest.TestCase):
    def test_a_prerelease_ships_nsis_only(self):
        # NSIS is the format the updater installs over, so nothing
        # operationally valuable is lost.
        self.assertEqual(windows_bundles("0.1.0-beta.1"), ["nsis"])

    def test_nsis_is_always_included(self):
        for version in ["0.1.0-beta.1", "1.0.0-rc.1", "0.1.0"]:
            self.assertIn("nsis", windows_bundles(version), version)

    def test_a_final_release_ships_both(self):
        self.assertEqual(windows_bundles("0.1.0"), ["nsis", "msi"])

    def test_the_order_is_stable(self):
        # A manifest built from whatever this returns should not reorder
        # between runs.
        self.assertEqual(windows_bundles("0.1.0"), windows_bundles("0.1.0"))


class Parsing(unittest.TestCase):
    def test_a_plain_version(self):
        self.assertEqual(parse("1.2.3"), (1, 2, 3, None, None))

    def test_a_prerelease(self):
        self.assertEqual(parse("1.2.3-rc.1"), (1, 2, 3, "rc.1", None))

    def test_build_metadata(self):
        self.assertEqual(parse("1.2.3+abc"), (1, 2, 3, None, "abc"))

    def test_surrounding_whitespace_is_tolerated(self):
        self.assertEqual(parse("  1.2.3  "), (1, 2, 3, None, None))

    def test_nonsense_is_rejected(self):
        for bad in ["", "1", "1.2", "1.2.3.4", "v1.2.3", "not-a-version", "1.2.x"]:
            with self.subTest(bad=bad), self.assertRaises(VersionError):
                parse(bad)


class Cli(unittest.TestCase):
    def test_prints_the_windows_list(self):
        self.assertEqual(main(["0.1.0-beta.1"]), 0)

    def test_prints_the_linux_list(self):
        self.assertEqual(main(["0.1.0-beta.1", "--platform", "linux"]), 0)

    def test_a_bad_version_exits_nonzero(self):
        self.assertEqual(main(["nonsense"]), 1)

    def test_output_is_comma_separated_with_no_spaces(self):
        # The workflow passes this straight to `--bundles`.
        import io
        import contextlib

        buffer = io.StringIO()
        with contextlib.redirect_stdout(buffer):
            main(["0.1.0"])
        self.assertEqual(buffer.getvalue().strip(), "nsis,msi")


if __name__ == "__main__":
    unittest.main(verbosity=2)
