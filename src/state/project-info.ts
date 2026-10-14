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
import type { ServerEvent } from "@/lib/opencode/types";

export interface VcsState {
  branch: string | null;
  defaultBranch: string | null;
  /** Files the agent has changed, keyed by path. */
  fileStatus: Record<string, string>;
  loaded: boolean;
}

interface ProjectStore extends VcsState {
  load(client: VcsClient): Promise<void>;
  ingest(event: ServerEvent): void;
  reset(): void;
}

/** The slice of the opencode client this store needs. */
export interface VcsClient {
  vcs(): Promise<{ branch?: string; default_branch?: string }>;
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
        defaultBranch: vcs?.default_branch ?? null,
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
    switch (event.type) {
      case "vcs.branch.updated": {
        const branch = (event.properties as { branch?: string }).branch;
        if (typeof branch === "string") set({ branch });
        break;
      }
      case "file.watcher.updated":
      case "file.status": {
        const raw = (event.properties as { files?: unknown }).files;
        if (Array.isArray(raw)) set({ fileStatus: indexFiles(raw as Array<Record<string, unknown>>) });
        break;
      }
      case "file.edited": {
        // An edit the agent made outside the diff feed — a file saved in the
        // editor, say. Mark it rather than dropping the signal.
        const file = (event.properties as { file?: string }).file;
        if (typeof file === "string") {
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
