import { beforeEach, describe, expect, it } from "vitest";
import {
  actionLabel,
  applyPermissionEvent,
  clearSessionState,
  emptyPermissions,
  fromV1,
  fromV2,
  mergeFetch,
  pendingCount,
  pendingFor,
  usePermissions,
  type PermissionsState,
} from "@/state/permissions";
import type { ServerEvent } from "@/lib/opencode/types";

const SESSION = "ses_1";

function v2Event(overrides: Record<string, unknown> = {}): ServerEvent {
  return {
    id: "evt_1",
    type: "permission.v2.asked",
    properties: {
      id: "per_1",
      sessionID: SESSION,
      action: "bash",
      resources: ["ls -la"],
      ...overrides,
    },
  } as ServerEvent;
}

function v1Event(overrides: Record<string, unknown> = {}): ServerEvent {
  return {
    id: "evt_1",
    type: "permission.asked",
    properties: {
      id: "per_1",
      sessionID: SESSION,
      permission: "edit",
      patterns: ["src/a.ts"],
      ...overrides,
    },
  } as ServerEvent;
}

describe("permission normalisation", () => {
  it("maps the v2 shape", () => {
    const pending = fromV2(
      { id: "per_1", sessionID: SESSION, action: "bash", resources: ["ls"], save: ["bash(ls)"] },
      1000,
    );
    expect(pending).toMatchObject({
      id: "per_1",
      action: "bash",
      resources: ["ls"],
      save: ["bash(ls)"],
      version: 2,
      askedAt: 1000,
    });
  });

  it("maps the v1 shape onto the same fields", () => {
    const pending = fromV1(
      { id: "per_1", sessionID: SESSION, permission: "edit", patterns: ["a.ts"], always: ["edit"] },
      500,
    );
    expect(pending).toMatchObject({
      action: "edit",
      resources: ["a.ts"],
      save: ["edit"],
      version: 1,
    });
  });

  it("tolerates a v2 request with no save list", () => {
    const pending = fromV2({ id: "per_1", sessionID: SESSION, action: "bash", resources: [] }, 0);
    expect(pending.save).toBeUndefined();
  });

  it("carries the tool reference through when the server sends one", () => {
    const pending = fromV2(
      {
        id: "per_1",
        sessionID: SESSION,
        action: "bash",
        resources: [],
        source: { type: "tool", messageID: "msg_1", callID: "call_1" },
      },
      0,
    );
    expect(pending.tool).toEqual({ messageID: "msg_1", callID: "call_1" });
  });
});

describe("applyPermissionEvent", () => {
  it("adds a v2 request", () => {
    const next = applyPermissionEvent(emptyPermissions(), v2Event(), 100);
    expect(pendingFor(next, SESSION)).toHaveLength(1);
  });

  it("adds a v1 request", () => {
    const next = applyPermissionEvent(emptyPermissions(), v1Event(), 100);
    expect(pendingFor(next, SESSION)[0]).toMatchObject({ action: "edit", version: 1 });
  });

  it("is idempotent for a repeated ask", () => {
    // The server re-broadcasts pending requests on reconnect; a duplicate card
    // would be a bug the user sees immediately.
    let state = applyPermissionEvent(emptyPermissions(), v2Event(), 100);
    state = applyPermissionEvent(state, v2Event(), 9999);
    expect(pendingFor(state, SESSION)).toHaveLength(1);
    // The original timestamp must survive, or the card would jump to the end.
    expect(pendingFor(state, SESSION)[0]!.askedAt).toBe(100);
  });

  it("removes on permission.replied", () => {
    let state = applyPermissionEvent(emptyPermissions(), v2Event(), 100);
    state = applyPermissionEvent(state, {
      id: "evt_2",
      type: "permission.replied",
      properties: { sessionID: SESSION, requestID: "per_1", reply: "once" },
    } as ServerEvent, 200);
    expect(pendingFor(state, SESSION)).toHaveLength(0);
  });

  it("removes on permission.v2.replied", () => {
    let state = applyPermissionEvent(emptyPermissions(), v2Event(), 100);
    state = applyPermissionEvent(state, {
      id: "evt_2",
      type: "permission.v2.replied",
      properties: { sessionID: SESSION, requestID: "per_1", reply: "always" },
    } as ServerEvent, 200);
    expect(pendingFor(state, SESSION)).toHaveLength(0);
  });

  it("ignores unrelated events", () => {
    const state = emptyPermissions();
    expect(applyPermissionEvent(state, { id: "e", type: "server.heartbeat", properties: {} }, 0)).toBe(state);
  });

  it("does not remove another session's request", () => {
    let state = applyPermissionEvent(emptyPermissions(), v2Event(), 100);
    state = applyPermissionEvent(state, {
      id: "evt_2",
      type: "permission.replied",
      properties: { sessionID: "ses_other", requestID: "per_1" },
    } as ServerEvent, 200);
    expect(pendingFor(state, SESSION)).toHaveLength(1);
  });

  it("keeps sessions isolated", () => {
    let state = applyPermissionEvent(emptyPermissions(), v2Event(), 100);
    state = applyPermissionEvent(state, {
      id: "evt_3",
      type: "permission.v2.asked",
      properties: { id: "per_2", sessionID: "ses_2", action: "read", resources: ["a"] },
    } as ServerEvent, 200);
    expect(pendingFor(state, "ses_2")).toHaveLength(1);
    expect(pendingFor(state, SESSION)).toHaveLength(1);
  });
});

describe("ordering and counting", () => {
  it("orders by when they were asked", () => {
    let state = applyPermissionEvent(emptyPermissions(), v2Event({ id: "per_b" }), 200);
    state = applyPermissionEvent(state, v2Event({ id: "per_a" }), 100);
    expect(pendingFor(state, SESSION).map((p) => p.id)).toEqual(["per_a", "per_b"]);
  });

  it("counts across every session", () => {
    let state = applyPermissionEvent(emptyPermissions(), v2Event({ id: "per_1" }), 100);
    state = applyPermissionEvent(
      state,
      { id: "e", type: "permission.v2.asked", properties: { id: "per_2", sessionID: "ses_2", action: "read", resources: [] } } as ServerEvent,
      200,
    );
    expect(pendingCount(state)).toBe(2);
  });

  it("returns nothing for a null session", () => {
    expect(pendingFor(applyPermissionEvent(emptyPermissions(), v2Event(), 1), null)).toEqual([]);
  });
});

describe("mergeFetch", () => {
  it("adds requests found only by the fetch", () => {
    const incoming = [fromV2({ id: "per_x", sessionID: SESSION, action: "bash", resources: [] }, 5)];
    const next = mergeFetch(emptyPermissions(), SESSION, incoming);
    expect(pendingFor(next, SESSION)).toHaveLength(1);
  });

  it("keeps a card already on screen rather than resetting it", () => {
    const existing = applyPermissionEvent(emptyPermissions(), v2Event(), 100);
    const next = mergeFetch(existing, SESSION, [
      fromV2({ id: "per_1", sessionID: SESSION, action: "bash", resources: ["new"] }, 9999),
    ]);
    expect(pendingFor(next, SESSION)[0]!.askedAt).toBe(100);
  });

  it("is a no-op for an empty list", () => {
    const state: PermissionsState = emptyPermissions();
    expect(mergeFetch(state, SESSION, [])).toBe(state);
  });
});

describe("clearSessionState", () => {
  it("removes only the named session", () => {
    let state = applyPermissionEvent(emptyPermissions(), v2Event(), 100);
    state = applyPermissionEvent(
      state,
      { id: "e", type: "permission.v2.asked", properties: { id: "per_2", sessionID: "ses_2", action: "read", resources: [] } } as ServerEvent,
      200,
    );
    const next = clearSessionState(state, SESSION);
    expect(pendingFor(next, SESSION)).toHaveLength(0);
    expect(pendingFor(next, "ses_2")).toHaveLength(1);
  });

  it("returns the same object for an unknown session", () => {
    const state = emptyPermissions();
    expect(clearSessionState(state, "nope")).toBe(state);
  });
});

describe("actionLabel", () => {
  it("humanises known actions", () => {
    expect(actionLabel("bash")).toBe("Run command");
    expect(actionLabel("webfetch")).toBe("Fetch URL");
  });

  it("passes unknown actions through untouched", () => {
    expect(actionLabel("quantum_entangler")).toBe("quantum_entangler");
  });
});

describe("permission store", () => {
  beforeEach(() => usePermissions.getState().reset());

  it("ingests, syncs and resolves through the store", () => {
    usePermissions.getState().ingest(v2Event());
    expect(pendingFor({ bySession: usePermissions.getState().bySession }, SESSION)).toHaveLength(1);

    usePermissions.getState().sync(SESSION, [
      fromV2({ id: "per_2", sessionID: SESSION, action: "read", resources: [] }, 1),
    ]);
    expect(pendingCount({ bySession: usePermissions.getState().bySession })).toBe(2);

    usePermissions.getState().resolve(SESSION, "per_1");
    expect(pendingCount({ bySession: usePermissions.getState().bySession })).toBe(1);
  });

  it("clears a whole session", () => {
    usePermissions.getState().ingest(v2Event());
    usePermissions.getState().clearSession(SESSION);
    expect(pendingCount({ bySession: usePermissions.getState().bySession })).toBe(0);
  });
});
