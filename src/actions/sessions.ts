/**
 * Session mutations.
 *
 * opencode owns session durability in its own database, so every action here
 * calls the server *first* and only then updates local state. Doing it the
 * other way round is what made a deleted session reappear the moment the user
 * switched projects and the list was re-fetched.
 */

import { confirm } from "@tauri-apps/plugin-dialog";
import { OpencodeClient } from "@/lib/opencode/client";
import { toSessionView } from "@/lib/opencode/types";
import { useServer } from "@/state/server";
import { useSessions } from "@/state/sessions";
import { useThreads } from "@/state/threads";

function client(): OpencodeClient | null {
  const phase = useServer.getState().phase;
  if (phase.kind !== "ready") return null;
  return new OpencodeClient(phase.info.url, phase.info.password);
}

/** Delete is irreversible, so it always confirms first. */
export async function deleteSession(sessionId: string): Promise<boolean> {
  const session = useSessions.getState().sessions.find((s) => s.id === sessionId);
  const api = client();
  if (!api) return false;

  const confirmed = await confirm(
    `Delete "${session?.title ?? sessionId}"?`,
    {
      title: "Delete session",
      kind: "warning",
      okLabel: "Delete",
      cancelLabel: "Cancel",
    },
  );
  if (!confirmed) return false;

  try {
    await api.deleteSession(sessionId);
  } catch (error) {
    console.error("delete failed", error);
    return false;
  }

  useSessions.getState().remove(sessionId);
  useThreads.getState().clear(sessionId);
  return true;
}

export async function renameSession(sessionId: string, title: string): Promise<boolean> {
  const api = client();
  const trimmed = title.trim();
  if (!api || !trimmed) return false;

  try {
    await api.updateSession(sessionId, { title: trimmed });
    const existing = useSessions.getState().sessions.find((s) => s.id === sessionId);
    if (existing) useSessions.getState().upsert({ ...existing, title: trimmed });
    return true;
  } catch (error) {
    console.error("rename failed", error);
    return false;
  }
}

export async function createSession(): Promise<string | null> {
  const api = client();
  if (!api) return null;
  try {
    const created = await api.createSession();
    const session = toSessionView(created);
    useSessions.getState().upsert(session);
    useSessions.getState().openTab(session.id);
    return session.id;
  } catch (error) {
    console.error("create failed", error);
    return null;
  }
}

export async function forkSession(sessionId: string): Promise<string | null> {
  const api = client();
  if (!api) return null;
  try {
    const forked = toSessionView(await api.forkSession(sessionId));
    useSessions.getState().upsert(forked);
    useSessions.getState().openTab(forked.id);
    return forked.id;
  } catch (error) {
    console.error("fork failed", error);
    return null;
  }
}

/**
 * Subagent runs delegated by a session.
 *
 * Returned by the server as child sessions; they are rendered nested under
 * their parent rather than as conversations in their own right.
 */
export async function loadChildSessions(parentId: string): Promise<void> {
  const api = client();
  if (!api) return;
  try {
    const page = await api.listSessions({ parentID: parentId });
    useSessions.getState().loadChildren(parentId, page.data.map(toSessionView));
  } catch (error) {
    console.error("children failed", error);
  }
}
