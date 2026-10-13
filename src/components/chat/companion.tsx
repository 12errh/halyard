import { motion, useReducedMotion } from "motion/react";

const W = 24;
const H = 16;

/**
 * Halyard's companion.
 *
 * Built as pixel art from a shape description rather than hand-placed cells:
 * the body is a filled mask, and the outline is derived by edge detection, so
 * the silhouette is symmetric by construction and can never drift out of
 * proportion. Every pixel takes its colour from the CSS variables the rest of
 * the UI uses, which means it re-themes correctly in light mode instead of
 * being an opaque sprite that fights the background.
 */

type Cell = { x: number; y: number; fill: string };

const OUTLINE = "var(--color-line-strong)";
const FACE = "var(--color-accent)";
// No dedicated dim token exists, so derive the shaded tone from the accent
// itself. This keeps the sprite correct if the accent is ever re-themed.
const SHADE = "color-mix(in oklab, var(--color-accent) 62%, var(--color-bg))";
const EYE = "var(--color-ink)";
const EYE_GLINT = "var(--color-bg)";

function ellipse(
  mask: boolean[],
  cx: number,
  cy: number,
  rx: number,
  ry: number,
): void {
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 <= 1) mask[y * W + x] = true;
    }
  }
}

function rect(mask: boolean[], x0: number, y0: number, w: number, h: number): void {
  for (let y = y0; y < y0 + h; y++) {
    for (let x = x0; x < x0 + w; x++) {
      if (x >= 0 && y >= 0 && x < W && y < H) mask[y * W + x] = true;
    }
  }
}

function build(): { cells: Cell[]; eyes: Cell[]; mouth: Cell[] } {
  const mask = new Array<boolean>(W * H).fill(false);

  ellipse(mask, 12, 10, 6.5, 5.5); // head
  rect(mask, 11, 1, 3, 3); // antenna stem, three wide so it has a lit centre
  rect(mask, 11, 0, 3, 1); // antenna tip

  const at = (x: number, y: number) => (x < 0 || y < 0 || x >= W || y >= H ? false : mask[y * W + x]);

  const cells: Cell[] = [];
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (!at(x, y)) continue;

      // Anything touching empty space becomes the outline; that single rule
      // gives a clean 1px border around every curve and the antenna.
      const edge = !at(x - 1, y) || !at(x + 1, y) || !at(x, y - 1) || !at(x, y + 1);
      cells.push({
        x,
        y,
        // Lit from above: the lower third drops to the dim accent so the head
        // reads as a sphere rather than a flat disc.
        fill: edge ? OUTLINE : y >= 14 ? SHADE : FACE,
      });
    }
  }

  // Eyes sit on their own layer so a blink is one opacity animation rather than
  // a per-pixel one. The lighter pixels are glints.
  // Eyes are placed symmetrically about the head's centre column (x = 12) and
  // held far enough apart that the face reads as two eyes rather than one dark
  // band at this size.
  const eyePositions: Array<[number, number]> = [
    [8, 9], [9, 9], [8, 10], [9, 10],
    [15, 9], [16, 9], [15, 10], [16, 10],
  ];
  const eyes: Cell[] = eyePositions.map(([x, y]) => ({ x, y, fill: EYE }));
  // One light pixel at the top-left of each eye. Two diagonal glints would
  // split each eye in half and read as a squint.
  eyes.push({ x: 8, y: 9, fill: EYE_GLINT }, { x: 15, y: 9, fill: EYE_GLINT });

  const mouth: Cell[] = [11, 12, 13].map((x) => ({ x, y: 12, fill: OUTLINE }));

  return { cells, eyes, mouth };
}

const { cells, eyes, mouth } = build();

/**
 * @param size  Rendered width in px; the sprite scales from this.
 * @param mood  `idle` breathes and blinks. `working` lifts the antenna tip and
 *              pulses it, used while the agent is streaming.
 */
export function Companion({
  size = 132,
  mood = "idle",
  className = "",
}: {
  size?: number;
  mood?: "idle" | "working";
  className?: string;
}) {
  const calm = useReducedMotion();
  const working = mood === "working" && !calm;

  return (
    <motion.div
      initial={{ opacity: 0, y: 6, scale: 0.94 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ duration: 0.55, ease: [0.22, 1, 0.36, 1] }}
      style={{ width: size, height: (size / W) * H }}
      className={`relative select-none ${className}`}
      aria-hidden
    >
      {/* A soft pool of accent light underneath, so the sprite sits in the page
          rather than floating on top of it. Kept faint on purpose. */}
      <div
        className="absolute inset-x-2 bottom-0 h-1/3 rounded-[50%] blur-xl"
        style={{ background: "var(--color-accent)", opacity: calm ? 0.08 : 0.18 }}
      />

      <motion.svg
        viewBox={`0 0 ${W} ${H}`}
        width={size}
        height={(size / W) * H}
        shapeRendering="crispEdges"
        className="relative overflow-visible"
        animate={working ? { y: [0, -2, 0] } : { y: [0, -0.75, 0] }}
        transition={{ duration: working ? 1.4 : 4.5, repeat: Infinity, ease: "easeInOut" }}
      >
        {cells.map((c) => (
          <rect key={`${c.x}-${c.y}`} x={c.x} y={c.y} width={1} height={1} fill={c.fill} />
        ))}

        {/* Antenna tip pulses while working, so there is a visible signal that
            something is in flight even when the sprite is off to the side. */}
        {working && (
          <motion.rect
            x={11}
            y={0}
            width={3}
            height={1}
            fill={FACE}
            animate={{ opacity: [0.3, 1, 0.3] }}
            transition={{ duration: 0.9, repeat: Infinity, ease: "easeInOut" }}
          />
        )}

        {mouth.map((c, i) => (
          <rect key={i} x={c.x} y={c.y} width={1} height={1} fill={c.fill} />
        ))}

        <motion.g
          animate={calm ? {} : { opacity: [1, 1, 1, 1, 0, 1, 1, 1] }}
          transition={{
            duration: working ? 4 : 7,
            repeat: Infinity,
            times: [0, 0.93, 0.945, 0.96, 0.975, 0.985, 0.995, 1],
          }}
        >
          {eyes.map((e, i) => (
            <rect key={i} x={e.x} y={e.y} width={1} height={1} fill={e.fill} />
          ))}
        </motion.g>
      </motion.svg>
    </motion.div>
  );
}