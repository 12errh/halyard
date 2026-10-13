import { describe, expect, it } from "vitest";
import {
  applyEvent,
  emptyThread,
  isStreaming,
  orderedParts,
  seedThread,
  threadTotals,
  toolIsActive,
  type ThreadState,
} from "@/lib/opencode/thread";
import type {
  AssistantMessage,
  Part,
  ServerEvent,
  TextPart,
  ToolPart,
  UserMessage,
} from "@/lib/opencode/types";

const SESSION = "ses_test";

function user(id: string, at = 1): UserMessage {
  return {
    id,
    sessionID: SESSION,
    role: "user",
    time: { created: at },
    agent: "build",
    model: { providerID: "opencode", modelID: "test-model" },
  };
}

function assistant(id: string, at = 2, extra: Partial<AssistantMessage> = {}): AssistantMessage {
  return {
    id,
    sessionID: SESSION,
    role: "assistant",
    parentID: "msg_user",
    providerID: "opencode",
    modelID: "test-model",
    agent: "build",
    mode: "build",
    path: { cwd: "/tmp", root: "/" },
    cost: 0,
    tokens: { input: 0, output: 0, reasoning: 0 },
    time: { created: at },
    ...extra,
  };
}

function textPart(id: string, messageID: string, text: string): TextPart {
  return { id, sessionID: SESSION, messageID, type: "text", text };
}

function event(type: string, properties: Record<string, unknown>): ServerEvent {
  return { id: "evt_1", type, properties };
}

function apply(state: ThreadState, type: string, properties: Record<string, unknown>) {
  return applyEvent(state, event(type, properties));
}

// ---------------------------------------------------------------------------

describe("thread reducer: seeding", () => {
  it("starts empty", () => {
    const thread = emptyThread();
    expect(thread.order).toEqual([]);
    expect(thread.status).toEqual({ type: "idle" });
  });

  it("orders seeded messages by creation time, not arrival order", () => {
    const thread = seedThread(emptyThread(), [
      { info: assistant("msg_b", 20), parts: [] },
      { info: user("msg_a", 10), parts: [] },
    ]);
    expect(thread.order).toEqual(["msg_a", "msg_b"]);
  });

  it("falls back to id ordering when timestamps tie", () => {
    const thread = seedThread(emptyThread(), [
      { info: user("msg_z", 5), parts: [] },
      { info: user("msg_a", 5), parts: [] },
    ]);
    expect(thread.order).toEqual(["msg_a", "msg_z"]);
  });

  it("indexes parts by id so out-of-order updates cannot reorder them", () => {
    const part = textPart("prt_1", "msg_a", "hello");
    const thread = seedThread(emptyThread(), [{ info: user("msg_a"), parts: [part] }]);
    expect(orderedParts(thread.messages["msg_a"])).toEqual([part]);
  });
});

// ---------------------------------------------------------------------------

describe("thread reducer: streaming deltas", () => {
  it("appends deltas to a part the server has already sent", () => {
    let thread = seedThread(emptyThread(), [
      { info: assistant("msg_a"), parts: [textPart("prt_1", "msg_a", "Hel")] },
    ]);
    thread = apply(thread, "message.part.delta", {
      sessionID: SESSION,
      messageID: "msg_a",
      partID: "prt_1",
      field: "text",
      delta: "lo",
    });
    expect(orderedParts(thread.messages["msg_a"])[0]).toMatchObject({ text: "Hello" });
  });

  it("survives a delta that arrives before message.updated", () => {
    // opencode is free to emit the delta first; the entry has no `info` yet and
    // the provisional part must still be well formed.
    const thread = apply(emptyThread(), "message.part.delta", {
      sessionID: SESSION,
      messageID: "msg_a",
      partID: "prt_1",
      field: "text",
      delta: "early",
    });
    const entry = thread.messages["msg_a"]!;
    expect(entry.info).toBeNull();
    expect(orderedParts(entry)[0]).toMatchObject({
      id: "prt_1",
      sessionID: SESSION,
      messageID: "msg_a",
      text: "early",
    });
  });

  it("attaches info to an entry that was created by a delta", () => {
    let thread = apply(emptyThread(), "message.part.delta", {
      sessionID: SESSION,
      messageID: "msg_a",
      partID: "prt_1",
      field: "text",
      delta: "early",
    });
    thread = apply(thread, "message.updated", { sessionID: SESSION, info: assistant("msg_a") });
    expect(thread.messages["msg_a"]!.info?.role).toBe("assistant");
    // The buffered text must survive the transition.
    expect(orderedParts(thread.messages["msg_a"])[0]).toMatchObject({ text: "early" });
  });

  it("buffers deltas for a part it has never seen", () => {
    // The server can emit a delta before the matching part.updated. Guessing the
    // type here would risk rendering reasoning as prose.
    let thread = apply(emptyThread(), "message.part.delta", {
      sessionID: SESSION,
      messageID: "msg_a",
      partID: "prt_new",
      field: "text",
      delta: "partial",
    });
    const entry = thread.messages["msg_a"]!;
    expect(isStreaming(entry)).toBe(true);
    expect(orderedParts(entry)[0]).toMatchObject({
      id: "prt_new",
      type: "text",
      text: "partial",
      streaming: true,
    });
  });

  it("accumulates successive deltas in order", () => {
    let thread = emptyThread();
    for (const delta of ["a", "b", "c"]) {
      thread = apply(thread, "message.part.delta", {
        sessionID: SESSION,
        messageID: "msg_a",
        partID: "prt_1",
        field: "text",
        delta,
      });
    }
    expect(orderedParts(thread.messages["msg_a"]!)[0]).toMatchObject({ text: "abc" });
  });

  it("replaces the optimistic guess with the authoritative part", () => {
    let thread = apply(emptyThread(), "message.part.delta", {
      sessionID: SESSION,
      messageID: "msg_a",
      partID: "prt_1",
      field: "text",
      delta: "guess",
    });
    const reasoning: Part = {
      id: "prt_1",
      sessionID: SESSION,
      messageID: "msg_a",
      type: "reasoning",
      text: "actually reasoning",
      time: { created: 1 },
    };
    thread = apply(thread, "message.part.updated", { sessionID: SESSION, part: reasoning });

    const entry = thread.messages["msg_a"]!;
    // The duplicate must be gone, not rendered twice.
    expect(isStreaming(entry)).toBe(false);
    expect(orderedParts(entry)).toHaveLength(1);
    expect(orderedParts(entry)[0]).toMatchObject({ type: "reasoning" });
  });

  it("does not duplicate a part when updated arrives for a known id", () => {
    let thread = seedThread(emptyThread(), [
      { info: assistant("msg_a"), parts: [textPart("prt_1", "msg_a", "one")] },
    ]);
    thread = apply(thread, "message.part.updated", {
      sessionID: SESSION,
      part: textPart("prt_1", "msg_a", "one two"),
    });
    expect(orderedParts(thread.messages["msg_a"])).toHaveLength(1);
  });

  it("returns the identical object for an unhandled event", () => {
    // Referential stability lets the store skip a re-render entirely.
    const thread = emptyThread();
    expect(applyEvent(thread, event("plugin.added", { id: "core/config" }))).toBe(thread);
  });
});

// ---------------------------------------------------------------------------

describe("thread reducer: lifecycle", () => {
  it("tracks busy and idle from session.status", () => {
    let thread = apply(emptyThread(), "session.status", {
      sessionID: SESSION,
      status: { type: "busy" },
    });
    expect(thread.status.type).toBe("busy");

    thread = apply(thread, "session.status", { sessionID: SESSION, status: { type: "idle" } });
    expect(thread.status.type).toBe("idle");
  });

  it("records a retry status verbatim", () => {
    const thread = apply(emptyThread(), "session.status", {
      sessionID: SESSION,
      status: { type: "retry", attempt: 2, message: "rate limited", next: 4 },
    });
    expect(thread.status).toEqual({ type: "retry", attempt: 2, message: "rate limited", next: 4 });
  });

  it("session.idle forces the status to idle", () => {
    let thread = apply(emptyThread(), "session.status", {
      sessionID: SESSION,
      status: { type: "busy" },
    });
    thread = apply(thread, "session.idle", { sessionID: SESSION });
    expect(thread.status.type).toBe("idle");
  });

  it("extracts a human message from a session.error", () => {
    const thread = apply(emptyThread(), "session.error", {
      sessionID: SESSION,
      error: { name: "APIError", data: { message: "Payment Required" } },
    });
    expect(thread.error).toBe("Payment Required");
  });

  it("falls back to the error name when there is no message", () => {
    const thread = apply(emptyThread(), "session.error", {
      sessionID: SESSION,
      error: { name: "UnknownError" },
    });
    expect(thread.error).toBe("UnknownError");
  });

  it("removes a message by id", () => {
    let thread = seedThread(emptyThread(), [
      { info: user("msg_a"), parts: [] },
      { info: user("msg_b", 2), parts: [] },
    ]);
    thread = apply(thread, "message.removed", { sessionID: SESSION, messageID: "msg_a" });
    expect(thread.order).toEqual(["msg_b"]);
    expect(thread.messages["msg_a"]).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------

describe("tool state", () => {
  const cases: Array<[ToolPart["state"]["status"], boolean]> = [
    ["pending", true],
    ["running", true],
    ["completed", false],
    ["error", false],
  ];

  it.each(cases)("%s -> active=%s", (status, expected) => {
    const state = { status } as ToolPart["state"];
    expect(toolIsActive(state)).toBe(expected);
  });
});

// ---------------------------------------------------------------------------

describe("threadTotals", () => {
  it("sums cost and tokens across assistant turns only", () => {
    const thread = seedThread(emptyThread(), [
      { info: user("msg_u", 1), parts: [] },
      {
        info: assistant("msg_a1", 2, {
          cost: 0.01,
          tokens: { input: 100, output: 50, reasoning: 10, cache: { read: 5, write: 2 } },
        }),
        parts: [],
      },
      {
        info: assistant("msg_a2", 3, {
          cost: 0.02,
          tokens: { input: 200, output: 100, reasoning: 0 },
        }),
        parts: [],
      },
    ]);

    const totals = threadTotals(thread);
    expect(totals.cost).toBeCloseTo(0.03, 6);
    expect(totals.tokens).toBe(100 + 50 + 10 + 5 + 2 + 200 + 100);
  });

  it("is zero for an empty thread", () => {
    expect(threadTotals(emptyThread())).toEqual({ cost: 0, tokens: 0 });
  });
});

// ---------------------------------------------------------------------------

describe("a realistic turn", () => {
  it("replays user prompt, streamed reply, tool call and idle correctly", () => {
    let thread = seedThread(emptyThread(), [
      { info: user("msg_u", 1), parts: [textPart("prt_u", "msg_u", "list files")] },
    ]);

    thread = apply(thread, "session.status", { sessionID: SESSION, status: { type: "busy" } });
    thread = apply(thread, "message.updated", { sessionID: SESSION, info: assistant("msg_a", 2) });

    for (const delta of ["Found ", "3 ", "files"]) {
      thread = apply(thread, "message.part.delta", {
        sessionID: SESSION,
        messageID: "msg_a",
        partID: "prt_t",
        field: "text",
        delta,
      });
    }

    const tool: ToolPart = {
      id: "prt_tool",
      sessionID: SESSION,
      messageID: "msg_a",
      type: "tool",
      callID: "call_1",
      tool: "read",
      state: { status: "running", input: { filePath: "README.md" }, title: "README.md" },
    };
    thread = apply(thread, "message.part.updated", { sessionID: SESSION, part: tool });

    thread = apply(thread, "session.idle", { sessionID: SESSION });

    const entry = thread.messages["msg_a"]!;
    const parts = orderedParts(entry);
    expect(parts.map((p) => p.type)).toEqual(["text", "tool"]);
    expect(parts[0]).toMatchObject({ text: "Found 3 files", streaming: true });
    expect(thread.status.type).toBe("idle");
    expect(thread.order).toEqual(["msg_u", "msg_a"]);
  });
});
