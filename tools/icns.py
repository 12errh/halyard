"""
Build an ICNS container from PNG files.

ImageMagick here has no ICNS writer, and the format is simple enough to emit
directly: a magic word, a total length, then length-prefixed chunks. macOS
accepts PNG payloads directly in the modern chunk types, so no bitmap
encoding is needed.

Usage: icns.py OUT.icns SIZE.png [SIZE.png ...]
"""

import struct
import sys
from pathlib import Path

# Chunk type per pixel size. These are the types that carry PNG payloads.
CHUNK = {
    16: b"ic04",
    32: b"ic05",
    64: b"ic11",
    128: b"ic07",
    256: b"ic08",
    512: b"ic09",
    1024: b"ic14",
}


def build(out: Path, pngs: list[Path]) -> None:
    chunks = b""
    for png in pngs:
        size = int(png.stem.split("x")[0])
        if size not in CHUNK:
            raise SystemExit(f"no chunk type for {size}px")
        data = png.read_bytes()
        # Length covers the 8-byte chunk header as well as the payload.
        chunks += CHUNK[size] + struct.pack(">I", len(data) + 8) + data

    total = len(chunks) + 8
    out.write_bytes(b"icns" + struct.pack(">I", total) + chunks)


if __name__ == "__main__":
    args = sys.argv[1:]
    if len(args) < 2:
        raise SystemExit(__doc__)
    build(Path(args[0]), [Path(a) for a in args[1:]])
