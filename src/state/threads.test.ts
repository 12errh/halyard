import { beforeEach, describe, expect, it } from "vitest";
import { useThreads } from "@/state/threads";
import { orderedParts } from "@/lib/opencode/thread";
import type { MessageInfo, TextPart, V2Event } from "@/lib/opencode/types";

/**
 * Streaming cadence.
 *
 * The complaint this encodes: a reply arrived in visible steps rather than
 * flowing. Nothing was wrong with the text — every token was applied, in
 * order. The problem was that each token triggered its own render, and each
 * render re-parsed the whole reply through the markdown renderer. Tokens
 * arrive several per frame, so the main thread could never keep up and the
 * reader saw the thread jump.
 *
 * So the contract under test is about *how many* updates land, not what the
 * text says: a burst of deltas must cost one update, and must not lose or
 * reorder a character.
 */

const SESSION = "ses_stream";

const assistant: MessageInfo = {
  id: "msg_1",
  sessionID: SESSION,
  role: "assistant",
  time: { created: 1, updated: 1 },
} as MessageInfo;

function delta(text: string): V2Event {
  return {
    id: `evt_${Math.random().toString(36).slice(2)}`,
    type: "session.text.delta",
    data: {
      sessionID: SESSION,
      assistantMessageID: "msg_1",
      ordinal: 0,
      delta: text,
    },
  } as unknown as V2Event;
}

/**
 * The text as the screen would show it.
 *
 * Read through `orderedParts` rather than the raw `parts` map on purpose: a
 * delta for a part the server has not described yet is buffered in `pending`,
 * so reading `parts` directly would report an empty reply for a perfectly
 * healthy stream.
 */
function streamedText(): string {
  const entry = useThreads.getState().threads[SESSION];
  const message = entry?.messages["msg_1"];
  if (!message) return "";
  return orderedParts(message)
    .filter((part): part is TextPart => part.type === "text")
    .map((part) => part.text)
    .join("");
}

/** Counts store notifications, which is what a React subscriber would see. */
function countUpdates(run: () => void): number {
  let updates = 0;
  const unsubscribe = useThreads.subscribe(() => {
    updates += 1;
  });
  try {
    run();
  } finally {
    unsubscribe();
  }
  return updates;
}

const reset = () => {
  useThreads.getState().flushPending();
  useThreads.setState({ threads: {}, busySessionId: null });
};

describe("thread store: streaming cadence", () => {
  beforeEach(() => {
    reset();
    useThreads.getState().load(SESSION, [{ info: assistant, parts: [] }]);
  });

  it("does not render once per token", () => {
    // Twenty tokens is an ordinary paragraph. One update, not twenty.
    const updates = countUpdates(() => {
      for (const word of Array(20).fill("word")) useThreads.getState().ingest(delta(word));
    });

    expect(updates).toBe(0);
    useThreads.getState().flushPending();
    // The flush is the single render the burst collapses into.
    expect(streamedText()).toBe(Array(20).fill("word").join(""));
  });

  it("collapses a burst into a single store update", () => {
    let updates = 0;
    const unsubscribe = useThreads.subscribe(() => {
      updates += 1;
    });

    for (const word of Array(20).fill("word")) useThreads.getState().ingest(delta(word));
    useThreads.getState().flushPending();
    unsubscribe();

    expect(updates).toBe(1);
  });

  it("loses no character and keeps the order", () => {
    const words = ["The", " quick", " brown", " fox", " jumps", " over"];
    for (const word of words) useThreads.getState().ingest(delta(word));
    useThreads.getState().flushPending();

    expect(streamedText()).toBe(words.join(""));
  });

  it("flushes pending text before applying a later event, so order holds", () => {
    useThreads.getState().ingest(delta("streamed "));

    // A tool call that ran after the paragraph must not render above it.
    useThreads.getState().ingest({
      id: "evt_tool",
      type: "session.tool.input.started",
      data: {
        sessionID: SESSION,
        assistantMessageID: "msg_1",
        id: "prt_2",
        name: "bash",
      },
    } as unknown as V2Event);

    const entry = useThreads.getState().threads[SESSION];
    expect(entry?.messages["msg_1"]?.partOrder).toEqual(["msg_1:0", "prt_2"]);
    expect(streamedText()).toBe("streamed ");
  });

  it("does not apply the same buffered text twice", () => {
    useThreads.getState().ingest(delta("once"));
    useThreads.getState().flushPending();
    useThreads.getState().flushPending();

    expect(streamedText()).toBe("once");
  });

  it("flushes before seeding, so server truth is not double-counted", () => {
    // The server already has this text. If the buffered delta were applied
    // after the seed rather than before it, the words would land twice.
    useThreads.getState().ingest(delta("quick "));

    const serverPart: TextPart = {
      id: "msg_1:0",
      sessionID: SESSION,
      messageID: "msg_1",
      type: "text",
      text: "The quick brown",
    };
    useThreads.getState().load(SESSION, [{ info: assistant, parts: [serverPart] }]);

    expect(streamedText()).toBe("The quick brown");
  });

  it("applies ordinary events immediately, with no frame in between", () => {
    // Busy state drives the spinner; a frame of lag would be visible.
    useThreads.getState().ingest({
      id: "evt_start",
      type: "session.execution.started",
      data: { sessionID: SESSION },
    } as unknown as V2Event);

    expect(useThreads.getState().busySessionId).toBe(SESSION);
  });

  it("resolves the busy state when the session goes idle", () => {
    useThreads.getState().ingest({
      id: "evt_start",
      type: "session.execution.started",
      data: { sessionID: SESSION },
    } as unknown as V2Event);
    useThreads.getState().ingest({
      id: "evt_done",
      type: "session.execution.succeeded",
      data: { sessionID: SESSION },
    } as unknown as V2Event);

    expect(useThreads.getState().busySessionId).toBeNull();
  });

  it("settles the text even where no frame clock exists", () => {
    // The fallback path for hosts without requestAnimationFrame must still
    // deliver the text rather than parking it in a buffer forever.
    const original = globalThis.requestAnimationFrame;
    // @ts-expect-error deliberately removing the clock for this case
    delete globalThis.requestAnimationFrame;

    try {
      useThreads.getState().ingest(delta("fallback"));
      useThreads.getState().flushPending();
      expect(streamedText()).toBe("fallback");
    } finally {
      globalThis.requestAnimationFrame = original;
    }
  });
});
