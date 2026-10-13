import { useEffect, useMemo, useRef, useState } from "react";
import { motion } from "motion/react";
import { Search } from "lucide-react";
import { Kbd } from "@/components/ui/primitives";
import { cn } from "@/lib/utils";

export interface Command {
  id: string;
  label: string;
  hint?: string;
  group: string;
  run(): void;
  /** Extra words that should match, e.g. a model id. */
  keywords?: string;
}

const isMac =
  typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);

export function CommandPalette({
  open,
  commands,
  onClose,
}: {
  open: boolean;
  commands: Command[];
  onClose(): void;
}) {
  const [query, setQuery] = useState("");
  const [highlight, setHighlight] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLUListElement>(null);

  const results = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return commands;
    return commands.filter((command) =>
      [command.label, command.group, command.keywords ?? ""]
        .join(" ")
        .toLowerCase()
        .includes(needle),
    );
  }, [commands, query]);

  useEffect(() => {
    if (open) {
      setQuery("");
      setHighlight(0);
      // Focus after the enter animation so the caret does not jump.
      const id = setTimeout(() => input.current?.focus(), 40);
      return () => clearTimeout(id);
    }
  }, [open]);

  useEffect(() => setHighlight(0), [query]);

  useEffect(() => {
    list.current
      ?.querySelector<HTMLElement>(`[data-index="${highlight}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [highlight]);

  if (!open) return null;

  const commit = (command: Command | undefined) => {
    if (!command) return;
    onClose();
    command.run();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-[14vh]">
      <motion.button
        type="button"
        aria-label="Close command palette"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.14 }}
        onClick={onClose}
        className="absolute inset-0 cursor-default bg-black/45 backdrop-blur-[2px]"
      />

      <motion.div
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
        initial={{ opacity: 0, scale: 0.97, y: -8 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.98, y: -6 }}
        transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
        className="relative w-[min(620px,92vw)] overflow-hidden rounded-[var(--radius-panel)] border border-line-strong bg-overlay shadow-[var(--shadow-panel)]"
      >
        <div className="flex items-center gap-2.5 border-b border-line px-3.5 py-3">
          <Search size={14} className="shrink-0 text-ink-ghost" />
          <input
            ref={input}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "ArrowDown") {
                event.preventDefault();
                setHighlight((h) => (h + 1) % Math.max(results.length, 1));
              } else if (event.key === "ArrowUp") {
                event.preventDefault();
                setHighlight((h) => (h - 1 + results.length) % Math.max(results.length, 1));
              } else if (event.key === "Enter") {
                event.preventDefault();
                commit(results[highlight]);
              } else if (event.key === "Escape") {
                event.preventDefault();
                onClose();
              }
            }}
            placeholder="Type a command…"
            className="flex-1 bg-transparent text-[0.88rem] text-ink outline-none placeholder:text-ink-ghost"
          />
          <Kbd>esc</Kbd>
        </div>

        <ul ref={list} className="scroll-area max-h-[46vh] overflow-auto py-1.5">
          {results.length === 0 && (
            <li className="px-3.5 py-6 text-center text-[0.8rem] text-ink-ghost">
              No matching commands.
            </li>
          )}
          {results.map((command, index) => (
            <li key={command.id}>
              <button
                type="button"
                data-index={index}
                onMouseEnter={() => setHighlight(index)}
                onClick={() => commit(command)}
                className={cn(
                  "flex w-full items-center gap-3 px-3.5 py-2 text-left transition-colors duration-100",
                  index === highlight ? "bg-accent/12" : "hover:bg-raised",
                )}
              >
                <span className="min-w-0 flex-1 truncate text-[0.84rem] text-ink">
                  {command.label}
                </span>
                {command.hint && (
                  <span className="shrink-0 font-mono text-[0.68rem] text-ink-ghost">
                    {command.hint}
                  </span>
                )}
                <span className="shrink-0 text-[0.66rem] uppercase tracking-wider text-ink-ghost">
                  {command.group}
                </span>
              </button>
            </li>
          ))}
        </ul>

        <div className="flex items-center gap-3 border-t border-line px-3.5 py-1.5 text-[0.66rem] text-ink-ghost">
          <span className="flex items-center gap-1">
            <Kbd>↑</Kbd>
            <Kbd>↓</Kbd> navigate
          </span>
          <span className="flex items-center gap-1">
            <Kbd>↵</Kbd> run
          </span>
          <span className="flex-1" />
          <span className="font-mono">{isMac ? "⌘K" : "Ctrl K"}</span>
        </div>
      </motion.div>
    </div>
  );
}

export function usePlatformMod(): string {
  return isMac ? "⌘" : "Ctrl";
}
