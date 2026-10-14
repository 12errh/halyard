import { useMemo, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { ChevronUp, Cpu } from "lucide-react";
import {
  aggregateUsage,
  billedTokens,
  contextUsage,
  formatCost,
  formatTokens,
  sessionUsage,
  usageBreakdown,
} from "@/lib/usage";
import type { Session } from "@/lib/opencode/types";
import { cn } from "@/lib/utils";

/**
 * Token and cost readout.
 *
 * Sits above the composer rather than in settings, because "what did that run
 * cost me" is a question you have while looking at the run, not later.
 *
 * With a thread open the headline is its context — the size of the prompt the
 * last answer came from — because that is the budget you can still spend. It
 * is emphatically not the thread's lifetime token total: opencode counts every
 * cache read in full, so that figure grows into the hundreds of millions over
 * a long session while the model never sees more than one window's worth.
 */
export function UsageMeter({
  sessions,
  activeSession,
  messages,
}: {
  sessions: Session[];
  activeSession: Session | undefined;
  /** The active thread's messages, in order, for the context figure. */
  messages: import("@/lib/opencode/types").MessageInfo[] | undefined;
}) {
  const [open, setOpen] = useState(false);

  const context = useMemo(() => contextUsage(messages), [messages]);
  const session = useMemo(() => (activeSession ? sessionUsage(activeSession) : null), [activeSession]);
  const project = useMemo(() => aggregateUsage(sessions), [sessions]);

  const headline = context
    ? { tokens: context.total, label: "context", cost: session?.cost ?? 0, scope: "this thread" }
    : { tokens: billedTokens(project), label: "tokens", cost: project.cost, scope: "this project" };

  if (headline.tokens === 0 && headline.cost === 0) return null;
  const breakdown = context ?? project;

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
              {formatTokens(headline.tokens)} {headline.label}
            </span>
            <span className="text-ink-ghost">·</span>
            <span className="tabular font-mono text-[0.7rem] text-ink-faint">
              {formatCost(headline.cost)}
            </span>
            <span className="ml-auto shrink-0 text-[0.66rem] text-ink-ghost/70">{headline.scope}</span>
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
                  {usageBreakdown(breakdown).map((row) => (
                    <div key={row.label} className="flex items-baseline justify-between gap-2">
                      <dt className="text-[0.7rem] text-ink-faint">{row.label}</dt>
                      <dd className="tabular font-mono text-[0.72rem] text-ink-muted">{row.value}</dd>
                    </div>
                  ))}
                  <div className="col-span-2 flex items-baseline justify-between gap-2 sm:col-span-3">
                    <dt className="text-[0.7rem] text-ink-faint">
                      {context ? "Messages in this context" : "Messages"}
                    </dt>
                    <dd className="tabular font-mono text-[0.72rem] text-ink-muted">{breakdown.messages}</dd>
                  </div>
                  {context && session && (
                    <div className="col-span-2 flex items-baseline justify-between gap-2 sm:col-span-3">
                      <dt className="text-[0.7rem] text-ink-faint">Spent on this thread</dt>
                      <dd className="tabular font-mono text-[0.72rem] text-ink-muted">
                        {formatCost(session.cost)}
                      </dd>
                    </div>
                  )}
                </dl>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
}
