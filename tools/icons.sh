#!/usr/bin/env bash
# Regenerate the Halyard icon set from the vector source.
#
# Single source of truth: tools/logo.py draws the mark, this turns it into
# every format the bundler and the OS ask for. Run it after changing the
# geometry, then commit the result under src-tauri/icons.
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

python3 "$root/tools/logo.py" --out "$work" >/dev/null
python3 "$root/tools/wordmark.py" --out "$work" >/dev/null

sizes=(16 32 48 64 128 256 512 1024)
node "$root/tools/rasterize.mjs" "$work/app-icon-dark.svg" "$work" "${sizes[@]}" >/dev/null
# The tray icon is the mark on the graphite plate at tray sizes, rasterised from
# the vector rather than resampled from the 512 app icon.
tray_sizes=(22 32 48 64)
node "$root/tools/rasterize.mjs" "$work/app-icon-dark.svg" "$work" "${tray_sizes[@]}" >/dev/null

icons="$root/src-tauri/icons"
rm -f "$icons"/*.png "$icons"/*.ico "$icons"/*.icns
# Tauri's bundler looks these up by exact name.
cp "$work/16.png"  "$icons/32x32.png"
cp "$work/32.png"  "$icons/128x128.png"
cp "$work/256.png" "$icons/128x128@2x.png"
cp "$work/512.png" "$icons/icon.png"
for s in "${sizes[@]}"; do cp "$work/$s.png" "$icons/$s.png"; done

convert "$work/16.png" "$work/32.png" "$work/48.png" "$work/64.png" \
        "$work/128.png" "$work/256.png" "$icons/icon.ico"
python3 "$root/tools/icns.py" "$icons/icon.icns" \
        "$work/16.png" "$work/32.png" "$work/128.png" "$work/256.png" "$work/512.png" "$work/1024.png"

# Keep the vectors next to the raster so the tray icon and the in-app mark come
# from the same file rather than drifting apart, and ship the wordmark beside
# them for anyone embedding the lockup.
cp "$work/mark.svg" "$work/mark-mono.svg" "$work/tray.svg" "$root/src-tauri/icons/"
cp "$work/wordmark-on-dark.svg" "$work/wordmark-on-light.svg" \
   "$work/wordmark-mono-white.svg" "$work/wordmark-mono-black.svg" \
   "$work/lockup-on-dark.svg" "$work/lockup-on-light.svg" \
   "$work/lockup-mono-white.svg" "$work/lockup-mono-black.svg" "$root/src-tauri/icons/"

# tray.png must be the plate version, so it is copied from its own raster pass
# rather than left over from the app-icon pass that shares those filenames.
cp "$work/22.png" "$icons/tray.png"

# The same vectors, for docs.
cp "$work/mark.svg" "$work/mark-mono.svg" "$work/app-icon-dark.svg" \
   "$work/app-icon-light.svg" "$work/lockup-on-dark.svg" \
   "$work/lockup-on-light.svg" "$work/wordmark-on-dark.svg" \
   "$work/wordmark-on-light.svg" "$root/docs/"
echo "icons written to $icons"

