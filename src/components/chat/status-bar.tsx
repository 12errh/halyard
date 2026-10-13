import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Loader2, Square, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { orderedParts, type MessageEntry } from "@/lib/opencode/thread";
import { isToolPart, toolTitle, type Part } from "@/lib/opencode/types";
import { cn } from "@/lib/utils";

/** The most recent tool that has not settled, i.e. what is running right now. */
export function currentActivity(entries: MessageEntry[]): { tool: string; label: string } | null {
  for (let i = entries.length - 1; i >= 0; i -= 1) {
    const parts = orderedParts(entries[i]);
    for (let p = parts.length - 1; p >= 0; p -= 1) {
      const part = parts[p] as Part;
      if (isToolPart(part) && (part.state.status === "running" || part.state.status === "pending")) {
        return { tool: part.tool, label: toolTitle(part.tool, part.state) };
      }
    }
  }
  return null;
}

function formatElapsed(ms: number): string {
  const total = Math.floor(ms / 1000);
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return minutes > 0 ? `${minutes}m ${String(seconds).padStart(2, "0")}s` : `${seconds}s`;
}

/**
 * Sticky activity bar.
 *
 * This is the answer to "what is it doing right now?" — it names the current
 * tool, counts elapsed time, and offers the only control that matters mid-run.
 */
export function StatusBar({
  entries,
  busy,
  agent,
  model,
  onAbort,
}: {
  entries: MessageEntry[];
  busy: boolean;
  agent?: string;
  model?: string;
  onAbort(): void;
}) {
  const activity = currentActivity(entries);
  const elapsed = useElapsed(busy);
  const started = useRef(false);

  useEffect(() => {
    started.current = busy;
  }, [busy]);

  return (
    <AnimatePresence>
      {busy && (
        <motion.div
          initial={{ height: 0, opacity: 0 }}
          animate={{ height: "auto", opacity: 1 }}
          exit={{ height: 0, opacity: 0 }}
          transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
          className="overflow-hidden"
        >
          <div className="mx-5 mb-2 w-full max-w-[760px]">
            <div
              role="status"
              aria-live="polite"
              className={cn(
                "flex items-center gap-2.5 rounded-[var(--radius-card)] border border-live/30 bg-live/[0.08] px-2.5 py-1.5",
              )}
            >
              <Loader2 size={13} className="shrink-0 animate-spin text-live" />

              <span className="shrink-0 text-[0.78rem] font-medium text-ink">
                {activity ? activity.tool : "Thinking"}
              </span>

              <span data-selectable className="min-w-0 flex-1 truncate font-mono text-[0.72rem] text-ink-faint">
                {activity ? activity.label : (agent ?? "working")}
              </span>

              {model && <span className="hidden shrink-0 font-mono text-[0.68rem] text-ink-ghost sm:inline">{model}</span>}

              <span className="tabular shrink-0 font-mono text-[0.72rem] text-ink-faint">
                {formatElapsed(elapsed)}
              </span>

              <Button variant="danger" size="icon-sm" onClick={onAbort} aria-label="Stop">
                <Square size={10} />
              </Button>
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/** Ticks once a second while `running`, resets whenever it flips false. */
export function useElapsed(running: boolean): number {
  const [ms, setMs] = useState(0);
  const since = useRef<number | null>(null);

  useEffect(() => {
    if (!running) {
      since.current = null;
      setMs(0);
      return;
    }
    since.current = Date.now();
    const timer = setInterval(() => {
      if (since.current !== null) setMs(Date.now() - since.current);
    }, 1000);
    return () => clearInterval(timer);
  }, [running]);

  return ms;
}

export { Zap };
