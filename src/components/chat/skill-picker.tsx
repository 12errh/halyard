import { useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Check, Package, Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { searchSkills, summariseSkill, type Skill } from "@/lib/resources";
import { cn } from "@/lib/utils";

/**
 * Skill picker.
 *
 * opencode lists a skill as a command of its own, which is true and is not
 * what anyone means by "give me the skills" — that is one searchable list you
 * can take several from at once. Tick as many as you want and they come back as
 * the commands that invoke them.
 *
 * Nothing here talks to the server: the list arrives ready, so the dialog opens
 * instantly and search is local.
 */
export function SkillPicker({
  open,
  skills,
  loading,
  error,
  onClose,
  onAdd,
}: {
  open: boolean;
  skills: Skill[];
  loading: boolean;
  error: string | null;
  onClose(): void;
  /** The skills chosen, in the order they were picked. */
  onAdd(names: string[]): void;
}) {
  const [query, setQuery] = useState("");
  const [picked, setPicked] = useState<string[]>([]);

  // Reopening should start from an empty search and nothing ticked: the last
  // selection is not a default, it is a leftover.
  useEffect(() => {
    if (open) {
      setQuery("");
      setPicked([]);
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const shown = useMemo(() => searchSkills(skills, query), [skills, query]);

  if (!open) return null;

  const toggle = (name: string) =>
    setPicked((prev) => (prev.includes(name) ? prev.filter((n) => n !== name) : [...prev, name]));

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.14 }}
        className="fixed inset-0 z-50 flex items-start justify-center bg-black/50 px-4 pt-[12vh] backdrop-blur-[2px]"
        onMouseDown={(event) => {
          if (event.target === event.currentTarget) onClose();
        }}
      >
        <motion.div
          role="dialog"
          aria-modal="true"
          aria-label="Add skills"
          initial={{ opacity: 0, y: 6, scale: 0.99 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 4, scale: 0.99 }}
          transition={{ duration: 0.16, ease: [0.22, 1, 0.36, 1] }}
          className="flex max-h-[70vh] w-[min(560px,92vw)] flex-col overflow-hidden rounded-[var(--radius-panel)] border border-line-strong bg-surface shadow-[var(--shadow-panel)]"
        >
          <header className="flex items-center gap-2 border-b border-line px-3 py-2">
            <Search size={13} className="shrink-0 text-ink-ghost" />
            <input
              autoFocus
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search skills…"
              aria-label="Search skills"
              className="min-w-0 flex-1 bg-transparent text-[0.84rem] text-ink outline-none placeholder:text-ink-ghost"
            />
            <span className="tabular shrink-0 text-[0.68rem] text-ink-ghost">
              {picked.length > 0 ? `${picked.length} picked` : `${shown.length} skills`}
            </span>
            <Button variant="ghost" size="icon-sm" onClick={onClose} aria-label="Close skill picker">
              <X size={13} />
            </Button>
          </header>

          <div className="scroll-area min-h-0 flex-1 p-1.5">
            {loading && <p className="px-2 py-6 text-center text-[0.78rem] text-ink-ghost">Loading skills…</p>}
            {!loading && error && (
              <p className="px-2 py-6 text-center text-[0.78rem] text-danger">{error}</p>
            )}
            {!loading && !error && shown.length === 0 && (
              <p className="px-2 py-6 text-center text-[0.78rem] text-ink-ghost">
                {skills.length === 0 ? "This server reported no skills." : "No skill matches."}
              </p>
            )}
            {shown.map((skill) => {
              const on = picked.includes(skill.name);
              return (
                <button
                  key={skill.name}
                  type="button"
                  onClick={() => toggle(skill.name)}
                  aria-pressed={on}
                  className={cn(
                    "flex w-full items-center gap-2.5 rounded-[7px] px-2 py-1.5 text-left transition-colors",
                    on ? "bg-accent/12 text-ink" : "text-ink-muted hover:bg-raised",
                  )}
                >
                  <span
                    className={cn(
                      "flex h-4 w-4 shrink-0 items-center justify-center rounded-[4px] border transition-colors",
                      on ? "border-accent bg-accent text-accent-ink" : "border-line-strong",
                    )}
                  >
                    {on && <Check size={11} />}
                  </span>
                  <Package size={12} className={cn("shrink-0", on ? "text-accent" : "text-ink-ghost")} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-mono text-[0.76rem]">{skill.name}</span>
                    <span className="block truncate text-[0.68rem] text-ink-ghost">
                      {summariseSkill(skill)}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>

          <footer className="flex items-center justify-between gap-2 border-t border-line px-3 py-2">
            <span className="text-[0.7rem] text-ink-ghost">
              {picked.length > 0
                ? picked.map((name) => `/${name}`).join("  ")
                : "Pick as many as you need."}
            </span>
            <div className="flex shrink-0 gap-1.5">
              <Button variant="ghost" size="sm" onClick={onClose}>
                Cancel
              </Button>
              <Button
                size="sm"
                disabled={picked.length === 0}
                onClick={() => {
                  onAdd(picked);
                  onClose();
                }}
              >
                {picked.length === 1 ? "Add skill" : `Add ${picked.length} skills`}
              </Button>
            </div>
          </footer>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}
