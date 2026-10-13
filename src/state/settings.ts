/**
 * Settings that live in opencode's own configuration.
 *
 * Read path is HTTP (`GET /config` gives the merged, effective view). Write
 * path is the filesystem: verified against opencode 1.18.35, `PATCH /config`
 * validates and echoes but persists nothing, and the server does not hot-reload
 * the file either. So a save writes the file and then restarts the server,
 * which this app already owns.
 */

import { create } from "zustand";
import { api, type ConfigFile } from "@/lib/tauri";
import { useServer } from "@/state/server";
import { OpencodeClient } from "@/lib/opencode/client";

export type ConfigScope = "project" | "global";

interface SettingsStore {
  /** Merged config as the server reports it. */
  effective: Record<string, unknown> | null;
  /** The file the editor is editing, verbatim. */
  file: ConfigFile | null;
  scope: ConfigScope;
  draft: string;
  /** Validation message for the draft, if any. */
  error: string | null;
  dirty: boolean;
  saving: boolean;
  loading: boolean;

  load(directory: string | null): Promise<void>;
  setScope(scope: ConfigScope): Promise<void>;
  setDraft(draft: string): void;
  save(): Promise<boolean>;
  revert(): void;
}

export const useSettings = create<SettingsStore>((set, get) => ({
  effective: null,
  file: null,
  scope: "project",
  draft: "",
  error: null,
  dirty: false,
  saving: false,
  loading: false,

  load: async (directory) => {
    set({ loading: true, error: null });
    try {
      const file = await readFile(get().scope, directory);
      set({ file, draft: file.content, dirty: false, loading: false });
      await refreshEffective();
    } catch (error) {
      set({ loading: false, error: (error as Error).message });
    }
  },

  setScope: async (scope) => {
    set({ scope });
    await get().load(null);
  },

  setDraft: (draft) => set({ draft, dirty: draft !== get().file?.content, error: null }),

  save: async () => {
    const file = get().file;
    if (!file) return false;

    set({ saving: true, error: null });
    try {
      // Validate before replacing a working config.
      await api.validateConfig(get().draft);
      await api.writeConfigFile(file.path, get().draft);

      // opencode reads config at start and never re-reads it, so a restart is
      // the only way the change takes effect. Halyard owns that lifecycle.
      await useServer.getState().restart();

      set({ saving: false, dirty: false, file: { ...file, content: get().draft, exists: true } });
      await refreshEffective();
      return true;
    } catch (error) {
      set({ saving: false, error: (error as Error).message });
      return false;
    }
  },

  revert: () =>
    set((state) => ({
      draft: state.file?.content ?? "",
      dirty: false,
      error: null,
    })),
}));

async function readFile(scope: ConfigScope, directory: string | null): Promise<ConfigFile> {
  if (scope === "global") return api.globalConfig();
  return api.readConfigFile(directory ?? ".");
}

async function refreshEffective(): Promise<void> {
  const phase = useServer.getState().phase;
  if (phase.kind !== "ready") return;
  try {
    const client = new OpencodeClient(phase.info.url);
    const config = await client.config();
    useSettings.setState({ effective: config as Record<string, unknown> });
  } catch {
    // A missing effective view should not block editing the file.
  }
}

/**
 * Apply a value to a nested config key, returning a new document.
 *
 * Used by the structured tabs so they write the same shape the raw editor
 * would, and so a missing intermediate object is created rather than throwing.
 */
export function setPath(document: unknown, path: string[], value: unknown): Record<string, unknown> {
  const [head, ...rest] = path;
  if (!head) return document as Record<string, unknown>;

  const root: Record<string, unknown> =
    document && typeof document === "object" && !Array.isArray(document)
      ? { ...(document as Record<string, unknown>) }
      : {};

  if (rest.length === 0) {
    root[head] = value;
    return root;
  }

  root[head] = setPath(root[head], rest, value);
  return root;
}

/** Read a nested value, or `fallback` when any step is missing. */
export function getPath(document: unknown, path: string[], fallback: unknown = undefined): unknown {
  let current: unknown = document;
  for (const key of path) {
    if (!current || typeof current !== "object") return fallback;
    current = (current as Record<string, unknown>)[key];
  }
  return current === undefined ? fallback : current;
}

/** Pretty-print a config document for the editor. */
export function formatConfig(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

/** One-line summary of a config for the effective-view list. */
export function describeValue(value: unknown): string {
  if (value === null || value === undefined) return "—";
  if (typeof value === "string") return value.length > 48 ? `${value.slice(0, 48)}…` : value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) return `${value.length} item${value.length === 1 ? "" : "s"}`;
  const entries = Object.entries(value as Record<string, unknown>);
  if (entries.length === 0) return "empty";
  return `${entries.length} key${entries.length === 1 ? "" : "s"}`;
}

/** Config keys surfaced as individual rows in the overview. */
export const CONFIG_SECTIONS: Array<{ key: string; label: string; hint: string }> = [
  { key: "model", label: "Default model", hint: "Used when a session does not pick one." },
  { key: "small_model", label: "Small model", hint: "Cheaper model for titles and summaries." },
  { key: "default_agent", label: "Default agent", hint: "Agent new sessions start with." },
  { key: "mode", label: "Default mode", hint: "build or plan." },
  { key: "share", label: "Sharing", hint: "Whether sessions can be published." },
  { key: "autoupdate", label: "Auto-update", hint: "opencode updating itself." },
  { key: "instructions", label: "Instructions", hint: "Extra rules appended to the system prompt." },
  { key: "permission", label: "Permissions", hint: "Per-tool allow, ask or deny rules." },
  { key: "mcp", label: "MCP servers", hint: "Configured MCP servers." },
  { key: "agent", label: "Agents", hint: "Custom agent definitions." },
  { key: "lsp", label: "Language servers", hint: "Configured LSP servers." },
  { key: "formatter", label: "Formatters", hint: "Configured formatters." },
  { key: "plugin", label: "Plugins", hint: "Loaded plugins." },
  { key: "provider", label: "Provider options", hint: "Per-provider model configuration." },
  { key: "disabled_providers", label: "Disabled providers", hint: "Providers hidden from pickers." },
];
