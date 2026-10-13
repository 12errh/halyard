/**
 * Structured edits to opencode's config file.
 *
 * Every write goes through the settings store's save path, which validates,
 * writes atomically and restarts the server — because opencode re-reads config
 * only at start and `PATCH /config` persists nothing.
 */

import { api } from "@/lib/tauri";
import { formatConfig, setPath, useSettings } from "@/state/settings";

/** Current draft as an object, or an empty document when it will not parse. */
function draftAsObject(): Record<string, unknown> {
  try {
    return JSON.parse(useSettings.getState().draft) as Record<string, unknown>;
  } catch {
    return {};
  }
}

/** Apply a change to `path`, then save and restart. */
export async function writeConfigValue(path: string[], value: unknown): Promise<boolean> {
  const next = setPath(draftAsObject(), path, value);
  useSettings.getState().setDraft(formatConfig(next));
  return useSettings.getState().save();
}

export async function removeConfigValue(path: string[]): Promise<boolean> {
  const root = draftAsObject();
  let cursor: Record<string, unknown> = root;
  for (const key of path.slice(0, -1)) {
    const next = cursor[key];
    if (!next || typeof next !== "object") return false;
    cursor = next as Record<string, unknown>;
  }
  delete cursor[path[path.length - 1]!];
  useSettings.getState().setDraft(formatConfig(root));
  return useSettings.getState().save();
}

export interface CustomModelInput {
  providerID: string;
  modelID: string;
  name?: string;
  /** npm package the provider speaks, e.g. @ai-sdk/openai-compatible. */
  npm?: string;
  baseURL?: string;
}

/**
 * Register a model on an existing provider.
 *
 * opencode derives its model list from each provider's catalogue, so a model it
 * does not know about has to be declared under `provider.<id>.models`.
 */
export async function addCustomModel(input: CustomModelInput): Promise<boolean> {
  const { providerID, modelID, name, npm, baseURL } = input;
  if (!providerID.trim() || !modelID.trim()) return false;

  const model: Record<string, unknown> = { name: name?.trim() || modelID.trim() };
  if (npm?.trim()) model["npm"] = npm.trim();
  if (baseURL?.trim()) {
    model["options"] = { ...(existingOptions(model) as object), baseURL: baseURL.trim() };
  }

  return writeConfigValue(["provider", providerID.trim(), "models", modelID.trim()], model);
}

function existingOptions(model: Record<string, unknown>): Record<string, unknown> {
  const options = model["options"];
  return options && typeof options === "object" ? (options as Record<string, unknown>) : {};
}

export interface CustomAgentInput {
  name: string;
  description?: string;
  prompt: string;
  mode?: "primary" | "subagent";
  model?: string;
  /** Tool names to hide from the agent. */
  tools?: Record<string, boolean>;
}

/** Define an agent under `agent.<name>` in the config file. */
export async function addCustomAgent(input: CustomAgentInput): Promise<boolean> {
  const name = input.name.trim();
  if (!name || !input.prompt.trim()) return false;

  const agent: Record<string, unknown> = {
    description: input.description?.trim() || name,
    mode: input.mode ?? "subagent",
    prompt: input.prompt.trim(),
  };
  if (input.model?.trim()) agent["model"] = input.model.trim();
  if (input.tools && Object.keys(input.tools).length > 0) agent["tools"] = input.tools;

  return writeConfigValue(["agent", name], agent);
}

/** Remove a custom agent. */
export async function removeCustomAgent(name: string): Promise<boolean> {
  return removeConfigValue(["agent", name]);
}

export async function removeCustomModel(providerID: string, modelID: string): Promise<boolean> {
  return removeConfigValue(["provider", providerID, "models", modelID]);
}

/** Validate before writing, so a bad document never replaces a good one. */
export async function checkConfig(content: string): Promise<string | null> {
  try {
    await api.validateConfig(content);
    return null;
  } catch (error) {
    return (error as Error).message;
  }
}