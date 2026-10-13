import {
  AlertTriangle,
  Brain,
  ChevronRight,
  CircleCheck,
  CircleX,
  Clock,
  FileCode2,
  GitBranch,
  Loader2,
  Sparkles,
  Terminal,
  Wrench,
} from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useState, type ReactNode } from "react";
import { Markdown } from "./markdown";
import { cn } from "@/lib/utils";
import { toolTitle, type Part, type ToolPart, type ToolState } from "@/lib/opencode/types";

/** Map a tool name onto a recognisable glyph. */
function toolIcon(tool: string): ReactNode {
  const name = tool.toLowerCase();
  if (name.includes("bash") || name.includes("shell") || name.includes("exec") || name.includes("run"))
    return <Terminal size={12} />;
  if (name.includes("task") || name.includes("agent")) return <Sparkles size={12} />;
  if (name.includes("read") || name.includes("write") || name.includes("edit") || name.includes("file"))
    return <FileCode2 size={12} />;
  if (name.includes("grep") || name.includes("glob") || name.includes("find") || name.includes("search"))
    return <GitBranch size={12} />;
  return <Wrench size={12} />;
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
 * One tool call, collapsed.
 *
 * Reads as a single quiet line rather than a log entry: status is carried by a
 * leading rule and a colour, not by a wall of text. Everything else is one
 * click away.
 */
export function ToolRow({ part }: { part: ToolPart }) {
  const [open, setOpen] = useState(false);
  const { state } = part;
  const failed = state.status === "error";
  const active = state.status === "pending" || state.status === "running";
  const elapsed = duration(state);

  return (
    <div
      className={cn(
        "group/tool my-1 overflow-hidden rounded-[var(--radius-card)] border bg-surface/70 transition-colors",
        failed ? "border-danger/30" : "border-line/80 hover:border-line",
      )}
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center gap-2 py-1.5 pl-2 pr-2 text-left"
      >
        <span
          className={cn(
            "h-3.5 w-[2px] shrink-0 rounded-full transition-colors",
            active ? "bg-live" : failed ? "bg-danger" : "bg-good/70",
          )}
        />

        <span className={cn("shrink-0", active ? "text-live" : failed ? "text-danger" : "text-ink-faint")}>
          {toolIcon(part.tool)}
        </span>

        <span className="shrink-0 text-[0.78rem] font-medium text-ink-muted">{part.tool}</span>

        <span data-selectable className="min-w-0 flex-1 truncate font-mono text-[0.73rem] text-ink-faint">
          {toolTitle(part.tool, state)}
        </span>

        {elapsed && (
          <span className="tabular hidden shrink-0 items-center gap-1 font-mono text-[0.68rem] text-ink-ghost sm:flex">
            <Clock size={9} />
            {elapsed}
          </span>
        )}

        {active && <Loader2 size={12} className="shrink-0 animate-spin text-live" />}
        {state.status === "completed" && !active && <CircleCheck size={12} className="shrink-0 text-good/80" />}
        {failed && <CircleX size={12} className="shrink-0 text-danger" />}

        <ChevronRight
          size={12}
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
            <div className="space-y-2 border-t border-line/70 px-2.5 py-2">
              <Block label="Input">
                <pre className="scroll-area max-h-48 overflow-auto rounded-[5px] bg-raised px-2 py-1.5 font-mono text-[0.71rem] leading-[1.55] text-ink-faint">
                  {JSON.stringify(state.input ?? {}, null, 2)}
                </pre>
              </Block>

              {state.status === "error" && (
                <Block label="Error" tone="danger">
                  <pre className="scroll-area max-h-48 overflow-auto whitespace-pre-wrap rounded-[5px] bg-danger/[0.08] px-2 py-1.5 font-mono text-[0.71rem] leading-[1.55] text-danger">
                    {state.error}
                  </pre>
                </Block>
              )}

              {state.status === "completed" && state.output && (
                <Block label="Output">
                  <pre className="scroll-area max-h-72 overflow-auto whitespace-pre-wrap rounded-[5px] bg-raised px-2 py-1.5 font-mono text-[0.71rem] leading-[1.55] text-ink-muted">
                    {state.output}
                  </pre>
                </Block>
              )}
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
  switch (part.type) {
    case "text":
      return part.text.trim() ? (
        <div data-selectable>
          <Markdown streaming={streaming}>{part.text}</Markdown>
        </div>
      ) : null;

    case "reasoning":
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
