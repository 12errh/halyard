/**
 * The Halyard wordmark, inline.
 *
 * Drawn rather than loaded for the same reason as the mark: it inherits
 * `currentColor`, stays crisp at any size, and needs no second asset to keep
 * in sync. Geometry mirrors tools/wordmark.py, which generates the shipped
 * SVGs from the same numbers — the two were checked against each other once,
 * and `wordmark.test.tsx` holds the shape list still.
 *
 * Two rules, both taken from the mark: horizontal bands are cut so their top
 * and bottom edges rise to the right at the mark's own angle, and nothing is
 * allowed any other angle. The word itself stays flat and level so it survives
 * the 11px the title bar gives it.
 */

import { Logo, MARK_DRAWN } from "@/components/shell/logo";

const CAP = 100;
const STROKE = 22;
const TRACKING = 20;
const SLANT = 0.4598; // rise per unit run of a band cut; the mark's 24.7°
const GAP = 34; // symbol to word, in word units

// Matches PAD in tools/logo.py: the mark's viewBox carries it as breathing room.

type Point = readonly [number, number];
type Shape = Point[];

/** Vertical stems, which hold the level cap line and baseline. */
const rect = (x0: number, x1: number, y0: number, y1: number): Shape => [
  [x0, y0],
  [x0, y1],
  [x1, y1],
  [x1, y0],
];

/** Horizontal band, cut so the right edge lifts by its own height at SLANT. */
const bar = (x0: number, x1: number, y0: number, y1: number): Shape => {
  const rise = (y1 - y0) * SLANT;
  return [
    [x0, y0],
    [x0, y1],
    [x1, y1 - rise],
    [x1, y0 - rise],
  ];
};

/** Diagonal band: a horizontal cut at each end, tapering as it rises. */
const band = (
  x0b: number,
  x1b: number,
  x0t: number,
  x1t: number,
  yb: number,
  yt: number,
): Shape => [
  [x0b, yb],
  [x1b, yb],
  [x1t, yt],
  [x0t, yt],
];

/**
 * Advance width and shapes per glyph. Shapes are drawn as separate paths: with
 * one shared fill rule, overlapping shapes wound in opposite directions punch
 * holes in each other, which is what a single merged path did to the H.
 */
const GLYPHS: Record<string, { width: number; shapes: Shape[] }> = {
  H: {
    width: 58,
    shapes: [rect(0, STROKE, 0, CAP), rect(36, 58, 0, CAP), bar(0, 58, 39, 61)],
  },
  A: {
    width: 68,
    // Pointed apex: both legs' inner edges land on x=38 at the cap line, so the
    // counter is a full-height triangle rather than a notch.
    shapes: [
      band(0, 22, 28, 38, CAP, 0),
      band(46, 68, 38, 48, CAP, 0),
      bar(24, 48, 62, 84),
    ],
  },
  L: { width: 52, shapes: [rect(0, STROKE, 0, CAP), bar(0, 52, 78, 100)] },
  Y: {
    width: 66,
    shapes: [
      band(0, 22, 22, 44, 0, 52),
      band(44, 66, 22, 44, 0, 52),
      rect(22, 44, 52, CAP),
    ],
  },
  R: {
    width: 64,
    shapes: [
      rect(0, STROKE, 0, CAP),
      bar(0, 64, 0, STROKE),
      rect(42, 64, 0, 62),
      bar(0, 64, 40, 62),
      band(40, 62, 22, 44, CAP, 62),
    ],
  },
  D: {
    width: 66,
    shapes: [
      rect(0, STROKE, 0, CAP),
      bar(0, 66, 0, STROKE),
      bar(0, 66, 78, 100),
      rect(44, 66, 0, CAP),
    ],
  },
};

export type WordmarkLayout = {
  shapes: Shape[];
  width: number;
  x: number;
  y: number;
  height: number;
};

/** The word, offset into place, with the bounds of what it actually draws. */
export function layoutWordmark(word = "HALYARD"): WordmarkLayout {
  let x = 0;
  const shapes: Shape[] = [];

  [...word].forEach((ch, i) => {
    const glyph = GLYPHS[ch];
    if (!glyph) throw new Error(`halyard wordmark: no glyph for "${ch}"`);
    for (const shape of glyph.shapes) shapes.push(shape.map(([px, py]) => [x + px, py] as Point));
    x += glyph.width;
    if (i !== word.length - 1) x += TRACKING;
  });

  const xs = shapes.flat().map(([px]) => px);
  const ys = shapes.flat().map(([, py]) => py);
  return {
    shapes,
    width: x,
    x: Math.min(...xs),
    y: Math.min(...ys),
    height: Math.max(...ys) - Math.min(...ys),
  };
}

const path = (shape: Shape) =>
  shape.map(([x, y], i) => `${i === 0 ? "M" : "L"}${x} ${y}`).join(" ") + "Z";

/** The wordmark alone, for places that have already shown the mark. */
export function Wordmark({ className = "" }: { className?: string }) {
  const { shapes, width, x, y, height } = layoutWordmark();
  return (
    <svg
      viewBox={`${x} ${y} ${width} ${height}`}
      className={className}
      role="img"
      aria-label="Halyard"
    >
      <g fill="currentColor">
        {shapes.map((shape, i) => (
          <path key={i} d={path(shape)} />
        ))}
      </g>
    </svg>
  );
}

/**
 * The combination mark. Scales the symbol to the height the word actually
 * draws — the mark's shear pushes its top corner above its own viewBox, so
 * aligning on nominal boxes leaves the symbol sitting low.
 */
export function LogoLockup({ className = "" }: { className?: string }) {
  const { shapes, width, y, height } = layoutWordmark();
  const pad = MARK_DRAWN.pad;

  // Scale the symbol to the height the word actually draws, not to either
  // nominal box: the mark's shear pushes its top corner above its own viewBox,
  // so aligning on the viewBox would leave it sitting low and small.
  const scale = height / MARK_DRAWN.height;
  const symbolW = MARK_DRAWN.width * scale;

  return (
    <svg
      viewBox={`${-pad * scale} ${y - pad} ${symbolW + GAP + width + 2 * pad * scale} ${height + 2 * pad}`}
      className={className}
      role="img"
      aria-label="Halyard"
    >
      <Logo
        x={-pad * scale}
        y={y - pad * scale}
        width={symbolW + 2 * pad * scale}
        height={height + 2 * pad * scale}
      />
      <g fill="currentColor" transform={`translate(${symbolW + GAP} 0)`}>
        {shapes.map((shape, i) => (
          <path key={i} d={path(shape)} />
        ))}
      </g>
    </svg>
  );
}
