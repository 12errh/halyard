/**
 * The active model, and the catalogue it is chosen from.
 *
 * Selection lives in local storage rather than on the session so switching
 * models mid-conversation does not fork the thread — opencode accepts the
 * model per prompt, so the newest choice simply wins for the next turn.
 */

import { create } from "zustand";
import {
  clearModelSelection,
  hasScopedSelection,
  labelFor,
  parseCatalogue,
  rankModels,
  readModelSelection,
  usableModels,
  writeModelSelection,
  type FlatModel,
  type ModelCatalogue,
  type ModelSelection,
} from "@/lib/opencode/models";

/** The one catalogue call the store needs. */
export interface ModelApi {
  providerCatalogue(): Promise<unknown>;
}

interface ModelStore {
  catalogue: ModelCatalogue | null;
  models: FlatModel[];
  selection: ModelSelection | null;
  /** Project the selection is scoped to; null means the global default. */
  project: string | null;
  loading: boolean;
  error: string | null;
  /**
   * Supplied by the shell at startup. Held here rather than imported so this
   * module never reaches into the server store and stays testable alone.
   */
  client: ModelApi | null;

  setClient(client: ModelApi | null): void;
  load(): Promise<void>;
  select(selection: ModelSelection): void;
  clear(): void;
  /** Re-read the remembered default, e.g. after switching project. */
  sync(project?: string | null): void;
  /** Is this project's default its own, or inherited? */
  scoped(project?: string | null): boolean;
  reset(): void;
}

export const useModels = create<ModelStore>((set, get) => ({
  catalogue: null,
  models: [],
  selection: readModelSelection(),
  project: null as string | null,
  loading: false,
  error: null,
  client: null,

  setClient: (client) => set({ client }),

  load: async () => {
    const client = get().client;
    if (!client) return;
    set({ loading: true, error: null });
    try {
      const catalogue = parseCatalogue(await client.providerCatalogue());
      const models = usableModels(catalogue);

      // Drop a remembered selection that is no longer available, rather than
      // sending a model id the server will reject at send time. This must not
      // erase the stored preference — the provider may simply be disconnected
      // right now, and the choice should survive reconnecting.
      const remembered = get().selection;
      const stillThere =
        remembered &&
        models.some(
          (m) => m.providerID === remembered.providerID && m.modelID === remembered.modelID,
        );

      set({ catalogue, models, loading: false, selection: stillThere ? remembered : null });
    } catch (cause) {
      set({ loading: false, error: (cause as Error).message || "could not load models" });
    }
  },

  select: (selection) => {
    const project = get().project;
    writeModelSelection(selection, project);
    set({ selection });
  },

  // Clears the project's override rather than writing a blank selection.
  clear: () => {
    const project = get().project;
    clearModelSelection(project);
    set({ selection: readModelSelection(project) });
  },

  sync: (project) => {
    set({ project: project ?? null, selection: readModelSelection(project ?? null) });
  },

  scoped: (project) => hasScopedSelection(project ?? get().project),

  reset: () =>
    set({ catalogue: null, models: [], loading: false, error: null, selection: null }),
}));

export function searchModels(models: FlatModel[], query: string): FlatModel[] {
  return rankModels(models, query);
}

export function selectedLabel(models: FlatModel[], selection: ModelSelection | null): string {
  return labelFor(models, selection);
}
