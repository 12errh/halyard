/**
 * Pending permission requests.
 *
 * Permissions are session-scoped rather than thread-scoped, and they outlive a
 * tab switch — a prompt asked while you were looking at another session must
 * still be there when you come back. Hence a store of its own, fed both by the
 * event stream and by an authoritative fetch when a session is opened.
 */

import { create } from "zustand";
import type {
  PermissionAskedV1,
  PermissionAskedV2,
  PermissionReply,
  PendingPermission,
  ServerEvent,
} from "@/lib/opencode/types";

export type { PendingPermission } from "@/lib/opencode/types";

export interface PermissionsState {
  /** Keyed by session, then by permission id. */
  bySession: Record<string, Record<string, PendingPermission>>;
}

export function emptyPermissions(): PermissionsState {
  return { bySession: {} };
}

function bucket(state: PermissionsState, sessionID: string): Record<string, PendingPermission> {
  return state.bySession[sessionID] ?? {};
}

function put(state: PermissionsState, permission: PendingPermission): PermissionsState {
  const current = bucket(state, permission.sessionID);
  // The server re-broadcasts pending requests on reconnect. Replacing the
  // existing entry would reset `askedAt` and make the card jump to the end of
  // the thread, so an already-known request is left exactly as it is.
  if (current[permission.id]) return state;

  return {
    bySession: {
      ...state.bySession,
      [permission.sessionID]: { ...current, [permission.id]: permission },
    },
  };
}

function drop(state: PermissionsState, sessionID: string, id: string): PermissionsState {
  const current = bucket(state, sessionID);
  if (!(id in current)) return state;
  const next = { ...current };
  delete next[id];
  return { bySession: { ...state.bySession, [sessionID]: next } };
}

export function fromV1(event: PermissionAskedV1, askedAt: number): PendingPermission {
  return {
    id: event.id,
    sessionID: event.sessionID,
    action: event.permission,
    resources: event.patterns ?? [],
    save: event.always,
    tool: event.tool,
    version: 1,
    askedAt,
  };
}

export function fromV2(event: PermissionAskedV2, askedAt: number): PendingPermission {
  return {
    id: event.id,
    sessionID: event.sessionID,
    action: event.action,
    resources: event.resources ?? [],
    save: event.save,
    tool: event.source
      ? { messageID: event.source.messageID, callID: event.source.callID }
      : undefined,
    version: 2,
    askedAt,
  };
}

/**
 * Apply one event to the permission state.
 *
 * Pure and idempotent for `asked`: the server re-broadcasts the request on
 * reconnect, and re-asking must not reset the card's position or duplicate it.
 */
export function applyPermissionEvent(
  state: PermissionsState,
  event: ServerEvent,
  now: number,
): PermissionsState {
  const props = event.properties as Record<string, unknown>;

  switch (event.type) {
    case "permission.asked":
      return put(state, fromV1(props as unknown as PermissionAskedV1, now));

    case "permission.v2.asked":
      return put(state, fromV2(props as unknown as PermissionAskedV2, now));

    case "permission.replied":
    case "permission.v2.replied": {
      const sessionID = String(props.sessionID ?? "");
      const requestID = String(props.requestID ?? "");
      return drop(state, sessionID, requestID);
    }

    default:
      return state;
  }
}

/** Merge an authoritative fetch, keeping cards we already have. */
export function mergeFetch(
  state: PermissionsState,
  sessionID: string,
  incoming: PendingPermission[],
): PermissionsState {
  if (incoming.length === 0) return state;
  const existing = bucket(state, sessionID);
  const merged = { ...existing };
  for (const permission of incoming) {
    if (!merged[permission.id]) merged[permission.id] = permission;
  }
  return { bySession: { ...state.bySession, [sessionID]: merged } };
}

export function pendingFor(
  state: PermissionsState,
  sessionID: string | null,
): PendingPermission[] {
  if (!sessionID) return [];
  return Object.values(bucket(state, sessionID)).sort((a, b) => a.askedAt - b.askedAt);
}

export function pendingCount(state: PermissionsState): number {
  return Object.values(state.bySession).reduce(
    (total, entries) => total + Object.keys(entries).length,
    0,
  );
}

export function clearSessionState(
  state: PermissionsState,
  sessionID: string,
): PermissionsState {
  if (!(sessionID in state.bySession)) return state;
  const bySession = { ...state.bySession };
  delete bySession[sessionID];
  return { bySession };
}

/** Human label for a permission action, e.g. `bash` -> `Run command`. */
export function actionLabel(action: string): string {
  const map: Record<string, string> = {
    bash: "Run command",
    edit: "Edit file",
    write: "Write file",
    read: "Read file",
    webfetch: "Fetch URL",
    websearch: "Search the web",
  };
  return map[action.toLowerCase()] ?? action;
}

export const REPLY_LABEL: Record<PermissionReply, string> = {
  once: "Allow once",
  always: "Always allow",
  reject: "Deny",
};

interface PermissionStore extends PermissionsState {
  ingest(event: ServerEvent): void;
  sync(sessionID: string, incoming: PendingPermission[]): void;
  /** Optimistically clear once a reply is sent. */
  resolve(sessionID: string, id: string): void;
  clearSession(sessionID: string): void;
  reset(): void;
}

export const usePermissions = create<PermissionStore>((set, get) => ({
  bySession: {},

  ingest: (event) => {
    const next = applyPermissionEvent(
      { bySession: get().bySession },
      event,
      Date.now(),
    );
    if (next.bySession !== get().bySession) set(next);
  },

  sync: (sessionID, incoming) => {
    const next = mergeFetch({ bySession: get().bySession }, sessionID, incoming);
    if (next.bySession !== get().bySession) set(next);
  },

  resolve: (sessionID, id) => {
    const next = drop({ bySession: get().bySession }, sessionID, id);
    if (next.bySession !== get().bySession) set(next);
  },

  clearSession: (sessionID) => {
    const next = clearSessionState({ bySession: get().bySession }, sessionID);
    if (next.bySession !== get().bySession) set(next);
  },

  reset: () => set({ bySession: {} }),
}));
