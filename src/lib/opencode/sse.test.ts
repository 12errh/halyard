import { describe, expect, it, vi } from "vitest";
import { SseParser, subscribe } from "@/lib/opencode/sse";
import type { V2Event } from "@/lib/opencode/types";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}

function streamOf(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
}

function frame(payload: unknown): string {
  return `data: ${JSON.stringify(payload)}\n\n`;
}

// ---------------------------------------------------------------------------

describe("SseParser", () => {
  it("decodes one frame", () => {
    const parser = new SseParser();
    expect(parser.push('data: {"type":"server.connected"}\n\n')).toEqual([
      '{"type":"server.connected"}',
    ]);
  });

  it("joins multiple data lines with a newline", () => {
    const parser = new SseParser();
    expect(parser.push("data: hello\ndata: world\n\n")).toEqual(["hello\nworld"]);
  });

  it("normalises CRLF line endings", () => {
    const parser = new SseParser();
    expect(parser.push("data: hello\r\n\r\n")).toEqual(["hello"]);
  });

  it("drops comment-only frames", () => {
    const parser = new SseParser();
    expect(parser.push(": keep-alive\n\n")).toEqual([]);
  });

  it("buffers a frame split across chunks", () => {
    const parser = new SseParser();
    expect(parser.push('data: {"type":"session.idle"')).toEqual([]);
    expect(parser.push('}\n\n')).toEqual(['{"type":"session.idle"}']);
  });

  it("flushes a trailing frame at end of stream", () => {
    const parser = new SseParser();
    expect(parser.push('data: {"type":"tail"}')).toEqual([]);
    expect(parser.flush()).toEqual(['{"type":"tail"}']);
    expect(parser.flush()).toEqual([]);
  });
});

describe("subscribe", () => {
  it("delivers typed events, merges headers and reports status", async () => {
    const seen: V2Event[] = [];
    const statuses: string[] = [];
    let headers: Record<string, string> | undefined;

    const fetchImpl: typeof fetch = async (_input, init) => {
      headers = init?.headers as Record<string, string> | undefined;
      return new Response(
        streamOf([
          frame({ id: "evt_1", type: "server.connected", data: {} }),
          frame({ id: "evt_2", type: "session.idle", data: { sessionID: "ses_1" } }),
        ]),
        { status: 200 },
      );
    };

    const settled = deferred();
    const handle = subscribe("http://localhost:4096/api/event", {
      onEvent: (event) => seen.push(event),
      onStatus: (status) => {
        statuses.push(status);
        if (status === "closed") settled.resolve();
      },
      headers: { Authorization: "Basic abc" },
      fetchImpl,
      retryDelayMs: 60_000,
    });

    await settled.promise;
    handle.close();

    expect(seen.map((event) => event.type)).toEqual(["server.connected", "session.idle"]);
    expect(headers).toMatchObject({
      Accept: "text/event-stream",
      Authorization: "Basic abc",
    });
    expect(statuses).toContain("open");
    expect(statuses.indexOf("closed")).toBeGreaterThan(statuses.indexOf("open"));
  });

  it("skips malformed and typeless frames without tearing down", async () => {
    const seen: V2Event[] = [];

    const fetchImpl: typeof fetch = async () =>
      new Response(
        streamOf([
          "data: not-json\n\n",
          frame({ foo: 1 }),
          frame({ id: "evt_ok", type: "server.connected", data: {} }),
        ]),
        { status: 200 },
      );

    const settled = deferred();
    const handle = subscribe("http://localhost:4096/api/event", {
      onEvent: (event) => seen.push(event),
      onStatus: (status) => {
        if (status === "closed") settled.resolve();
      },
      fetchImpl,
      retryDelayMs: 60_000,
    });

    await settled.promise;
    handle.close();

    expect(seen).toHaveLength(1);
    expect(seen[0]!.id).toBe("evt_ok");
  });

  it("stops reconnecting when the server rejects the credential", async () => {
    vi.useFakeTimers();
    try {
      const statuses: string[] = [];
      const fetchImpl = vi.fn(async () => new Response(null, { status: 401 }));

      const handle = subscribe("http://localhost:4096/api/event", {
        onEvent: () => {},
        onStatus: (status) => statuses.push(status),
        fetchImpl,
        retryDelayMs: 1,
      });

      // Let any old backoff timer fire: a surviving loop would retry here.
      await Promise.resolve();
      await Promise.resolve();
      await vi.advanceTimersByTimeAsync(50);
      handle.close();

      // A 401 is a credential bug, not a network blip: retrying replays it.
      expect(fetchImpl).toHaveBeenCalledTimes(1);
      expect(statuses).toContain("unauthorized");
      expect(statuses).not.toContain("error");
    } finally {
      vi.useRealTimers();
    }
  });

  it("still retries transient failures", async () => {
    vi.useFakeTimers();
    try {
      const statuses: string[] = [];
      const fetchImpl = vi.fn(async () => new Response(null, { status: 503 }));

      const handle = subscribe("http://localhost:4096/api/event", {
        onEvent: () => {},
        onStatus: (status) => statuses.push(status),
        fetchImpl,
        retryDelayMs: 1,
      });

      await Promise.resolve();
      await Promise.resolve();
      await vi.advanceTimersByTimeAsync(50);
      handle.close();

      expect(fetchImpl.mock.calls.length).toBeGreaterThan(1);
      expect(statuses).toContain("error");
    } finally {
      vi.useRealTimers();
    }
  });
});
