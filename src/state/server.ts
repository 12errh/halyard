/**
 * Server lifecycle, mirroring the Rust-side `ServerStatus` machine.
 *
 * The Rust process manager is the source of truth and pushes transitions over
 * an event; this store only reflects them, plus optimistic local state while a
 * restart is in flight.
 */

import { create } from "zustand";
import { api, onServerStatus, onServerLog, type ServerInfo, type ServerStatus } from "@/lib/tauri";

export type ServerPhase =
  | { kind: "stopped" }
  | { kind: "starting" }
  | { kind: "ready"; info: ServerInfo }
  | { kind: "failed"; message: string };

export interface ServerLogEntry {
  level: string;
  message: string;
  at: number;
}

interface ServerStore {
  phase: ServerPhase;
  logs: ServerLogEntry[];
  /** Path of the project the running server is scoped to. */
  project: string | null;
  /** Path of the binary in use, when overridden in Settings. */
  binaryOverride: string | null;
  /** Bind the event listeners exactly once, for the app's lifetime. */
  attach(): Promise<() => void>;
  start(project: string, binaryOverride: string | null): Promise<void>;
  stop(): Promise<void>;
  /** Stop and start again on the same project. */
  restart(project?: string): Promise<void>;
  reset(): void;
}

const MAX_LOG_LINES = 300;

export const useServer = create<ServerStore>((set, get) => ({
  phase: { kind: "stopped" },
  logs: [],
  project: null,
  binaryOverride: null,

  attach: async () => {
    const [unlistenStatus, unlistenLog] = await Promise.all([
      onServerStatus((status) => set({ phase: fromRust(status) })),
      onServerLog((line) =>
        set((state) => ({
          // Newest first: when you are debugging a failed boot you want the
          // reason at the top, not buried at the bottom.
          logs: [{ ...line, at: Date.now() }, ...state.logs].slice(0, MAX_LOG_LINES),
        })),
      ),
    ]);
    return () => {
      unlistenStatus();
      unlistenLog();
    };
  },

  start: async (project, binaryOverride) => {
    set({ phase: { kind: "starting" }, logs: [], project, binaryOverride });
    try {
      const info = await api.startServer(project, binaryOverride);
      set({ phase: { kind: "ready", info } });
    } catch (error) {
      const message = String(error);
      set({ phase: { kind: "failed", message } });
    }
  },

  stop: async () => {
    set({ phase: { kind: "stopped" } });
    await api.stopServer().catch(() => undefined);
  },

  // opencode reads its config at start and never re-reads it, so applying a
  // settings change means cycling the process.
  restart: async (project) => {
    const target = project ?? get().project;
    if (!target) return;
    await get().stop();
    await get().start(target, get().binaryOverride);
  },

  reset: () => set({ phase: { kind: "stopped" }, logs: [], project: null }),
}));

function fromRust(status: ServerStatus): ServerPhase {
  switch (status.status) {
    case "stopped":
      return { kind: "stopped" };
    case "starting":
      return { kind: "starting" };
    case "ready":
      return {
        kind: "ready",
        info: {
          url: status.url,
          port: status.port,
          version: status.version,
          project: status.project,
        },
      };
    case "failed":
      return { kind: "failed", message: status.message };
  }
}

export function serverIsBusy(phase: ServerPhase): boolean {
  return phase.kind === "starting";
}

export function serverInfo(phase: ServerPhase): ServerInfo | null {
  return phase.kind === "ready" ? phase.info : null;
}

/** Re-exported for components that only need to know "can I talk to opencode". */
export function useServerReady(): boolean {
  return useServer((s) => s.phase.kind === "ready");
}

export function useServerPhase(): ServerPhase {
  return useServer((s) => s.phase);
}

export const serverStore = useServer;
export const useServerLogs = () => useServer((s) => s.logs);
export const useServerStart = () => useServer((s) => s.start);
export const getServerPhase = () => useServer.getState().phase;
