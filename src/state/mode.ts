/**
 * Plan / Build selection.
 *
 * opencode models these as `mode: "primary"` agents rather than a flag, so the
 * choice rides along on each prompt. Internal agents (compaction, summary,
 * title) share that mode but are not things a user should ever pick, so they
 * are filtered out by name.
 */

import { create } from "zustand";
import type { ModeOption } from "@/components/chat/mode-picker";

const STORAGE_KEY = "halyard.mode";

/** Agents opencode drives internally; never offer these. */
const INTERNAL_AGENTS = new Set(["compaction", "summary", "title"]);

const LABELS: Record<string, string> = {
  build: "Build",
  plan: "Plan",
};

export const DEFAULT_MODE = "build";

export interface Agent {
  name: string;
  description?: string;
  mode?: string;
}

/** Reduce the agent list to the user-selectable primary agents. */
export function toModeOptions(agents: Agent[]): ModeOption[] {
  return agents
    .filter((agent) => agent.mode === "primary")
    .filter((agent) => !INTERNAL_AGENTS.has(agent.name))
    .map((agent) => ({
      name: agent.name,
      label: LABELS[agent.name] ?? agent.name,
      description: agent.description,
      // Plan mode refuses every edit tool; say so rather than letting the user
      // discover it when a write fails.
      readOnly: agent.name === "plan",
    }));
}

function read(): string {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) return stored;
  } catch {
    // Fall through to the default.
  }
  return DEFAULT_MODE;
}

interface ModeStore {
  modes: ModeOption[];
  value: string;
  loaded: boolean;
  setModes(agents: Agent[]): void;
  setValue(value: string): void;
  reset(): void;
}

export const useMode = create<ModeStore>((set) => ({
  modes: [],
  value: read(),
  loaded: false,

  setModes: (agents) =>
    set((state) => {
      const modes = toModeOptions(agents);
      // Keep the current choice only if it still exists.
      const stillThere = modes.some((m) => m.name === state.value);
      const value = stillThere ? state.value : modes.find((m) => m.name === DEFAULT_MODE)?.name ?? modes[0]?.name ?? DEFAULT_MODE;
      return { modes, value, loaded: true };
    }),

  setValue: (value) => {
    try {
      localStorage.setItem(STORAGE_KEY, value);
    } catch {
      // Persistence is optional.
    }
    set({ value });
  },

  reset: () => set({ modes: [], loaded: false }),
}));
