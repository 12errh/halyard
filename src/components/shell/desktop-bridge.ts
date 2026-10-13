/**
 * Watches session activity and does the two things worth doing when the window
 * is not in front: badge the taskbar, and say the agent finished.
 *
 * Written as a pure decision function plus a thin effect so the interesting
 * part — *should* this fire? — is testable without a Tauri runtime.
 */

import { useEffect, useRef } from "react";
import { notify, setAttention, windowIsFocused } from "@/lib/desktop";
import { onOpenRequest, onMenuAction, type OpenRequest } from "@/lib/tauri";
import type { SessionStatus } from "@/lib/opencode/types";

/** Busy state for every session, keyed by session id. */
export type StatusMap = Record<string, SessionStatus>;

/** Whether a session is doing work right now. */
export function isWorking(status: SessionStatus | undefined): boolean {
  return status?.type === "busy" || status?.type === "retry";
}

/**
 * Did this session just finish work?
 *
 * Two conditions, and the first matters more than it looks: opencode reports
 * `idle` at start-up as well as after a turn. Firing on every transition out of
 * `busy` without remembering the prior state would announce "done" for an agent
 * that never started, so the previous value has to be carried forward.
 */
export function justFinished(
  previous: SessionStatus | undefined,
  next: SessionStatus | undefined,
): boolean {
  return isWorking(previous) && !isWorking(next);
}

/**
 * Report each session as it falls out of work.
 *
 * `onFinished` is given only the id: the caller reads the title from its own
 * store, which is the only place it is kept.
 */
export function useSessionActivity(
  status: StatusMap,
  onFinished: (sessionID: string) => void,
): void {
  const previous = useRef<StatusMap>({});

  useEffect(() => {
    for (const [sessionID, next] of Object.entries(status)) {
      if (justFinished(previous.current[sessionID], next)) onFinished(sessionID);
    }
    previous.current = status;
  }, [status, onFinished]);
}

/**
 * Fire the notification and the badge for a finished session.
 *
 * Exported so the policy can be exercised directly without React.
 */
export async function announceFinish(options: {
  enabled: boolean;
  title: string;
  body: string;
  unread: number;
}): Promise<{ notified: boolean; badged: boolean }> {
  // The badge is worth setting either way: it is how a hidden window says
  // "there is something waiting" without being able to interrupt. Guarded
  // separately so a platform without a taskbar cannot cost us the notification.
  try {
    await setAttention(options.unread);
  } catch {
    /* decoration only */
  }
  if (!options.enabled) return { notified: false, badged: true };

  // If focus cannot be determined, assume the user is watching. A missed
  // notification is a smaller failure than one that interrupts.
  let focused = true;
  try {
    focused = await windowIsFocused();
  } catch {
    /* treat as focused */
  }
  if (focused) return { notified: false, badged: true };

  const notified = await notify("Halyard", `${options.title} — ${options.body}`);
  return { notified, badged: true };
}

/** Wire the tray and menu-bar events to app actions. */
export function useNativeShellActions(handlers: {
  onNewThread(): void;
  onOpenSettings(): void;
}): void {
  const { onNewThread, onOpenSettings } = handlers;

  useEffect(() => {
    const cleanups: Array<() => void> = [];

    void onOpenRequest((request: OpenRequest) => {
      if (request.action === "newThread") onNewThread();
      else if (request.action === "settings") onOpenSettings();
    }).then((un) => cleanups.push(un));

    void onMenuAction((id) => {
      if (id === "new-thread") onNewThread();
      else if (id === "open-settings") onOpenSettings();
    }).then((un) => cleanups.push(un));

    return () => cleanups.forEach((fn) => fn());
  }, [onNewThread, onOpenSettings]);
}
