import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Check, ChevronRight, CircleDashed, ListChecks, Loader2, X } from "lucide-react";
import type { Todo, TodoStatus } from "@/lib/opencode/types";
import { todoProgress } from "@/lib/opencode/types";
import { AUTO_EXPAND_LIMIT } from "@/state/todos";

function iconFor(status: TodoStatus) {
  if (status === "completed") return <Check size={11} strokeWidth={3} />;
  if (status === "in_progress") return <Loader2 size={11} className="animate-spin" />;
  if (status === "cancelled") return <X size={11} />;
  return <CircleDashed size={11} className="opacity-60" />;
}

function toneFor(status: TodoStatus): string {
  if (status === "completed") return "text-good";
  if (status === "in_progress") return "text-accent";
  if (status === "cancelled") return "text-ink-ghost line-through";
  return "text-ink-faint";
}

/**
 * The agent's plan, shown above the composer.
 *
 * Folds itself away once the list is long: a ten-item plan written mid-turn
 * would push the conversation off screen, which is the opposite of useful.
 */
export function TodoPanel({ todos, className = "" }: { todos: Todo[]; className?: string }) {
  const { done, total, active } = todoProgress(todos);
  // Never auto-expands. The full list already appears in the transcript where
  // the agent wrote it; repeating it here just made the plan appear twice on
  // one screen. What belongs here is the state of it at a glance.
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    if (todos.length > AUTO_EXPAND_LIMIT) setExpanded(false);
  }, [todos.length]);

  if (!total) return null;

  const pct = total ? Math.round((done / total) * 100) : 0;
  const showList = expanded;

  return (
    <motion.div
      initial={{ opacity: 0, y: -4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2 }}
      className={`rounded-[var(--radius-card)] border border-line/70 bg-surface/60 px-2.5 py-1.5 ${className}`}
    >
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
        className="flex w-full items-center gap-2 text-left"
      >
        <ChevronRight
          size={12}
          className={`shrink-0 text-ink-ghost transition-transform ${expanded ? "rotate-90" : ""}`}
        />
        <span className="truncate text-[0.74rem] text-ink-muted">
          {active > 0 ? (
            <>
              <span className="text-accent">{currentLabel(todos)}</span>
              <span className="text-ink-ghost"> · {done}/{total} done</span>
            </>
          ) : (
            <span className="text-ink-ghost">{done} of {total} done</span>
          )}
        </span>

        <span className="ml-auto flex items-center gap-2">
          <span className="h-[3px] w-20 overflow-hidden rounded-full bg-line">
            <motion.span
              className="block h-full rounded-full bg-accent"
              initial={false}
              animate={{ width: `${pct}%` }}
              transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
            />
          </span>
        </span>
      </button>

      <AnimatePresence initial={false}>
        {showList && (
          <motion.ul
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="mt-2 space-y-1 border-t border-line/70 pt-2">
              {todos.map((todo, index) => (
                <li
                  key={todo.id ?? `${index}-${todo.content}`}
                  className="flex items-start gap-2 text-[0.76rem]"
                >
                  <span className={`mt-[3px] shrink-0 ${toneFor(todo.status as TodoStatus)}`}>
                    {iconFor(todo.status as TodoStatus)}
                  </span>
                  <span className={`min-w-0 flex-1 ${toneFor(todo.status as TodoStatus)}`}>
                    {todo.content}
                  </span>
                </li>
              ))}
            </div>
          </motion.ul>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

/**
 * A `todowrite` call inside the transcript.
 *
 * Deliberately a marker rather than a second copy of the list. The plan itself
 * is shown once, in the pinned strip above the composer, where its current
 * state is always in view; repeating the full list here made the same three
 * lines appear twice on one screen and turned a status line into the heaviest
 * element in the thread.
 */
export function TodoBlock({ todos, truncated }: { todos: Todo[]; truncated?: boolean }) {
  if (!todos.length) return null;
  const { done, total, active } = todoProgress(todos);

  const summary = active
    ? todos.find((t) => t.status === "in_progress")?.content ?? "Working"
    : done === total
      ? "All done"
      : `${done} of ${total} done`;

  return (
    <div
      className="my-1 flex items-center gap-2 py-0.5 text-[0.73rem] text-ink-faint"
      data-selectable
    >
      <ListChecks size={11} className="shrink-0 text-ink-ghost" />
      <span className="shrink-0 text-ink-ghost">Plan updated</span>
      <span className="shrink-0 text-line-strong">·</span>
      <span className="min-w-0 flex-1 truncate">{summary}</span>
      {truncated && <span className="shrink-0 text-ink-ghost/70">truncated</span>}
    </div>
  );
}

/** The item currently being worked on, for the pinned strip. */
function currentLabel(todos: Todo[]): string {
  return todos.find((t) => t.status === "in_progress")?.content ?? "In progress";
}
