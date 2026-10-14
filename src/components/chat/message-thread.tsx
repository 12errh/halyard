import { memo, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Companion } from "./companion";
import { AnimatePresence, motion } from "motion/react";
import { ArrowDown, Paperclip, Sparkles } from "lucide-react";
import { useAutoScroll } from "@/hooks/use-auto-scroll";
import { PartView } from "./part-view";
import { DiffSummary } from "./diff-view";
import { PermissionCard } from "./permission-card";
import { QuestionCard } from "./question-card";
import { isStreaming, orderedParts, type MessageEntry } from "@/lib/opencode/thread";
import { normaliseDiff, type NormalisedDiff } from "@/lib/diff";
import type { Part, PermissionReply, PendingPermission, UserMessage } from "@/lib/opencode/types";
import type { PendingQuestion } from "@/state/questions";
import { useTranscript } from "@/state/transcript";
import { cn } from "@/lib/utils";

export function MessageThread({
  entries,
  live,
  agent,
  model,
  permissions = [],
  onPermissionReply,
  questions = [],
  onQuestionAnswer,
  onQuestionSkip,
  diffs = [],
  onEditAndResend,
  title,
  subtitle,
}: {
  entries: MessageEntry[];
  live: boolean;
  agent?: string;
  model?: string;
  permissions?: PendingPermission[];
  onPermissionReply?(permission: PendingPermission, reply: PermissionReply): Promise<void>;
  questions?: PendingQuestion[];
  onQuestionAnswer?(pending: PendingQuestion, answers: string[][]): Promise<void>;
  onQuestionSkip?(pending: PendingQuestion): Promise<void>;
  diffs?: NormalisedDiff[];
  onEditAndResend?(messageID: string, text: string): Promise<void>;
  title?: string;
  subtitle?: string;
}) {
  // Follow the stream, but never fight a user who has scrolled up.
  const { containerRef, contentRef, stuck, scrollToBottom } = useAutoScroll();
  const normalised = useMemo(
    () => diffs.map(normaliseDiff).filter((d): d is NormalisedDiff => d !== null),
    [diffs],
  );

  // Entries whose `message.updated` has not arrived yet render nothing; drop
  // them here so the rest of the component can assume `info` is present.
  const visible = useMemo(() => entries.filter((entry) => entry.info !== null), [entries]);
  const lastAssistantId = useMemo(
    () => [...visible].reverse().find((e) => e.info!.role === "assistant")?.info!.id,
    [visible],
  );

  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      <div ref={containerRef} className="scroll-area flex-1 px-5 pb-6" data-selectable>
        {/* The observed element: its height changes on every token, tool row
            and diff, which is what triggers following. */}
        <div
          ref={contentRef}
          className="mx-auto flex w-full max-w-[760px] flex-col gap-1 pt-6"
        >
        {normalised.length > 0 && <DiffSummary diffs={normalised} />}

        {/* No AnimatePresence around the turns. It exists to animate entries
            going in and out, and nothing here ever exits — but it still
            re-diffs and re-renders every child on each parent render, which
            on a long thread cost more than the messages themselves. Each turn
            animates itself in. */}
        {visible.map((entry, index) => (
            <Turn
              key={entry.info!.id}
              entry={entry}
              streaming={live && index === visible.length - 1}
              showDiffAfter={
                entry.info!.role === "assistant" && entry.info!.id === lastAssistantId
                  ? normalised
                  : null
              }
            onEditAndResend={onEditAndResend}
          />
        ))}

        {/* Questions wait above permissions: the agent cannot proceed until one
            is answered, so it should be the first thing read. */}
        <AnimatePresence>
          {questions.map((pending) => (
            <QuestionCard
              key={pending.id}
              pending={pending}
              onSubmit={(answers) => onQuestionAnswer?.(pending, answers) ?? Promise.resolve()}
              onReject={() => onQuestionSkip?.(pending) ?? Promise.resolve()}
            />
          ))}
        </AnimatePresence>

        <AnimatePresence>
          {permissions.map((permission) => (
            <PermissionCard
              key={permission.id}
              permission={permission}
              onReply={(reply) => onPermissionReply?.(permission, reply) ?? Promise.resolve()}
            />
          ))}
        </AnimatePresence>

        {live && visible.length === 0 && (
          <div className="flex items-center gap-2 py-6 text-[0.84rem] text-ink-faint">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-live" />
            {agent && model ? `${agent} · ${model}` : "Working…"}
          </div>
        )}

        {/* A brand-new thread is the most-seen screen in the app, so it gets a
            proper welcome rather than a blank column. Centred with a min-height
            so it sits optically in the middle without fighting the composer. */}
        {!live && entries.length === 0 && (
          <div className="flex min-h-[52vh] flex-col items-center justify-center gap-3 py-10 text-center">
            <Companion size={116} />
            <div className="space-y-1">
              <h2 className="text-[1.05rem] font-medium tracking-tight text-ink">
                {title ?? "What are we working on?"}
              </h2>
              <p className="text-[0.84rem] text-ink-faint">
                {subtitle ?? "Describe the change, the bug, or the file you want to look at."}
              </p>
            </div>
          </div>
        )}

        </div>
      </div>

      <AnimatePresence>
        {!stuck && (
          <motion.button
            type="button"
            onClick={scrollToBottom}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 4 }}
            transition={{ duration: 0.18 }}
            className="absolute bottom-3 left-1/2 z-10 flex -translate-x-1/2 items-center gap-1.5 rounded-full border border-line-strong bg-overlay px-3 py-1.5 text-[0.75rem] text-ink-muted shadow-[var(--shadow-panel)] transition-colors hover:text-ink"
          >
            <ArrowDown size={12} />
            Jump to latest
          </motion.button>
        )}
      </AnimatePresence>
    </div>
  );
}

const Turn = memo(function Turn({
  entry,
  streaming,
  showDiffAfter,
  onEditAndResend,
}: {
  entry: MessageEntry;
  streaming: boolean;
  showDiffAfter: NormalisedDiff[] | null;
  onEditAndResend?(messageID: string, text: string): Promise<void>;
}) {
  const { info } = entry;
  const parts = useMemo(() => orderedParts(entry), [entry]);
  const flowing = streaming || isStreaming(entry);

  // A delta can arrive before `message.updated`. Nothing is rendered until we
  // know the message's role, but the parts are already buffered in the store.
  if (!info) return null;

  const assistant = info.role === "assistant";
  const showTimestamps = useTranscript((s) => s.showTimestamps);
  const createdAt = info.time?.created;
  const text = userText(parts);
  const canEdit = !assistant && text.length > 0 && onEditAndResend !== undefined;
  const [editing, setEditing] = useState(false);

  return (
    <motion.article
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
      // `content-visibility` lets the browser skip layout and paint for turns
      // that are scrolled out of view, while `contain-intrinsic-size` supplies
      // a placeholder height so the scrollbar does not jump around as they
      // come into range.
      className={cn(
        "group py-2.5 [contain-intrinsic-size:auto_64px] [content-visibility:auto]",
        assistant ? "" : "flex justify-end",
      )}
    >
      {assistant ? (
        // Assistant: full-width prose on the left. A bubble would fight the
        // markdown and code blocks, which need the room.
        <div className="flex gap-3">
          <span className="mt-[3px] flex h-6 w-6 shrink-0 select-none items-center justify-center rounded-full border border-line bg-raised">
            <Sparkles size={11} className="text-accent" />
          </span>
          <div className="min-w-0 flex-1 text-[0.88rem] text-ink">
            {parts.map((part) => (
              <PartView key={part.id} part={part} streaming={flowing && part.type === "text"} />
            ))}
            {!parts.length && flowing && <TypingIndicator />}
          </div>
        </div>
      ) : (
        // User: a bubble on the right, so the two sides are unmistakable at a
        // glance rather than distinguished only by a label.
        <div className="max-w-[85%] min-w-0">
          {/* Provenance sits above the bubble and stays out of the way until
              the turn is hovered. A permanently visible timestamp and Edit
              label on every message is pure noise. */}
          <div
            className={cn(
              "mb-1 flex items-baseline justify-end gap-2 pr-0.5",
              "h-4 transition-opacity duration-150",
              showTimestamps ? "opacity-100" : "opacity-0 group-hover:opacity-100 focus-within:opacity-100",
            )}
          >
            <time className="text-[0.66rem] text-ink-ghost">{formatTime(createdAt)}</time>
            {canEdit && !editing && (
              <button
                type="button"
                onClick={() => setEditing(true)}
                aria-label="Edit and resend"
                className="rounded px-1 text-[0.68rem] text-ink-ghost transition-colors hover:text-accent"
              >
                Edit
              </button>
            )}
          </div>

          {editing && onEditAndResend ? (
            <EditBox
              initial={text}
              onCancel={() => setEditing(false)}
              onSubmit={async (next) => {
                setEditing(false);
                await onEditAndResend(info.id, next);
              }}
            />
          ) : (
            <div className="rounded-[var(--radius-panel)] rounded-br-[6px] border border-line bg-raised/70 px-3.5 py-2.5">
              {parts.map((part) =>
                // Plain text in the bubble: markdown headings and tables look
                // wrong squeezed into a chat bubble, and user turns are prose.
                part.type === "text" ? (
                  <p
                    key={part.id}
                    data-selectable
                    className="whitespace-pre-wrap break-words text-[0.88rem] leading-[1.6] text-ink"
                  >
                    {(part as { text: string }).text}
                  </p>
                ) : (
                  <UserPart key={part.id} part={part} />
                ),
              )}
            </div>
          )}
        </div>
      )}

      {showDiffAfter && showDiffAfter.length > 0 && <DiffSummary diffs={showDiffAfter} />}
    </motion.article>
  );
});

/** Non-text parts inside a user bubble — attachments and the like. */
function UserPart({ part }: { part: Part }) {
  if (part.type !== "file") return null;
  return (
    <div
      data-selectable
      title={part.filename ?? part.url}
      className="flex items-center gap-1.5 rounded-[6px] bg-surface/70 px-2 py-1 text-[0.76rem] text-ink-muted"
    >
      <Paperclip size={11} className="shrink-0 text-ink-faint" />
      <span className="truncate">{part.filename ?? part.url}</span>
    </div>
  );
}

function EditBox({
  initial,
  onSubmit,
  onCancel,
}: {
  initial: string;
  onSubmit(text: string): Promise<void>;
  onCancel(): void;
}) {
  const [value, setValue] = useState(initial);
  const [busy, setBusy] = useState(false);
  const ref = useRef<HTMLTextAreaElement>(null);

  useLayoutEffect(() => {
    const node = ref.current;
    if (!node) return;
    node.style.height = "0px";
    node.style.height = `${Math.min(node.scrollHeight, 320)}px`;
    node.focus();
    node.setSelectionRange(node.value.length, node.value.length);
  }, []);

  return (
    <div className="overflow-hidden rounded-[var(--radius-card)] border border-accent/50 bg-surface">
      <textarea
        ref={ref}
        value={value}
        disabled={busy}
        onChange={(event) => setValue(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            onCancel();
          }
          if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
            event.preventDefault();
            if (!value.trim() || busy) return;
            setBusy(true);
            void onSubmit(value.trim()).finally(() => setBusy(false));
          }
        }}
        className="scroll-area max-h-[320px] w-full resize-none bg-transparent px-3 py-2.5 text-[0.88rem] leading-[1.55] text-ink outline-none"
      />
      <div className="flex items-center justify-between border-t border-line px-2.5 py-1.5">
        <span className="text-[0.68rem] text-ink-ghost">
          Rewinds the conversation and resends. ⌘↵ to send, esc to cancel.
        </span>
        <div className="flex gap-1.5">
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="rounded px-2 py-0.5 text-[0.74rem] text-ink-faint hover:bg-raised hover:text-ink"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={busy || !value.trim()}
            onClick={() => {
              setBusy(true);
              void onSubmit(value.trim()).finally(() => setBusy(false));
            }}
            className="rounded bg-accent px-2 py-0.5 text-[0.74rem] font-medium text-accent-ink disabled:opacity-40"
          >
            {busy ? "Sending…" : "Resend"}
          </button>
        </div>
      </div>
    </div>
  );
}

function userText(parts: ReturnType<typeof orderedParts>): string {
  return parts
    .filter((part) => part.type === "text")
    .map((part) => (part as { text: string }).text)
    .join("\n")
    .trim();
}

function TypingIndicator() {
  return (
    <span className="inline-flex items-center gap-1 py-1" aria-label="Assistant is responding">
      {[0, 1, 2].map((index) => (
        <motion.span
          key={index}
          className="h-1.5 w-1.5 rounded-full bg-ink-ghost"
          animate={{ opacity: [0.25, 0.9, 0.25], y: [0, -2, 0] }}
          transition={{ duration: 1.1, repeat: Infinity, delay: index * 0.14 }}
        />
      ))}
    </span>
  );
}

function formatTime(ms?: number): string {
  if (!ms) return "";
  return new Date(ms).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

export type { UserMessage };
