/**
 * Server-sent events transport for the opencode event bus.
 *
 * Written against `fetch` + `ReadableStream` rather than `EventSource` so we
 * control reconnection, backoff and teardown, and so a dropped connection
 * surfaces to the UI instead of retrying silently forever.
 */

import { httpFetch } from "@/lib/http";
import type { ServerEvent } from "./types";

export interface SseHandle {
  close(): void;
}

export interface SseOptions {
  /** Called for every decoded event. */
  onEvent(event: ServerEvent): void;
  onStatus?(status: "connecting" | "open" | "closed" | "error"): void;
  /** Injected for tests. */
  fetchImpl?: typeof fetch;
  /** Base backoff delay; doubles per consecutive failure. */
  retryDelayMs?: number;
  maxRetryDelayMs?: number;
}

/**
 * Incremental SSE frame parser.
 *
 * Exported so the framing rules can be tested without a socket: events are
 * separated by a blank line, comments start with `:`, and a single `data:`
 * line may be split across network chunks.
 */
export class SseParser {
  private buffer = "";

  /** Feed a chunk, receive whatever complete events it completed. */
  push(chunk: string): string[] {
    this.buffer += chunk;
    const frames: string[] = [];

    // Normalise CRLF and lone CR so the split below only has to handle \n.
    this.buffer = this.buffer.replace(/\r\n|\r/g, "\n");

    let separator = this.buffer.indexOf("\n\n");
    while (separator !== -1) {
      const frame = this.buffer.slice(0, separator);
      this.buffer = this.buffer.slice(separator + 2);
      const data = readData(frame);
      if (data !== null) frames.push(data);
      separator = this.buffer.indexOf("\n\n");
    }

    return frames;
  }

  /** Flush a trailing frame when the stream ends without a blank line. */
  flush(): string[] {
    if (!this.buffer.trim()) {
      this.buffer = "";
      return [];
    }
    const data = readData(this.buffer);
    this.buffer = "";
    return data === null ? [] : [data];
  }
}

function readData(frame: string): string | null {
  const payload = frame
    .split("\n")
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).replace(/^ /, ""))
    .join("\n");

  return payload.length > 0 ? payload : null;
}

/**
 * Subscribe to `GET /event`, reconnecting with exponential backoff.
 *
 * The `server.connected` handshake event arrives first and is surfaced to the
 * caller like any other; it is a useful liveness signal for the status bar.
 */
export function subscribe(url: string, options: SseOptions): SseHandle {
  // Must go through httpFetch: a bare `fetch` reference loses its receiver.
  const doFetch = options.fetchImpl ?? httpFetch;
  const baseDelay = options.retryDelayMs ?? 500;
  const maxDelay = options.maxRetryDelayMs ?? 10_000;

  let closed = false;
  let attempt = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let controller: AbortController | undefined;

  const schedule = () => {
    if (closed) return;
    const delay = Math.min(baseDelay * 2 ** attempt, maxDelay);
    attempt += 1;
    timer = setTimeout(connect, delay);
  };

  const connect = async () => {
    if (closed) return;
    controller = new AbortController();
    options.onStatus?.("connecting");

    try {
      const response = await doFetch(url, {
        headers: { Accept: "text/event-stream" },
        signal: controller.signal,
      });

      if (!response.ok || !response.body) {
        options.onStatus?.("error");
        schedule();
        return;
      }

      options.onStatus?.("open");
      attempt = 0;

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      const parser = new SseParser();

      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        for (const frame of parser.push(decoder.decode(value, { stream: true }))) {
          dispatch(frame, options.onEvent);
        }
      }

      for (const frame of parser.flush()) dispatch(frame, options.onEvent);

      // A clean end-of-stream still means we lost the server (it is a long
      // lived connection), so treat it as a drop rather than a shutdown.
      if (!closed) {
        options.onStatus?.("closed");
        schedule();
      }
    } catch (error) {
      if (closed || (error as Error)?.name === "AbortError") return;
      options.onStatus?.("error");
      schedule();
    }
  };

  void connect();

  return {
    close() {
      closed = true;
      if (timer) clearTimeout(timer);
      controller?.abort();
      options.onStatus?.("closed");
    },
  };
}

function dispatch(raw: string, onEvent: (event: ServerEvent) => void) {
  try {
    const parsed = JSON.parse(raw) as ServerEvent;
    // Guard against a partial frame that happened to parse as something else.
    if (parsed && typeof parsed.type === "string") onEvent(parsed);
  } catch {
    // Malformed frame: skip it rather than tearing down the stream. One bad
    // event should not cost the user their whole session.
  }
}
