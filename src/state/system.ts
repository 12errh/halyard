/**
 * Everything the settings tabs read, in one place.
 *
 * Two problems this solves:
 *
 * 1. Each tab used to fetch on mount, so switching tabs refetched and flashed
 *    a spinner over data that was already there.
 * 2. Nothing reflected reality until a manual reload — connect a provider, add
 *    an MCP server, and the tab kept showing the old list.
 *
 * So data is fetched once per server and then kept live by the same SSE
 * subscription the chat already uses. opencode announces changes on
 * `catalog.updated` and `integration.updated`, so a new provider or model
 * appears without anyone reloading anything.
 */

import { create } from "zustand";
import { OpencodeClient, type FormatterStatus, type LspStatus, type StatusEntry } from "@/lib/opencode/client";
import { parseCatalogue, stripSecrets, type Provider } from "@/lib/opencode/models";
import type { ServerEvent } from "@/lib/opencode/types";

export interface Agent {
  name: string;
  description?: string;
  mode?: string;
  native?: boolean;
}

export interface McpState extends StatusEntry {
  status?: string;
  error?: string;
}

/** Events that invalidate the catalogue. */
const CATALOGUE_EVENTS = new Set([
  "catalog.updated",
  "integration.updated",
  "integration.connection.updated",
  "plugin.added",
  "installation.updated",
]);

/** Events that invalidate server diagnostics. */
const DIAGNOSTIC_EVENTS = new Set([
  "mcp.tools.changed",
  "file.watcher.updated",
  "lsp.updated",
  "plugin.added",
]);

interface SystemStore {
  providers: Provider[];
  connected: string[];
  defaults: Record<string, string>;
  mcp: Record<string, McpState>;
  lsp: LspStatus[];
  formatters: FormatterStatus[];
  agents: Agent[];
  authMethods: Record<string, Array<{ type: string; label: string }>>;

  /** True only for the very first load; after that the data is already here. */
  loading: boolean;
  error: string | null;
  client: OpencodeClient | null;

  setClient(client: OpencodeClient | null): void;
  load(): Promise<void>;
  /** Apply a server event; returns true when it triggered a refresh. */
  ingest(event: ServerEvent): void;
  refreshCatalogue(): Promise<void>;
  refreshDiagnostics(): Promise<void>;
  refreshAgents(): Promise<void>;
}

export const useSystem = create<SystemStore>((set, get) => {
  // Several events can land in the same burst (adding one MCP server fires
  // several). Coalesce so we fetch once, not once per event.
  let scheduled = false;
  const schedule = (work: () => Promise<void>) => {
    if (scheduled) return;
    scheduled = true;
    const run = () => {
      scheduled = false;
      void work();
    };
    if (typeof queueMicrotask === "function") queueMicrotask(run);
    else setTimeout(run, 0);
  };

  return {
    providers: [],
    connected: [],
    defaults: {},
    mcp: {},
    lsp: [],
    formatters: [],
    agents: [],
    authMethods: {},
    loading: false,
    error: null,
    client: null,

    setClient: (client) => {
      const changed = get().client?.baseUrl !== client?.baseUrl;
      set({ client });
      // A different server means different providers, models and servers.
      if (changed) {
        set({
          providers: [],
          connected: [],
          mcp: {},
          lsp: [],
          formatters: [],
          agents: [],
          authMethods: {},
        });
      }
    },

    load: async () => {
      const client = get().client;
      if (!client) return;
      set({ loading: true, error: null });
      try {
        await Promise.all([
          get().refreshCatalogue(),
          get().refreshDiagnostics(),
          get().refreshAgents(),
        ]);
        set({ loading: false });
      } catch (error) {
        set({ loading: false, error: (error as Error).message });
      }
    },

    ingest: (event) => {
      if (CATALOGUE_EVENTS.has(event.type)) {
        schedule(async () => {
          await get().refreshCatalogue();
          await get().refreshAgents();
        });
        return;
      }
      if (DIAGNOSTIC_EVENTS.has(event.type)) {
        schedule(() => get().refreshDiagnostics());
      }
    },

    refreshCatalogue: async () => {
      const client = get().client;
      if (!client) return;
      try {
        const [raw, methods] = await Promise.all([
          client.providerCatalogue(),
          client.authMethods().catch(() => ({})),
        ]);
        // `GET /provider` carries no key field, but strip anyway so a future
        // endpoint swap cannot leak one into component state.
        const catalogue = parseCatalogue(stripSecrets(raw));
        set({
          providers: catalogue.providers,
          connected: catalogue.connected,
          defaults: catalogue.defaults,
          authMethods: stripSecrets(methods) as Record<string, Array<{ type: string; label: string }>>,
          error: null,
        });
      } catch (error) {
        set({ error: (error as Error).message });
      }
    },

    refreshDiagnostics: async () => {
      const client = get().client;
      if (!client) return;
      const [mcp, lsp, formatters] = await Promise.all([
        client.mcpStatus().catch(() => ({})),
        client.lspStatus().catch(() => []),
        client.formatterStatus().catch(() => []),
      ]);
      set({ mcp, lsp, formatters });
    },

    refreshAgents: async () => {
      const client = get().client;
      if (!client) return;
      const agents = await client.agents().catch(() => []);
      set({ agents });
    },
  };
});

// --- Selectors -------------------------------------------------------------

/** Providers the user can actually authenticate and use. */
export function connectedProviders(state: SystemStore): Provider[] {
  const connected = new Set(state.connected);
  return state.providers.filter((provider) => connected.has(provider.id));
}

/** Every model across every provider, flattened. */
export function allModels(state: SystemStore) {
  return state.providers.flatMap((provider) =>
    Object.values(provider.models).map((model) => ({
      ...model,
      providerID: provider.id,
      providerName: provider.name,
      connected: state.connected.includes(provider.id),
    })),
  );
}

export function providerSearchText(provider: Provider): string {
  return `${provider.id} ${provider.name}`.toLowerCase();
}