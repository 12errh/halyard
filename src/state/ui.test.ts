import { beforeEach, describe, expect, it } from "vitest";
import { clampDensity, DEFAULT_APPEARANCE, useUi } from "@/state/ui";
import { DEFAULT_FONT, fontById, FONT_OPTIONS, isFontId } from "@/lib/fonts";
import { projectName, shortenPath, truncate } from "@/lib/utils";

describe("density", () => {
  it("clamps to the readable range", () => {
    expect(clampDensity(0.1)).toBe(0.85);
    expect(clampDensity(9)).toBe(1.25);
    expect(clampDensity(1.1)).toBe(1.1);
  });

  it("falls back to the default for non-numeric input", () => {
    expect(clampDensity(undefined)).toBe(DEFAULT_APPEARANCE.density);
    expect(clampDensity("big")).toBe(DEFAULT_APPEARANCE.density);
  });
});

describe("appearance store", () => {
  beforeEach(() => {
    localStorage.clear();
    useUi.setState({ appearance: DEFAULT_APPEARANCE });
  });

  it("defaults to the dark theme and the pixel font", () => {
    const appearance = useUi.getState().appearance;
    expect(appearance.theme).toBe("dark");
    expect(appearance.font).toBe(DEFAULT_FONT);
  });

  it("persists a change to local storage", () => {
    useUi.getState().setFont("geist");
    const raw = localStorage.getItem("halyard.appearance");
    expect(raw).toContain("geist");
  });

  it("clamps a density set through the store", () => {
    useUi.getState().setDensity(5);
    expect(useUi.getState().appearance.density).toBe(1.25);
  });

  it("toggles the command palette", () => {
    useUi.setState({ paletteOpen: false });
    useUi.getState().togglePalette();
    expect(useUi.getState().paletteOpen).toBe(true);
    useUi.getState().togglePalette();
    expect(useUi.getState().paletteOpen).toBe(false);
  });

  it("accepts an explicit palette state", () => {
    useUi.setState({ paletteOpen: false });
    useUi.getState().togglePalette(true);
    expect(useUi.getState().paletteOpen).toBe(true);
  });
});

describe("font registry", () => {
  it("offers the curated seven-font set", () => {
    expect(FONT_OPTIONS).toHaveLength(7);
  });

  it("includes PixelCode as the default", () => {
    expect(DEFAULT_FONT).toBe("pixelcode");
    expect(fontById("pixelcode").ui).toContain("PixelCode");
  });

  it("gives every option a UI stack and a mono stack", () => {
    for (const font of FONT_OPTIONS) {
      expect(font.ui.length).toBeGreaterThan(0);
      expect(font.mono.length).toBeGreaterThan(0);
      expect(font.label.length).toBeGreaterThan(0);
    }
  });

  it("has unique ids", () => {
    const ids = FONT_OPTIONS.map((f) => f.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("falls back to the default for an unknown id", () => {
    // A stale persisted value must not break typography after a rename.
    expect(fontById("comic-sans" as never).id).toBe(DEFAULT_FONT);
  });

  it("validates ids", () => {
    expect(isFontId("geist")).toBe(true);
    expect(isFontId("nope")).toBe(false);
    expect(isFontId(42)).toBe(false);
  });
});

describe("formatting helpers", () => {
  it("truncates on a word boundary when there is one", () => {
    expect(truncate("hello beautiful world", 15)).toBe("hello beautiful…");
  });

  it("hard-cuts when no boundary is near the end", () => {
    expect(truncate("aaaaaaaaaaaaaaaaaaaa", 10)).toBe("aaaaaaaaaa…");
  });

  it("leaves short strings alone", () => {
    expect(truncate("short", 20)).toBe("short");
  });

  it("derives a project name from the final path segment", () => {
    expect(projectName("/home/rehan/Projects/ocis")).toBe("ocis");
    expect(projectName("/home/rehan/Projects/ocis/")).toBe("ocis");
  });

  it("shortens long paths from the left", () => {
    expect(shortenPath("/home/rehan/Projects/ocis", 2)).toBe("…/Projects/ocis");
    expect(shortenPath("/ocis", 2)).toBe("/ocis");
  });
});
