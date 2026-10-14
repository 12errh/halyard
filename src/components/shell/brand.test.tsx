import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { Logo, MARK_DRAWN, MARK_VIEW } from "@/components/shell/logo";
import { LogoLockup, Wordmark, layoutWordmark } from "@/components/shell/wordmark";

/** A viewBox as four numbers, so a malformed one fails the test not the types. */
function box(svg: SVGElement): [number, number, number, number] {
  const parts = svg.getAttribute("viewBox")?.trim().split(/\s+/).map(Number) ?? [];
  if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n))) {
    throw new Error(`unusable viewBox on <${svg.tagName}>`);
  }
  return parts as [number, number, number, number];
}

describe("Logo", () => {
  it("draws the three strokes of the H, each split into two facets and an edge", () => {
    const { container } = render(<Logo />);
    // Two posts and the crossbar: lit, shade and the lit edge along the top.
    expect(container.querySelectorAll("path")).toHaveLength(9);
  });

  it("carries the facet gradients rather than filling flat", () => {
    const { container } = render(<Logo />);
    expect(container.querySelectorAll("linearGradient")).toHaveLength(3);
    for (const path of container.querySelectorAll("path")) {
      expect(path.getAttribute("fill")).toMatch(/^url\(#halyard-logo-/);
    }
  });

  it("uses the viewBox the generator draws, so the two cannot drift", () => {
    const { container } = render(<Logo />);
    expect(container.querySelector("svg")).toHaveAttribute("viewBox", MARK_VIEW);
  });

  it("has a viewBox that contains everything the shear lifts up", () => {
    // The shear raises the right post's top corner above the nominal box, and
    // a viewBox measured in unsheared units crops it off.
    const [x, y, w, h] = MARK_VIEW.split(" ").map(Number) as [
      number, number, number, number,
    ];
    expect(MARK_DRAWN.y).toBeLessThan(0);
    expect(MARK_DRAWN.y).toBeGreaterThanOrEqual(y);
    expect(MARK_DRAWN.x).toBeGreaterThanOrEqual(x);
    expect(MARK_DRAWN.x + MARK_DRAWN.width).toBeLessThanOrEqual(x + w);
    expect(MARK_DRAWN.y + MARK_DRAWN.height).toBeLessThanOrEqual(y + h);
  });

  it("is hidden from assistive tech — the lockup beside it names the app", () => {
    const { container } = render(<Logo />);
    expect(container.querySelector("svg")).toHaveAttribute("aria-hidden", "true");
  });
});

describe("layoutWordmark", () => {
  it("draws HALYARD across the glyphs and the tracking between them", () => {
    const { width } = layoutWordmark();
    // 58 + 68 + 52 + 66 + 68 + 64 + 66 of glyph, six gaps of 20.
    expect(width).toBe(58 + 68 + 52 + 66 + 68 + 64 + 66 + 6 * 20);
  });

  it("bounds what it draws, not the nominal cap box", () => {
    const { y, height } = layoutWordmark();
    // Bands overshoot the cap line on the right by their own height at the
    // mark's angle, so the box starts above zero.
    expect(y).toBeLessThan(0);
    expect(height).toBeGreaterThan(100);
    expect(y + height).toBe(100);
  });

  it("keeps every shape's edges on a vertical, horizontal or the mark's cut", () => {
    for (const shape of layoutWordmark().shapes) {
      expect(shape).toHaveLength(4);
      const ys = shape.map(([, y]) => y);
      const xs = shape.map(([x]) => x);
      // A quad is either axis-aligned or a band cut at the mark's angle.
      const axisAligned = xs[0] === xs[1] || xs[2] === xs[3];
      expect(axisAligned || ys[0] === ys[1] || ys[2] === ys[3]).toBe(true);
    }
  });

  it("refuses letters it cannot draw", () => {
    expect(() => layoutWordmark("HALYARDZ")).toThrow(/no glyph/);
  });
});

describe("Wordmark", () => {
  it("draws every shape as its own path so overlaps cannot punch holes", () => {
    const { container } = render(<Wordmark />);
    expect(container.querySelectorAll("path")).toHaveLength(layoutWordmark().shapes.length);
  });

  it("inherits currentColor", () => {
    const { container } = render(<Wordmark />);
    expect(container.querySelector("g")).toHaveAttribute("fill", "currentColor");
  });

  it("is named for assistive tech", () => {
    render(<Wordmark />);
    expect(document.querySelector("svg")).toHaveAttribute("aria-label", "Halyard");
  });
});

describe("LogoLockup", () => {
  function setup() {
    const { container } = render(<LogoLockup />);
    const [lockup, mark] = [...container.querySelectorAll("svg")];
    if (!lockup || !mark) throw new Error("expected the lockup and its nested mark");
    return { lockup, mark, container };
  }

  it("nests the mark ahead of the word", () => {
    const { lockup, mark, container } = setup();
    expect(lockup).toHaveAttribute("aria-label", "Halyard");
    expect(mark).toHaveAttribute("width");
    // The symbol is the nested svg; the word is the group beside it.
    expect(container.querySelector("g[transform]")?.parentElement).toBe(mark);
    expect(container.querySelectorAll("path").length).toBeGreaterThan(
      layoutWordmark().shapes.length,
    );
  });

  it("scales the mark to the height the word draws, not to its viewBox", () => {
    const { mark } = setup();
    const { pad, height } = MARK_DRAWN;
    const drawn = (Number(mark.getAttribute("height")) / (height + 2 * pad)) * height;
    expect(drawn).toBeCloseTo(layoutWordmark().height, 5);
  });

  it("puts the mark's drawn top on the word's cap line", () => {
    const { lockup, mark } = setup();
    const [vx, vy] = box(lockup);
    const { pad, height } = MARK_DRAWN;
    const scale = Number(mark.getAttribute("height")) / (height + 2 * pad);

    // The lockup is padded like the mark is, so the word's cap line is one pad
    // below the top of the box; the mark's drawn top must land exactly there.
    expect(Number(mark.getAttribute("y")) + pad * scale).toBeCloseTo(vy + pad, 5);
    // And the left of the box is the left of the lockup, padding included, so
    // the symbol's ink starts where the viewBox says it does.
    expect(Number(mark.getAttribute("x"))).toBeCloseTo(vx, 5);
  });
});


