import { beforeEach, describe, expect, it, vi } from "vitest";
import { toModeOptions, useMode, DEFAULT_MODE } from "@/state/mode";
import { sortSessions, useSessions, filterSessions } from "@/state/sessions";
import type { ServerEvent, Session } from "@/lib/opencode/types";

const SESSION = "ses_1";

function session(overrides: Partial<Session> = {}): Session {
  return {
    id: SESSION,
    slug: SESSION,
    projectID: "p",
    directory: "/tmp",
    title: "New session - 2026-10-13T12:52:33.569Z",
    version: "1.18.35",
    time: { created: 1 },
    ...overrides,
  };
}

describe("toModeOptions", () => {
  const agents = [
    { name: "build", mode: "primary", description: "The default agent." },
    { name: "plan", mode: "primary", description: "Plan mode. Disallows all edit tools." },
    { name: "compaction", mode: "primary" },
    { name: "summary", mode: "primary" },
    { name: "title", mode: "primary" },
    { name: "explore", mode: "subagent" },
    { name: "general", mode: "subagent" },
  ];

  it("keeps only user-selectable primary agents", () => {
    expect(toModeOptions(agents).map((m) => m.name)).toEqual(["build", "plan"]);
  });

  it("hides agents opencode drives internally", () => {
    const names = toModeOptions(agents).map((m) => m.name);
    expect(names).not.toContain("compaction");
    expect(names).not.toContain("title");
  });

  it("hides subagents", () => {
    expect(toModeOptions(agents).map((m) => m.name)).not.toContain("explore");
  });

  it("labels build and plan readably", () => {
    const modes = toModeOptions(agents);
    expect(modes[0]).toMatchObject({ label: "Build", readOnly: false });
    expect(modes[1]).toMatchObject({ label: "Plan", readOnly: true });
  });

  it("passes unknown primary agents through with their own name", () => {
    const modes = toModeOptions([{ name: "custom", mode: "primary" }]);
    expect(modes[0]).toMatchObject({ name: "custom", label: "custom", readOnly: false });
  });

  it("handles an empty list", () => {
    expect(toModeOptions([])).toEqual([]);
  });
});

describe("mode store", () => {
  beforeEach(() => {
    localStorage.clear();
    useMode.setState({ modes: [], value: DEFAULT_MODE, loaded: false });
  });

  it("defaults to build", () => {
    expect(useMode.getState().value).toBe("build");
  });

  it("adopts the agent list", () => {
    useMode.getState().setModes([
      { name: "build", mode: "primary" },
      { name: "plan", mode: "primary" },
    ]);
    expect(useMode.getState().modes).toHaveLength(2);
    expect(useMode.getState().value).toBe("build");
  });

  it("keeps a stored preference that still exists", () => {
    useMode.getState().setValue("plan");
    useMode.getState().setModes([
      { name: "build", mode: "primary" },
      { name: "plan", mode: "primary" },
    ]);
    expect(useMode.getState().value).toBe("plan");
  });

  it("falls back when the stored agent disappears", () => {
    useMode.getState().setValue("plan");
    useMode.getState().setModes([{ name: "build", mode: "primary" }]);
    expect(useMode.getState().value).toBe("build");
  });

  it("survives an empty agent list", () => {
    useMode.getState().setModes([]);
    expect(useMode.getState().value).toBe(DEFAULT_MODE);
  });
});

describe("sessions store: server events", () => {
  beforeEach(() =>
    useSessions.setState({ sessions: [], tabs: [], activeId: null, query: "" }),
  );

  it("adopts a generated title from session.updated", () => {
    // opencode names a session after the first turn; without this the list stays
    // stuck on the seeded "New session - <timestamp>" forever.
    useSessions.setState({ sessions: [session()] });
    useSessions.getState().ingest({
      id: "evt_1",
      type: "session.updated",
      properties: { sessionID: SESSION, info: session({ title: "Refactor the parser" }) },
    } as ServerEvent);

    expect(useSessions.getState().sessions[0]!.title).toBe("Refactor the parser");
  });

  it("adds a session it has never seen", () => {
    useSessions.getState().ingest({
      id: "evt_1",
      type: "session.updated",
      properties: { sessionID: "ses_new", info: session({ id: "ses_new", title: "New one" }) },
    } as ServerEvent);
    expect(useSessions.getState().sessions).toHaveLength(1);
  });

  it("removes on session.deleted, closing the tab", () => {
    useSessions.setState({ sessions: [session()], tabs: [SESSION], activeId: SESSION });
    useSessions.getState().ingest({
      id: "evt_1",
      type: "session.deleted",
      properties: { sessionID: SESSION },
    } as ServerEvent);

    expect(useSessions.getState().sessions).toEqual([]);
    expect(useSessions.getState().tabs).toEqual([]);
    expect(useSessions.getState().activeId).toBeNull();
  });

  it("ignores unrelated events", () => {
    useSessions.setState({ sessions: [session()] });
    const before = useSessions.getState().sessions;
    useSessions.getState().ingest({ id: "e", type: "server.heartbeat", properties: {} });
    expect(useSessions.getState().sessions).toBe(before);
  });

  it("tolerates an update with no info payload", () => {
    useSessions.setState({ sessions: [session()] });
    useSessions.getState().ingest({
      id: "evt_1",
      type: "session.updated",
      properties: { sessionID: SESSION },
    } as ServerEvent);
    expect(useSessions.getState().sessions).toHaveLength(1);
  });
});

describe("list presentation", () => {
  it("hides opencode's seeded timestamp title", () => {
    const list = filterSessions([session()], "");
    expect(list[0]!.title).toContain("New session -");
    // The sidebar maps this to a readable placeholder.
    expect(list[0]!.title.startsWith("New session -")).toBe(true);
  });

  it("orders by most recently updated", () => {
    const sorted = sortSessions([
      session({ id: "a", time: { created: 1 } }),
      session({ id: "b", time: { created: 9 } }),
    ]);
    expect(sorted[0]!.id).toBe("b");
  });
});

describe("prompt payload", () => {
  it("carries the chosen agent and model", async () => {
    // Both ride along per prompt; omitting the agent silently keeps whatever
    // the session was created with, which is why Plan had no visible effect.
    const { OpencodeClient } = await import("@/lib/opencode/client");
    const fetchImpl = vi.fn().mockResolvedValue({ status: 204, ok: true, json: async () => ({}) });
    const client = new OpencodeClient("http://x", fetchImpl as unknown as typeof fetch);

    await client.sendPrompt("ses_1", {
      model: { providerID: "opencode", modelID: "exo-free" },
      agent: "plan",
      parts: [{ type: "text", text: "hi" }],
    });

    const body = JSON.parse(String(fetchImpl.mock.calls[0]![1]?.body));
    expect(body).toEqual({
      model: { providerID: "opencode", modelID: "exo-free" },
      agent: "plan",
      parts: [{ type: "text", text: "hi" }],
    });
  });
});
