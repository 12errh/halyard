/**
 * The active model, and the catalogue it is chosen from.
 *
 * Selection lives in local storage rather than on the session so switching
 * models mid-conversation does not fork the thread — opencode accepts the
 * model per prompt, so the newest choice simply wins for the next turn.
 */

import { create } from "zustand";
import type { ModelInfo, ProviderInfo, V2Event } from "@/lib/opencode/types";
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

/** The two catalogue calls the store needs. */
export interface ModelApi {
  providers(): Promise<import("@/lib/opencode/types").ProviderInfo[]>;
  models(): Promise<import("@/lib/opencode/types").ModelInfo[]>;
}

/**
 * v2 populates `GET /api/provider` lazily: immediately after boot it can return
 * zero (or only some) providers while `/api/model` is already complete. Models
 * are joined onto providers, so a one-shot fetch drops whichever providers
 * raced the load. Poll briefly until every model's provider has an activation.
 */
const PROVIDER_RETRY_DELAYS = [150, 300, 600, 1200, 2000];

async function fetchCatalogue(client: ModelApi): Promise<{
  providers: ProviderInfo[];
  models: ModelInfo[];
}> {
  let providers = await client.providers();
  let models = await client.models();

  for (const delay of PROVIDER_RETRY_DELAYS) {
    const known = new Set(providers.map((provider) => provider.id));
    const missing = models.some((model) => model.providerID && !known.has(model.providerID));
    if (!missing && providers.length > 0) break;
    // `Promise.withResolvers` is not in this project's ES2022 lib target.
    await new Promise<void>((resolve) => {
      setTimeout(resolve, delay);
    });
    [providers, models] = await Promise.all([client.providers(), client.models()]);
  }

  return { providers, models };
}

const MODEL_EVENTS: Record<string, true> = {
  "config.updated": true,
  "provider.updated": true,
  "model.updated": true,
  "integration.updated": true,
  "credential.updated": true,
  "credential.switched": true,
};

let loadSeq = 0;
let ingestQueued = false;

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
  /** Refresh when the server reports a provider/model/credential change. */
  ingest(event: V2Event): void;
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

  setClient: (client) => {
    // Cancel an in-flight load for the previous server.
    loadSeq += 1;
    set({ client });
  },

  load: async () => {
    const client = get().client;
    if (!client) return;
    const seq = (loadSeq += 1);
    set({ loading: true, error: null });
    try {
      const { providers, models: catalogueModels } = await fetchCatalogue(client);
      if (seq !== loadSeq) return;
      const catalogue = parseCatalogue(providers, catalogueModels);
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
      if (seq !== loadSeq) return;
      set({ loading: false, error: (cause as Error).message || "could not load models" });
    }
  },

  ingest: (event) => {
    if (!MODEL_EVENTS[event.type] || ingestQueued) return;
    ingestQueued = true;
    queueMicrotask(() => {
      ingestQueued = false;
      void get().load();
    });
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

  reset: () => {
    loadSeq += 1;
    set({ catalogue: null, models: [], loading: false, error: null, selection: null });
  },
}));

export function searchModels(models: FlatModel[], query: string): FlatModel[] {
  return rankModels(models, query);
}

export function selectedLabel(models: FlatModel[], selection: ModelSelection | null): string {
  return labelFor(models, selection);
}
