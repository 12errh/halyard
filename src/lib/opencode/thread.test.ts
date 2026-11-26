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
import type { AssistantMessage, UserMessage, V2Event } from "@/lib/opencode/types";

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
    cost: 0,
    tokens: { input: 0, output: 0, reasoning: 0 },
    time: { created: at },
    ...extra,
  };
}

let counter = 0;

function event(type: string, data: Record<string, unknown>, created = 10): V2Event {
  counter += 1;
  return { id: `evt_${counter}`, type, data, created };
}

function apply(state: ThreadState, type: string, data: Record<string, unknown>, created = 10) {
  return applyEvent(state, event(type, data, created));
}

function stream(part: string, extra: Record<string, unknown> = {}) {
  return { sessionID: SESSION, assistantMessageID: "msg_a", ordinal: 0, ...extra, part };
}

// ---------------------------------------------------------------------------

describe("thread reducer: seeding", () => {
  it("starts empty and idle", () => {
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

  it("indexes parts by id and keeps their announced order", () => {
    const thread = seedThread(emptyThread(), [
      {
        info: assistant("msg_a", 10),
        parts: [
          { id: "p2", sessionID: SESSION, messageID: "msg_a", type: "text", text: "two" },
          { id: "p1", sessionID: SESSION, messageID: "msg_a", type: "text", text: "one" },
        ],
      },
    ]);
    expect(orderedParts(thread.messages.msg_a!).map((part) => part.id)).toEqual(["p2", "p1"]);
  });
});

describe("thread reducer: text streams", () => {
  it("streams deltas keyed by message and ordinal", () => {
    let thread = apply(emptyThread(), "session.text.started", stream("text"));
    thread = apply(thread, "session.text.delta", { ...stream("text"), delta: "Hel" }, 11);
    thread = apply(thread, "session.text.delta", { ...stream("text"), delta: "lo" }, 12);

    const entry = thread.messages.msg_a!;
    expect(entry.info).toMatchObject({ id: "msg_a", role: "assistant", cost: 0 });
    expect(entry.parts["msg_a:0"]).toMatchObject({
      type: "text",
      text: "Hello",
      streaming: true,
    });
    expect(isStreaming(entry)).toBe(true);
  });

  it("creates the part when a delta arrives before started", () => {
    const thread = apply(emptyThread(), "session.text.delta", {
      ...stream("text"),
      delta: "early",
    });
    expect(thread.messages.msg_a!.parts["msg_a:0"]).toMatchObject({ text: "early" });
  });

  it("replaces the text on ended and clears streaming", () => {
    let thread = apply(emptyThread(), "session.text.delta", {
      ...stream("text"),
      delta: "partial",
    });
    thread = apply(thread, "session.text.ended", { ...stream("text"), text: "final text" }, 13);

    expect(thread.messages.msg_a!.parts["msg_a:0"]).toMatchObject({ text: "final text" });
    expect(isStreaming(thread.messages.msg_a!)).toBe(false);
  });

  it("keeps separate parts per ordinal", () => {
    let thread = apply(emptyThread(), "session.text.ended", {
      ...stream("text"),
      ordinal: 0,
      text: "first",
    });
    thread = apply(thread, "session.text.ended", { ...stream("text"), ordinal: 1, text: "second" }, 11);

    expect(Object.keys(thread.messages.msg_a!.parts)).toEqual(["msg_a:0", "msg_a:1"]);
    expect(thread.messages.msg_a!.parts["msg_a:1"]).toMatchObject({ text: "second" });
  });

  it("streams reasoning into its own part type", () => {
    let thread = apply(emptyThread(), "session.reasoning.started", stream("reasoning"));
    thread = apply(thread, "session.reasoning.delta", {
      ...stream("reasoning"),
      delta: "thinking",
    });

    expect(thread.messages.msg_a!.parts["msg_a:0"]).toMatchObject({
      type: "reasoning",
      text: "thinking",
      streaming: true,
    });
  });
});

describe("thread reducer: tools", () => {
  const toolFrame = (extra: Record<string, unknown>) => ({
    sessionID: SESSION,
    assistantMessageID: "msg_a",
    id: "tool_1",
    name: "bash",
    ...extra,
  });

  it("builds a pending card from the streamed input", () => {
    let thread = apply(emptyThread(), "session.tool.input.started", toolFrame({}));
    thread = apply(thread, "session.tool.input.delta", toolFrame({ delta: '{"command":' }), 11);
    thread = apply(thread, "session.tool.input.ended", toolFrame({ text: '{"command":"ls"}' }), 12);

    const part = thread.messages.msg_a!.parts.tool_1!;
    expect(part).toMatchObject({ type: "tool", tool: "bash", callID: "tool_1" });
    expect(part.type === "tool" && part.state).toEqual({
      status: "pending",
      input: { command: "ls" },
    });
  });

  it("marks the call running when the server calls it", () => {
    let thread = apply(emptyThread(), "session.tool.input.ended", toolFrame({ text: "{}" }));
    thread = apply(
      thread,
      "session.tool.called",
      toolFrame({ input: { command: "ls" }, metadata: { truncated: false } }),
      11,
    );

    const part = thread.messages.msg_a!.parts.tool_1!;
    expect(part.type === "tool" && part.state).toMatchObject({
      status: "running",
      input: { command: "ls" },
      metadata: { truncated: false },
    });
    expect(part.type === "tool" && toolIsActive(part.state)).toBe(true);
  });

  it("refreshes metadata on progress", () => {
    let thread = apply(emptyThread(), "session.tool.called", toolFrame({ input: {} }));
    thread = apply(
      thread,
      "session.tool.progress",
      toolFrame({ metadata: { diagnostics: { errors: 1 } } }),
      11,
    );

    const part = thread.messages.msg_a!.parts.tool_1!;
    expect(part.type === "tool" && part.state).toMatchObject({
      status: "running",
      metadata: { diagnostics: { errors: 1 } },
    });
  });

  it("completes with joined text output and ignores executed", () => {
    let thread = apply(emptyThread(), "session.tool.called", toolFrame({ input: { command: "ls" } }));
    thread = apply(
      thread,
      "session.tool.success",
      toolFrame({
        executed: true,
        content: [
          { type: "text", text: "a.ts" },
          { type: "text", text: "b.ts" },
          { type: "image", uri: "file://x" },
        ],
        metadata: { truncated: true },
      }),
      11,
    );

    const part = thread.messages.msg_a!.parts.tool_1!;
    expect(part.type === "tool" && part.state).toMatchObject({
      status: "completed",
      output: "a.ts\nb.ts",
      metadata: { truncated: true },
    });
    expect(part.type === "tool" && toolIsActive(part.state)).toBe(false);
  });

  it("surfaces the error message on failure", () => {
    let thread = apply(emptyThread(), "session.tool.called", toolFrame({ input: {} }));
    thread = apply(
      thread,
      "session.tool.failed",
      toolFrame({ error: { _tag: "CommandFailed", message: "exit 1" } }),
      11,
    );

    const part = thread.messages.msg_a!.parts.tool_1!;
    expect(part.type === "tool" && part.state).toMatchObject({
      status: "error",
      error: "exit 1",
    });
  });
});

describe("thread reducer: turns", () => {
  it("records cost and tokens from step.ended", () => {
    let thread = apply(emptyThread(), "session.text.ended", stream("text", { text: "hi" }));
    thread = apply(
      thread,
      "session.step.ended",
      {
        sessionID: SESSION,
        assistantMessageID: "msg_a",
        cost: 0.25,
        tokens: { input: 100, output: 20 },
        finish: "stop",
      },
      20,
    );

    expect(thread.messages.msg_a!.info).toMatchObject({
      cost: 0.25,
      tokens: { input: 100, output: 20 },
      finish: "stop",
    });
  });

  it("tracks execution status transitions", () => {
    let thread = apply(emptyThread(), "session.execution.started", { sessionID: SESSION });
    expect(thread.status).toEqual({ type: "busy" });

    thread = apply(thread, "session.execution.succeeded", { sessionID: SESSION });
    expect(thread.status).toEqual({ type: "idle" });
  });

  it("reports a failed execution with its message", () => {
    const thread = apply(emptyThread(), "session.execution.failed", {
      sessionID: SESSION,
      error: { _tag: "ProviderError", message: "provider exploded" },
    });

    expect(thread.status).toEqual({ type: "idle" });
    expect(thread.error).toBe("provider exploded");
  });

  it("maps retry status verbatim", () => {
    const thread = apply(emptyThread(), "session.status", {
      sessionID: SESSION,
      status: { type: "retry", attempt: 2, message: "rate limited", next: 500 },
    });

    expect(thread.status).toEqual({
      type: "retry",
      attempt: 2,
      message: "rate limited",
      next: 500,
    });
  });

  it("forces idle on session.idle", () => {
    let thread = apply(emptyThread(), "session.execution.started", { sessionID: SESSION });
    thread = apply(thread, "session.idle", { sessionID: SESSION });
    expect(thread.status).toEqual({ type: "idle" });
  });
});

describe("thread reducer: revert and compaction", () => {
  it("stages and clears diffs", () => {
    let thread = apply(emptyThread(), "session.revert.staged", {
      sessionID: SESSION,
      revert: { files: [{ path: "src/a.ts", additions: 2, deletions: 1 }] },
    });
    expect(thread.diffs).toHaveLength(1);

    thread = apply(thread, "session.revert.cleared", { sessionID: SESSION });
    expect(thread.diffs).toEqual([]);
  });

  it("drops messages after the revert target on commit", () => {
    let thread = seedThread(emptyThread(), [
      { info: user("msg_a", 10), parts: [] },
      { info: assistant("msg_b", 20), parts: [] },
      { info: assistant("msg_c", 30), parts: [] },
    ]);

    thread = apply(thread, "session.revert.committed", { sessionID: SESSION, to: "msg_b" });

    expect(thread.order).toEqual(["msg_a", "msg_b"]);
    expect(thread.messages.msg_c).toBeUndefined();
    expect(thread.diffs).toEqual([]);
  });

  it("appends compaction output to a per-session message", () => {
    let thread = apply(emptyThread(), "session.compaction.started", { sessionID: SESSION });
    expect(thread.order).toEqual([]);

    thread = apply(thread, "session.compaction.ended", {
      sessionID: SESSION,
      text: "summary one",
      reason: "auto",
    });
    const entry = thread.messages[`compaction:${SESSION}`];
    expect(orderedParts(entry)).toHaveLength(1);
    expect(orderedParts(entry)[0]).toMatchObject({ type: "compaction", text: "summary one" });
  });

  it("returns the identical object for an unrelated event", () => {
    const thread = emptyThread();
    expect(applyEvent(thread, event("plugin.added", { id: "core/config" }))).toBe(thread);
  });
});

describe("threadTotals", () => {
  it("sums cost and tokens across assistant turns only", () => {
    const thread = seedThread(emptyThread(), [
      { info: user("msg_a", 10), parts: [] },
      {
        info: assistant("msg_b", 20, {
          cost: 0.5,
          tokens: { input: 10, output: 20, reasoning: 5 },
        }),
        parts: [],
      },
    ]);

    expect(threadTotals(thread)).toEqual({ cost: 0.5, tokens: 35 });
  });

  it("is zero for an empty thread", () => {
    expect(threadTotals(emptyThread())).toEqual({ cost: 0, tokens: 0 });
  });
});
