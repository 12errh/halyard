/**
 * The active model, and the catalogue it is chosen from.
 *
 * Selection lives in local storage rather than on the session so switching
 * models mid-conversation does not fork the thread — opencode accepts the
 * model per prompt, so the newest choice simply wins for the next turn.
 */

import { create } from "zustand";
import {
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
  reset(): void;
}

export const useModels = create<ModelStore>((set, get) => ({
  catalogue: null,
  models: [],
  selection: readModelSelection(),
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
      // sending a model id the server will reject at send time.
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
    writeModelSelection(selection);
    set({ selection });
  },

  clear: () => {
    writeModelSelection({ providerID: "", modelID: "" });
    set({ selection: null });
  },

  reset: () =>
    set({ catalogue: null, models: [], loading: false, error: null, selection: null }),
}));

export function searchModels(models: FlatModel[], query: string): FlatModel[] {
  return rankModels(models, query);
}

export function selectedLabel(models: FlatModel[], selection: ModelSelection | null): string {
  return labelFor(models, selection);
}
