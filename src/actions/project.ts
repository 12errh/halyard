/**
 * Project switching.
 *
 * A project owns everything the server reports: sessions, threads, pending
 * permissions. Switching has to tear all of that down first, otherwise the new
 * project briefly renders the old project's conversations and — worse — a
 * stale SSE stream can deliver events into the wrong thread.
 */

import { useProjects } from "@/state/projects";
import { useServer } from "@/state/server";
import { useSessions } from "@/state/sessions";
import { useThreads } from "@/state/threads";
import { usePermissions } from "@/state/permissions";
import { useModels } from "@/state/models";

/** Clears every store whose contents are scoped to a single project. */
export function resetProjectScope() {
  useSessions.setState({
    sessions: [],
    tabs: [],
    activeId: null,
    query: "",
    // The scope is the old project's directory; keeping it would make the next
    // project's sessions filter against a path they do not live under.
    directory: null,
  });
  useThreads.setState({ threads: {}, busySessionId: null, connection: "idle", handle: null });
  usePermissions.getState().reset();
  // Model ids belong to the server that issued them; the next one may differ.
  useModels.getState().reset();
}

export async function switchProject(path: string): Promise<void> {
  const current = useProjects.getState().active;
  if (current === path) return;

  // Stop first: a server still bound to the old directory will keep pushing
  // events, and we do not want those landing in the new project's threads.
  await useServer.getState().stop();
  resetProjectScope();

  const binaryOverride = useProjects.getState().binaryOverride;
  await useProjects.getState().openProject(path);
  await useServer.getState().start(path, binaryOverride);
}
