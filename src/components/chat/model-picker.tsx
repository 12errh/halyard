import { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Check, ChevronDown, Image as ImageIcon, Sparkles } from "lucide-react";
import { Badge } from "@/components/ui/primitives";
import { Input } from "@/components/ui/input";
import { formatContext, type FlatModel } from "@/lib/opencode/models";
import { rankModels } from "@/lib/opencode/models";
import { cn } from "@/lib/utils";

/**
 * Model picker.
 *
 * Sits directly above the composer rather than buried in settings, because
 * switching model mid-conversation is a normal thing to want to do.
 */
export function ModelPicker({
  models,
  selection,
  loading,
  onSelect,
}: {
  models: FlatModel[];
  selection: { providerID: string; modelID: string } | null;
  loading: boolean;
  onSelect(next: { providerID: string; modelID: string }): void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [highlight, setHighlight] = useState(0);
  const root = useRef<HTMLDivElement>(null);

  const results = useMemo(() => rankModels(models, query), [models, query]);
  const current = selection
    ? models.find((m) => m.providerID === selection.providerID && m.modelID === selection.modelID)
    : null;

  useEffect(() => {
    if (!open) return;
    setQuery("");
    setHighlight(0);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onDown = (event: MouseEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  return (
    <div ref={root} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="listbox"
        className={cn(
          "flex max-w-[280px] items-center gap-1.5 rounded-full border px-2.5 py-1 text-[0.74rem] transition-colors",
          open ? "border-accent/50 bg-raised text-ink" : "border-line bg-surface text-ink-muted hover:border-line-strong hover:text-ink",
        )}
      >
        <Sparkles size={11} className={cn("shrink-0", current?.free ? "text-good" : "text-accent")} />
        <span className="truncate">
          {loading ? "loading models…" : (current?.label ?? "Auto")}
        </span>
        {current?.free && !loading && (
          <Badge tone="good" className="shrink-0 px-1 py-px text-[0.6rem]">
            free
          </Badge>
        )}
        <ChevronDown
          size={11}
          className={cn("shrink-0 text-ink-ghost transition-transform duration-150", open && "rotate-180")}
        />
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: 6, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 4, scale: 0.99 }}
            transition={{ duration: 0.15, ease: [0.22, 1, 0.36, 1] }}
            className="absolute bottom-[calc(100%+8px)] left-0 z-40 w-[340px] overflow-hidden rounded-[var(--radius-card)] border border-line-strong bg-overlay shadow-[var(--shadow-panel)]"
            role="listbox"
          >
            <div className="border-b border-line p-2">
              <Input
                autoFocus
                value={query}
                onChange={(event) => {
                  setQuery(event.target.value);
                  setHighlight(0);
                }}
                onKeyDown={(event) => {
                  if (event.key === "ArrowDown") {
                    event.preventDefault();
                    setHighlight((h) => (h + 1) % Math.max(results.length, 1));
                  } else if (event.key === "ArrowUp") {
                    event.preventDefault();
                    setHighlight((h) => (h - 1 + results.length) % Math.max(results.length, 1));
                  } else if (event.key === "Enter") {
                    event.preventDefault();
                    const picked = results[highlight];
                    if (picked) {
                      onSelect({ providerID: picked.providerID, modelID: picked.modelID });
                      setOpen(false);
                    }
                  } else if (event.key === "Escape") {
                    event.preventDefault();
                    setOpen(false);
                  }
                }}
                placeholder="Search models…"
                className="h-7 text-[0.78rem]"
              />
            </div>

            <ul className="scroll-area max-h-[320px] overflow-auto py-1">
              {results.length === 0 && (
                <li className="px-3 py-4 text-center text-[0.78rem] text-ink-ghost">
                  {models.length === 0
                    ? "No usable models. Connect a provider in Settings."
                    : "No models match."}
                </li>
              )}

              {results.map((model, index) => {
                const selected =
                  selection?.providerID === model.providerID && selection?.modelID === model.modelID;
                return (
                  <li key={`${model.providerID}/${model.modelID}`}>
                    <button
                      type="button"
                      role="option"
                      aria-selected={selected}
                      onMouseEnter={() => setHighlight(index)}
                      onClick={() => {
                        onSelect({ providerID: model.providerID, modelID: model.modelID });
                        setOpen(false);
                      }}
                      className={cn(
                        "flex w-full items-center gap-2 px-2.5 py-1.5 text-left transition-colors",
                        index === highlight ? "bg-accent/12" : "hover:bg-raised",
                      )}
                    >
                      <span className="w-3 shrink-0">
                        {selected && <Check size={12} className="text-accent" />}
                      </span>

                      <span className="min-w-0 flex-1">
                        <span className="flex items-center gap-1.5">
                          <span className="truncate text-[0.8rem] text-ink">{model.label}</span>
                          {model.free && (
                            <Badge tone="good" className="shrink-0 px-1 py-px text-[0.58rem]">
                              free
                            </Badge>
                          )}
                          {model.image && <ImageIcon size={10} className="shrink-0 text-ink-ghost" />}
                        </span>
                        <span className="block truncate font-mono text-[0.64rem] text-ink-ghost">
                          {model.providerID} · {model.modelID}
                          {model.context ? ` · ${formatContext(model.context)} ctx` : ""}
                        </span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
