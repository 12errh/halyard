/**
 * Model catalogue.
 *
 * Built on `GET /provider` rather than `GET /config/providers`: the latter
 * returns every provider's API key in plaintext, and there is no reason for a
 * model picker to ever hold one. The sanitiser below is a second line of
 * defence in case a future build reaches for the richer endpoint by mistake.
 */

export interface ModelCost {
  input?: number;
  output?: number;
  cache?: { read?: number; write?: number };
}

export interface ModelLimit {
  context?: number;
  output?: number;
}

export interface ModelInputCapabilities {
  text?: boolean;
  image?: boolean;
  audio?: boolean;
  video?: boolean;
  pdf?: boolean;
}

export interface ProviderModel {
  id: string;
  providerID: string;
  name?: string;
  family?: string;
  cost?: ModelCost;
  limit?: ModelLimit;
  status?: string;
  release_date?: string;
  capabilities?: {
    reasoning?: boolean;
    attachment?: boolean;
    toolcall?: boolean;
    input?: ModelInputCapabilities;
  };
}

export interface Provider {
  id: string;
  name: string;
  models: Record<string, ProviderModel>;
}

export interface ModelCatalogue {
  providers: Provider[];
  connected: string[];
  /** Provider id -> model id, exactly as the server reports. */
  defaults: Record<string, string>;
}

/** Fields that must never survive into app state. */
const SECRET_KEYS = new Set(["key", "apiKey", "api_key", "token", "secret", "headers"]);

/**
 * Strip anything credential-shaped from an unknown payload.
 *
 * Recursive, because a key can sit at any depth. Exported so the behaviour is
 * testable rather than assumed.
 */
export function stripSecrets<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((entry) => stripSecrets(entry)) as unknown as T;
  }
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, inner] of Object.entries(value as Record<string, unknown>)) {
      if (SECRET_KEYS.has(key)) continue;
      out[key] = stripSecrets(inner);
    }
    return out as unknown as T;
  }
  return value;
}

/**
 * Normalise `GET /provider` into the shape the UI uses.
 *
 * `name` is required by the picker, but some rows omit it, so fall back to the
 * id rather than rendering a blank row.
 */
export function parseCatalogue(raw: unknown): ModelCatalogue {
  const payload = stripSecrets(raw) as {
    all?: unknown[];
    connected?: unknown;
    default?: Record<string, unknown>;
  };

  const providers: Provider[] = [];
  for (const entry of Array.isArray(payload?.all) ? payload.all : []) {
    if (!entry || typeof entry !== "object") continue;
    const record = entry as Record<string, unknown>;
    const id = typeof record.id === "string" ? record.id : null;
    if (!id) continue;

    const rawModels = record.models;
    const models: Record<string, ProviderModel> = {};
    if (rawModels && typeof rawModels === "object") {
      for (const [modelId, model] of Object.entries(rawModels as Record<string, unknown>)) {
        if (!model || typeof model !== "object") continue;
        const row = model as Record<string, unknown>;
        models[modelId] = {
          id: modelId,
          providerID: id,
          name: typeof row.name === "string" && row.name ? row.name : modelId,
          family: typeof row.family === "string" ? row.family : undefined,
          cost: row.cost as ModelCost | undefined,
          limit: row.limit as ModelLimit | undefined,
          status: typeof row.status === "string" ? row.status : undefined,
          release_date: typeof row.release_date === "string" ? row.release_date : undefined,
          capabilities: row.capabilities as ProviderModel["capabilities"],
        };
      }
    }

    providers.push({
      id,
      name: typeof record.name === "string" && record.name ? record.name : id,
      models,
    });
  }

  const connected = Array.isArray(payload?.connected)
    ? payload.connected.filter((id): id is string => typeof id === "string")
    : [];

  const defaults: Record<string, string> = {};
  if (payload?.default && typeof payload.default === "object") {
    for (const [providerId, modelId] of Object.entries(payload.default)) {
      if (typeof modelId === "string") defaults[providerId] = modelId;
    }
  }

  return { providers, connected, defaults };
}

export interface FlatModel {
  providerID: string;
  providerName: string;
  modelID: string;
  label: string;
  free: boolean;
  connected: boolean;
  context?: number;
  output?: number;
  reasoning: boolean;
  image: boolean;
}

/** Flatten to a searchable list, filtered to providers the user can actually use. */
export function flattenModels(catalogue: ModelCatalogue): FlatModel[] {
  const out: FlatModel[] = [];
  for (const provider of catalogue.providers) {
    const connected = catalogue.connected.includes(provider.id);
    for (const model of Object.values(provider.models)) {
      const cost = model.cost ?? {};
      // Treat "no price at all" as free; that is how the free tier is expressed.
      const free = !cost.input && !cost.output;
      out.push({
        providerID: provider.id,
        providerName: provider.name,
        modelID: model.id,
        label: model.name ?? model.id,
        free,
        connected,
        context: model.limit?.context,
        output: model.limit?.output,
        reasoning: model.capabilities?.reasoning ?? false,
        image: model.capabilities?.input?.image ?? false,
      });
    }
  }
  return out;
}

/**
 * Models usable right now.
 *
 * An unconnected provider cannot authenticate, so offering it only produces a
 * confusing failure at send time.
 */
export function usableModels(catalogue: ModelCatalogue): FlatModel[] {
  return flattenModels(catalogue).filter((model) => model.connected);
}

export function formatContext(tokens?: number): string {
  if (!tokens) return "";
  if (tokens >= 1_000_000) {
    // 1048576 is conventionally "1M", not "1.0M".
    return `${(tokens / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
  }
  if (tokens >= 1_000) return `${Math.round(tokens / 1_000)}k`;
  return String(tokens);
}

/** Score-based ranking: free, image-capable and connected models first. */
export function rankModels(models: FlatModel[], query: string): FlatModel[] {
  const needle = query.trim().toLowerCase();
  const filtered = needle
    ? models.filter((m) =>
        [m.label, m.modelID, m.providerName, m.providerID]
          .join(" ")
          .toLowerCase()
          .includes(needle),
      )
    : models.slice();

  const score = (model: FlatModel) =>
    (model.free ? 0 : 1) * 1000 + (model.image ? 0 : 1) * 10 + (model.reasoning ? 0 : 1);

  return filtered.sort((a, b) => {
    const delta = score(a) - score(b);
    if (delta !== 0) return delta;
    return a.label.localeCompare(b.label);
  });
}

/**
 * The remembered default model.
 *
 * Keyed by project. A single global default would be wrong for a tool you use
 * across several repos — the model that suits a Rust service is rarely the one
 * you want for a docs site — and switching projects should not silently change
 * which model you get.
 *
 * This is Halyard's own preference and applies instantly. opencode's own
 * `model` config key is a separate, slower thing: it lives in the config file
 * and only takes effect after a restart.
 */

const STORE_KEY = "halyard.models";
const GLOBAL = "*";

export interface ModelSelection {
  providerID: string;
  modelID: string;
}

type Store = Record<string, ModelSelection>;

function readStore(): Store {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Store;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    // Corrupt value: start clean rather than break the picker.
    return {};
  }
}

function writeStore(store: Store) {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(store));
  } catch {
    // Persistence is a convenience, not a requirement.
  }
}

function isSelection(value: unknown): value is ModelSelection {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return typeof record.providerID === "string" && typeof record.modelID === "string";
}

/** The default for a project, falling back to the cross-project default. */
export function readModelSelection(project?: string | null): ModelSelection | null {
  const store = readStore();
  const scoped = project ? store[project] : undefined;
  if (isSelection(scoped)) return scoped;
  return isSelection(store[GLOBAL]) ? store[GLOBAL] : null;
}

/** Set the default for one project, leaving other projects untouched. */
export function writeModelSelection(selection: ModelSelection, project?: string | null): void {
  const store = readStore();
  store[project ?? GLOBAL] = selection;
  writeStore(store);
}

/** Clear a project's override so it inherits the cross-project default again. */
export function clearModelSelection(project?: string | null): void {
  const store = readStore();
  if (!project) {
    delete store[GLOBAL];
  } else {
    delete store[project];
  }
  writeStore(store);
}

/** Does this project have its own default, or is it inheriting? */
export function hasScopedSelection(project?: string | null): boolean {
  return isSelection(readStore()[project ?? GLOBAL]);
}

export function labelFor(models: FlatModel[], selection: ModelSelection | null): string {
  if (!selection) return "";
  const match = models.find(
    (m) => m.providerID === selection.providerID && m.modelID === selection.modelID,
  );
  return match?.label ?? selection.modelID;
}
