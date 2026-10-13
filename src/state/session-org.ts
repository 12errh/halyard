/**
 * How sessions are organised: pins, archives, and which ones are unread.
 *
 * None of this is server state. `session.pin.toggle` and `session.archive`
 * exist only in opencode's terminal UI, which keeps them in its own store —
 * there is no route for either. So Halyard keeps its own, per project.
 *
 * Archived sessions are hidden, never deleted: opencode holds the real
 * transcript, and the difference between "put this away" and "throw this away"
 * is exactly what a person needs to be able to change their mind about.
 */

import { create } from "zustand";

interface SessionOrgStore {
  /** Pinned session ids, per project directory. */
  pinned: Record<string, string[]>;
  /** Archived session ids, per project directory. */
  archived: Record<string, string[]>;
  /** Sessions with unseen output, per project directory. */
  unseen: Record<string, string[]>;

  isPinned(project: string, sessionID: string): boolean;
  isArchived(project: string, sessionID: string): boolean;
  isUnseen(project: string, sessionID: string): boolean;

  togglePin(project: string, sessionID: string): void;
  toggleArchive(project: string, sessionID: string): void;
  markUnseen(project: string, sessionID: string): void;
  markSeen(project: string, sessionID: string): void;

  /** Sessions for a project, split and ordered for the sidebar. */
  arrange<T extends { id: string }>(project: string, sessions: T[]): {
    pinned: T[];
    recent: T[];
    archived: T[];
  };
}

const KEY = "halyard.session-org";

interface Persisted {
  pinned: Record<string, string[]>;
  archived: Record<string, string[]>;
}

function read(): Persisted {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { pinned: {}, archived: {} };
    const parsed = JSON.parse(raw) as Partial<Persisted>;
    return {
      pinned: parsed.pinned ?? {},
      archived: parsed.archived ?? {},
    };
  } catch {
    return { pinned: {}, archived: {} };
  }
}

function persist(state: Persisted) {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    // Private browsing or a full quota: the arrangement lasts this session only.
  }
}

/** Add or remove one id, returning a new list. */
function toggle(list: string[], id: string): string[] {
  return list.includes(id) ? list.filter((x) => x !== id) : [id, ...list];
}

export const useSessionOrg = create<SessionOrgStore>((set, get) => {
  const initial = read();

  const persistNow = () => {
    const { pinned, archived } = get();
    persist({ pinned, archived });
  };

  return {
    pinned: initial.pinned,
    archived: initial.archived,
    unseen: {},

    isPinned: (project, sessionID) => (get().pinned[project] ?? []).includes(sessionID),
    isArchived: (project, sessionID) => (get().archived[project] ?? []).includes(sessionID),
    isUnseen: (project, sessionID) => (get().unseen[project] ?? []).includes(sessionID),

    togglePin: (project, sessionID) => {
      set((s) => ({ pinned: { ...s.pinned, [project]: toggle(s.pinned[project] ?? [], sessionID) } }));
      persistNow();
    },

    toggleArchive: (project, sessionID) => {
      set((s) => ({ archived: { ...s.archived, [project]: toggle(s.archived[project] ?? [], sessionID) } }));
      persistNow();
    },

    markUnseen: (project, sessionID) =>
      set((s) => {
        const list = s.unseen[project] ?? [];
        if (list.includes(sessionID)) return s;
        return { unseen: { ...s.unseen, [project]: [sessionID, ...list] } };
      }),

    markSeen: (project, sessionID) =>
      set((s) => {
        const list = s.unseen[project];
        if (!list?.includes(sessionID)) return s;
        return { unseen: { ...s.unseen, [project]: list.filter((x) => x !== sessionID) } };
      }),

    arrange: <T extends { id: string }>(project: string, sessions: T[]) => {
      const pinOrder = get().pinned[project] ?? [];
      const archiveSet = new Set(get().archived[project] ?? []);

      const pinned: T[] = [];
      const recent: T[] = [];
      const archived: T[] = [];

      for (const session of sessions) {
        if (archiveSet.has(session.id)) archived.push(session);
        else if (pinOrder.includes(session.id)) pinned.push(session);
        else recent.push(session);
      }

      // Pins follow the order the user put them in; everything else is by
      // recency, which is how the server already returns it.
      pinned.sort((a, b) => pinOrder.indexOf(a.id) - pinOrder.indexOf(b.id));

      return { pinned, recent, archived };
    },
  };
});
