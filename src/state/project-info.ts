/**
 * Project-level state that is not conversation: the git branch, and which
 * files the agent has touched.
 *
 * Both come from opencode rather than being worked out here. The branch in
 * particular is worth taking from the server rather than shelling out to git:
 * opencode already knows it, and a second source of truth for "which branch am
 * I on" is a second thing to be wrong.
 */

import { create } from "zustand";
import type { V2Event } from "@/lib/opencode/types";

export interface VcsState {
  branch: string | null;
  defaultBranch: string | null;
  /** Files the agent has changed, keyed by path. */
  fileStatus: Record<string, string>;
  loaded: boolean;
}

interface ProjectStore extends VcsState {
  load(client: VcsClient): Promise<void>;
  ingest(event: V2Event): void;
  reset(): void;
}

/** The slice of the opencode client this store needs. */
export interface VcsClient {
  vcs(): Promise<{ branch: string | null; defaultBranch: string | null }>;
  fileStatus(): Promise<Array<Record<string, unknown>>>;
}

const EMPTY: VcsState = { branch: null, defaultBranch: null, fileStatus: {}, loaded: false };

export const useProjectInfo = create<ProjectStore>((set) => ({
  ...EMPTY,

  load: async (client) => {
    try {
      const [vcs, files] = await Promise.all([
        client.vcs().catch(() => null),
        client.fileStatus().catch(() => []),
      ]);
      set({
        branch: vcs?.branch ?? null,
        defaultBranch: vcs?.defaultBranch ?? null,
        fileStatus: indexFiles(files),
        loaded: true,
      });
    } catch {
      // A project with no git repository, or a server that does not expose
      // these, is normal. The UI simply shows nothing.
      set({ loaded: true });
    }
  },

  ingest: (event) => {
    const data = (event.data ?? {}) as { branch?: unknown; file?: unknown; event?: unknown };
    switch (event.type) {
      case "vcs.branch.updated": {
        if (typeof data.branch === "string") set({ branch: data.branch });
        break;
      }
      case "filesystem.changed": {
        // v2 reports one file at a time and says whether it appeared,
        // changed, or disappeared. There is no status payload to index.
        const file = data.file;
        if (typeof file !== "string" || !file) break;
        if (data.event === "unlink") {
          set((s) => {
            if (!(file in s.fileStatus)) return s;
            const fileStatus = { ...s.fileStatus };
            delete fileStatus[file];
            return { fileStatus };
          });
        } else {
          set((s) => ({ fileStatus: { ...s.fileStatus, [file]: "modified" } }));
        }
        break;
      }
      default:
        break;
    }
  },

  reset: () => set({ ...EMPTY }),
}));

/**
 * Index the file-status payload by path.
 *
 * The array arrives in a couple of shapes depending on whether it came from
 * the endpoint or the event, so both keys are accepted and the first usable
 * status wins.
 */
export function indexFiles(files: Array<Record<string, unknown>>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const file of files) {
    const path = file.file ?? file.path;
    if (typeof path !== "string" || !path) continue;
    const status = file.status;
    out[path] = typeof status === "string" ? status : "modified";
  }
  return out;
}

/** How many files the agent has changed, for the header badge. */
export function changedCount(fileStatus: Record<string, string>): number {
  return Object.keys(fileStatus).length;
}

/** Whether the current branch is the project's default. */
export function onDefaultBranch(state: Pick<VcsState, "branch" | "defaultBranch">): boolean {
  if (!state.branch || !state.defaultBranch) return true;
  return state.branch === state.defaultBranch;
}
