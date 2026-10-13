import { describe, expect, it, vi } from "vitest";
import { SseParser, subscribe } from "@/lib/opencode/sse";
import type { ServerEvent } from "@/lib/opencode/types";

function frame(payload: unknown): string {
  return `data: ${JSON.stringify(payload)}\n\n`;
}

/** Build a Response-like object that streams the given chunks. */
function streamOf(chunks: string[], opts: { failAfter?: number } = {}) {
  let index = 0;
  return {
    ok: true,
    body: {
      getReader() {
        return {
          read: async () => {
            if (opts.failAfter !== undefined && index >= opts.failAfter) {
              throw new Error("connection reset");
            }
            if (index >= chunks.length) return { done: true, value: undefined };
            const value = new TextEncoder().encode(chunks[index]!);
            index += 1;
            return { done: false, value };
          },
        };
      },
    },
  } as unknown as Response;
}

describe("SseParser framing", () => {
  it("emits nothing until the terminating blank line arrives", () => {
    const parser = new SseParser();
    expect(parser.push('data: {"type":"a"}')).toEqual([]);
    // A frame ends at a blank line, i.e. the second newline.
    expect(parser.push("\n")).toEqual([]);
    expect(parser.push("\n")).toEqual(['{"type":"a"}']);
  });

  it("joins a payload split across chunks", () => {
    const parser = new SseParser();
    expect(parser.push('data: {"ty')).toEqual([]);
    expect(parser.push('pe":"server.conn')).toEqual([]);
    expect(parser.push('ected"}\n\n')).toEqual(['{"type":"server.connected"}']);
  });

  it("handles several events in one chunk", () => {
    const parser = new SseParser();
    const out = parser.push('data: {"n":1}\n\ndata: {"n":2}\n\ndata: {"n":3}\n\n');
    expect(out).toEqual(['{"n":1}', '{"n":2}', '{"n":3}']);
  });

  it("normalises CRLF line endings", () => {
    const parser = new SseParser();
    expect(parser.push('data: {"n":1}\r\n\r\n')).toEqual(['{"n":1}']);
  });

  it("ignores comment frames such as heartbeats", () => {
    const parser = new SseParser();
    expect(parser.push(": keep-alive\n\n")).toEqual([]);
  });

  it("ignores non-data fields", () => {
    const parser = new SseParser();
    expect(parser.push('event: ping\nid: 7\n\n')).toEqual([]);
  });

  it("joins multi-line data fields", () => {
    const parser = new SseParser();
    expect(parser.push("data: one\ndata: two\n\n")).toEqual(["one\ntwo"]);
  });

  it("flushes a trailing frame with no terminating blank line", () => {
    const parser = new SseParser();
    parser.push('data: {"n":1}');
    expect(parser.flush()).toEqual(['{"n":1}']);
  });
});

describe("subscribe", () => {
  it("delivers decoded events", async () => {
    const events: ServerEvent[] = [];
    const handle = subscribe("http://127.0.0.1:4096/event", {
      onEvent: (event) => events.push(event),
      fetchImpl: vi.fn().mockResolvedValue(
        streamOf([frame({ id: "evt_1", type: "server.connected", properties: {} })]),
      ),
    });

    await vi.waitFor(() => expect(events).toHaveLength(1));
    expect(events[0]!.type).toBe("server.connected");
    handle.close();
  });

  it("skips malformed frames without tearing down the stream", async () => {
    const events: ServerEvent[] = [];
    const handle = subscribe("http://127.0.0.1:4096/event", {
      onEvent: (event) => events.push(event),
      fetchImpl: vi.fn().mockResolvedValue(
        streamOf(["data: {not json\n\n", frame({ id: "evt_2", type: "session.idle", properties: {} })]),
      ),
    });

    await vi.waitFor(() => expect(events).toHaveLength(1));
    // One bad frame must not cost the user the rest of the session.
    expect(events[0]!.type).toBe("session.idle");
    handle.close();
  });

  it("reports open once the stream is established", async () => {
    const statuses: string[] = [];
    const handle = subscribe("http://127.0.0.1:4096/event", {
      onEvent: () => {},
      onStatus: (status) => statuses.push(status),
      fetchImpl: vi.fn().mockResolvedValue(streamOf([])),
    });

    await vi.waitFor(() => expect(statuses).toContain("open"));
    handle.close();
  });

  it("reconnects after the stream ends", async () => {
    // Each call must yield a *fresh* stream; reusing an exhausted reader would
    // return `done` immediately and turn this into a reconnect storm.
    let call = 0;
    const fetchImpl = vi.fn().mockImplementation(async () => {
      call += 1;
      if (call === 1) {
        return streamOf([frame({ id: "evt_1", type: "first", properties: {} })]);
      }
      return streamOf([frame({ id: "evt_2", type: "second", properties: {} })]);
    });

    const events: ServerEvent[] = [];
    const handle = subscribe("http://127.0.0.1:4096/event", {
      onEvent: (event) => events.push(event),
      fetchImpl,
      retryDelayMs: 5,
      maxRetryDelayMs: 5,
    });

    await vi.waitFor(() => expect(events.length).toBeGreaterThanOrEqual(2), { timeout: 3000 });
    expect(events.map((e) => e.type)).toContain("first");
    expect(events.map((e) => e.type)).toContain("second");
    expect(fetchImpl.mock.calls.length).toBeGreaterThanOrEqual(2);
    handle.close();
  }, 5000);

  it("stops fetching once closed", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(streamOf([]));
    const handle = subscribe("http://127.0.0.1:4096/event", {
      onEvent: () => {},
      fetchImpl,
      retryDelayMs: 5,
    });
    handle.close();
    const callsAtClose = fetchImpl.mock.calls.length;
    await new Promise((resolve) => setTimeout(resolve, 60));
    expect(fetchImpl.mock.calls.length).toBe(callsAtClose);
  });
});
