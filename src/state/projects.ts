/**
 * Active project, recent projects, and the binary path override.
 *
 * Backed by the Rust settings file so the choice survives restarts and is
 * available to the process manager without a webview round trip.
 */

import { create } from "zustand";
import { api, type Settings } from "@/lib/tauri";

interface ProjectStore {
  recent: string[];
  active: string | null;
  binaryOverride: string | null;
  loaded: boolean;
  hydrate(): Promise<void>;
  openProject(path: string): Promise<void>;
  closeProject(): Promise<void>;
  setBinaryOverride(path: string | null): Promise<void>;
}

export const useProjects = create<ProjectStore>((set, get) => ({
  recent: [],
  active: null,
  binaryOverride: null,
  loaded: false,

  hydrate: async () => {
    const settings = await api.getSettings();
    set({
      recent: settings.recentProjects,
      active: settings.lastProject,
      binaryOverride: settings.binaryOverride,
      loaded: true,
    });
  },

  openProject: async (path) => {
    // Paint immediately; the recency write is a round trip and should never
    // gate the UI.
    set((state) => ({
      active: path,
      recent: [path, ...state.recent.filter((p) => p !== path)],
    }));
    const settings = await api.rememberProject(path);
    set({ recent: settings.recentProjects, active: settings.lastProject });
  },

  closeProject: async () => {
    const settings = await api.forgetProject(get().active ?? "");
    set({ recent: settings.recentProjects, active: settings.lastProject });
  },

  setBinaryOverride: async (path) => {
    const current = await api.getSettings();
    await api.saveSettings({
      ...current,
      binaryOverride: path,
    } satisfies Settings);
    set({ binaryOverride: path });
  },
}));
