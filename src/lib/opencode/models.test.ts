import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  flattenModels,
  formatContext,
  labelFor,
  parseCatalogue,
  rankModels,
  readModelSelection,
  stripSecrets,
  usableModels,
  writeModelSelection,
  type FlatModel,
} from "@/lib/opencode/models";
import { useModels } from "@/state/models";

const RAW = {
  all: [
    {
      id: "opencode",
      name: "opencode",
      key: "sk-should-never-appear",
      models: {
        "mimo-v2.6-flash-free": {
          id: "mimo-v2.6-flash-free",
          providerID: "opencode",
          name: "Mimo v2.6 Flash",
          cost: { input: 0, output: 0 },
          limit: { context: 200000, output: 32000 },
          capabilities: { reasoning: true, input: { text: true, image: true } },
        },
        "exo-free": {
          id: "exo-free",
          providerID: "opencode",
          name: "Exo",
          cost: { input: 0, output: 0 },
          limit: { context: 1048576 },
          capabilities: { input: { text: true, image: true } },
        },
        "paid-model": {
          id: "paid-model",
          providerID: "opencode",
          name: "Paid",
          cost: { input: 3, output: 15 },
          limit: { context: 128000 },
        },
      },
    },
    {
      id: "anthropic",
      name: "Anthropic",
      key: "sk-ant-should-never-appear",
      models: {
        sonnet: {
          id: "sonnet",
          providerID: "anthropic",
          name: "Sonnet",
          cost: { input: 3, output: 15 },
          limit: { context: 200000 },
        },
      },
    },
  ],
  default: { opencode: "mimo-v2.6-flash-free" },
  connected: ["opencode"],
};

describe("stripSecrets", () => {
  it("removes credential-shaped keys at the top level", () => {
    expect(stripSecrets({ key: "abc", name: "x" })).toEqual({ name: "x" });
  });

  it("removes them at any depth", () => {
    const input = { a: { b: { apiKey: "x", keep: 1 } } };
    expect(stripSecrets(input)).toEqual({ a: { b: { keep: 1 } } });
  });

  it("walks arrays", () => {
    expect(stripSecrets([{ token: "t", id: 1 }])).toEqual([{ id: 1 }]);
  });

  it("leaves primitives alone", () => {
    expect(stripSecrets("x")).toBe("x");
    expect(stripSecrets(5)).toBe(5);
  });

  it("removes model headers, which can carry auth", () => {
    const cleaned = stripSecrets({ models: { m: { headers: { Authorization: "Bearer x" } } } });
    expect(cleaned).toEqual({ models: { m: {} } });
  });
});

describe("parseCatalogue", () => {
  it("keeps providers and models", () => {
    const catalogue = parseCatalogue(RAW);
    expect(catalogue.providers.map((p) => p.id)).toEqual(["opencode", "anthropic"]);
    expect(Object.keys(catalogue.providers[0]!.models)).toHaveLength(3);
  });

  it("never carries a provider key into the result", () => {
    const serialised = JSON.stringify(parseCatalogue(RAW));
    expect(serialised).not.toContain("should-never-appear");
  });

  it("falls back to the id when a model has no display name", () => {
    const catalogue = parseCatalogue({
      all: [{ id: "p", name: "P", models: { bare: { id: "bare" } } }],
      connected: ["p"],
    });
    expect(catalogue.providers[0]!.models["bare"]!.name).toBe("bare");
  });

  it("falls back to the id when a provider has no name", () => {
    const catalogue = parseCatalogue({ all: [{ id: "p", models: {} }], connected: [] });
    expect(catalogue.providers[0]!.name).toBe("p");
  });

  it("reads the defaults map", () => {
    expect(parseCatalogue(RAW).defaults).toEqual({ opencode: "mimo-v2.6-flash-free" });
  });

  it("survives garbage", () => {
    expect(parseCatalogue(null).providers).toEqual([]);
    expect(parseCatalogue("nope").providers).toEqual([]);
    expect(parseCatalogue({ all: [null, 3, {}] }).providers).toEqual([]);
  });
});

describe("flattenModels and usableModels", () => {
  it("flags zero-cost models as free", () => {
    const flat = flattenModels(parseCatalogue(RAW));
    expect(flat.find((m) => m.modelID === "mimo-v2.6-flash-free")!.free).toBe(true);
    expect(flat.find((m) => m.modelID === "paid-model")!.free).toBe(false);
  });

  it("excludes providers that are not connected", () => {
    // Offering an unreachable provider only produces a confusing failure later.
    const usable = usableModels(parseCatalogue(RAW));
    expect(usable.every((m) => m.providerID === "opencode")).toBe(true);
    expect(usable).toHaveLength(3);
  });

  it("carries context and capabilities through", () => {
    const model = flattenModels(parseCatalogue(RAW))[0]!;
    expect(model.context).toBe(200000);
    expect(model.image).toBe(true);
    expect(model.reasoning).toBe(true);
  });
});

describe("rankModels", () => {
  const models: FlatModel[] = flattenModels(parseCatalogue(RAW));

  it("puts free models first", () => {
    const ranked = rankModels(models, "");
    expect(ranked.filter((m) => m.free).length).toBe(2);
    expect(ranked[0]!.free).toBe(true);
  });

  it("prefers image-capable models within the free tier", () => {
    const free = rankModels(models, "").filter((m) => m.free);
    expect(free[0]!.image).toBe(true);
  });

  it("filters on label, id and provider", () => {
    expect(rankModels(models, "exo").map((m) => m.modelID)).toEqual(["exo-free"]);
    expect(rankModels(models, "mimo").map((m) => m.modelID)).toEqual(["mimo-v2.6-flash-free"]);
  });

  it("is case-insensitive", () => {
    expect(rankModels(models, "MIMO").length).toBe(1);
  });

  it("returns nothing for a miss", () => {
    expect(rankModels(models, "zzzz")).toEqual([]);
  });
});

describe("formatContext", () => {
  it("scales to k and M", () => {
    expect(formatContext(200000)).toBe("200k");
    expect(formatContext(1048576)).toBe("1M");
    expect(formatContext(128000)).toBe("128k");
  });

  it("is empty for unknown", () => {
    expect(formatContext(undefined)).toBe("");
  });
});

describe("selection persistence", () => {
  beforeEach(() => {
    localStorage.clear();
    useModels.getState().reset();
  });

  it("round-trips through local storage", () => {
    writeModelSelection({ providerID: "opencode", modelID: "exo-free" });
    expect(readModelSelection()).toEqual({ providerID: "opencode", modelID: "exo-free" });
  });

  it("ignores a corrupt value", () => {
    localStorage.setItem("halyard.model", "{not json");
    expect(readModelSelection()).toBeNull();
  });

  it("ignores a value missing a half of the pair", () => {
    localStorage.setItem("halyard.model", JSON.stringify({ providerID: "opencode" }));
    expect(readModelSelection()).toBeNull();
  });

  it("labels the current selection", () => {
    const models = flattenModels(parseCatalogue(RAW));
    expect(labelFor(models, { providerID: "opencode", modelID: "exo-free" })).toBe("Exo");
    expect(labelFor(models, { providerID: "x", modelID: "y" })).toBe("y");
    expect(labelFor(models, null)).toBe("");
  });
});

describe("model store", () => {
  beforeEach(() => {
    localStorage.clear();
    useModels.getState().reset();
  });

  it("loads only connected providers", async () => {
    useModels.getState().setClient({ providerCatalogue: vi.fn().mockResolvedValue(RAW) });
    await useModels.getState().load();
    expect(useModels.getState().models).toHaveLength(3);
    expect(useModels.getState().loading).toBe(false);
  });

  it("drops a remembered selection that is no longer offered", async () => {
    useModels.getState().select({ providerID: "opencode", modelID: "vanished-model" });
    useModels.getState().setClient({ providerCatalogue: vi.fn().mockResolvedValue(RAW) });
    await useModels.getState().load();
    // Better than sending an id the server will reject at send time.
    expect(useModels.getState().selection).toBeNull();
  });

  it("keeps a remembered selection that is still offered", async () => {
    useModels.getState().select({ providerID: "opencode", modelID: "exo-free" });
    useModels.getState().setClient({ providerCatalogue: vi.fn().mockResolvedValue(RAW) });
    await useModels.getState().load();
    expect(useModels.getState().selection).toEqual({
      providerID: "opencode",
      modelID: "exo-free",
    });
  });

  it("does nothing without a client", async () => {
    useModels.getState().setClient(null);
    await useModels.getState().load();
    expect(useModels.getState().models).toEqual([]);
  });

  it("surfaces a failure instead of throwing", async () => {
    useModels
      .getState()
      .setClient({ providerCatalogue: vi.fn().mockRejectedValue(new Error("offline")) });
    await useModels.getState().load();
    expect(useModels.getState().error).toBe("offline");
    expect(useModels.getState().loading).toBe(false);
  });
});
