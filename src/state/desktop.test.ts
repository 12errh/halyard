import { beforeEach, describe, expect, it, vi } from "vitest";
import { closeToTray, useDesktop } from "@/state/desktop";

describe("desktop preferences", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useDesktop.setState({
      showTray: true,
      closeToTray: true,
      notifyOnFinish: true,
      launchAtLogin: false,
      loaded: true,
    });
  });

  it("hides to the tray when both switches allow it", () => {
    expect(closeToTray({ showTray: true, closeToTray: true })).toBe(true);
  });

  it("quits when the user turned the tray off", () => {
    // Otherwise closing would hide the window with no way to bring it back.
    expect(closeToTray({ showTray: false, closeToTray: true })).toBe(false);
  });

  it("quits when the user asked close to mean close", () => {
    expect(closeToTray({ showTray: true, closeToTray: false })).toBe(false);
  });

  it("defaults to a tray so a fresh install can be closed safely", () => {
    const state = useDesktop.getState();
    expect(state.showTray).toBe(true);
    expect(state.closeToTray).toBe(true);
  });

  it("paints the change before the write returns", async () => {
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const { api } = await import("@/lib/tauri");
    vi.spyOn(api, "getSettings").mockReturnValue(gate.then(() => ({
      recentProjects: [],
      lastProject: null,
      binaryOverride: null,
      showTray: true,
      closeToTray: true,
      notifyOnFinish: true,
    })));

    const pending = useDesktop.getState().update({ showTray: false });
    // Toggles must feel instant; the disk write is not allowed to gate them.
    expect(useDesktop.getState().showTray).toBe(false);
    release?.();
    await pending;
  });
});
