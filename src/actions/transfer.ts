/**
 * Session export and import.
 *
 * opencode exposes these only as CLI verbs, so the work happens in Rust by
 * shelling out to `opencode export` / `import`. That keeps the file format
 * canonical: an export from Halyard is byte-identical to one opencode would
 * produce itself, and an import stays valid across versions.
 */

import { open, save } from "@tauri-apps/plugin-dialog";
import { api } from "@/lib/tauri";
import { useProjects } from "@/state/projects";
import { useServer } from "@/state/server";

export interface TransferResult {
  ok: boolean;
  message: string;
}

export async function exportSession(sessionId: string, title: string): Promise<TransferResult> {
  const binaryOverride = useProjects.getState().binaryOverride;

  // Ask where first; the CLI writes the file itself.
  const suggested = `${sanitise(title) || sessionId}.json`;
  const path = await save({
    title: "Export session",
    defaultPath: suggested,
    filters: [{ name: "Session export", extensions: ["json"] }],
  });
  if (!path) return { ok: false, message: "cancelled" };

  try {
    const result = await api.exportSession(sessionId, path, binaryOverride);
    return {
      ok: true,
      message: `Exported ${formatBytes(result.bytes)} to ${result.path}`,
    };
  } catch (error) {
    return { ok: false, message: (error as Error).message };
  }
}

/**
 * Import a session file.
 *
 * opencode's importer writes into its own store, so the list has to be
 * re-read afterwards or the new session stays invisible until a restart.
 */
export async function importSession(): Promise<TransferResult> {
  const binaryOverride = useProjects.getState().binaryOverride;

  const path = await open({
    title: "Import session",
    multiple: false,
    filters: [{ name: "Session export", extensions: ["json"] }],
  });
  if (typeof path !== "string") return { ok: false, message: "cancelled" };

  try {
    await api.importSession(path, binaryOverride);
    // Restart so the server re-reads its store and the session appears.
    await useServer.getState().restart();
    return { ok: true, message: `Imported ${sanitise(path.split("/").pop() ?? path)}` };
  } catch (error) {
    return { ok: false, message: (error as Error).message };
  }
}

function sanitise(value: string): string {
  return value.replace(/[^\w.-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60);
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}