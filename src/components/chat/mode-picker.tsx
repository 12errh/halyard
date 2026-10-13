import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Check, Pencil, ShieldCheck } from "lucide-react";
import { cn } from "@/lib/utils";

export interface ModeOption {
  name: string;
  label: string;
  description?: string;
  /** Plan mode refuses every edit tool; worth showing plainly. */
  readOnly?: boolean;
}

/**
 * Plan / Build switch.
 *
 * These are opencode "primary" agents rather than a separate mode flag, so the
 * choice is carried per prompt. The store filters out internal agents
 * (compaction, summary, title) which are not user-selectable.
 */
export function ModePicker({
  modes,
  value,
  onChange,
}: {
  modes: ModeOption[];
  value: string;
  onChange(next: string): void;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const active = modes.find((m) => m.name === value) ?? modes[0];

  useEffect(() => {
    if (!open) return;
    const onDown = (event: MouseEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  if (modes.length === 0) return null;

  return (
    <div ref={root} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="listbox"
        title={active?.description}
        className={cn(
          "flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-1 text-[0.74rem] transition-colors",
          open
            ? "border-accent/50 bg-raised text-ink"
            : "border-line bg-surface text-ink-muted hover:border-line-strong hover:text-ink",
        )}
      >
        {active?.readOnly ? (
          <ShieldCheck size={11} className="shrink-0 text-live" />
        ) : (
          <Pencil size={11} className="shrink-0 text-accent" />
        )}
        <span>{active?.label ?? value}</span>
      </button>

      <AnimatePresence>
        {open && (
          <motion.ul
            role="listbox"
            initial={{ opacity: 0, y: 6, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 4, scale: 0.99 }}
            transition={{ duration: 0.15, ease: [0.22, 1, 0.36, 1] }}
            className="absolute bottom-[calc(100%+8px)] left-0 z-40 w-[280px] overflow-hidden rounded-[var(--radius-card)] border border-line-strong bg-overlay py-1 shadow-[var(--shadow-panel)]"
          >
            {modes.map((mode) => (
              <li key={mode.name}>
                <button
                  type="button"
                  role="option"
                  aria-selected={mode.name === value}
                  onClick={() => {
                    onChange(mode.name);
                    setOpen(false);
                  }}
                  className="flex w-full items-start gap-2 px-2.5 py-1.5 text-left transition-colors hover:bg-raised"
                >
                  <span className="mt-0.5 w-3 shrink-0">
                    {mode.name === value && <Check size={12} className="text-accent" />}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-1.5">
                      <span className="text-[0.8rem] text-ink">{mode.label}</span>
                      {mode.readOnly && (
                        <span className="shrink-0 rounded-full border border-live/30 bg-live/10 px-1.5 py-px text-[0.6rem] text-live">
                          read-only
                        </span>
                      )}
                    </span>
                    {mode.description && (
                      <span className="mt-0.5 block text-[0.7rem] leading-snug text-ink-ghost">
                        {mode.description}
                      </span>
                    )}
                  </span>
                </button>
              </li>
            ))}
          </motion.ul>
        )}
      </AnimatePresence>
    </div>
  );
}
