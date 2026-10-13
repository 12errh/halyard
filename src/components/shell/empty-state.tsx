import { FolderOpen, TriangleAlert } from "lucide-react";
import { motion } from "motion/react";
import type { ReactNode } from "react";
import { Companion } from "@/components/chat/companion";

/**
 * Empty state.
 *
 * The WebGL treatment is lazy-mounted and intentionally absent when the user
 * has asked for reduced motion or the OS has — it is decoration, not content.
 */
export function EmptyState({
  title,
  body,
  action,
  tone = "neutral",
  companion = false,
  mood = "idle",
}: {
  title: string;
  body?: ReactNode;
  action?: ReactNode;
  tone?: "neutral" | "danger";
  /** Show the companion sprite in place of the generic icon. */
  companion?: boolean;
  mood?: "idle" | "working";
}) {
  const danger = tone === "danger";

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
      className="flex max-w-md flex-col items-center gap-3 text-center"
    >
      {companion && !danger ? (
        <Companion size={124} mood={mood} className="-mb-1" />
      ) : (
        <span
          className={
            danger
              ? "flex h-11 w-11 items-center justify-center rounded-full border border-danger/30 bg-danger/10 text-danger"
              : "flex h-11 w-11 items-center justify-center rounded-full border border-line bg-raised text-ink-faint"
          }
        >
          {danger ? <TriangleAlert size={18} /> : <FolderOpen size={18} />}
        </span>
      )}

      <h2 className="text-[1rem] font-medium tracking-tight text-ink">{title}</h2>

      {body && (
        <p className="text-[0.84rem] leading-relaxed text-ink-faint">
          {body}
        </p>
      )}

      {action && <div className="pt-1">{action}</div>}
    </motion.div>
  );
}
