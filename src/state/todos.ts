/**
 * The agent's plan for each session.
 *
 * v2 has no todo route and no `todo.updated` event. The only place a plan
 * exists is the `todowrite` tool call, whose completed part carries
 * `state.input.todos`. Plans are therefore derived from the thread: the newest
 * completed `todowrite` part in the latest assistant message wins, exactly as
 * it would on the server.
 *
 * The `todowrite` tool is opt-in on the server side: an install that does not
 * expose it simply never produces a plan, and this store stays empty.
 *
 * Kept out of the thread store on purpose. Todos are not transcript content —
 * they are live state the agent rewrites wholesale — so treating them as
 * messages would put the same list in the history several times and make "what
 * is the current plan" ambiguous.
 */

import { create } from "zustand";
import { normaliseTodos, todoProgress, type Todo } from "@/lib/opencode/types";
import type { V2Event } from "@/lib/opencode/types";
import { orderedParts, type ThreadState } from "@/lib/opencode/thread";
import { useThreads } from "@/state/threads";

interface TodoStore {
  /** Live plan per session. */
  bySession: Record<string, Todo[]>;
  /** Sessions whose list has not been read since it last changed. */
  dirty: Set<string>;
  /** Recompose a session's plan from its thread, if it changed. */
  ingest(event: V2Event): void;
  set(sessionID: string, raw: unknown, seen: boolean): void;
  hydrate(sessionID: string, raw: unknown): void;
  clear(sessionID: string): void;
  reset(): void;
}

export const useTodos = create<TodoStore>((set) => ({
  bySession: {},
  dirty: new Set(),

  ingest: (event) => {
    // Tool and step events are the only things that can move the plan.
    if (!event.type.startsWith("session.tool.") && !event.type.startsWith("session.step.")) return;
    const sessionID = (event.data as { sessionID?: string } | undefined)?.sessionID;
    if (!sessionID) return;
    const thread = useThreads.getState().threads[sessionID];
    if (!thread) return;
    const todos = todosFromThread(thread);
    const current = useTodos.getState().bySession[sessionID];
    if (sameTodos(current, todos)) return;
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

/**
 * The newest completed `todowrite` part in the thread.
 *
 * Later assistant messages win; within one message the last completed call
 * wins, because the agent rewrites the whole list rather than editing items.
 */
export function todosFromThread(thread: ThreadState | undefined): Todo[] {
  if (!thread) return [];
  for (let index = thread.order.length - 1; index >= 0; index -= 1) {
    const entry = thread.messages[thread.order[index]!];
    if (!entry?.info || entry.info.role !== "assistant") continue;
    const parts = orderedParts(entry);
    for (let partIndex = parts.length - 1; partIndex >= 0; partIndex -= 1) {
      const part = parts[partIndex]!;
      if (part.type !== "tool" || part.tool !== "todowrite") continue;
      if (part.state.status !== "completed") continue;
      const raw = part.state.input?.todos;
      if (Array.isArray(raw)) return normaliseTodos(raw);
    }
  }
  return [];
}

function sameTodos(a: Todo[] | undefined, b: Todo[]): boolean {
  if (!a || a.length !== b.length) return false;
  return a.every(
    (todo, index) =>
      todo.content === b[index]!.content && todo.status === b[index]!.status,
  );
}

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
