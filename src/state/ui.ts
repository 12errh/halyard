/**
 * Appearance and transient UI state.
 *
 * Appearance lives in local storage rather than the Rust settings file so the
 * font and theme apply on first paint without waiting on a round trip. The
 * module-level `applyAppearance` writes CSS custom properties; nothing in the
 * React tree needs to re-render for a font change.
 */

import { create } from "zustand";
import { DEFAULT_FONT, fontById, isFontId, type FontId } from "@/lib/fonts";

export type ThemeChoice = "dark" | "light" | "system";

export interface Appearance {
  theme: ThemeChoice;
  font: FontId;
  /** Multiplier applied to the root font size. */
  density: number;
  /** Suppress decorative motion even when the OS allows it. */
  reduceMotion: boolean;
}

export const DEFAULT_APPEARANCE: Appearance = {
  theme: "dark",
  font: DEFAULT_FONT,
  density: 1,
  reduceMotion: false,
};

const STORAGE_KEY = "halyard.appearance";

function read(): Appearance {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_APPEARANCE;
    const parsed = JSON.parse(raw) as Partial<Appearance>;
    return {
      theme:
        parsed.theme === "light" || parsed.theme === "system" || parsed.theme === "dark"
          ? parsed.theme
          : DEFAULT_APPEARANCE.theme,
      font: isFontId(parsed.font) ? parsed.font : DEFAULT_APPEARANCE.font,
      // Clamp so a corrupted value cannot make the UI unreadable.
      density: clampDensity(parsed.density),
      reduceMotion: parsed.reduceMotion === true,
    };
  } catch {
    return DEFAULT_APPEARANCE;
  }
}

export function clampDensity(value: unknown): number {
  const numeric = typeof value === "number" ? value : DEFAULT_APPEARANCE.density;
  return Math.min(1.25, Math.max(0.85, Number(numeric.toFixed(2))));
}

function persist(appearance: Appearance) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(appearance));
  } catch {
    // Private browsing or a full quota: appearance simply will not persist.
  }
}

interface UiStore {
  appearance: Appearance;
  paletteOpen: boolean;
  settingsOpen: boolean;
  sidebarOpen: boolean;
  fileTreeOpen: boolean;

  setTheme(theme: ThemeChoice): void;
  setFont(font: FontId): void;
  setDensity(density: number): void;
  setReduceMotion(value: boolean): void;

  togglePalette(open?: boolean): void;
  setSettingsOpen(open: boolean): void;
  toggleSidebar(open?: boolean): void;
  toggleFileTree(open?: boolean): void;
}

export const useUi = create<UiStore>((set) => ({
  appearance: read(),
  paletteOpen: false,
  settingsOpen: false,
  sidebarOpen: true,
  fileTreeOpen: false,

  setTheme: (theme) => update(set, { theme }),
  setFont: (font) => update(set, { font }),
  setDensity: (density) => update(set, { density: clampDensity(density) }),
  setReduceMotion: (reduceMotion) => update(set, { reduceMotion }),

  togglePalette: (open) => set((s) => ({ paletteOpen: open ?? !s.paletteOpen })),
  setSettingsOpen: (settingsOpen) => set({ settingsOpen }),
  toggleSidebar: (open) => set((s) => ({ sidebarOpen: open ?? !s.sidebarOpen })),
  toggleFileTree: (open) => set((s) => ({ fileTreeOpen: open ?? !s.fileTreeOpen })),
}));

type Setter = (partial: Partial<UiStore>) => void;

function update(set: Setter, patch: Partial<Appearance>) {
  set({ appearance: { ...useUi.getState().appearance, ...patch } });
  const next = useUi.getState().appearance;
  persist(next);
  applyAppearance(next);
}

/** Push appearance onto the document. Cheap, idempotent, safe to call often. */
export function applyAppearance(appearance: Appearance) {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  const font = fontById(appearance.font);

  const resolved =
    appearance.theme === "system"
      ? window.matchMedia("(prefers-color-scheme: light)").matches
        ? "light"
        : "dark"
      : appearance.theme;

  root.dataset.theme = resolved;
  root.style.setProperty("--font-ui", font.ui);
  root.style.setProperty("--font-mono", font.mono);
  root.style.setProperty("--density", String(appearance.density));
  root.style.setProperty(
    "--motion",
    appearance.reduceMotion ? "0" : "1",
  );
  root.dataset.reduceMotion = appearance.reduceMotion ? "true" : "false";
}

/** Apply persisted appearance as early as possible. */
export function initAppearance() {
  applyAppearance(useUi.getState().appearance);
}
