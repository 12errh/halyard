import { useMemo, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { ChevronUp, Coins, Cpu } from "lucide-react";
import {
  aggregateUsage,
  formatCost,
  formatTokens,
  sessionUsage,
  usageBreakdown,
  type UsageTotals,
} from "@/lib/usage";
import type { Session } from "@/lib/opencode/types";
import { cn } from "@/lib/utils";

/**
 * Token and cost readout.
 *
 * Sits above the composer rather than in settings, because "what did that run
 * cost me" is a question you have while looking at the run, not later.
 */
export function UsageMeter({
  sessions,
  activeSession,
}: {
  sessions: Session[];
  activeSession: Session | undefined;
}) {
  const [open, setOpen] = useState(false);

  const scope = useMemo<UsageTotals>(
    () => (activeSession ? sessionUsage(activeSession) : aggregateUsage(sessions)),
    [activeSession, sessions],
  );

  if (scope.total === 0 && scope.cost === 0) return null;

  return (
    <div className="px-5 pb-1">
      <div className="mx-auto w-full max-w-[760px]">
        {/* Borderless until opened. Three stacked outlined panels above the
            composer read as a wall of chrome; the composer is the one element
            that should feel solid, because it is the one you touch. */}
        <div
          className={cn(
            "overflow-hidden transition-colors",
            open ? "rounded-[var(--radius-card)] border border-line bg-surface/60" : "",
          )}
        >
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
            className="flex w-full items-center gap-2 rounded-[6px] px-2 py-0.5 text-left transition-colors hover:bg-raised/50"
          >
            <Cpu size={11} className="shrink-0 text-ink-faint" />
            <span className="tabular font-mono text-[0.7rem] text-ink-faint">
              {formatTokens(scope.total)} tokens
            </span>
            <span className="text-ink-ghost">·</span>
            <span className="tabular font-mono text-[0.7rem] text-ink-faint">
              {formatCost(scope.cost)}
            </span>
            <span className="ml-auto shrink-0 text-[0.66rem] text-ink-ghost/70">
              {activeSession ? "this session" : "this project"}
            </span>
            <ChevronUp
              size={11}
              className={cn(
                "shrink-0 text-ink-ghost transition-transform duration-150",
                !open && "rotate-180",
              )}
            />
          </button>

          <AnimatePresence initial={false}>
            {open && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: "auto", opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
                className="overflow-hidden"
              >
                <dl className="grid grid-cols-2 gap-x-4 gap-y-1 border-t border-line px-2.5 py-2 sm:grid-cols-3">
                  {usageBreakdown(scope).map((row) => (
                    <div key={row.label} className="flex items-baseline justify-between gap-2">
                      <dt className="text-[0.7rem] text-ink-faint">{row.label}</dt>
                      <dd className="tabular font-mono text-[0.72rem] text-ink-muted">{row.value}</dd>
                    </div>
                  ))}
                  <div className="col-span-2 flex items-baseline justify-between gap-2 sm:col-span-3">
                    <dt className="text-[0.7rem] text-ink-faint">Messages</dt>
                    <dd className="tabular font-mono text-[0.72rem] text-ink-muted">{scope.messages}</dd>
                  </div>
                </dl>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
}

export { Coins };