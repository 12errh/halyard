/**
 * Per-session thread state plus the live SSE subscription.
 *
 * Threads are kept only for sessions the user has actually opened. opencode
 * owns the durable copy in its database, so nothing here needs persisting.
 */

import { create } from "zustand";
import {
  applyEvent,
  emptyThread,
  seedThread,
  type ThreadState,
} from "@/lib/opencode/thread";
import { subscribe, type SseHandle } from "@/lib/opencode/sse";
import type { ServerEvent } from "@/lib/opencode/types";

export type ConnectionState = "idle" | "connecting" | "open" | "error" | "closed";

interface ThreadStore {
  threads: Record<string, ThreadState>;
  connection: ConnectionState;
  /** Currently streaming session, for the global activity indicator. */
  busySessionId: string | null;
  handle: SseHandle | null;

  connect(url: string, alsoHandle?: (event: ServerEvent) => void): void;
  disconnect(): void;
  ingest(event: ServerEvent): void;
  load(sessionId: string, entries: Array<{ info: import("@/lib/opencode/types").MessageInfo; parts: import("@/lib/opencode/types").Part[] }>): void;
  clear(sessionId: string): void;
  /**
   * Apply any deltas still waiting on a frame.
   *
   * Text arrives far faster than the screen refreshes — often several tokens
   * per 16ms. Rendering each one separately meant a full markdown re-parse of
   * the whole reply per token, which saturated the main thread and left the
   * reader watching text jump in visible steps. Deltas are now batched into one
   * render per frame, which is the difference between water and chunks.
   *
   * Called automatically; exposed so tests and non-browser hosts can settle
   * synchronously instead of waiting on a frame that may never come.
   */
  flushPending(): void;
}

/**
 * Fold one event into the thread map.
 *
 * Split out of the store so it can be applied either immediately or, for
 * deltas, later — the arithmetic must not care which. It reads and writes only
 * the two fields it touches, which is what lets a batch of deltas be folded
 * together without copying the store's actions.
 */
type ThreadSlice = Pick<ThreadStore, "threads" | "busySessionId">;

function applyIngest(state: ThreadSlice, event: ServerEvent): ThreadSlice {
  const sessionID = (event.properties as { sessionID?: string })?.sessionID;
  if (!sessionID) return state;
  // Ignore churn from sessions the user never opened.
  if (!(sessionID in state.threads)) return state;

  const previous = state.threads[sessionID]!;
  const next = applyEvent(previous, event);
  if (next === previous) return state;

  const busy =
    event.type === "session.status" && (event.properties as { status: { type: string } }).status.type === "busy"
      ? sessionID
      : event.type === "session.idle"
        ? state.busySessionId === sessionID
          ? null
          : state.busySessionId
        : state.busySessionId;

  return {
    threads: { ...state.threads, [sessionID]: next },
    busySessionId: busy,
  };
}

export const useThreads = create<ThreadStore>((set, get) => {
  // Deltas waiting for the next frame, and the frame they are waiting on.
  let buffered: ServerEvent[] = [];
  let frame: number | null = null;

  const flushPending = () => {
    if (frame !== null) {
      if (typeof cancelAnimationFrame === "function") cancelAnimationFrame(frame);
      else clearTimeout(frame);
      frame = null;
    }
    if (buffered.length === 0) return;
    const events = buffered;
    buffered = [];
    set((state) => {
      let next: ThreadSlice = state;
      for (const event of events) next = applyIngest(next, event);
      return next;
    });
  };

  const schedule = () => {
    if (frame !== null) return;
    // One batch per frame. `requestAnimationFrame` is the honest clock here:
    // it fires immediately before the next paint, so the text a reader sees is
    // always the newest text we have, and never newer than the screen.
    if (typeof requestAnimationFrame === "function") {
      frame = requestAnimationFrame(() => {
        frame = null;
        flushPending();
      });
    } else {
      // Server-side rendering and tests have no frame clock. A short timer
      // keeps the text moving without pretending to be a paint.
      frame = setTimeout(() => {
        frame = null;
        flushPending();
      }, 16) as unknown as number;
    }
  };

  return {
    threads: {},
    connection: "idle",
    busySessionId: null,
    handle: null,

    connect: (url, alsoHandle) => {
      get().disconnect();
      const handle = subscribe(url, {
        // The SSE subscription is the single fan-out point for server events.
        // `alsoHandle` lets other stores (permissions) observe the same stream
        // without opening a second connection.
        onEvent: (event) => {
          get().ingest(event);
          alsoHandle?.(event);
        },
        onStatus: (status) =>
          set((state) => ({
            connection: status,
            // A drop must not leave a stale spinner running forever.
            busySessionId: status === "open" ? state.busySessionId : null,
          })),
      });
      set({ handle });
    },

    disconnect: () => {
      get().flushPending();
      get().handle?.close();
      set({ handle: null, connection: "idle", busySessionId: null });
    },

    ingest: (event) => {
      // The high-frequency path: hold the text back until the next frame.
      if (event.type === "message.part.delta") {
        buffered.push(event);
        schedule();
        return;
      }
      // Everything else must not overtake text already in flight, or the tool
      // call that follows a streamed paragraph renders above it.
      flushPending();
      set((state) => applyIngest(state, event));
    },

    flushPending,

    load: (sessionId, entries) => {
      // Seed over the newest text, not over a version missing its last tokens.
      flushPending();
      set((state) => ({
        threads: {
          ...state.threads,
          [sessionId]: seedThread(state.threads[sessionId] ?? emptyThread(), entries),
        },
      }));
    },

    clear: (sessionId) => {
      flushPending();
      set((state) => {
        const threads = { ...state.threads };
        delete threads[sessionId];
        return { threads };
      });
    },
  };
});

export function useThread(sessionId: string | null): ThreadState | undefined {
  return useThreads((s) => (sessionId ? s.threads[sessionId] : undefined));
}

export function useBusySessionId(): string | null {
  return useThreads((s) => s.busySessionId);
}

export function useConnection(): ConnectionState {
  return useThreads((s) => s.connection);
}
