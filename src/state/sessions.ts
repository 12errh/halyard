/**
 * Session list and the browser-style tab strip.
 *
 * Tabs are the primary navigation inside a project — the user asked for
 * multiple sessions side by side, switchable without a detour through a list.
 * The sidebar list still exists, but tabs are the fast path.
 */

import { create } from "zustand";
import type { ServerEvent, Session, SessionStatus } from "@/lib/opencode/types";
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

  /**
   * Child sessions (subagent runs) keyed by parent id.
   *
   * Held apart from `sessions` on purpose: a subagent run belongs to the
   * conversation that spawned it, not to the top-level session list. Left
   * flat, every delegated task would appear to be a conversation of its own.
   */
  children: Record<string, Session[]>;
  expandedParents: Record<string, boolean>;

  loadChildren(parentId: string, children: Session[]): void;
  toggleParent(parentId: string): void;

  /**
   * Apply a server event to the list.
   *
   * Without this the title never appears: opencode names a session after the
   * first turn and announces it via `session.updated`, so a list that is only
   * loaded once stays stuck on the seeded "New session - <timestamp>".
   */
  ingest(event: ServerEvent): void;
  /**
   * Busy state for every session, not just the open one.
   *
   * The chat only renders the active thread, but a background session
   * finishing is exactly when a notification is worth sending — so the status
   * has to be tracked app-wide.
   */
  status: Record<string, SessionStatus>;
}

export const useSessions = create<SessionStore>((set) => ({
  sessions: [],
  tabs: [],
  activeId: null,
  status: {},
  query: "",
  children: {},
  expandedParents: {},

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

  loadChildren: (parentId, children) =>
    set((state) => ({ children: { ...state.children, [parentId]: children } })),

  toggleParent: (parentId) =>
    set((state) => ({
      expandedParents: {
        ...state.expandedParents,
        [parentId]: !state.expandedParents[parentId],
      },
    })),

  ingest: (event) =>
    set((state) => {
      if (event.type === "session.updated" || event.type === "session.created") {
        const info = (event.properties as { info?: Session }).info;
        if (!info?.id) return state;
        const index = state.sessions.findIndex((s) => s.id === info.id);
        if (index === -1) return { ...state, sessions: [info, ...state.sessions] };
        const sessions = [...state.sessions];
        sessions[index] = info;
        return { ...state, sessions };
      }

      if (event.type === "session.status") {
        const props = event.properties as { sessionID?: string; status?: SessionStatus };
        if (!props.sessionID || !props.status) return state;
        return { ...state, status: { ...state.status, [props.sessionID]: props.status } };
      }

      if (event.type === "session.deleted") {
        const id = (event.properties as { sessionID?: string }).sessionID;
        if (!id) return state;
        const status = { ...state.status };
        delete status[id];
        const sessions = state.sessions.filter((s) => s.id !== id);
        const tabs = state.tabs.filter((t) => t !== id);
        const children = Object.fromEntries(
          Object.entries(state.children)
            .map(([parent, kids]) => [parent, kids.filter((k) => k.id !== id)] as const)
            .filter(([, kids]) => kids.length > 0),
        );
        if (sessions.length === state.sessions.length) return state;
        return {
          ...state,
          sessions,
          status,
          tabs,
          children,
          activeId: state.activeId === id ? (tabs[tabs.length - 1] ?? null) : state.activeId,
        };
      }

      return state;
    }),
}));

// --- Selectors ------------------------------------------------------------

/**
 * Top-level conversations only.
 *
 * Sessions carrying a `parentID` are subagent runs delegated by another
 * session; they belong nested under their parent, not in the list.
 */
export function rootSessions(sessions: Session[]): Session[] {
  return sessions.filter((session) => !session.parentID);
}

export function filterSessions(sessions: Session[], query: string): Session[] {
  const roots = rootSessions(sessions);
  const needle = query.trim().toLowerCase();
  if (!needle) return roots;
  return roots.filter((s) => s.title.toLowerCase().includes(needle));
}

/** Sessions newest first; ties broken by id so ordering is stable. */
export function sortSessions(sessions: Session[]): Session[] {
  return [...sessions].sort((a, b) => {
    const delta = (b.time?.updated ?? b.time?.created ?? 0) - (a.time?.updated ?? a.time?.created ?? 0);
    return delta !== 0 ? delta : a.id.localeCompare(b.id);
  });
}

/**
 * Label a delegated run so it is obvious it is not a conversation.
 *
 * opencode titles child sessions with a `(@agent subagent)` suffix, which is
 * stripped here because the agent is already shown as the leading label —
 * keeping both just reads as a stutter.
 */
export function childLabel(session: Session): string {
  const agent = session.agent?.trim();
  const raw = session.title ?? "";
  const title = raw.replace(/\s*\(@[\w.-]+\s+subagent\)\s*$/i, "").trim();

  const body =
    title && !/^new session -/i.test(title)
      ? title
      : session.summary?.files
        ? `${session.summary.files} file${session.summary.files === 1 ? "" : "s"} touched`
        : "Subagent run";

  return agent ? `${agent} · ${body}` : body;
}

export function tabTitle(sessions: Session[], sessionId: string): string {
  const session = sessions.find((s) => s.id === sessionId);
  if (!session) return sessionId;
  // opencode seeds new sessions with a timestamp title; that reads as noise on
  // a tab, so show a placeholder until the agent has named it.
  if (!session.title || session.title.startsWith("New session -")) return "Untitled";
  return truncate(session.title, 26);
}
