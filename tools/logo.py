"""
Halyard's mark, as geometry.

An isometric H built from sheared parallelograms. Each stroke is split along
its centre line into two facets meeting at a fold, so the mark reads as a
folded ribbon rather than a flat letter — and so it still reads as an H when
every facet collapses to one colour.

Run with `--preview` to rasterise it for review.
"""

import argparse
import math
import pathlib

# Brand palette.
GRAPHITE = "#17191D"
MINT = "#83E1C1"
MINT_DEEP = "#35A184"
MINT_DARK = "#1F6350"
SOFT_WHITE = "#F4F4F0"

SHEAR_ANGLE = 24.7      # degrees; the cut every horizontal band is made on
SHEAR = math.tan(math.radians(SHEAR_ANGLE))  # rise per unit run
POST_W = 27.0         # post width in unsheared units
POST_H = 84.0
GAP = 19.0
BAR_H = 22.0
PAD = 6.0             # breathing room around the drawn bounds


def shear(x: float, y: float) -> tuple[float, float]:
    """Apply the isometric shear, with the baseline pinned to the origin."""
    return x, y - SHEAR * x


def poly(points, **attrs) -> str:
    d = " ".join(f"{'M' if i == 0 else 'L'}{shear(x, y)[0]:.2f} {shear(x, y)[1]:.2f}" for i, (x, y) in enumerate(points))
    a = " ".join(f'{k.replace("_", "-")}="{v}"' for k, v in attrs.items())
    return f"<path d=\"{d}Z\" {a}/>"


def facet(stroke, fold) -> list[str]:
    """
    Split a stroke into two facets along `fold` (a fraction across it).

    The left facet catches the light and stays close to the mint; the right
    falls away. That is the whole illusion — two values, one fold.
    """
    x0, x1, y0, y1 = stroke
    fx = x0 + (x1 - x0) * fold
    left = poly([(x0, y0), (fx, y0), (fx, y1), (x0, y1)], fill="url(#lit)")
    right = poly([(fx, y0), (x1, y0), (x1, y1), (fx, y1)], fill="url(#shade)")
    # A hairline along the top of each stroke reads as the light catching the
    # fold, and keeps the silhouette crisp at 16px.
    edge = poly([(x0, y0), (x1, y0), (x1, y0 + 2.2), (x0, y0 + 2.2)], fill="url(#edge)")
    return [left, right, edge]


def bounds() -> tuple[float, float, float, float]:
    """
    The mark's drawn bounds, after the shear.

    The strokes span x from the left post's edge to the right post's, and y over
    the full post height, so the nominal box sheared at its own corners is the
    real extent — the crossbar sits inside both ranges.
    """
    left_x1 = 14.0 + POST_W
    right_x0 = left_x1 + GAP
    right_x1 = right_x0 + POST_W
    top, bottom = 12.0, 12.0 + POST_H
    pts = [(14.0, top), (right_x1, top), (14.0, bottom), (right_x1, bottom)]
    sheared = [shear(x, y) for x, y in pts]
    xs = [p[0] for p in sheared]
    ys = [p[1] for p in sheared]
    return min(xs), min(ys), max(xs), max(ys)


def frame(pad: float = PAD) -> str:
    """
    viewBox for the mark on its own.

    It has to come from the sheared geometry. The shear lifts the right-hand
    side of every stroke above the nominal top, so a viewBox measured in the
    unsheared box crops the top off the right post — which is exactly what it
    used to do.
    """
    min_x, min_y, max_x, max_y = bounds()
    return (
        f"{min_x - pad:.2f} {min_y - pad:.2f} "
        f"{max_x - min_x + 2 * pad:.2f} {max_y - min_y + 2 * pad:.2f}"
    )


def build() -> str:
    left_x0, left_x1 = 14.0, 14.0 + POST_W
    right_x0 = left_x1 + GAP
    right_x1 = right_x0 + POST_W
    bar_x0, bar_x1 = left_x0, right_x1
    top = 12.0
    bottom = top + POST_H
    bar_y0 = top + (POST_H - BAR_H) / 2
    bar_y1 = bar_y0 + BAR_H

    parts: list[str] = []

    # Posts first, crossbar on top so it reads as passing in front.
    parts += facet((left_x0, left_x1, top, bottom), 0.52)
    parts += facet((right_x0, right_x1, top, bottom), 0.52)
    parts += facet((bar_x0, bar_x1, bar_y0, bar_y1), 0.42)

    body = "\n    ".join(parts)
    box = frame()

    return f"""<svg xmlns="http://www.w3.org/2000/svg" viewBox="{box}" preserveAspectRatio="xMidYMid meet">
  <title>Halyard</title>
  <defs>
    <linearGradient id="lit" x1="0" y1="0" x2="0.25" y2="1">
      <stop offset="0" stop-color="{MINT}"/>
      <stop offset="0.55" stop-color="#63D2AE"/>
      <stop offset="1" stop-color="{MINT_DEEP}"/>
    </linearGradient>
    <linearGradient id="shade" x1="0" y1="0" x2="0.55" y2="1">
      <stop offset="0" stop-color="#2E8E74"/>
      <stop offset="1" stop-color="{MINT_DARK}"/>
    </linearGradient>
    <linearGradient id="edge" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="#BDF3E0"/>
      <stop offset="1" stop-color="#7BD9B8"/>
    </linearGradient>
  </defs>
  {body}
</svg>
"""


def monochrome() -> str:
    """One-colour version, for monochrome contexts and stencils."""
    left_x0, left_x1 = 14.0, 14.0 + POST_W
    right_x0 = left_x1 + GAP
    right_x1 = right_x0 + POST_W
    top = 12.0
    bottom = top + POST_H
    bar_y0 = top + (POST_H - BAR_H) / 2
    bar_y1 = bar_y0 + BAR_H

    def flat(x0, x1, y0, y1):
        return poly([(x0, y0), (x1, y0), (x1, y1), (x0, y1)], fill="currentColor")

    return f"""<svg xmlns="http://www.w3.org/2000/svg" viewBox="{frame()}" preserveAspectRatio="xMidYMid meet">
  <title>Halyard</title>
  {flat(left_x0, left_x1, top, bottom)}
  {flat(right_x0, right_x1, top, bottom)}
  {flat(left_x0, right_x1, bar_y0, bar_y1)}
</svg>
"""


def post_path(x0, x1, y0, y1) -> str:
    pts = [(x0, y0), (x1, y0), (x1, y1), (x0, y1)]
    d = " ".join(
        f"{'M' if i == 0 else 'L'}{shear(x, y)[0]:.2f} {shear(x, y)[1]:.2f}"
        for i, (x, y) in enumerate(pts)
    )
    return d + "Z"


def app_icon(foreground: str, plate: str | None, inset: float = 0.24) -> str:
    """
    The mark inside a rounded plate, as used for the app and tray icons.

    The fit is computed from the mark's sheared bounds rather than guessed, so
    changing the geometry cannot silently push it out of the plate.
    """
    w = 128.0
    min_x, min_y, max_x, max_y = bounds()
    span = max(max_x - min_x, max_y - min_y)
    scale = (w * (1 - 2 * inset)) / span
    # Place the scaled mark's own centre on the plate's centre.
    off_x = w / 2 - ((min_x + max_x) / 2) * scale
    off_y = w / 2 - ((min_y + max_y) / 2) * scale

    left_x1 = 14.0 + POST_W
    right_x0 = left_x1 + GAP
    right_x1 = right_x0 + POST_W
    top = 12.0
    bar_y0 = top + (POST_H - BAR_H) / 2
    bar_y1 = bar_y0 + BAR_H

    plate_svg = (
        f'<rect x="0" y="0" width="{w}" height="{w}" rx="28" fill="{plate}"/>'
        if plate
        else ""
    )
    return f"""<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {w:.0f} {w:.0f}" width="{w:.0f}" height="{w:.0f}">
  {plate_svg}
  <g transform="translate({off_x:.2f} {off_y:.2f}) scale({scale:.4f})" fill="{foreground}">
    <path d="{post_path(14, left_x1, top, top + POST_H)}"/>
    <path d="{post_path(right_x0, right_x1, top, top + POST_H)}"/>
    <path d="{post_path(14, right_x1, bar_y0, bar_y1)}"/>
  </g>
</svg>"""


PREVIEW = """<!doctype html><meta charset=utf-8>
<style>
  body{{margin:0;background:#0d0e10;font:12px ui-monospace,monospace;color:#8b8f96;
       display:grid;grid-template-columns:repeat(3,1fr);gap:18px;padding:22px}}
  .cell{{display:flex;flex-direction:column;align-items:center;gap:8px}}
  .dark{{background:{GRAPHITE};border-radius:14px;padding:22px}}
  .light{{background:{SOFT_WHITE};border-radius:14px;padding:22px}}
  .mono{{background:#000;border-radius:14px;padding:22px}}
  h4{{margin:0;font-size:10px;letter-spacing:.14em;text-transform:uppercase;font-weight:500}}
</style>
<div class="cell"><h4>mark · mint</h4><div class="dark">{MARK}</div></div>
<div class="cell"><h4>mark · white</h4><div class="dark">{MARK_W}</div></div>
<div class="cell"><h4>mark · black</h4><div class="mono">{MARK_W}</div></div>
<div class="cell"><h4>app icon · dark</h4><div class="dark">{APP_DARK}</div></div>
<div class="cell"><h4>app icon · light</h4><div class="light">{APP_LIGHT}</div></div>
<div class="cell"><h4>mark · 16px</h4><div class="dark">{SMALL}</div></div>
"""


def sized(svg: str, height: int) -> str:
    """Pin an SVG to a pixel height, so the browser cannot rescale it."""
    x, y, w, h = (float(v) for v in frame().split())
    scale = height / h
    return svg.replace(
        f'viewBox="{frame()}"',
        f'viewBox="{frame()}" width="{w * scale:.1f}" height="{height}"',
        1,
    )


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--preview", action="store_true")
    parser.add_argument("--out", default="/tmp/opencode/logo")
    args = parser.parse_args()

    out = pathlib.Path(args.out)
    out.mkdir(parents=True, exist_ok=True)

    (out / "mark.svg").write_text(build())
    (out / "mark-mono.svg").write_text(monochrome())
    (out / "app-icon-dark.svg").write_text(app_icon(MINT, GRAPHITE))
    (out / "app-icon-light.svg").write_text(app_icon(GRAPHITE, SOFT_WHITE))
    (out / "tray.svg").write_text(app_icon(MINT, None))

    if args.preview:
        html = (
            PREVIEW.replace("{MARK}", sized(build(), 150))
            .replace("{MARK_W}", sized(monochrome(), 150).replace("<svg ", '<svg fill="#F4F4F0" ', 1))
            .replace("{APP_DARK}", sized(app_icon(MINT, GRAPHITE), 150))
            .replace("{APP_LIGHT}", sized(app_icon(GRAPHITE, SOFT_WHITE), 150))
            .replace("{SMALL}", sized(app_icon(MINT, None), 40))
        )
        (out / "preview.html").write_text(html)
        print(out / "preview.html")


if __name__ == "__main__":
    main()
