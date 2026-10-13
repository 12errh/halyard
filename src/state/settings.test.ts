import { beforeEach, describe, expect, it } from "vitest";
import {
  aggregateUsage,
  formatCost,
  formatTokens,
  sessionUsage,
  usageBreakdown,
} from "@/lib/usage";
import {
  CONFIG_SECTIONS,
  describeValue,
  formatConfig,
  getPath,
  safeParseDraft,
  setPath,
} from "@/state/settings";
import { useModels } from "@/state/models";
import {
  clearModelSelection,
  hasScopedSelection,
  readModelSelection,
  writeModelSelection,
} from "@/lib/opencode/models";
import { formatBytes } from "@/actions/transfer";
import type { Session } from "@/lib/opencode/types";

function session(overrides: Partial<Session> = {}): Session {
  return {
    id: "ses_1",
    slug: "s",
    projectID: "p",
    directory: "/tmp",
    title: "Work",
    version: "1.18.35",
    time: { created: 1 },
    ...overrides,
  };
}

describe("usage totals", () => {
  it("is empty for a missing session", () => {
    expect(sessionUsage(undefined).total).toBe(0);
  });

  it("sums every token bucket", () => {
    // Cache reads are billed far below input, so they are counted but reported
    // separately rather than folded into one headline number.
    const totals = sessionUsage(
      session({
        cost: 0.25,
        tokens: { input: 1000, output: 200, reasoning: 50, cache: { read: 3000, write: 10 } },
      }),
    );
    expect(totals).toMatchObject({
      input: 1000,
      output: 200,
      reasoning: 50,
      cacheRead: 3000,
      cacheWrite: 10,
      total: 4260,
      cost: 0.25,
    });
  });

  it("tolerates missing cache figures", () => {
    const totals = sessionUsage(session({ tokens: { input: 10, output: 5, reasoning: 0 } }));
    expect(totals.cacheRead).toBe(0);
    expect(totals.cacheWrite).toBe(0);
    expect(totals.total).toBe(15);
  });

  it("tolerates a session with no usage at all", () => {
    expect(sessionUsage(session()).total).toBe(0);
  });

  it("counts cost even when the session reports no token breakdown", () => {
    // Spend without a usage block must not be silently dropped.
    expect(sessionUsage(session({ cost: 1.25 })).cost).toBe(1.25);
  });

  it("aggregates across sessions", () => {
    const totals = aggregateUsage([
      session({ cost: 0.1, tokens: { input: 10, output: 5, reasoning: 0 } }),
      session({ cost: 0.2, tokens: { input: 20, output: 5, reasoning: 0 } }),
    ]);
    expect(totals.cost).toBeCloseTo(0.3, 6);
    expect(totals.total).toBe(40);
    expect(totals.messages).toBe(2);
  });

  it("aggregates an empty list to zero", () => {
    expect(aggregateUsage([])).toMatchObject({ total: 0, cost: 0, messages: 0 });
  });

  it("formats tokens at each scale", () => {
    expect(formatTokens(0)).toBe("0");
    expect(formatTokens(512)).toBe("512");
    expect(formatTokens(1500)).toBe("1.5k");
    expect(formatTokens(2_500_000)).toBe("2.50M");
  });

  it("formats cost with enough precision to be meaningful", () => {
    expect(formatCost(0)).toBe("$0");
    expect(formatCost(0.0004)).toBe("$0.0004");
    expect(formatCost(1.5)).toBe("$1.50");
  });

  it("breaks usage into display rows", () => {
    const rows = usageBreakdown(sessionUsage(session({ cost: 1 })));
    expect(rows.map((r) => r.label)).toContain("Cache read");
    expect(rows.at(-1)).toEqual({ label: "Cost", value: "$1.00" });
  });
});

describe("config path helpers", () => {
  it("sets a top-level key", () => {
    expect(setPath({}, ["model"], "x")).toEqual({ model: "x" });
  });

  it("creates missing intermediates rather than throwing", () => {
    expect(setPath({}, ["permission", "edit", "*"], "allow")).toEqual({
      permission: { edit: { "*": "allow" } },
    });
  });

  it("does not mutate the source document", () => {
    const source = { permission: { edit: "ask" } };
    const next = setPath(source, ["permission", "edit"], "allow");
    // Editing in place would corrupt the merged config we render as "effective".
    expect(source.permission.edit).toBe("ask");
    expect(getPath(next, ["permission", "edit"])).toBe("allow");
  });

  it("reads nested values with a fallback", () => {
    const doc = { permission: { bash: { "*": "deny" } } };
    expect(getPath(doc, ["permission", "bash", "*"])).toBe("deny");
    expect(getPath(doc, ["permission", "edit"], "ask")).toBe("ask");
    expect(getPath(doc, ["nope", "deeper"])).toBeUndefined();
  });

  it("formats a document with a trailing newline", () => {
    expect(formatConfig({ a: 1 })).toBe('{\n  "a": 1\n}\n');
  });
});

describe("describeValue", () => {
  it("summarises each shape", () => {
    expect(describeValue("opencode/exo-free")).toBe("opencode/exo-free");
    expect(describeValue(42)).toBe("42");
    expect(describeValue([1, 2])).toBe("2 items");
    expect(describeValue({ a: 1 })).toBe("1 key");
    expect(describeValue({})).toBe("empty");
    expect(describeValue(null)).toBe("—");
  });

  it("truncates a long string", () => {
    expect(describeValue("x".repeat(80)).endsWith("…")).toBe(true);
  });
});

describe("config sections", () => {
  it("every documented section has a label and a hint", () => {
    for (const section of CONFIG_SECTIONS) {
      expect(section.key.length).toBeGreaterThan(0);
      expect(section.label.length).toBeGreaterThan(0);
      expect(section.hint.length).toBeGreaterThan(0);
    }
  });

  it("has no duplicate keys", () => {
    const keys = CONFIG_SECTIONS.map((s) => s.key);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe("formatBytes", () => {
  it("scales units", () => {
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(2048)).toBe("2.0 KB");
    expect(formatBytes(5 * 1024 * 1024)).toBe("5.0 MB");
  });
});
describe("default model scope", () => {
  const A = { providerID: "opencode", modelID: "exo-free" };
  const B = { providerID: "opencode", modelID: "cat-jam-free" };

  beforeEach(() => {
    localStorage.clear();
    useModels.getState().reset();
  });

  it("starts with no default", () => {
    expect(readModelSelection("/repo/a")).toBeNull();
  });

  it("stores a default per project", () => {
    writeModelSelection(A, "/repo/a");
    writeModelSelection(B, "/repo/b");
    expect(readModelSelection("/repo/a")).toEqual(A);
    expect(readModelSelection("/repo/b")).toEqual(B);
  });

  it("does not let one project's choice leak into another", () => {
    writeModelSelection(A, "/repo/a");
    expect(readModelSelection("/repo/b")).toBeNull();
  });

  it("falls back to the cross-project default when a project has none", () => {
    writeModelSelection(A, null);
    writeModelSelection(B, "/repo/b");
    expect(readModelSelection("/repo/c")).toEqual(A);
    // The project override still wins where it exists.
    expect(readModelSelection("/repo/b")).toEqual(B);
  });

  it("clearing a project restores the shared default", () => {
    writeModelSelection(A, null);
    writeModelSelection(B, "/repo/b");
    clearModelSelection("/repo/b");
    expect(readModelSelection("/repo/b")).toEqual(A);
  });

  it("reports whether a project has its own default", () => {
    writeModelSelection(A, null);
    writeModelSelection(B, "/repo/b");
    expect(hasScopedSelection("/repo/b")).toBe(true);
    expect(hasScopedSelection("/repo/a")).toBe(false);
  });

  it("survives a corrupt store", () => {
    localStorage.setItem("halyard.models", "{not json");
    expect(readModelSelection("/repo/a")).toBeNull();
  });

  it("ignores a half-written entry", () => {
    localStorage.setItem("halyard.models", JSON.stringify({ "/repo/a": { providerID: "x" } }));
    expect(readModelSelection("/repo/a")).toBeNull();
  });
});

describe("safeParseDraft", () => {
  it("parses a valid document", () => {
    expect(safeParseDraft('{"a":1}')).toEqual({ a: 1 });
  });

  it("falls back while the draft is mid-edit", () => {
    expect(safeParseDraft("{ \"a\": ")).toEqual({});
    expect(safeParseDraft("")).toEqual({});
  });

  it("rejects a non-object document", () => {
    expect(safeParseDraft("[1,2]")).toEqual({});
    expect(safeParseDraft("42")).toEqual({});
  });
});
