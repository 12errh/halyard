import { beforeEach, describe, expect, it } from "vitest";
import {
  filterSessions,
  sortSessions,
  tabTitle,
  useSessions,
} from "@/state/sessions";
import type { Session } from "@/lib/opencode/types";

function session(id: string, title: string, updated: number, parentID?: string): Session {
  return {
    id,
    slug: id,
    projectID: "p",
    directory: "/tmp",
    title,
    version: "1.18.35",
    time: { created: updated, updated },
    ...(parentID ? { parentID } : {}),
  };
}

const reset = () =>
  useSessions.setState({ sessions: [], tabs: [], activeId: null, query: "" });

describe("session store: tabs", () => {
  beforeEach(reset);

  it("opens and activates a tab", () => {
    useSessions.getState().openTab("ses_1");
    expect(useSessions.getState().tabs).toEqual(["ses_1"]);
    expect(useSessions.getState().activeId).toBe("ses_1");
  });

  it("does not duplicate a tab that is already open", () => {
    useSessions.getState().openTab("ses_1");
    useSessions.getState().openTab("ses_2");
    useSessions.getState().openTab("ses_1");
    expect(useSessions.getState().tabs).toEqual(["ses_1", "ses_2"]);
  });

  it("focuses the right-hand neighbour when the active tab closes", () => {
    const store = useSessions.getState();
    store.openTab("a");
    store.openTab("b");
    store.openTab("c");
    useSessions.getState().closeTab("b");
    expect(useSessions.getState().activeId).toBe("c");
  });

  it("falls back to the left-hand neighbour when the last tab closes", () => {
    const store = useSessions.getState();
    store.openTab("a");
    store.openTab("b");
    store.openTab("c");
    useSessions.getState().closeTab("c");
    expect(useSessions.getState().activeId).toBe("b");
  });

  it("clears the active tab when the only one closes", () => {
    useSessions.getState().openTab("a");
    useSessions.getState().closeTab("a");
    expect(useSessions.getState().activeId).toBeNull();
  });

  it("closing an inactive tab leaves the active one alone", () => {
    const store = useSessions.getState();
    store.openTab("a");
    store.openTab("b");
    useSessions.getState().closeTab("a");
    expect(useSessions.getState().activeId).toBe("b");
  });

  it("cycles forwards and wraps around", () => {
    const store = useSessions.getState();
    ["a", "b", "c"].forEach((id) => store.openTab(id));
    store.selectTab("a");

    useSessions.getState().stepTab(1);
    expect(useSessions.getState().activeId).toBe("b");
    useSessions.getState().stepTab(1);
    useSessions.getState().stepTab(1);
    expect(useSessions.getState().activeId).toBe("a");
  });

  it("cycles backwards and wraps around", () => {
    const store = useSessions.getState();
    ["a", "b", "c"].forEach((id) => store.openTab(id));
    store.selectTab("a");
    useSessions.getState().stepTab(-1);
    expect(useSessions.getState().activeId).toBe("c");
  });

  it("does not throw when cycling with no tabs", () => {
    useSessions.getState().stepTab(1);
    expect(useSessions.getState().activeId).toBeNull();
  });

  it("closeOthers keeps only the requested tab", () => {
    const store = useSessions.getState();
    ["a", "b", "c"].forEach((id) => store.openTab(id));
    useSessions.getState().closeOthers("b");
    expect(useSessions.getState().tabs).toEqual(["b"]);
  });
});

describe("session store: list maintenance", () => {
  beforeEach(reset);

  it("drops tabs whose session has disappeared", () => {
    const store = useSessions.getState();
    store.openTab("a");
    store.openTab("gone");
    useSessions.getState().setSessions([session("a", "A", 1)]);
    expect(useSessions.getState().tabs).toEqual(["a"]);
  });

  it("falls back to the first surviving tab when the active one disappears", () => {
    const store = useSessions.getState();
    store.openTab("a");
    store.openTab("b");
    useSessions.getState().setSessions([session("a", "A", 1)]);
    expect(useSessions.getState().activeId).toBe("a");
  });

  it("removing a session also removes its tab", () => {
    const store = useSessions.getState();
    store.openTab("a");
    store.upsert(session("a", "A", 1));
    useSessions.getState().remove("a");
    expect(useSessions.getState().sessions).toEqual([]);
    expect(useSessions.getState().tabs).toEqual([]);
  });

  it("upsert replaces rather than duplicates", () => {
    const store = useSessions.getState();
    store.upsert(session("a", "First", 1));
    store.upsert(session("a", "Second", 2));
    expect(useSessions.getState().sessions).toHaveLength(1);
    expect(useSessions.getState().sessions[0]!.title).toBe("Second");
  });
});

describe("session selectors", () => {
  it("sorts by most recently updated", () => {
    const sorted = sortSessions([
      session("a", "A", 10),
      session("b", "B", 30),
      session("c", "C", 20),
    ]);
    expect(sorted.map((s) => s.id)).toEqual(["b", "c", "a"]);
  });

  it("filters case-insensitively on the title", () => {
    const sessions = [session("a", "Refactor API", 1), session("b", "Fix bug", 2)];
    expect(filterSessions(sessions, "api").map((s) => s.id)).toEqual(["a"]);
    expect(filterSessions(sessions, "  ").map((s) => s.id)).toEqual(["a", "b"]);
  });

  it("shows a placeholder instead of opencode's timestamp seed title", () => {
    const seeded = session("a", "New session - 2026-10-13T12:52:33.569Z", 1);
    expect(tabTitle([seeded], "a")).toBe("Untitled");
  });

  it("shows the real title on a tab", () => {
    expect(tabTitle([session("a", "Refactor the parser", 1)], "a")).toBe("Refactor the parser");
  });

  it("falls back to the id for an unknown session", () => {
    expect(tabTitle([], "ses_missing")).toBe("ses_missing");
  });
});
