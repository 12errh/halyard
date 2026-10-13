/**
 * How the transcript is displayed.
 *
 * Separate from `appearance`, which is about the app's skin. These are
 * choices about how much of the transcript a person wants to read — how much
 * reasoning to show, whether a wall of timestamps helps or hurts. They apply
 * per install rather than per project, like appearance, and persist the same
 * way.
 */

import { create } from "zustand";

export interface TranscriptPrefs {
  /** Render reasoning blocks. */
  showThinking: boolean;
  /** Show a timestamp beside each turn. */
  showTimestamps: boolean;
  /** Expand tool rows to show their input by default. */
  expandTools: boolean;
  /** Keep the plan panel pinned above the composer even when scrolled away. */
  pinPlan: boolean;
}

const STORAGE_KEY = "halyard.transcript";

export const DEFAULT_TRANSCRIPT: TranscriptPrefs = {
  // Reasoning on by default: in a coding session it is usually the most useful
  // part of the stream, and it is collapsible in one click when it is not.
  showThinking: true,
  showTimestamps: false,
  expandTools: false,
  pinPlan: true,
};

function read(): TranscriptPrefs {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_TRANSCRIPT;
    const parsed = JSON.parse(raw) as Partial<TranscriptPrefs>;
    return {
      showThinking: parsed.showThinking ?? DEFAULT_TRANSCRIPT.showThinking,
      showTimestamps: parsed.showTimestamps ?? DEFAULT_TRANSCRIPT.showTimestamps,
      expandTools: parsed.expandTools ?? DEFAULT_TRANSCRIPT.expandTools,
      pinPlan: parsed.pinPlan ?? DEFAULT_TRANSCRIPT.pinPlan,
    };
  } catch {
    return DEFAULT_TRANSCRIPT;
  }
}

interface TranscriptStore extends TranscriptPrefs {
  toggle(key: keyof TranscriptPrefs): void;
  reset(): void;
}

export const useTranscript = create<TranscriptStore>((set, get) => ({
  ...read(),

  toggle: (key) => {
    const next = { ...stripStore(get()), [key]: !get()[key] };
    set(next);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
      // Private browsing or a full quota: the choice simply does not persist.
    }
  },

  reset: () => set({ ...DEFAULT_TRANSCRIPT }),
}));

/** The persisted shape, without the actions. */
function stripStore(state: TranscriptStore): TranscriptPrefs {
  return {
    showThinking: state.showThinking,
    showTimestamps: state.showTimestamps,
    expandTools: state.expandTools,
    pinPlan: state.pinPlan,
  };
}
