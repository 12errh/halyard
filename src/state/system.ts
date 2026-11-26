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
import { OpencodeClient } from "@/lib/opencode/client";
import { parseCatalogue, stripSecrets, type Provider } from "@/lib/opencode/models";
import type {
  CredentialEntry,
  IntegrationInfo,
  McpServer,
  V2Event,
} from "@/lib/opencode/types";

export interface Agent {
  name: string;
  description?: string;
  mode?: string;
  native?: boolean;
}

export interface McpState {
  name: string;
  status: string;
  error?: string;
}

/** Events that invalidate the provider/model/agent catalogue. */
const CATALOGUE_EVENTS = new Set([
  "config.updated",
  "provider.updated",
  "model.updated",
  "agent.updated",
  "command.updated",
  "skill.updated",
  "plugin.updated",
  "installation.updated",
]);

/** Events that change the MCP servers or their status. */
const DIAGNOSTIC_EVENTS = new Set(["mcp.status.changed", "mcp.resources.changed"]);

/** Events that change the integration or credential lists. */
const INTEGRATION_EVENTS = new Set([
  "integration.updated",
  "credential.updated",
  "credential.switched",
]);

interface SystemStore {
  providers: Provider[];
  connected: string[];
  defaults: Record<string, string>;
  mcp: Record<string, McpState>;
  agents: Agent[];
  integrations: IntegrationInfo[];
  credentials: CredentialEntry[];

  /** True only for the very first load; after that the data is already here. */
  loading: boolean;
  error: string | null;
  client: OpencodeClient | null;

  setClient(client: OpencodeClient | null): void;
  load(): Promise<void>;
  /** Apply a server event; returns true when it triggered a refresh. */
  ingest(event: V2Event): void;
  refreshCatalogue(): Promise<void>;
  refreshDiagnostics(): Promise<void>;
  refreshAgents(): Promise<void>;
  refreshIntegrations(): Promise<void>;
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
    agents: [],
    integrations: [],
    credentials: [],
    loading: false,
    error: null,
    client: null,

    setClient: (client) => {
      const changed = get().client?.serverKey !== client?.serverKey;
      set({ client });
      // A different server means different providers, models and servers.
      if (changed) {
        set({
          providers: [],
          connected: [],
          mcp: {},
          agents: [],
          integrations: [],
          credentials: [],
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
          get().refreshIntegrations(),
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
      if (INTEGRATION_EVENTS.has(event.type)) {
        schedule(() => get().refreshIntegrations());
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
        // Providers carry identity and activation; models carry limits and
        // capabilities. Both are separate v2 routes, and neither is a secret.
        const [providers, models] = await Promise.all([
          client.providers(),
          client.models(),
        ]);
        const catalogue = parseCatalogue(stripSecrets(providers), stripSecrets(models));
        set({
          providers: catalogue.providers,
          connected: catalogue.connected,
          defaults: catalogue.defaults,
          error: null,
        });
      } catch (error) {
        set({ error: (error as Error).message });
      }
    },

    refreshDiagnostics: async () => {
      const client = get().client;
      if (!client) return;
      const servers = await client.mcpStatus().catch(() => [] as McpServer[]);
      const mcp: Record<string, McpState> = {};
      for (const server of servers) {
        const state = parseMcpStatus(server);
        if (state) mcp[state.name] = state;
      }
      set({ mcp });
    },

    refreshAgents: async () => {
      const client = get().client;
      if (!client) return;
      const agents = await client.agents().catch(() => []);
      set({ agents });
    },

    refreshIntegrations: async () => {
      const client = get().client;
      if (!client) return;
      const [integrations, credentials] = await Promise.all([
        client.integrations().catch(() => [] as IntegrationInfo[]),
        client.credentials().catch(() => [] as CredentialEntry[]),
      ]);
      set({ integrations, credentials });
    },
  };
});

/**
 * Normalise one `GET /api/mcp` row.
 *
 * The v2 server nests state (`{status: {status, error}}`) while the older
 * flat string survives in a few builds; both are accepted.
 */
function parseMcpStatus(server: McpServer): McpState | null {
  if (!server || typeof server.name !== "string") return null;
  const raw = (server as { status?: unknown }).status;
  if (typeof raw === "string") return { name: server.name, status: raw };
  if (raw && typeof raw === "object") {
    const record = raw as { status?: unknown; error?: unknown };
    return {
      name: server.name,
      status: typeof record.status === "string" ? record.status : "unknown",
      error: typeof record.error === "string" ? record.error : undefined,
    };
  }
  return { name: server.name, status: "unknown" };
}

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