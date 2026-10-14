"""
Halyard's wordmark, as geometry.

A custom geometric sans, not a font. Two rules hold the whole word together,
and both come from the mark:

  1. Every horizontal band is a parallelogram whose top and bottom edges rise
     to the right at the mark's own angle (tan of the isometric shear). That is
     the same cut as the mark's crossbar, so the word leans the way the symbol
     leans.
  2. Every other edge is vertical or follows the band cuts. Nothing else is
     allowed in.

The wordmark itself is drawn flat and level — the slant lives inside each
letter rather than running the length of the word — so it stays legible at the
14px the title bar uses, and it still works as one colour on any background.

Run with `--preview` to rasterise it for review.
"""

import argparse
import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).parent))

import logo  # noqa: E402

GRAPHITE = logo.GRAPHITE
MINT = logo.MINT
SOFT_WHITE = logo.SOFT_WHITE
WHITE = "#FFFFFF"
BLACK = "#000000"

CAP = 100.0        # cap height; every letter is measured against this
STROKE = 22.0      # stem width
TRACKING = 20.0    # space between letters
SLANT = 0.4598     # rise per unit run of a band cut; the mark's 24.7 degrees


def rect(x0: float, x1: float, y0: float, y1: float) -> list[tuple[float, float]]:
    """Plain rectangle — the stems, which hold the level cap line and baseline."""
    return [(x0, y0), (x0, y1), (x1, y1), (x1, y0)]


def bar(x0: float, x1: float, y0: float, y1: float) -> list[tuple[float, float]]:
    """
    Horizontal band with the mark's cut.

    The left edge sits exactly on y0..y1 and the right edge is lifted by the
    band's own height at the mark's angle, so the cut is the shape of the
    mark's crossbar. Bands overshoot the cap line on the right by design — the
    word leans the way the symbol leans — so the wordmark's bounds are measured
    from the drawn geometry rather than assumed.
    """
    rise = (y1 - y0) * SLANT
    return [(x0, y0), (x0, y1), (x1, y1 - rise), (x1, y0 - rise)]


def band(x0b: float, x1b: float, x0t: float, x1t: float, yb: float, yt: float):
    """Diagonal band: a horizontal cut at each end, tapering as it rises."""
    return [(x0b, yb), (x1b, yb), (x1t, yt), (x0t, yt)]


# Each glyph is (advance width, shapes). Shapes are drawn as separate paths so
# that where they overlap they union rather than cancel — with one shared fill
# rule, oppositely wound subpaths punch holes in each other.
GLYPHS: dict[str, tuple[float, list]] = {
    "H": (58.0, [
        rect(0, STROKE, 0, CAP),
        rect(36, 58, 0, CAP),
        bar(0, 58, 39, 61),
    ]),
    "A": (68.0, [
        # Pointed apex: both legs' inner edges land on x=38 at the cap line, so
        # the counter is a full-height triangle instead of a notch.
        band(0, 22, 28, 38, CAP, 0),
        band(46, 68, 38, 48, CAP, 0),
        bar(24, 48, 62, 84),                          # the fold, low enough to keep
    ]),                                               # the counter open above it
    "L": (52.0, [
        rect(0, STROKE, 0, CAP),
        bar(0, 52, 78, 100),
    ]),
    "Y": (66.0, [
        band(0, 22, 22, 44, 0, 52),                   # left arm, falling to the join
        band(44, 66, 22, 44, 0, 52),                  # right arm
        rect(22, 44, 52, CAP),
    ]),
    "R": (64.0, [
        rect(0, STROKE, 0, CAP),
        bar(0, 64, 0, STROKE),                        # top of the bowl
        rect(42, 64, 0, 62),
        bar(0, 64, 40, 62),                           # the fold the leg springs from
        band(40, 62, 22, 44, CAP, 62),                # leg
    ]),
    "D": (66.0, [
        rect(0, STROKE, 0, CAP),
        bar(0, 66, 0, STROKE),
        bar(0, 66, 78, 100),
        rect(44, 66, 0, CAP),
    ]),
}


def layout(word: str = "HALYARD") -> tuple[list[list[tuple[float, float]]], float]:
    """Return the word's shapes, offset into place, plus its total width."""
    x = 0.0
    shapes: list[list[tuple[float, float]]] = []
    for i, ch in enumerate(word):
        width, glyph = GLYPHS[ch]
        for pts in glyph:
            shapes.append([(x + px, py) for px, py in pts])
        x += width
        if i != len(word) - 1:
            x += TRACKING
    return shapes, x


def to_path(pts: list[tuple[float, float]]) -> str:
    return " ".join(
        f"{'M' if i == 0 else 'L'}{x:.2f} {y:.2f}" for i, (x, y) in enumerate(pts)
    ) + "Z"


def frame(shapes, pad: float = 0.0) -> tuple[float, float, float, float]:
    """x, y, width, height of everything actually drawn."""
    xs = [p[0] for s in shapes for p in s]
    ys = [p[1] for s in shapes for p in s]
    return (
        min(xs) - pad,
        min(ys) - pad,
        max(xs) - min(xs) + 2 * pad,
        max(ys) - min(ys) + 2 * pad,
    )


def view(shapes, pad: float = 0.0) -> str:
    x, y, w, h = frame(shapes, pad)
    return f"{x:.2f} {y:.2f} {w:.2f} {h:.2f}"


def wordmark(fill: str, word: str = "HALYARD") -> str:
    shapes, width = layout(word)
    _, _, _, height = frame(shapes)
    body = "\n  ".join(f'<path d="{to_path(s)}"/>' for s in shapes)
    return f"""<svg xmlns="http://www.w3.org/2000/svg" viewBox="{view(shapes)}" width="{width:.0f}" height="{height:.0f}">
  <title>Halyard</title>
  <g fill="{fill}">
  {body}
  </g>
</svg>
"""


def lockup(word_fill: str, mark: str = "mark", gap: float = 34.0) -> str:
    """
    The combination mark: symbol, then wordmark.

    Both are aligned on what they actually draw, not on their nominal boxes —
    the mark's shear pushes its top corner above its own viewBox, and the word's
    bands overshoot the cap line by the same reason. Scaling to the shared
    drawn height is what keeps the two optically level.
    """
    shapes, word_w = layout()
    wx, wy, _, wh = frame(shapes)

    if mark == "mark":
        symbol = logo.build()
    elif mark == "mono":
        symbol = logo.monochrome()
    else:
        raise ValueError(mark)

    min_x, min_y, max_x, max_y = logo.bounds()
    scale = wh / (max_y - min_y)
    symbol_w = (max_x - min_x) * scale
    symbol_y = wy - min_y * scale

    total_w = symbol_w + gap + word_w
    pad = logo.PAD
    body = "\n  ".join(
        f'<path transform="translate({symbol_w + gap:.2f} 0)" d="{to_path(s)}"/>'
        for s in shapes
    )
    inner = symbol[symbol.index(">") + 1: symbol.rindex("</svg>")]

    return f"""<svg xmlns="http://www.w3.org/2000/svg" viewBox="{-pad:.2f} {wy - pad:.2f} {total_w + 2 * pad:.2f} {wh + 2 * pad:.2f}" width="{total_w + 2 * pad:.0f}" height="{wh + 2 * pad:.0f}">
  <title>Halyard</title>
  <g transform="translate(0 {symbol_y:.2f}) scale({scale:.4f})">{inner}</g>
  <g fill="{word_fill}">
  {body}
  </g>
</svg>
"""



PREVIEW = """<!doctype html><meta charset=utf-8>
<style>
  body{{margin:0;background:#0d0e10;font:12px ui-monospace,monospace;color:#8b8f96;
       display:grid;gap:16px;padding:22px}}
  .row{{display:flex;flex-direction:column;gap:10px;padding:18px;border-radius:14px}}
  .dark{{background:{GRAPHITE}}}
  .light{{background:{SOFT_WHITE}}}
  h4{{margin:0;font-size:10px;letter-spacing:.14em;text-transform:uppercase;font-weight:500}}
</style>
<div class="row dark"><h4>lockup · mint mark, soft white word</h4>{LOCKUP_DARK}</div>
<div class="row light"><h4>lockup · graphite, for light surfaces</h4>{LOCKUP_LIGHT}</div>
<div class="row" style="background:#000"><h4>lockup · pure white</h4>{LOCKUP_WHITE}</div>
<div class="row" style="background:#fff"><h4>lockup · pure black</h4>{LOCKUP_BLACK}</div>
<div class="row dark"><h4>wordmark alone</h4>{WORD}</div>
<div class="row dark"><h4>title bar size · 14px cap</h4>{WORD_14}</div>
<div class="row dark"><h4>small · 9px cap</h4>{WORD_9}</div>
<div class="row dark"><h4>lockup · title bar size</h4>{LOCKUP_14}</div>
"""


def sized(svg: str, height: int) -> str:
    """Re-emit an SVG at a fixed height so the browser cannot rescale it."""
    w = float(svg.split('width="')[1].split('"')[0])
    h = float(svg.split('height="')[1].split('"')[0])
    scale = height / h
    return (
        svg.replace(f'width="{w:.0f}"', f'width="{w * scale:.1f}"', 1)
        .replace(f'height="{h:.0f}"', f'height="{height}"', 1)
    )



def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--preview", action="store_true")
    parser.add_argument("--out", default="/tmp/opencode/wordmark")
    args = parser.parse_args()

    out = pathlib.Path(args.out)
    out.mkdir(parents=True, exist_ok=True)

    (out / "wordmark-on-dark.svg").write_text(wordmark(SOFT_WHITE))
    (out / "wordmark-on-light.svg").write_text(wordmark(GRAPHITE))
    (out / "wordmark-mono-white.svg").write_text(wordmark(WHITE))
    (out / "wordmark-mono-black.svg").write_text(wordmark(BLACK))
    (out / "lockup-on-dark.svg").write_text(lockup(SOFT_WHITE, "mark"))
    (out / "lockup-on-light.svg").write_text(lockup(GRAPHITE, "mono"))
    (out / "lockup-mono-white.svg").write_text(lockup(WHITE, "mono"))
    (out / "lockup-mono-black.svg").write_text(lockup(BLACK, "mono"))

    if args.preview:
        html = (
            PREVIEW.replace("{LOCKUP_DARK}", lockup(SOFT_WHITE, "mark"))
            .replace("{LOCKUP_LIGHT}", lockup(GRAPHITE, "mono"))
            .replace("{LOCKUP_WHITE}", lockup(WHITE, "mono"))
            .replace("{LOCKUP_BLACK}", lockup(BLACK, "mono"))
            .replace("{WORD}", wordmark(SOFT_WHITE))
            .replace("{WORD_14}", sized(wordmark(SOFT_WHITE), 14))
            .replace("{WORD_9}", sized(wordmark(SOFT_WHITE), 9))
            .replace("{LOCKUP_14}", sized(lockup(SOFT_WHITE, "mark"), 14))
        )
        (out / "preview.html").write_text(html)
        print(out / "preview.html")


if __name__ == "__main__":
    main()
