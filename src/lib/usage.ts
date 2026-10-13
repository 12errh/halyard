import type { Session, TokenUsage } from "@/lib/opencode/types";

/**
 * Token and cost accounting for a session.
 *
 * Cache reads are billed at a fraction of input tokens, so counting them as
 * plain input overstates usage badly on a long session. They are reported
 * separately rather than folded in.
 */
export interface UsageTotals {
  input: number;
  output: number;
  reasoning: number;
  cacheRead: number;
  cacheWrite: number;
  /** Everything counted, for a single headline number. */
  total: number;
  cost: number;
  messages: number;
}

const EMPTY: UsageTotals = {
  input: 0,
  output: 0,
  reasoning: 0,
  cacheRead: 0,
  cacheWrite: 0,
  total: 0,
  cost: 0,
  messages: 0,
};

function add(target: UsageTotals, usage: TokenUsage | undefined, cost: number | undefined) {
  // Cost is counted even when the token block is absent. A session can report
  // spend without a usage breakdown, and silently dropping it would understate
  // the bill — the one number the user cannot verify themselves.
  target.cost += cost ?? 0;
  if (usage) {
    target.input += usage.input ?? 0;
    target.output += usage.output ?? 0;
    target.reasoning += usage.reasoning ?? 0;
    target.cacheRead += usage.cache?.read ?? 0;
    target.cacheWrite += usage.cache?.write ?? 0;
  }
  target.messages += 1;
}

function finish(totals: UsageTotals): UsageTotals {
  totals.total =
    totals.input +
    totals.output +
    totals.reasoning +
    totals.cacheRead +
    totals.cacheWrite;
  return totals;
}

/** Totals for one session, from the figures the server already reports. */
export function sessionUsage(session: Session | undefined): UsageTotals {
  if (!session) return { ...EMPTY };
  const totals: UsageTotals = { ...EMPTY };
  add(totals, session.tokens, session.cost);
  return finish(totals);
}

/** Totals across many sessions, for the project overview. */
export function aggregateUsage(sessions: Session[]): UsageTotals {
  const totals: UsageTotals = { ...EMPTY };
  for (const session of sessions) add(totals, session.tokens, session.cost);
  return finish(totals);
}

export function formatTokens(count: number): string {
  if (count <= 0) return "0";
  if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(2)}M`;
  if (count >= 1_000) return `${(count / 1_000).toFixed(1)}k`;
  return String(count);
}

export function formatCost(cost: number): string {
  if (cost <= 0) return "$0";
  if (cost < 0.01) return `$${cost.toFixed(4)}`;
  return `$${cost.toFixed(2)}`;
}

/** Breakdown rows for the usage panel. */
export function usageBreakdown(totals: UsageTotals): Array<{ label: string; value: string }> {
  return [
    { label: "Input", value: formatTokens(totals.input) },
    { label: "Output", value: formatTokens(totals.output) },
    { label: "Reasoning", value: formatTokens(totals.reasoning) },
    { label: "Cache read", value: formatTokens(totals.cacheRead) },
    { label: "Cache write", value: formatTokens(totals.cacheWrite) },
    { label: "Cost", value: formatCost(totals.cost) },
  ];
}