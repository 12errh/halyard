import { afterEach, describe, expect, it, vi } from "vitest";
import type { ModelInfo, ProviderInfo, V2Event } from "@/lib/opencode/types";
import { useModels, type ModelApi } from "@/state/models";

const PROVIDERS: ProviderInfo[] = [
  { id: "opencode", name: "opencode", activation: "enabled" },
  { id: "freepi", name: "free-pi (via local proxy)", activation: "enabled" },
];

const MODELS: ModelInfo[] = [
  {
    id: "opencode/seaglass-alpha-free",
    modelID: "seaglass-alpha-free",
    providerID: "opencode",
    name: "Seaglass Alpha Free",
    cost: [{ input: 0, output: 0 }],
  },
  {
    id: "freepi/deepseek-v4.1-flash",
    modelID: "deepseek-v4.1-flash",
    providerID: "freepi",
    name: "DeepSeek v4.1 Flash",
  },
];

afterEach(() => {
  vi.useRealTimers();
  useModels.getState().reset();
  useModels.getState().setClient(null);
});

describe("useModels.load", () => {
  it("retries /provider until every model's provider is activated", async () => {
    vi.useFakeTimers();
    let providerCalls = 0;
    const client: ModelApi = {
      providers: async () => {
        providerCalls += 1;
        // v2 answers the first call before its provider registry is populated.
        return providerCalls === 1 ? [] : PROVIDERS;
      },
      models: async () => MODELS,
    };

    useModels.getState().setClient(client);
    const pending = useModels.getState().load();
    await vi.advanceTimersByTimeAsync(250);
    await pending;

    expect(providerCalls).toBeGreaterThan(1);
    const state = useModels.getState();
    expect(state.error).toBeNull();
    expect(state.catalogue?.connected).toEqual(["opencode", "freepi"]);
    expect(state.models.map((model) => model.modelID).sort()).toEqual([
      "deepseek-v4.1-flash",
      "seaglass-alpha-free",
    ]);
    expect(state.models.every((model) => model.free)).toBe(true);
  });

  it("retries when only some providers have arrived", async () => {
    vi.useFakeTimers();
    let providerCalls = 0;
    const client: ModelApi = {
      providers: async () => {
        providerCalls += 1;
        return providerCalls === 1 ? PROVIDERS.slice(0, 1) : PROVIDERS;
      },
      models: async () => MODELS,
    };

    useModels.getState().setClient(client);
    const pending = useModels.getState().load();
    await vi.advanceTimersByTimeAsync(250);
    await pending;

    expect(useModels.getState().models).toHaveLength(2);
  });

  it("does not throw when providers never arrive", async () => {
    vi.useFakeTimers();
    let providerCalls = 0;
    const client: ModelApi = {
      providers: async () => {
        providerCalls += 1;
        return [];
      },
      models: async () => MODELS,
    };

    useModels.getState().setClient(client);
    const pending = useModels.getState().load();
    await vi.advanceTimersByTimeAsync(5_000);
    await pending;

    const state = useModels.getState();
    expect(providerCalls).toBeGreaterThan(1);
    expect(state.error).toBeNull();
    expect(state.catalogue?.providers).toHaveLength(2);
    expect(state.models).toEqual([]);
  });

  it("refreshes when the server reports a provider change", async () => {
    vi.useFakeTimers();
    let providerCalls = 0;
    const client: ModelApi = {
      providers: async () => {
        providerCalls += 1;
        return PROVIDERS;
      },
      models: async () => MODELS,
    };

    useModels.getState().setClient(client);
    await useModels.getState().load();
    const settled = providerCalls;

    const event = { type: "provider.updated" } as V2Event;
    useModels.getState().ingest(event);
    useModels.getState().ingest(event);
    await vi.advanceTimersByTimeAsync(0);

    expect(providerCalls).toBe(settled + 1);
    expect(useModels.getState().models).toHaveLength(2);
  });
});
