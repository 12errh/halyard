import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { ArrowUp, CornerDownLeft, Square } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/primitives";
import { cn } from "@/lib/utils";

interface Suggestion {
  value: string;
  label: string;
  hint?: string;
  kind: "file" | "command";
}

export function Composer({
  onSubmit,
  onAbort,
  busy,
  disabled,
  placeholder = "Ask opencode to do something…",
  suggestFiles,
  suggestCommands,
}: {
  onSubmit(text: string): void;
  onAbort(): void;
  busy: boolean;
  disabled?: boolean;
  placeholder?: string;
  suggestFiles(query: string): Promise<string[]>;
  suggestCommands(): Promise<Suggestion[]>;
}) {
  const [value, setValue] = useState("");
  const [caret, setCaret] = useState(0);
  const [items, setItems] = useState<Suggestion[]>([]);
  const [highlight, setHighlight] = useState(0);
  const textarea = useRef<HTMLTextAreaElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);

  // Trigger detection: the token the caret currently sits inside, if it starts
  // with @ or / and has no whitespace yet.
  const trigger = (() => {
    const before = value.slice(0, caret);
    const match = /(^|\s)([@/])([^\s]*)$/.exec(before);
    if (!match) return null;
    const token = match[3] ?? "";
    return {
      start: caret - token.length - 1,
      sigil: match[2] as "@" | "/",
      query: token,
    };
  })();

  useEffect(() => {
    if (!trigger) {
      setItems([]);
      return;
    }
    let cancelled = false;
    const run = async () => {
      const found =
        trigger.sigil === "@"
          ? (await suggestFiles(trigger.query)).map((path) => ({
              value: path,
              label: path.split("/").pop() ?? path,
              hint: path,
              kind: "file" as const,
            }))
          : (await suggestCommands()).filter(
              (c) => !trigger.query || c.label.toLowerCase().startsWith(trigger.query.toLowerCase()),
            );
      if (!cancelled) {
        setItems(found.slice(0, 8));
        setHighlight(0);
      }
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [trigger?.sigil, trigger?.query]); // eslint-disable-line react-hooks/exhaustive-deps

  // Grow with content, up to a ceiling, then scroll.
  useLayoutEffect(() => {
    const node = textarea.current;
    if (!node) return;
    node.style.height = "0px";
    node.style.height = `${Math.min(node.scrollHeight, 220)}px`;
  }, [value]);

  const applySuggestion = useCallback(
    (suggestion: Suggestion) => {
      if (!trigger) return;
      const token = trigger.sigil === "@" ? `@${suggestion.value}` : `/${suggestion.label}`;
      const next = `${value.slice(0, trigger.start)}${token} ${value.slice(caret)}`;
      setValue(next);
      setItems([]);
      requestAnimationFrame(() => {
        const node = textarea.current;
        if (!node) return;
        node.focus();
        const position = trigger.start + token.length + 1;
        node.setSelectionRange(position, position);
        setCaret(position);
      });
    },
    [trigger, value, caret],
  );

  const submit = useCallback(() => {
    const text = value.trim();
    if (!text || disabled || busy) return;
    onSubmit(text);
    setValue("");
    setItems([]);
  }, [value, busy, disabled, onSubmit]);

  const onKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (items.length > 0) {
      if (event.key === "ArrowDown") {
        event.preventDefault();
        setHighlight((h) => (h + 1) % items.length);
        return;
      }
      if (event.key === "ArrowUp") {
        event.preventDefault();
        setHighlight((h) => (h - 1 + items.length) % items.length);
        return;
      }
      if (event.key === "Enter" || event.key === "Tab") {
        event.preventDefault();
        const picked = items[highlight];
        if (picked) applySuggestion(picked);
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        setItems([]);
        return;
      }
    }

    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      submit();
    }
  };

  return (
    <div className="px-5 pb-4">
      <div className="mx-auto w-full max-w-[760px]">
        <div
          ref={boxRef}
          className={cn(
            "relative rounded-[var(--radius-panel)] border bg-surface transition-colors duration-150",
            disabled ? "border-line opacity-50" : "border-line focus-within:border-accent/50",
          )}
        >
          <AnimatePresence>
            {items.length > 0 && (
              <motion.ul
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 4 }}
                transition={{ duration: 0.14 }}
                className="scroll-area absolute bottom-[calc(100%+8px)] left-0 max-h-64 w-full overflow-auto rounded-[var(--radius-card)] border border-line bg-overlay py-1 shadow-[var(--shadow-panel)]"
              >
                {items.map((item, index) => (
                  <li key={`${item.kind}-${item.value ?? item.label}`}>
                    <button
                      type="button"
                      onMouseDown={(event) => {
                        event.preventDefault();
                        applySuggestion(item);
                      }}
                      onMouseEnter={() => setHighlight(index)}
                      className={cn(
                        "flex w-full items-baseline gap-2 px-2.5 py-1.5 text-left text-[0.82rem]",
                        index === highlight ? "bg-accent/12 text-ink" : "text-ink-muted",
                      )}
                    >
                      <span className="truncate">{item.label}</span>
                      {item.hint && item.hint !== item.label && (
                        <span className="truncate font-mono text-[0.7rem] text-ink-ghost">{item.hint}</span>
                      )}
                    </button>
                  </li>
                ))}
              </motion.ul>
            )}
          </AnimatePresence>

          <textarea
            ref={textarea}
            value={value}
            disabled={disabled}
            placeholder={placeholder}
            rows={1}
            onChange={(event) => {
              setValue(event.target.value);
              setCaret(event.target.selectionStart);
            }}
            onKeyUp={(event) => setCaret(event.currentTarget.selectionStart)}
            onClick={(event) => setCaret(event.currentTarget.selectionStart)}
            onKeyDown={onKeyDown}
            className="scroll-area max-h-[220px] w-full resize-none bg-transparent px-3.5 py-3 text-[0.88rem] leading-[1.55] text-ink outline-none placeholder:text-ink-ghost"
          />

          <div className="flex items-center justify-between gap-2 px-2 pb-2">
            <div className="flex items-center gap-1.5 text-[0.68rem] text-ink-ghost">
              <Kbd>@</Kbd>
              <span>files</span>
              <span className="text-line-strong">·</span>
              <Kbd>/</Kbd>
              <span>commands</span>
            </div>

            {busy ? (
              <Button variant="danger" size="icon-sm" onClick={onAbort} aria-label="Stop">
                <Square size={11} />
              </Button>
            ) : (
              <Button
                variant="primary"
                size="icon-sm"
                onClick={submit}
                disabled={disabled || value.trim().length === 0}
                aria-label="Send"
              >
                <ArrowUp size={13} />
              </Button>
            )}
          </div>
        </div>

        <p className="mt-1.5 flex items-center justify-center gap-1 text-[0.68rem] text-ink-ghost">
          <Kbd>
            <CornerDownLeft size={9} />
          </Kbd>
          send
          <span className="text-line-strong">·</span>
          <Kbd>shift</Kbd>
          <span>+</span>
          <Kbd>
            <CornerDownLeft size={9} />
          </Kbd>
          newline
        </p>
      </div>
    </div>
  );
}
