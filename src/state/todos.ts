/**
 * The agent's plan for each session.
 *
 * Kept out of the thread store on purpose. Todos are not transcript content —
 * they are live state that the agent rewrites wholesale on every `todowrite` —
 * so treating them as messages would put the same list in the history several
 * times and make "what is the current plan" ambiguous.
 */

import { create } from "zustand";
import { normaliseTodos, todoProgress, type Todo } from "@/lib/opencode/types";
import type { ServerEvent } from "@/lib/opencode/types";

interface TodoStore {
  /** Live plan per session. */
  bySession: Record<string, Todo[]>;
  /** Sessions whose list has not been read since it last changed. */
  dirty: Set<string>;
  /** Consume a server event, if it is one we care about. */
  ingest(event: ServerEvent): void;
  set(sessionID: string, raw: unknown, seen: boolean): void;
  hydrate(sessionID: string, raw: unknown): void;
  clear(sessionID: string): void;
  reset(): void;
}

export const useTodos = create<TodoStore>((set) => ({
  bySession: {},
  dirty: new Set(),

  ingest: (event) => {
    if (event.type !== "todo.updated") return;
    const { sessionID, todos } = event.properties as { sessionID?: string; todos?: unknown };
    if (!sessionID) return;
    useTodos.getState().set(sessionID, todos, false);
  },

  // `seen` distinguishes a list pushed by the agent (unread) from one fetched
  // on open, which is already on screen and must not claim to be unseen.
  set: (sessionID, raw, seen) =>
    set((state) => {
      const dirty = new Set(state.dirty);
      if (seen) dirty.delete(sessionID);
      else dirty.add(sessionID);
      return { bySession: { ...state.bySession, [sessionID]: normaliseTodos(raw) }, dirty };
    }),

  hydrate: (sessionID, raw) => useTodos.getState().set(sessionID, raw, true),

  clear: (sessionID) =>
    set((state) => {
      const bySession = { ...state.bySession };
      delete bySession[sessionID];
      const dirty = new Set(state.dirty);
      dirty.delete(sessionID);
      return { bySession, dirty };
    }),

  reset: () => set({ bySession: {}, dirty: new Set() }),
}));

/** Read one session's plan. */
export function todosFor(bySession: Record<string, Todo[]>, sessionID: string | null): Todo[] {
  return sessionID ? (bySession[sessionID] ?? []) : [];
}

/**
 * Whether the panel should be expanded on its own.
 *
 * A long list would otherwise dominate the thread the moment it is written, so
 * anything past a few items stays folded until asked for.
 */
export const AUTO_EXPAND_LIMIT = 5;

export function shouldAutoExpand(todos: Todo[]): boolean {
  return todos.length > 0 && todos.length <= AUTO_EXPAND_LIMIT;
}

/** Progress for the header line. */
export function progressOf(todos: Todo[]): ReturnType<typeof todoProgress> {
  return todoProgress(todos);
}
