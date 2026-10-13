/**
 * Desktop shell preferences: tray visibility, close behaviour, notifications.
 *
 * These live in the Rust settings file rather than webview storage because the
 * close-button handler runs on the Rust side, before any JavaScript has had a
 * chance to read a preference. A value only the frontend knew about could not
 * be honoured at the moment it matters.
 */

import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";
import { api } from "@/lib/tauri";
import { autostartEnabled, setAutostart } from "@/lib/desktop";

export interface DesktopPreferences {
  showTray: boolean;
  closeToTray: boolean;
  notifyOnFinish: boolean;
  launchAtLogin: boolean;
}

interface DesktopStore extends DesktopPreferences {
  loaded: boolean;
  hydrate(): Promise<void>;
  update(patch: Partial<DesktopPreferences>): Promise<void>;
}

const DEFAULTS: DesktopPreferences = {
  showTray: true,
  closeToTray: true,
  notifyOnFinish: true,
  // Not a Rust setting: the OS owns it, so it is read back from the plugin.
  launchAtLogin: false,
};

/**
 * Whether closing should hide rather than quit.
 *
 * Mirrors `Settings::effective_close_to_tray` on the Rust side. Both must
 * agree: Rust decides what the close button does, and the setting that
 * switches the tray off has to disable it in both places or the window would
 * hide with no icon left to restore it.
 */
export function closeToTray(prefs: Pick<DesktopPreferences, "showTray" | "closeToTray">): boolean {
  return prefs.closeToTray && prefs.showTray;
}

export const useDesktop = create<DesktopStore>((set) => ({
  ...DEFAULTS,
  loaded: false,

  hydrate: async () => {
    try {
      const settings = await api.getSettings();
      const launchAtLogin = await autostartEnabled();
      set({
        showTray: settings.showTray ?? DEFAULTS.showTray,
        closeToTray: settings.closeToTray ?? DEFAULTS.closeToTray,
        notifyOnFinish: settings.notifyOnFinish ?? DEFAULTS.notifyOnFinish,
        launchAtLogin,
        loaded: true,
      });
    } catch {
      // Without the settings file the defaults still describe a usable app,
      // so start rather than leaving the toggles inert.
      set({ loaded: true });
    }
  },

  update: async (patch) => {
    // Paint first: these are toggles, and waiting on a disk write makes them
    // feel broken on slow filesystems.
    set(patch);

    // Login registration is the OS's to hold, not ours to persist.
    if (patch.launchAtLogin !== undefined) {
      const ok = await setAutostart(patch.launchAtLogin);
      if (!ok) set({ launchAtLogin: !patch.launchAtLogin });
      return;
    }

    const { launchAtLogin: _ignored, ...shell } = patch;
    if (!Object.keys(shell).length) return;

    // Hiding the tray has to reach the running icon, not just the preference:
    // the tray is built once at start-up and would otherwise linger until a
    // restart, which makes the switch look broken.
    if (shell.showTray !== undefined) {
      try {
        await invoke("set_tray_visible", { visible: shell.showTray });
      } catch {
        /* the icon stays; the preference is still recorded */
      }
    }

    try {
      const current = await api.getSettings();
      await api.saveSettings({ ...current, ...shell });
    } catch {
      /* the preference stays as painted for this session */
    }
  },
}));
