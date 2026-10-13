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
}

export const useThreads = create<ThreadStore>((set, get) => ({
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
    get().handle?.close();
    set({ handle: null, connection: "idle", busySessionId: null });
  },

  ingest: (event) =>
    set((state) => {
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
    }),

  load: (sessionId, entries) =>
    set((state) => ({
      threads: {
        ...state.threads,
        [sessionId]: seedThread(state.threads[sessionId] ?? emptyThread(), entries),
      },
    })),

  clear: (sessionId) =>
    set((state) => {
      const threads = { ...state.threads };
      delete threads[sessionId];
      return { threads };
    }),
}));

export function useThread(sessionId: string | null): ThreadState | undefined {
  return useThreads((s) => (sessionId ? s.threads[sessionId] : undefined));
}

export function useBusySessionId(): string | null {
  return useThreads((s) => s.busySessionId);
}

export function useConnection(): ConnectionState {
  return useThreads((s) => s.connection);
}
