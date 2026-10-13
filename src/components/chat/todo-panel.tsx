import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Check, ChevronRight, CircleDashed, Loader2, X } from "lucide-react";
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
  const [expanded, setExpanded] = useState(false);

  // Re-fold whenever the list grows past the limit, so a long plan never
  // appears without being asked for.
  useEffect(() => {
    setExpanded(todos.length <= AUTO_EXPAND_LIMIT);
  }, [todos.length]);

  if (!total) return null;

  const pct = total ? Math.round((done / total) * 100) : 0;
  // A short plan is shown outright — there is nothing to protect the user
  // from. The toggle exists for long ones, which start folded.
  const showList = expanded;

  return (
    <motion.div
      initial={{ opacity: 0, y: -4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2 }}
      className={`rounded-[var(--radius-card)] border border-line bg-raised/50 px-3 py-2 ${className}`}
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
        <span className="text-[0.76rem] font-medium text-ink-muted">
          {done} of {total} done
        </span>
        {active > 0 && (
          <span className="text-[0.7rem] text-accent">
            {active} in progress
          </span>
        )}

        <span className="ml-auto flex items-center gap-2">
          <span className="h-[3px] w-16 overflow-hidden rounded-full bg-line">
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

/** Inline rendering of a `todowrite` call inside the transcript. */
export function TodoBlock({ todos, truncated }: { todos: Todo[]; truncated?: boolean }) {
  if (!todos.length) return null;
  const { done } = todoProgress(todos);

  return (
    <div className="my-1.5 rounded-[var(--radius-card)] border border-line bg-raised/40 px-2.5 py-2">
      <div className="mb-1.5 flex items-center gap-2">
        <span className="text-[0.72rem] font-medium text-ink-muted">Plan</span>
        <span className="text-[0.68rem] text-ink-ghost">
          {done}/{todos.length}
        </span>
        {truncated && <span className="text-[0.68rem] text-ink-ghost">· truncated</span>}
      </div>
      <ul className="space-y-0.5">
        {todos.map((todo, index) => (
          <li key={todo.id ?? `${index}-${todo.content}`} className="flex items-start gap-2 text-[0.76rem]">
            <span className={`mt-[3px] shrink-0 ${toneFor(todo.status as TodoStatus)}`}>
              {iconFor(todo.status as TodoStatus)}
            </span>
            <span className={`min-w-0 flex-1 ${toneFor(todo.status as TodoStatus)}`}>{todo.content}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
