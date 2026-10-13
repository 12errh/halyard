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
import { useServer } from "@/state/server";
import { useSessions } from "@/state/sessions";
import { useThreads } from "@/state/threads";

function client(): OpencodeClient | null {
  const phase = useServer.getState().phase;
  return phase.kind === "ready" ? new OpencodeClient(phase.info.url) : null;
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
    const updated = await api.renameSession(sessionId, trimmed);
    useSessions.getState().upsert(updated);
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
    const session = await api.createSession();
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
    const forked = await api.forkSession(sessionId);
    useSessions.getState().upsert(forked);
    useSessions.getState().openTab(forked.id);
    return forked.id;
  } catch (error) {
    console.error("fork failed", error);
    return null;
  }
}
