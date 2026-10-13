import { useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { ShieldCheck, ShieldX } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/primitives";
import { actionLabel, REPLY_LABEL, type PendingPermission } from "@/state/permissions";
import type { PermissionReply } from "@/lib/opencode/types";
import { cn } from "@/lib/utils";

/**
 * Inline permission prompt.
 *
 * This is a blocking gate: until the user answers, the agent is parked. So the
 * card must be unmistakable and must survive tab switches — it lives in the
 * permissions store rather than in the thread.
 */
export function PermissionCard({
  permission,
  onReply,
}: {
  permission: PendingPermission;
  onReply(reply: PermissionReply): void;
}) {
  const [busy, setBusy] = useState<PermissionReply | null>(null);
  const [error, setError] = useState<string | null>(null);

  const answer = async (reply: PermissionReply) => {
    setBusy(reply);
    setError(null);
    try {
      await onReply(reply);
    } catch (cause) {
      setBusy(null);
      setError((cause as Error).message || "could not send the reply");
    }
  };

  // "Always" is hidden when the server did not say what it would persist —
  // offering a button with no defined scope would be a lie.
  const canPersist = Boolean(permission.save?.length);

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 8, scale: 0.99 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, scale: 0.98 }}
      transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
      data-testid="permission-card"
      className="my-2 overflow-hidden rounded-[var(--radius-card)] border border-warn/40 bg-warn/[0.07]"
    >
      <div className="flex items-start gap-2.5 px-3 pt-2.5">
        <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-warn/40 text-warn">
          <ShieldCheck size={13} />
        </span>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[0.85rem] font-medium text-ink">
              {actionLabel(permission.action)}
            </span>
            <Badge tone="warn">needs approval</Badge>
          </div>

          {permission.resources.length > 0 && (
            <ul className="mt-1.5 flex flex-col gap-0.5">
              {permission.resources.slice(0, 6).map((resource: string) => (
                <li
                  key={resource}
                  data-selectable
                  className="truncate rounded-[4px] bg-raised px-1.5 py-0.5 font-mono text-[0.72rem] text-ink-muted"
                >
                  {resource}
                </li>
              ))}
              {permission.resources.length > 6 && (
                <li className="px-1 text-[0.7rem] text-ink-ghost">
                  +{permission.resources.length - 6} more
                </li>
              )}
            </ul>
          )}

          {canPersist && (
            <p className="mt-1.5 text-[0.7rem] text-ink-ghost">
              “Always allow” covers: {permission.save!.join(", ")}
            </p>
          )}

          {error && (
            <p className="mt-1.5 text-[0.74rem] text-danger" role="alert">
              {error}
            </p>
          )}
        </div>
      </div>

      <div className="mt-2.5 flex flex-wrap items-center gap-1.5 border-t border-warn/25 px-3 py-2">
        <Button
          size="sm"
          variant="primary"
          disabled={busy !== null}
          onClick={() => void answer("once")}
        >
          {REPLY_LABEL.once}
        </Button>

        {canPersist && (
          <Button
            size="sm"
            variant="secondary"
            disabled={busy !== null}
            onClick={() => void answer("always")}
          >
            {REPLY_LABEL.always}
          </Button>
        )}

        <Button
          size="sm"
          variant="ghost"
          disabled={busy !== null}
          onClick={() => void answer("reject")}
          className={cn("text-ink-muted")}
        >
          <ShieldX size={12} />
          {REPLY_LABEL.reject}
        </Button>

        {busy && <span className="ml-1 text-[0.72rem] text-ink-ghost">sending…</span>}
      </div>

      <AnimatePresence>
        {busy && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="h-0.5 w-full overflow-hidden bg-warn/20"
          >
            <motion.div
              className="h-full bg-warn"
              initial={{ width: "0%" }}
              animate={{ width: "100%" }}
              transition={{ duration: 6, ease: "linear", repeat: Infinity }}
            />
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
