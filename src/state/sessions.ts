/**
 * Session list and the browser-style tab strip.
 *
 * Tabs are the primary navigation inside a project — the user asked for
 * multiple sessions side by side, switchable without a detour through a list.
 * The sidebar list still exists, but tabs are the fast path.
 */

import { create } from "zustand";
import type { Session } from "@/lib/opencode/types";
import { truncate } from "@/lib/utils";

interface SessionStore {
  sessions: Session[];
  /** Open tabs, left to right. */
  tabs: string[];
  activeId: string | null;
  query: string;

  setSessions(sessions: Session[]): void;
  upsert(session: Session): void;
  remove(sessionId: string): void;

  openTab(sessionId: string): void;
  closeTab(sessionId: string): void;
  selectTab(sessionId: string): void;
  /** Cycle to the neighbouring tab, wrapping at both ends. */
  stepTab(delta: 1 | -1): void;
  closeOthers(sessionId: string): void;

  setQuery(query: string): void;
}

export const useSessions = create<SessionStore>((set) => ({
  sessions: [],
  tabs: [],
  activeId: null,
  query: "",

  setSessions: (sessions) =>
    set((state) => {
      // Never leave a tab pointing at a session that no longer exists.
      const alive = new Set(sessions.map((s) => s.id));
      const tabs = state.tabs.filter((id) => alive.has(id));
      const activeId = state.activeId && alive.has(state.activeId) ? state.activeId : tabs[0] ?? null;
      return { sessions, tabs, activeId };
    }),

  upsert: (session) =>
    set((state) => {
      const index = state.sessions.findIndex((s) => s.id === session.id);
      if (index === -1) return { sessions: [session, ...state.sessions] };
      const sessions = [...state.sessions];
      sessions[index] = session;
      return { sessions };
    }),

  remove: (sessionId) =>
    set((state) => {
      const sessions = state.sessions.filter((s) => s.id !== sessionId);
      const tabs = state.tabs.filter((id) => id !== sessionId);
      const activeId =
        state.activeId === sessionId ? (tabs[tabs.length - 1] ?? null) : state.activeId;
      return { sessions, tabs, activeId };
    }),

  openTab: (sessionId) =>
    set((state) => ({
      tabs: state.tabs.includes(sessionId) ? state.tabs : [...state.tabs, sessionId],
      activeId: sessionId,
    })),

  closeTab: (sessionId) =>
    set((state) => {
      const index = state.tabs.indexOf(sessionId);
      if (index === -1) return state;
      const tabs = state.tabs.filter((id) => id !== sessionId);
      let activeId = state.activeId;
      if (state.activeId === sessionId) {
        // Focus the neighbour that took its place, or the one before it.
        activeId = tabs[index] ?? tabs[index - 1] ?? null;
      }
      return { tabs, activeId };
    }),

  selectTab: (sessionId) => set({ activeId: sessionId }),

  stepTab: (delta) =>
    set((state) => {
      if (state.tabs.length === 0) return state;
      const index = state.tabs.indexOf(state.activeId ?? "");
      const next = (((index + delta) % state.tabs.length) + state.tabs.length) % state.tabs.length;
      return { activeId: state.tabs[next] ?? state.activeId };
    }),

  closeOthers: (sessionId) => set({ tabs: [sessionId], activeId: sessionId }),

  setQuery: (query) => set({ query }),
}));

// --- Selectors ------------------------------------------------------------

export function filterSessions(sessions: Session[], query: string): Session[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return sessions;
  return sessions.filter((s) => s.title.toLowerCase().includes(needle));
}

/** Sessions newest first; ties broken by id so ordering is stable. */
export function sortSessions(sessions: Session[]): Session[] {
  return [...sessions].sort((a, b) => {
    const delta = (b.time?.updated ?? b.time?.created ?? 0) - (a.time?.updated ?? a.time?.created ?? 0);
    return delta !== 0 ? delta : a.id.localeCompare(b.id);
  });
}

export function tabTitle(sessions: Session[], sessionId: string): string {
  const session = sessions.find((s) => s.id === sessionId);
  if (!session) return sessionId;
  // opencode seeds new sessions with a timestamp title; that reads as noise on
  // a tab, so show a placeholder until the agent has named it.
  if (!session.title || session.title.startsWith("New session -")) return "Untitled";
  return truncate(session.title, 26);
}
