import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { AlertTriangle, ArrowUp, Paperclip, Square, X } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/primitives";
import {
  filesFromTransfer,
  formatSize,
  isImage,
  newAttachmentId,
  readAttachment,
  screenAttachments,
  toCandidates,
  toFileParts,
  type Attachment,
  type BrowserFile,
  type Rejection,
} from "@/lib/attachments";
import { cn } from "@/lib/utils";

export interface ComposerSubmit {
  text: string;
  attachments: Attachment[];
}

/**
 * Composer with @-file and /-command autocomplete plus drag-and-drop and paste
 * attachments.
 *
 * Attachments travel as data URLs (what the opencode server accepts), guarded
 * by an explicit size budget rather than letting a large file silently stall
 * the turn.
 */
export function Composer({
  onSubmit,
  onAbort,
  busy,
  disabled,
  placeholder = "Ask opencode to do something…",
  suggestFiles,
  suggestCommands,
  modelPicker,
}: {
  onSubmit(payload: ComposerSubmit): void;
  onAbort(): void;
  busy: boolean;
  disabled?: boolean;
  placeholder?: string;
  suggestFiles(query: string): Promise<string[]>;
  suggestCommands(): Promise<Suggestion[]>;
  /** Rendered in the composer's toolbar, left of the send affordance. */
  modelPicker?: React.ReactNode;
}) {
  const [value, setValue] = useState("");
  const [caret, setCaret] = useState(0);
  const [items, setItems] = useState<Suggestion[]>([]);
  const [highlight, setHighlight] = useState(0);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [rejections, setRejections] = useState<Rejection[]>([]);
  const [dragging, setDragging] = useState(false);
  const textarea = useRef<HTMLTextAreaElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const addFiles = useCallback(async (files: BrowserFile[]) => {
    if (files.length === 0) return;
    const { accepted, rejected } = screenAttachments(attachments, toCandidates(files));
    setRejections(rejected);
    if (accepted.length === 0) return;

    const allowed = new Set(accepted.map((file) => file.name));
    const read = await Promise.all(
      files.filter((file) => allowed.has(file.name)).map((file) => readAttachment(file)),
    );
    setAttachments((prev) => [
      ...prev,
      ...read.map((value) => ({ ...value, id: newAttachmentId() })),
    ]);
  }, [attachments]);

  const removeAttachment = (id: string) =>
    setAttachments((prev) => {
      const target = prev.find((a) => a.id === id);
      if (target?.previewUrl) URL.revokeObjectURL(target.previewUrl);
      return prev.filter((a) => a.id !== id);
    });

  // Trigger detection: the token the caret sits inside, if it starts with @ or /
  // and has no whitespace yet.
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
          : (await suggestCommands()).filter((c) => matches(c, trigger.query));
      if (!cancelled) {
        // No cap: a truncated command list reads as "the app only has three
        // commands", which is worse than a scrollbar.
        setItems(found);
        setHighlight(0);
      }
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [trigger?.sigil, trigger?.query]);

  // Grow with content up to a ceiling, then scroll.
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
    if ((!text && attachments.length === 0) || disabled || busy) return;
    onSubmit({ text, attachments });
    setValue("");
    setAttachments([]);
    setItems([]);
    setRejections([]);
  }, [value, attachments, busy, disabled, onSubmit]);

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
          onDragOver={(event) => {
            event.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(event) => {
            event.preventDefault();
            setDragging(false);
            void addFiles(filesFromTransfer(event.dataTransfer));
          }}
          className={cn(
            "relative rounded-[var(--radius-panel)] border bg-surface transition-colors duration-150",
            dragging ? "border-accent bg-accent/[0.06]" : "border-line focus-within:border-accent/50",
            disabled && "opacity-50",
          )}
        >
          <AnimatePresence>
            {dragging && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center rounded-[var(--radius-panel)] border-2 border-dashed border-accent/60 text-[0.82rem] text-accent"
              >
                Drop files to attach
              </motion.div>
            )}
          </AnimatePresence>

          <AnimatePresence>
            {items.length > 0 && (
              <motion.ul
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 4 }}
                transition={{ duration: 0.14 }}
                className="scroll-area absolute bottom-[calc(100%+8px)] left-0 z-20 max-h-[320px] w-full overflow-auto rounded-[var(--radius-card)] border border-line bg-overlay py-1 shadow-[var(--shadow-panel)]"
              >
                {items.map((item, index) => {
                  const previous = items[index - 1];
                  const showHeading =
                    item.kind === "command" &&
                    (!previous || previous.kind !== "command" || previous.source !== item.source);

                  return (
                    <li key={`${item.kind}-${item.value ?? item.label}`}>
                      {showHeading && (
                        <p className="px-2.5 pb-0.5 pt-1.5 text-[0.6rem] font-semibold uppercase tracking-[0.13em] text-ink-ghost">
                          {item.source === "skill" ? "Skills" : "Commands"}
                        </p>
                      )}
                      <button
                        type="button"
                        onMouseDown={(event) => {
                          event.preventDefault();
                          applySuggestion(item);
                        }}
                        onMouseEnter={() => setHighlight(index)}
                        className={cn(
                          "flex w-full flex-col gap-0.5 px-2.5 py-1.5 text-left",
                          index === highlight ? "bg-accent/12" : "hover:bg-raised",
                        )}
                      >
                        <span className="flex items-baseline gap-1.5">
                          <span
                            className={cn(
                              "truncate font-mono text-[0.8rem]",
                              index === highlight ? "text-accent" : "text-ink",
                            )}
                          >
                            {item.kind === "command" ? `/${item.label}` : item.label}
                          </span>
                        </span>
                        {item.hint && item.hint !== item.label && (
                          <span
                            data-selectable
                            className="line-clamp-2 text-[0.72rem] leading-snug text-ink-ghost"
                          >
                            {item.hint}
                          </span>
                        )}
                      </button>
                    </li>
                  );
                })}
              </motion.ul>
            )}
          </AnimatePresence>

          <AnimatePresence>
            {(attachments.length > 0 || rejections.length > 0) && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: "auto", opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                className="overflow-hidden"
              >
                <div className="flex flex-wrap gap-1.5 px-2.5 pt-2.5">
                  {attachments.map((attachment) => (
                    <div
                      key={attachment.id}
                      className="group relative flex items-center gap-1.5 rounded-[6px] border border-line bg-raised py-1 pl-1.5 pr-6"
                    >
                      {isImage(attachment) && attachment.previewUrl ? (
                        <img
                          src={attachment.previewUrl}
                          alt=""
                          className="h-7 w-7 rounded-[4px] object-cover"
                        />
                      ) : (
                        <Paperclip size={12} className="text-ink-faint" />
                      )}
                      <span className="max-w-[140px] truncate text-[0.74rem] text-ink-muted">
                        {attachment.name}
                      </span>
                      <span className="tabular font-mono text-[0.66rem] text-ink-ghost">
                        {formatSize(attachment.size)}
                      </span>
                      <button
                        type="button"
                        onClick={() => removeAttachment(attachment.id)}
                        aria-label={`Remove ${attachment.name}`}
                        className="absolute right-1 rounded p-0.5 text-ink-ghost opacity-0 transition-opacity hover:text-danger group-hover:opacity-100 focus-visible:opacity-100"
                      >
                        <X size={10} />
                      </button>
                    </div>
                  ))}
                </div>

                {rejections.length > 0 && (
                  <ul className="px-2.5 pb-1 pt-1.5">
                    {rejections.map((rejection) => (
                      <li key={rejection.name} className="flex items-center gap-1.5 text-[0.7rem] text-warn">
                        <AlertTriangle size={11} />
                        {rejection.message}
                      </li>
                    ))}
                  </ul>
                )}
              </motion.div>
            )}
          </AnimatePresence>

          <textarea
            ref={textarea}
            value={value}
            disabled={disabled}
            placeholder={placeholder}
            rows={1}
            onChange={(event) => setValue(event.target.value)}
            onPaste={(event) => {
              // A pasted screenshot arrives as a file, not as text.
              const files = filesFromTransfer(event.clipboardData);
              if (files.length > 0) {
                event.preventDefault();
                void addFiles(files);
              }
            }}
            onKeyUp={(event) => setCaret(event.currentTarget.selectionStart)}
            onClick={(event) => setCaret(event.currentTarget.selectionStart)}
            onKeyDown={onKeyDown}
            className="scroll-area max-h-[220px] w-full resize-none bg-transparent px-3.5 py-3 text-[0.88rem] leading-[1.55] text-ink outline-none placeholder:text-ink-ghost"
          />

          <div className="flex items-center justify-between gap-2 px-2 pb-2">
            <div className="flex min-w-0 flex-1 items-center gap-2">
              <button
                type="button"
                onClick={() => fileInput.current?.click()}
                disabled={disabled}
                aria-label="Attach files"
                title="Attach files"
                className="shrink-0 rounded-full border border-line bg-surface p-1.5 text-ink-faint transition-colors hover:border-line-strong hover:text-ink disabled:opacity-40"
              >
                <Paperclip size={12} />
              </button>

              <input
                ref={fileInput}
                type="file"
                multiple
                className="hidden"
                accept="image/*,text/*,application/json,application/xml,application/yaml,application/pdf,application/zip"
                onChange={(event) => {
                  const picked = Array.from(event.target.files ?? []) as BrowserFile[];
                  void addFiles(picked);
                  // Reset so re-picking the same file fires change again.
                  event.target.value = "";
                }}
              />

              {modelPicker}
              <div className="hidden items-center gap-1.5 text-[0.68rem] text-ink-ghost sm:flex">
                <Kbd>@</Kbd>
                <span>files</span>
                <span className="text-line-strong">·</span>
                <Kbd>/</Kbd>
                <span>commands</span>
              </div>
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
                disabled={disabled || (!value.trim() && attachments.length === 0)}
                aria-label="Send"
              >
                <ArrowUp size={13} />
              </Button>
            )}
          </div>
        </div>

        <p className="mt-1.5 flex items-center justify-center gap-1 text-[0.68rem] text-ink-ghost">
          <Kbd>shift</Kbd>
          <span>+</span>
          <Kbd>↵</Kbd>
          <span>newline</span>
        </p>
      </div>
    </div>
  );
}

export interface Suggestion {
  value: string;
  label: string;
  hint?: string;
  kind: "file" | "command";
  /** `command` vs `skill`; used to group the list under headings. */
  source?: string;
}

/**
 * Command matching.
 *
 * Substring rather than prefix: users type "/ini" expecting /init, and the
 * command set is small enough that substring never returns noise first.
 */
export function matches(suggestion: Suggestion, query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  return `${suggestion.label} ${suggestion.hint ?? ""}`.toLowerCase().includes(needle);
}

export { toFileParts };
