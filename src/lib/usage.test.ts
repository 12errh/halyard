import { describe, expect, it } from "vitest";
import {
  aggregateUsage,
  billedTokens,
  contextUsage,
  formatCost,
  formatTokens,
  sessionUsage,
} from "@/lib/usage";
import type { AssistantMessage, Session, UserMessage } from "@/lib/opencode/types";

function session(id: string, tokens: Session["tokens"], cost = 0): Session {
  return { id, slug: "", projectID: "p", directory: "/repo", title: id, version: "1", time: { created: 0, updated: 0 }, cost, tokens } as Session;
}

function assistant(tokens: Session["tokens"], cost = 0, extra: Partial<AssistantMessage> = {}): AssistantMessage {
  return {
    id: "m",
    sessionID: "s",
    role: "assistant",
    parentID: "u",
    providerID: "opencode",
    modelID: "m",
    agent: "build",
    mode: "build",
    path: { cwd: "/repo", root: "/repo" },
    cost,
    tokens: tokens!,
    time: { created: 0 },
    ...extra,
  } as AssistantMessage;
}

const user = { role: "user" } as UserMessage;

describe("formatTokens", () => {
  it("reads in units a person can hold in their head", () => {
    expect(formatTokens(0)).toBe("0");
    expect(formatTokens(999)).toBe("999");
    expect(formatTokens(1_500)).toBe("1.5k");
    expect(formatTokens(12_400)).toBe("12.4k");
    expect(formatTokens(2_500_000)).toBe("2.50M");
  });

  it("does not invent billions out of a nine-figure count", () => {
    // 1.1B was being printed as "1099.47M" before.
    expect(formatTokens(1_099_470_000)).toBe("1.10B");
  });
});

describe("formatCost", () => {
  it("keeps small amounts legible instead of rounding them to nothing", () => {
    expect(formatCost(0)).toBe("$0");
    expect(formatCost(0.0021)).toBe("$0.0021");
    expect(formatCost(1.239)).toBe("$1.24");
  });
});

describe("billedTokens", () => {
  it("leaves cache reads out", () => {
    // Cache reads repeat the same prefix every turn, so counting them turns a
    // long session's total into a number nothing ever actually processed.
    const totals = sessionUsage(
      session("s", { input: 100, output: 50, reasoning: 25, cache: { read: 900_000, write: 10 } }),
    );
    expect(totals.total).toBe(900_185);
    expect(billedTokens(totals)).toBe(185);
  });
});

describe("contextUsage", () => {
  it("reports the last turn's context, not the thread's lifetime total", () => {
    const messages = [
      user,
      assistant({ input: 1_000, output: 200, reasoning: 100, cache: { read: 12_000, write: 0 } }),
      user,
      assistant({ input: 1_500, output: 300, reasoning: 50, cache: { read: 13_500, write: 0 } }),
    ];
    const context = contextUsage(messages)!;
    expect(context.total).toBe(1_500 + 300 + 50 + 13_500);
    // The lifetime total of the same thread would be the sum of both turns,
    // including every cache hit along the way.
    expect(context.total).toBeLessThan(1_500 + 300 + 50 + 13_500 + 12_000);
  });

  it("is not thrown off by a summary turn, which carries no real context", () => {
    const messages = [
      assistant({ input: 100, output: 20, reasoning: 0 }),
      assistant({ input: 5, output: 1, reasoning: 0 }, 0, { summary: true }),
    ];
    expect(contextUsage(messages)!.total).toBe(120);
  });

  it("has nothing to say before the agent has answered", () => {
    expect(contextUsage([user])).toBeNull();
    expect(contextUsage(undefined)).toBeNull();
  });
});

describe("aggregateUsage", () => {
  it("sums every session in the project", () => {
    const totals = aggregateUsage([
      session("a", { input: 10, output: 5, reasoning: 0 }, 0.1),
      session("b", { input: 20, output: 5, reasoning: 0 }, 0.2),
    ]);
    expect(totals.total).toBe(40);
    expect(totals.cost).toBeCloseTo(0.3, 5);
    expect(totals.messages).toBe(2);
  });

  it("counts spend even when a session reports no token breakdown", () => {
    const totals = aggregateUsage([session("a", undefined, 1.5)]);
    expect(totals.cost).toBe(1.5);
    expect(totals.total).toBe(0);
  });
});
