import { useMemo } from "react";
import { OpencodeClient } from "@/lib/opencode/client";
import { useServer } from "@/state/server";

/**
 * The opencode client for the running server, or `null` while it is starting
 * or has failed.
 *
 * A new client per phase change, so every caller shares the one instance the
 * event stream is attached to. Split out because several components now need
 * it and each was reaching into the phase union on its own.
 */
export function useOpencodeClient(): OpencodeClient | null {
  const phase = useServer((s) => s.phase);
  return useMemo(
    () => (phase.kind === "ready" ? new OpencodeClient(phase.info.url) : null),
    [phase],
  );
}
