/**
 * The Halyard mark, inline.
 *
 * Drawn rather than loaded so it stays crisp at any size without a network
 * round trip or a second asset to keep in sync with the icon set. Geometry
 * mirrors tools/logo.py, which generates the shipped icons from the same
 * numbers — including the viewBox, which has to be measured after the shear
 * or the top of the right post gets cropped.
 */

const MINT = "#83E1C1";
const MINT_DEEP = "#35A184";
const MINT_DARK = "#1F6350";
const EDGE = "#BDF3E0";

const SHEAR_DEG = 24.7;
const POST_W = 27;
const GAP = 19;
const POST_H = 84;
const BAR_H = 22;
const EDGE_H = 2.2;
const PAD = 6;

const LEFT = 14;
const RIGHT = LEFT + POST_W + GAP + POST_W;
const TOP = 12;
const BOTTOM = TOP + POST_H;
const BAR_Y0 = TOP + (POST_H - BAR_H) / 2;

// After the shear the strokes reach up and to the left, so the box is measured
// from the sheared extremes rather than the nominal one.
const SHEAR = Math.tan((SHEAR_DEG * Math.PI) / 180);

/**
 * What the mark actually draws, for callers that have to align something else
 * to it — the lockup scales the symbol by this rather than by its viewBox, or
 * the mark would sit inside its own padding and read too small.
 */
export const MARK_DRAWN = {
  pad: PAD,
  x: LEFT,
  y: TOP - SHEAR * RIGHT,
  width: RIGHT - LEFT,
  height: BOTTOM - TOP + SHEAR * (RIGHT - LEFT),
};

export const MARK_VIEW = [
  MARK_DRAWN.x - PAD,
  MARK_DRAWN.y - PAD,
  MARK_DRAWN.width + PAD * 2,
  MARK_DRAWN.height + PAD * 2,
].join(" ");

function path(x0: number, x1: number, y0: number, y1: number): string {
  return `M${x0} ${y0}H${x1}V${y1}H${x0}Z`;
}

/** Split a stroke across `fold` into a lit and a shaded facet, plus the edge. */
function facet(x0: number, x1: number, y0: number, y1: number, fold: number) {
  const fx = x0 + (x1 - x0) * fold;
  return {
    lit: path(x0, fx, y0, y1),
    shade: path(fx, x1, y0, y1),
    edge: path(x0, x1, y0, y0 + EDGE_H),
  };
}

const strokes = [
  facet(LEFT, LEFT + POST_W, TOP, BOTTOM, 0.52),
  facet(RIGHT - POST_W, RIGHT, TOP, BOTTOM, 0.52),
  facet(LEFT, RIGHT, BAR_Y0, BAR_Y0 + BAR_H, 0.42),
];

export function Logo({
  className = "",
  x,
  y,
  width,
  height,
}: {
  className?: string;
  /** Passed through for when the mark is nested inside a lockup's svg. */
  x?: number;
  y?: number;
  width?: number;
  height?: number;
}) {
  const id = "halyard-logo";
  return (
    <svg
      viewBox={MARK_VIEW}
      className={className}
      aria-hidden
      focusable="false"
      x={x}
      y={y}
      width={width}
      height={height}
    >
      <defs>
        <linearGradient id={`${id}-lit`} x1="0" y1="0" x2="0.25" y2="1">
          <stop offset="0" stopColor={MINT} />
          <stop offset="0.55" stopColor="#63D2AE" />
          <stop offset="1" stopColor={MINT_DEEP} />
        </linearGradient>
        <linearGradient id={`${id}-shade`} x1="0" y1="0" x2="0.55" y2="1">
          <stop offset="0" stopColor="#2E8E74" />
          <stop offset="1" stopColor={MINT_DARK} />
        </linearGradient>
        <linearGradient id={`${id}-edge`} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor={EDGE} />
          <stop offset="1" stopColor="#7BD9B8" />
        </linearGradient>
      </defs>

      {/* The isometric shear. Applied as a transform so the facet paths stay
          axis-aligned and the geometry stays readable above. */}
      <g transform={`skewY(${-SHEAR_DEG})`}>
        {strokes.map((s, i) => (
          <g key={i}>
            <path d={s.lit} fill={`url(#${id}-lit)`} />
            <path d={s.shade} fill={`url(#${id}-shade)`} />
            <path d={s.edge} fill={`url(#${id}-edge)`} />
          </g>
        ))}
      </g>
    </svg>
  );
}
