import { describe, expect, it } from "vitest";
import {
  clearModelSelection,
  flattenModels,
  formatContext,
  hasScopedSelection,
  labelFor,
  parseCatalogue,
  rankModels,
  readModelSelection,
  stripSecrets,
  usableModels,
  writeModelSelection,
} from "@/lib/opencode/models";
import type { ModelInfo, ProviderInfo } from "@/lib/opencode/types";

/**
 * Captured from a real opencode 2.4.2 server. v2 sends activities as
 * `auto | enabled | disabled`, prices as an array of tiers and input media as
 * an array of names.
 */
const PROVIDERS: ProviderInfo[] = [
  { id: "anthropic", name: "Anthropic", activation: "enabled" },
  { id: "opencode", name: "opencode", activation: "auto" },
  { id: "local", name: "Local", activation: "disabled" },
  { id: "", name: "Broken" },
];

const MODELS: ModelInfo[] = [
  {
    id: "m1",
    modelID: "claude-x",
    providerID: "anthropic",
    name: "Claude X",
    family: "claude",
    cost: [{ input: 3, output: 15, cache: { read: 0.3, write: 3.75 } }],
    limit: { context: 200_000, output: 8_192 },
    capabilities: { tools: true, temperature: true, input: ["text", "image"] },
  },
  {
    id: "m2",
    modelID: "claude-y",
    providerID: "anthropic",
    name: "",
    cost: [
      { tier: { type: "context", size: 200_000 }, input: 6, output: 22 },
      { input: 1, output: 2 },
    ],
    capabilities: { input: ["text"] },
  },
  {
    id: "m3",
    modelID: "free-model",
    providerID: "opencode",
    name: "Free",
    cost: [{ input: 0, output: 0, cache: { read: 0, write: 0 } }],
    limit: { context: 1_048_576 },
    capabilities: { tools: true, input: ["text"] },
  },
  { id: "m4", modelID: "local-z", providerID: "local", name: "Local Z" },
  {
    id: "m5",
    modelID: "orphan",
    providerID: "missing",
    name: "Orphan",
    cost: [{ input: 0, output: 0 }],
  },
];

const USABLE_FREE = ["free-model"];

function catalogue() {
  return parseCatalogue(PROVIDERS, MODELS);
}

// ---------------------------------------------------------------------------

describe("parseCatalogue", () => {
  it("joins model rows onto their providers", () => {
    const result = catalogue();
    expect(result.providers.map((provider) => provider.id)).toEqual([
      "anthropic",
      "opencode",
      "local",
      "missing",
    ]);

    const anthropic = result.providers[0]!;
    expect(Object.keys(anthropic.models)).toEqual(["claude-x", "claude-y"]);
    expect(anthropic.models["claude-x"]).toMatchObject({
      id: "claude-x",
      providerID: "anthropic",
      name: "Claude X",
      family: "claude",
      cost: { input: 3, output: 15 },
      limit: { context: 200_000, output: 8_192 },
      capabilities: { toolcall: true, input: { text: true, image: true } },
    });
  });

  it("uses the untiered price when the server sends price tiers", () => {
    expect(catalogue().providers[0]!.models["claude-y"]!.cost).toEqual({ input: 1, output: 2 });
  });

  it("falls back to the model id when the row has no name", () => {
    expect(catalogue().providers[0]!.models["claude-y"]!.name).toBe("claude-y");
  });

  it("marks enabled and auto providers as connected but disabled ones not", () => {
    expect(catalogue().connected).toEqual(["anthropic", "opencode"]);
  });

  it("treats a provider without an activation field as connected for v1", () => {
    const result = parseCatalogue(
      [{ id: "legacy", name: "Legacy" }, { id: "off", name: "Off", activation: "disabled" }],
      MODELS,
    );
    expect(result.connected).toEqual(["legacy"]);
  });

  it("does not invent defaults", () => {
    expect(catalogue().defaults).toEqual({});
  });

  it("keeps models whose provider has not appeared in /provider yet", () => {
    const orphan = catalogue().providers.find((provider) => provider.id === "missing");
    expect(Object.keys(orphan?.models ?? {})).toEqual(["orphan"]);
    expect(catalogue().connected).not.toContain("missing");
  });
});

describe("catalogue views", () => {
  it("flattens every model and derives cost and capability flags", () => {
    const flat = flattenModels(catalogue());
    expect(flat).toHaveLength(5);

    expect(flat.find((model) => model.modelID === "claude-x")).toMatchObject({
      providerName: "Anthropic",
      label: "Claude X",
      free: false,
      connected: true,
      image: true,
      context: 200_000,
    });

    const free = flat.find((model) => model.modelID === "free-model");
    expect(free).toMatchObject({ free: true, connected: true, reasoning: false, image: false });

    const orphan = flat.find((model) => model.modelID === "orphan");
    expect(orphan).toMatchObject({ free: true, connected: false });
  });

  it("offers only models from connected providers as usable", () => {
    const usable = usableModels(catalogue()).map((model) => model.modelID);
    expect(usable).not.toContain("local-z");
    expect(usable).not.toContain("orphan");
    expect(usable).toEqual(expect.arrayContaining(USABLE_FREE));
  });

  it("ranks free, image-capable and reasoning models first", () => {
    const ranked = rankModels(flattenModels(catalogue()), "");
    expect(ranked[0]!.modelID).toBe("free-model");
    const ids = ranked.map((model) => model.modelID);
    expect(ids.indexOf("claude-x")).toBeLessThan(ids.indexOf("claude-y"));
  });

  it("filters on the query", () => {
    expect(rankModels(flattenModels(catalogue()), "local").map((model) => model.modelID)).toEqual([
      "local-z",
    ]);
  });

  it("formats context windows compactly", () => {
    expect(formatContext(1_048_576)).toBe("1M");
    expect(formatContext(200_000)).toBe("200k");
    expect(formatContext(512)).toBe("512");
    expect(formatContext(undefined)).toBe("");
  });
});

/**
 * Regression: `/api/provider` is populated lazily by opencode 2.4.2. If it is
 * empty when the app boots, the catalogue used to drop every model and the
 * picker showed "No usable models" for the whole session.
 */
describe("v2 lazy provider loading", () => {
  const LIVE_PROVIDERS: ProviderInfo[] = [
    { id: "opencode", name: "opencode", activation: "enabled" },
    { id: "freepi", name: "free-pi (via local proxy)", activation: "enabled" },
    { id: "agentrouter", name: "AgentRouter", activation: "auto" },
  ];

  const LIVE_MODELS: ModelInfo[] = [
    {
      id: "opencode/seaglass-alpha-free",
      modelID: "seaglass-alpha-free",
      providerID: "opencode",
      name: "Seaglass Alpha Free",
      cost: [{ input: 0, output: 0, cache: { read: 0, write: 0 } }],
      limit: { context: 200_000, output: 64_000 },
      capabilities: { tools: true, temperature: true, input: ["text"] },
    },
    {
      id: "google/gemini-4-neon",
      modelID: "gemini-4-neon",
      providerID: "google",
      name: "Gemini 4 Neon",
      cost: [{ input: 1.25, output: 10 }],
      limit: { context: 1_048_576, output: 65_536 },
      capabilities: { tools: true, input: ["text", "image", "video"] },
    },
    {
      id: "freepi/deepseek-v4.1-flash",
      modelID: "deepseek-v4.1-flash",
      providerID: "freepi",
      name: "DeepSeek v4.1 Flash",
      limit: { context: 128_000 },
      capabilities: { tools: true, input: ["text"] },
    },
  ];

  it("builds a non-empty catalogue before any provider arrives", () => {
    const raced = parseCatalogue([], LIVE_MODELS);
    expect(raced.providers.map((provider) => provider.id)).toEqual(["opencode", "google", "freepi"]);
    expect(flattenModels(raced)).toHaveLength(LIVE_MODELS.length);
    expect(raced.connected).toEqual([]);
  });

  it("exposes free models once the providers are loaded", () => {
    const result = parseCatalogue(LIVE_PROVIDERS, LIVE_MODELS);
    const usable = usableModels(result).map((model) => model.modelID);
    expect(usable).toContain("seaglass-alpha-free");
    expect(usable).toContain("deepseek-v4.1-flash");

    const free = flattenModels(result)
      .filter((model) => model.free)
      .map((model) => model.modelID);
    expect(free).toEqual(
      expect.arrayContaining(["seaglass-alpha-free", "deepseek-v4.1-flash"]),
    );
    expect(free).not.toContain("gemini-4-neon");
    expect(flattenModels(result).find((model) => model.modelID === "gemini-4-neon")).toMatchObject({
      image: true,
      free: false,
    });
  });
});

describe("model selection", () => {
  it("round-trips a scoped selection", () => {
    writeModelSelection({ providerID: "anthropic", modelID: "claude-x" }, "/repo/a");
    expect(readModelSelection("/repo/a")).toEqual({
      providerID: "anthropic",
      modelID: "claude-x",
    });
    expect(hasScopedSelection("/repo/a")).toBe(true);

    clearModelSelection("/repo/a");
    expect(readModelSelection("/repo/a")).toBeNull();
    expect(hasScopedSelection("/repo/a")).toBe(false);
  });

  it("falls back to the global selection", () => {
    writeModelSelection({ providerID: "opencode", modelID: "free-model" });
    try {
      expect(readModelSelection("/repo/b")).toEqual({
        providerID: "opencode",
        modelID: "free-model",
      });
    } finally {
      clearModelSelection();
    }
  });

  it("labels a selection from the catalogue, or falls back to the id", () => {
    const flat = flattenModels(catalogue());
    expect(labelFor(flat, { providerID: "anthropic", modelID: "claude-x" })).toBe("Claude X");
    expect(labelFor(flat, { providerID: "anthropic", modelID: "gone" })).toBe("gone");
    expect(labelFor(flat, null)).toBe("");
  });
});

describe("stripSecrets", () => {
  it("removes credential-shaped keys at any depth", () => {
    const raw = {
      provider: { id: "anthropic", key: "sk-live", options: { apiKey: "x", token: "y" } },
      list: [{ secret: "s", name: "keep" }],
    };

    expect(stripSecrets(raw)).toEqual({
      provider: { id: "anthropic", options: {} },
      list: [{ name: "keep" }],
    });
  });

  it("leaves primitives alone", () => {
    expect(stripSecrets("plain")).toBe("plain");
    expect(stripSecrets(7)).toBe(7);
  });
});
