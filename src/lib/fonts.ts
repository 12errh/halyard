/**
 * The curated font set offered in Settings › Appearance.
 *
 * Font choices here are applied by writing CSS custom properties onto the
 * document root, so switching is instant and does not re-render the tree.
 */

export type FontId =
  | "pixelcode"
  | "geist"
  | "inter"
  | "jetbrains"
  | "plex-mono"
  | "system-sans"
  | "system-mono";

export interface FontOption {
  id: FontId;
  label: string;
  /** Shown under the label so the pixel default is never a mystery. */
  hint: string;
  ui: string;
  mono: string;
}

export const FONT_OPTIONS: readonly FontOption[] = [
  {
    id: "pixelcode",
    label: "PixelCode",
    hint: "Pixel — default",
    ui: '"PixelCode", ui-sans-serif, system-ui, sans-serif',
    mono: '"PixelCode", ui-monospace, monospace',
  },
  {
    id: "geist",
    label: "Geist",
    hint: "Linear-style UI face",
    ui: '"Geist Variable", "Geist", ui-sans-serif, system-ui, sans-serif',
    mono: '"Geist Mono Variable", "Geist Mono", ui-monospace, monospace',
  },
  {
    id: "inter",
    label: "Inter",
    hint: "Maximum legibility",
    ui: '"Inter Variable", "Inter", ui-sans-serif, system-ui, sans-serif',
    mono: '"JetBrains Mono Variable", "JetBrains Mono", ui-monospace, monospace',
  },
  {
    id: "jetbrains",
    label: "JetBrains Mono",
    hint: "Mono throughout",
    ui: '"JetBrains Mono Variable", "JetBrains Mono", ui-monospace, monospace',
    mono: '"JetBrains Mono Variable", "JetBrains Mono", ui-monospace, monospace',
  },
  {
    id: "plex-mono",
    label: "IBM Plex Mono",
    hint: "Mono throughout, warmer",
    ui: '"IBM Plex Mono", ui-monospace, monospace',
    mono: '"IBM Plex Mono", ui-monospace, monospace',
  },
  {
    id: "system-sans",
    label: "System Sans",
    hint: "Match the desktop",
    ui: "system-ui, -apple-system, 'Segoe UI', sans-serif",
    mono: "ui-monospace, 'Cascadia Mono', 'DejaVu Sans Mono', monospace",
  },
  {
    id: "system-mono",
    label: "System Mono",
    hint: "Mono everywhere",
    ui: "ui-monospace, 'Cascadia Mono', 'DejaVu Sans Mono', monospace",
    mono: "ui-monospace, 'Cascadia Mono', 'DejaVu Sans Mono', monospace",
  },
] as const;

export const DEFAULT_FONT: FontId = "pixelcode";

export function fontById(id: FontId): FontOption {
  const found = FONT_OPTIONS.find((option) => option.id === id);
  // Falling back to the default keeps a stale persisted value from breaking
  // typography entirely after a rename.
  return found ?? FONT_OPTIONS[0]!;
}

export function isFontId(value: unknown): value is FontId {
  return typeof value === "string" && FONT_OPTIONS.some((o) => o.id === value);
}
