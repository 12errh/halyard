import {
  AlertTriangle,
  Braces,
  Brain,
  ChevronRight,
  CircleCheck,
  CircleX,
  Clock,
  FileCode2,
  FilePlus2,
  GitBranch,
  Globe,
  Grid3x3,
  Layers,
  List,
  ListChecks,
  Loader2,
  MessageCircleQuestion,
  PencilLine,
  Search,
  Sparkles,
  Terminal,
  TextSearch,
  Wrench,
  Zap,
} from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useMemo, useState, type ReactNode } from "react";
import { Markdown } from "./markdown";
import { RawDiff } from "./diff-view";
import { TodoBlock } from "./todo-panel";
import { describeTool, type ToolView } from "./tool-view";
import { useTranscript } from "@/state/transcript";
import { cn } from "@/lib/utils";
import type { Part, ToolPart, ToolState } from "@/lib/opencode/types";

/** Map a tool's presentation icon onto a recognisable glyph. */
function toolIcon(icon: ToolView["icon"]): ReactNode {
  switch (icon) {
    case "bash": return <Terminal size={12} />;
    case "read": return <FileCode2 size={12} />;
    case "write": return <FilePlus2 size={12} />;
    case "edit": return <PencilLine size={12} />;
    case "search": return <Search size={12} />;
    case "glob": return <Grid3x3 size={12} />;
    case "grep": return <TextSearch size={12} />;
    case "list": return <List size={12} />;
    case "web": return <Globe size={12} />;
    case "task": return <Sparkles size={12} />;
    case "todo": return <ListChecks size={12} />;
    case "skill": return <Zap size={12} />;
    case "patch": return <GitBranch size={12} />;
    case "question": return <MessageCircleQuestion size={12} />;
    case "lsp": return <Braces size={12} />;
    case "batch": return <Layers size={12} />;
    case "agent": return <Sparkles size={12} />;
    case "invalid": return <AlertTriangle size={12} />;
    default: return <Wrench size={12} />;
  }
}

function duration(state: ToolState): string {
  const start = state.time?.created;
  const end = state.time?.completed ?? (state.status === "running" ? Date.now() : undefined);
  if (!start || !end || end <= start) return "";
  const ms = end - start;
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.round(ms / 60_000)}m`;
}

/**
 * One tool call.
 *
 * Reads as a single quiet line rather than a log entry: status is carried by a
 * leading rule and a colour, not by a wall of text.
 *
 * The title and the secondary line come from `describeTool`, which is where
 * each tool's own vocabulary lives. That is what makes a glob report its match
 * count and an edit report its diff — both of which live in the tool metadata
 * and were previously dropped on the floor.
 */
export function ToolRow({ part }: { part: ToolPart }) {
  const { state } = part;
  const view = useMemo(() => describeTool(part.tool, state), [part.tool, state]);

  const [open, setOpen] = useState(false);
  const failed = state.status === "error";
  const active = state.status === "pending" || state.status === "running";
  const elapsed = duration(state);

  // A todo list is its own presentation, not something to expand.
  if (view.todos?.length) {
    return (
      <div className="my-1.5">
        <TodoBlock todos={view.todos} truncated={state.metadata?.truncated} />
      </div>
    );
  }

  const errorText = state.status === "error" ? state.error : undefined;
  const output = state.status === "completed" ? state.output : "";
  const hasBody = Boolean(view.body?.text.trim());
  const expandable = hasBody || Boolean(output) || Boolean(errorText);

  return (
    <div
      className={cn(
        // Flat until it is opened or hovered. A stack of fully-bordered cards
        // reads as a list of boxes competing with the prose they exist to
        // support, rather than as quiet annotation on it.
        "group/tool overflow-hidden rounded-[var(--radius-card)] transition-colors",
        open
          ? failed
            ? "border border-danger/30 bg-surface/70"
            : "border border-line bg-surface/70"
          : failed
            ? "border border-transparent bg-danger/[0.05] hover:bg-danger/[0.07]"
            : "border border-transparent hover:bg-raised/50",
      )}
    >
      <button
        type="button"
        onClick={expandable ? () => setOpen((v) => !v) : undefined}
        aria-expanded={expandable ? open : undefined}
        className={cn(
          "flex w-full items-center gap-2 py-1 pl-2 pr-2 text-left",
          expandable && "cursor-pointer",
        )}
      >
        {/* Status is a quiet tick in the left gutter rather than a full-height
            rule; four rules stacked read as a barcode. */}
        <span
          className={cn(
            "h-[3px] w-[3px] shrink-0 rounded-full transition-colors",
            active ? "bg-live" : failed ? "bg-danger" : "bg-good/60",
          )}
        />

        <span className={cn("shrink-0", active ? "text-live" : failed ? "text-danger" : "text-ink-faint")}>
          {toolIcon(view.icon)}
        </span>

        <span data-selectable className="min-w-0 flex-1 truncate text-[0.76rem] text-ink-muted">
          {view.title}
        </span>


        {view.description && (
          <span data-selectable className="hidden shrink-0 truncate text-[0.68rem] text-ink-ghost sm:block">
            {view.description}
          </span>
        )}

        {elapsed && (
          <span className="tabular hidden shrink-0 items-center gap-1 font-mono text-[0.68rem] text-ink-ghost sm:flex">
            <Clock size={9} />
            {elapsed}
          </span>
        )}

        {active && <Loader2 size={12} className="shrink-0 animate-spin text-live" />}
        {state.status === "completed" && !active && <CircleCheck size={12} className="shrink-0 text-good/80" />}
        {failed && <CircleX size={12} className="shrink-0 text-danger" />}

        {expandable && (
          <ChevronRight
            size={12}
            className={cn(
              "shrink-0 text-ink-ghost transition-transform duration-150",
              open && "rotate-90",
            )}
          />
        )}
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
            <div className="space-y-2 border-t border-line/70 px-2.5 py-2">
              {/* The point of the change, when there is one, before the raw
                  output it was derived from. */}
              {view.body?.kind === "diff" && (
                <Block label="Diff">
                  <RawDiff patch={view.body.text} path={typeof state.input?.filePath === "string" ? state.input.filePath : ""} />
                </Block>
              )}

              {view.body?.kind === "code" && (
                <Block label={view.title.replace(/^Wrote\s*/, "")}>
                  <pre className="scroll-area max-h-72 overflow-auto rounded-[5px] bg-raised px-2 py-1.5 font-mono text-[0.71rem] leading-[1.55] text-ink-muted">
                    {view.body.text}
                  </pre>
                </Block>
              )}

              {errorText && (
                <Block label="Error" tone="danger">
                  <pre className="scroll-area max-h-48 overflow-auto whitespace-pre-wrap rounded-[5px] bg-danger/[0.08] px-2 py-1.5 font-mono text-[0.71rem] leading-[1.55] text-danger">
                    {errorText}
                  </pre>
                </Block>
              )}

              {output && !hasBody && (
                <Block label="Output">
                  <pre className="scroll-area max-h-72 overflow-auto whitespace-pre-wrap rounded-[5px] bg-raised px-2 py-1.5 font-mono text-[0.71rem] leading-[1.55] text-ink-muted">
                    {output}
                  </pre>
                </Block>
              )}

              <Block label="Input">
                <pre className="scroll-area max-h-48 overflow-auto rounded-[5px] bg-raised px-2 py-1.5 font-mono text-[0.71rem] leading-[1.55] text-ink-faint">
                  {JSON.stringify(state.input ?? {}, null, 2)}
                </pre>
              </Block>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function Block({
  label,
  children,
  tone = "neutral",
}: {
  label: string;
  children: ReactNode;
  tone?: "neutral" | "danger";
}) {
  return (
    <div>
      <div
        className={cn(
          "mb-1 text-[0.62rem] font-semibold uppercase tracking-[0.12em]",
          tone === "danger" ? "text-danger/80" : "text-ink-ghost",
        )}
      >
        {label}
      </div>
      {children}
    </div>
  );
}

/**
 * A delegated agent run.
 *
 * Subagents are the main source of visual noise in a coding session, so this is
 * deliberately distinct from a tool call: it reads as a nested conversation
 * rather than as another machine step.
 */
export function SubtaskCard({
  prompt,
  description,
  agent,
}: {
  prompt: string;
  description?: string;
  agent?: string;
}) {
  const [open, setOpen] = useState(false);

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
      className="my-2 overflow-hidden rounded-[var(--radius-panel)] border border-accent/25 bg-accent/[0.05]"
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center gap-2.5 px-3 py-2 text-left transition-colors hover:bg-accent/[0.06]"
      >
        <span className="relative flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-accent/15 text-accent">
          <Sparkles size={11} />
        </span>

        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-1.5">
            <span className="text-[0.8rem] font-medium text-ink">
              {agent ? `${agent} agent` : "Subagent"}
            </span>
            <span className="rounded-full border border-accent/30 px-1.5 py-px text-[0.6rem] uppercase tracking-wider text-accent">
              delegated
            </span>
          </span>
          {description && (
            <span data-selectable className="mt-0.5 block truncate text-[0.75rem] text-ink-faint">
              {description}
            </span>
          )}
        </span>

        <ChevronRight
          size={13}
          className={cn(
            "shrink-0 text-ink-ghost transition-transform duration-150",
            open && "rotate-90",
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
            <div className="border-t border-accent/20 px-3 py-2">
              <div className="mb-1 text-[0.62rem] font-semibold uppercase tracking-[0.12em] text-ink-ghost">
                Prompt
              </div>
              <p data-selectable className="whitespace-pre-wrap text-[0.78rem] leading-relaxed text-ink-muted">
                {prompt}
              </p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

export function ReasoningBlock({ text, streaming }: { text: string; streaming: boolean }) {
  const [open, setOpen] = useState(false);
  if (!text.trim()) return null;

  return (
    <div className="my-1">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex items-center gap-1.5 rounded px-1 py-0.5 text-[0.74rem] text-ink-faint transition-colors hover:text-ink-muted"
      >
        <Brain size={12} />
        <ChevronRight size={11} className={cn("transition-transform duration-150", open && "rotate-90")} />
        {streaming ? "Thinking…" : "Reasoning"}
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
            <div className="mt-1 whitespace-pre-wrap border-l-2 border-line-strong pl-3 text-[0.82rem] text-ink-faint">
              {text}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/**
 * A completed step.
 *
 * Previously a full-width rule reading "STEP". Steps are bookkeeping, not
 * content, so they now read as a faint inline marker that only appears when
 * there is something worth saying — the reason or a cost.
 */
function StepMarker({ label, cost }: { label: string; cost?: number }) {
  if (!label && (cost ?? 0) === 0) return null;
  return (
    <div className="my-2.5 flex items-center gap-2 text-[0.65rem] text-ink-ghost/70">
      <span className="h-px flex-1 bg-line/50" />
      <span className="uppercase tracking-[0.14em]">{label || "step"}</span>
      {typeof cost === "number" && cost > 0 && (
        <span className="tabular font-mono">${cost.toFixed(4)}</span>
      )}
      <span className="h-px flex-1 bg-line/50" />
    </div>
  );
}

export function PartView({ part, streaming }: { part: Part; streaming: boolean }) {
  // Read once per render rather than per part: the store is cheap to read but
  // a turn can hold hundreds of parts.
  const showThinking = useTranscript((s) => s.showThinking);

  switch (part.type) {
    case "text":
      return part.text.trim() ? (
        <div data-selectable>
          <Markdown streaming={streaming}>{part.text}</Markdown>
        </div>
      ) : null;

    case "reasoning":
      // Hidden rather than removed: the part stays in the transcript so
      // re-enabling the toggle restores it without a reload.
      if (!showThinking) return null;
      return <ReasoningBlock text={part.text} streaming={streaming} />;

    case "tool":
      return <ToolRow part={part} />;

    case "subtask":
      return (
        <SubtaskCard prompt={part.prompt} description={part.description} agent={part.agent} />
      );

    case "step-start":
      // A step boundary carries no information the user acts on.
      return null;

    case "step-finish":
      return <StepMarker label={part.reason} cost={part.cost} />;

    case "agent":
      return (
        <div className="my-1 flex items-center gap-1.5 text-[0.74rem] text-ink-faint">
          <GitBranch size={12} />
          <span className="font-mono">{part.name}</span>
        </div>
      );

    case "retry":
      return (
        <div className="my-2 flex items-center gap-2 rounded-[var(--radius-card)] border border-warn/35 bg-warn/[0.08] px-2.5 py-1.5 text-[0.78rem] text-warn">
          <AlertTriangle size={13} className="shrink-0" />
          <span className="shrink-0">Retrying (attempt {part.attempt})</span>
          <span className="truncate text-warn/75">{part.error?.data?.message ?? part.error?.name}</span>
        </div>
      );

    case "compaction":
      return <StepMarker label={part.auto ? "auto-compacted" : "compacted"} />;

    case "file":
      return (
        <div className="my-1.5 flex items-center gap-2 rounded-[var(--radius-card)] border border-line bg-surface px-2.5 py-1.5 text-[0.78rem] text-ink-muted">
          <FileCode2 size={13} className="shrink-0 text-ink-faint" />
          <span className="truncate">{part.filename ?? part.url}</span>
        </div>
      );

    default:
      return null;
  }
}

export { Clock };
