import { describe, expect, it } from "vitest";
import { chooseScrollBehaviour } from "@/hooks/use-auto-scroll";
import { childLabel, filterSessions, rootSessions } from "@/state/sessions";
import { matches, type Suggestion } from "@/components/chat/composer";
import type { Session } from "@/lib/opencode/types";

function session(overrides: Partial<Session> = {}): Session {
  return {
    id: "ses_root",
    slug: "s",
    projectID: "p",
    directory: "/tmp",
    title: "Main thread",
    version: "1.18.35",
    time: { created: 1 },
    ...overrides,
  };
}

describe("chooseScrollBehaviour", () => {
  it("animates a short hop", () => {
    expect(chooseScrollBehaviour(120, 600)).toBe("smooth");
  });

  it("jumps when the distance is more than two viewports", () => {
    // A smooth animation over a long distance never catches up with a fast
    // token stream and would sit permanently behind it.
    expect(chooseScrollBehaviour(2000, 600)).toBe("auto");
  });

  it("animates right up to the two-viewport boundary", () => {
    expect(chooseScrollBehaviour(1199, 600)).toBe("smooth");
    expect(chooseScrollBehaviour(1201, 600)).toBe("auto");
  });

  it("does nothing when already at the bottom", () => {
    expect(chooseScrollBehaviour(0, 600)).toBe("auto");
    expect(chooseScrollBehaviour(-40, 600)).toBe("auto");
  });
});

describe("subagent sessions", () => {
  const root = session({ id: "ses_root", title: "Main thread" });
  const child = session({
    id: "ses_child",
    parentID: "ses_root",
    title: "Explore the codebase",
    agent: "explore",
  });

  it("excludes delegated runs from the root list", () => {
    // Left flat, every subagent run would read as its own conversation.
    expect(rootSessions([root, child]).map((s) => s.id)).toEqual(["ses_root"]);
  });

  it("keeps both available for lookup", () => {
    expect(filterSessions([root, child], "").map((s) => s.id)).toEqual(["ses_root"]);
    expect(rootSessions([root, child])).toHaveLength(1);
  });

  it("still filters roots by query", () => {
    const other = session({ id: "ses_x", title: "Refactor API" });
    expect(filterSessions([root, other, child], "refactor").map((s) => s.id)).toEqual(["ses_x"]);
  });

  it("labels a delegated run with its agent", () => {
    expect(childLabel(child)).toBe("explore · Explore the codebase");
  });

  it("strips the agent suffix opencode puts in the title", () => {
    // Real child titles look like "List repo files (@explore subagent)".
    // Showing the agent twice reads as a stutter.
    const real = session({
      id: "ses_real",
      parentID: "ses_root",
      title: "List repo files (@explore subagent)",
      agent: "explore",
    });
    expect(childLabel(real)).toBe("explore · List repo files");
  });

  it("strips the suffix even when there is no agent field", () => {
    const real = session({
      id: "ses_real2",
      parentID: "ses_root",
      title: "List repo files (@explore subagent)",
    });
    expect(childLabel(real)).toBe("List repo files");
  });

  it("labels a run with no agent", () => {
    const orphan = session({ id: "ses_o", parentID: "ses_root", title: "Some work" });
    expect(childLabel(orphan)).toBe("Some work");
  });

  it("describes a run by files touched when untitled", () => {
    const untitled = session({
      id: "ses_u",
      parentID: "ses_root",
      title: "New session - 2026-10-13T12:52:33.569Z",
      agent: "general",
      summary: { additions: 1, deletions: 0, files: 3 },
    });
    expect(childLabel(untitled)).toBe("general · 3 files touched");
  });

  it("falls back to a generic label", () => {
    const bare = session({ id: "ses_b", parentID: "ses_root", title: "New session - x" });
    expect(childLabel(bare)).toBe("Subagent run");
  });

  it("handles a one-file summary grammatically", () => {
    const one = session({
      id: "ses_1f",
      parentID: "ses_root",
      title: "New session - x",
      agent: "explore",
      summary: { additions: 0, deletions: 0, files: 1 },
    });
    expect(childLabel(one)).toContain("1 file touched");
  });
});

describe("slash command matching", () => {
  const commands: Suggestion[] = [
    { value: "init", label: "init", hint: "guided AGENTS.md setup", kind: "command", source: "command" },
    { value: "review", label: "review", hint: "review changes", kind: "command", source: "command" },
    { value: "motion-broll", label: "motion-broll", hint: "Turn a talking-head video", kind: "command", source: "skill" },
  ];

  it("shows everything for an empty query", () => {
    expect(commands.filter((c) => matches(c, ""))).toHaveLength(3);
  });

  it("matches on a prefix", () => {
    expect(commands.filter((c) => matches(c, "ini")).map((c) => c.label)).toEqual(["init"]);
  });

  it("matches mid-word, so /ini and /rev both feel right", () => {
    expect(commands.filter((c) => matches(c, "view")).map((c) => c.label)).toEqual(["review"]);
  });

  it("matches the description too", () => {
    expect(commands.filter((c) => matches(c, "talking")).map((c) => c.label)).toEqual(["motion-broll"]);
  });

  it("is case-insensitive", () => {
    expect(commands.filter((c) => matches(c, "INIT")).map((c) => c.label)).toEqual(["init"]);
  });

  it("returns nothing when there is no match", () => {
    expect(commands.filter((c) => matches(c, "zzz"))).toEqual([]);
  });
});
