import {
  AlertTriangle,
  Brain,
  ChevronRight,
  CircleCheck,
  CircleX,
  FileCode2,
  GitBranch,
  Loader2,
  Wrench,
} from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useState, type ReactNode } from "react";
import { Markdown } from "./markdown";
import { cn } from "@/lib/utils";
import { toolTitle, type Part, type ToolPart } from "@/lib/opencode/types";

/** Map a tool name onto a recognisable glyph. */
function toolIcon(tool: string): ReactNode {
  const name = tool.toLowerCase();
  if (name.includes("bash") || name.includes("shell") || name.includes("exec")) return <Wrench size={12} />;
  if (name.includes("read") || name.includes("write") || name.includes("edit") || name.includes("file")) {
    return <FileCode2 size={12} />;
  }
  if (name.includes("grep") || name.includes("glob") || name.includes("find") || name.includes("search")) {
    return <GitBranch size={12} />;
  }
  if (name.includes("web") || name.includes("fetch")) return <Loader2 size={12} />;
  return <Wrench size={12} />;
}

export function ToolRow({ part }: { part: ToolPart }) {
  const [open, setOpen] = useState(false);
  const { state } = part;
  const failed = state.status === "error";
  const active = state.status === "pending" || state.status === "running";

  return (
    <div
      className={cn(
        "my-1 overflow-hidden rounded-[var(--radius-card)] border bg-surface",
        failed ? "border-danger/35" : "border-line",
      )}
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left transition-colors hover:bg-raised"
      >
        <ChevronRight
          size={12}
          className={cn("shrink-0 text-ink-ghost transition-transform duration-150", open && "rotate-90")}
        />
        <span className={cn("shrink-0", failed ? "text-danger" : "text-ink-faint")}>
          {toolIcon(part.tool)}
        </span>
        <span className="shrink-0 font-mono text-[0.72rem] text-ink-muted">{part.tool}</span>
        <span className="min-w-0 flex-1 truncate text-[0.78rem] text-ink-faint">
          {toolTitle(part.tool, state)}
        </span>
        {active && <Loader2 size={12} className="shrink-0 animate-spin text-live" />}
        {state.status === "completed" && <CircleCheck size={12} className="shrink-0 text-good" />}
        {failed && <CircleX size={12} className="shrink-0 text-danger" />}
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
            <div className="border-t border-line px-2.5 py-2">
              <div className="mb-1.5 text-[0.66rem] uppercase tracking-wider text-ink-ghost">Input</div>
              <pre className="scroll-area max-h-48 overflow-auto rounded bg-raised px-2 py-1.5 font-mono text-[0.72rem] text-ink-muted">
                {JSON.stringify(state.input ?? {}, null, 2)}
              </pre>

              {state.status === "error" && (
                <>
                  <div className="mb-1.5 mt-2.5 text-[0.66rem] uppercase tracking-wider text-danger">
                    Error
                  </div>
                  <pre className="scroll-area max-h-48 overflow-auto rounded bg-danger/8 px-2 py-1.5 font-mono text-[0.72rem] text-danger">
                    {state.error}
                  </pre>
                </>
              )}

              {state.status === "completed" && state.output && (
                <>
                  <div className="mb-1.5 mt-2.5 text-[0.66rem] uppercase tracking-wider text-ink-ghost">
                    Output
                  </div>
                  <pre className="scroll-area max-h-64 overflow-auto rounded bg-raised px-2 py-1.5 font-mono text-[0.72rem] text-ink-muted">
                    {state.output}
                  </pre>
                </>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
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
        <ChevronRight
          size={11}
          className={cn("transition-transform duration-150", open && "rotate-90")}
        />
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
            <div className="mt-1 border-l-2 border-line-strong pl-3 text-[0.82rem] whitespace-pre-wrap text-ink-faint">
              {text}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function StepDivider({ label, cost }: { label: string; cost?: number }) {
  return (
    <div className="my-3 flex items-center gap-3 text-[0.66rem] text-ink-ghost">
      <span className="h-px flex-1 bg-line" />
      <span className="uppercase tracking-[0.12em]">{label}</span>
      {typeof cost === "number" && cost > 0 && (
        <span className="tabular font-mono">${cost.toFixed(4)}</span>
      )}
      <span className="h-px flex-1 bg-line" />
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

    case "step-start":
      return <StepDivider label="step" />;

    case "step-finish":
      return <StepDivider label={part.reason} cost={part.cost} />;

    case "agent":
      return (
        <div className="my-1 flex items-center gap-1.5 text-[0.74rem] text-ink-faint">
          <GitBranch size={12} />
          <span className="font-mono">{part.name}</span>
        </div>
      );

    case "retry":
      return (
        <div className="my-2 flex items-center gap-2 rounded-[var(--radius-card)] border border-warn/35 bg-warn/8 px-2.5 py-1.5 text-[0.78rem] text-warn">
          <AlertTriangle size={13} />
          Retrying (attempt {part.attempt})
          <span className="truncate text-warn/75">
            {part.error?.data?.message ?? part.error?.name}
          </span>
        </div>
      );

    case "compaction":
      return <StepDivider label={part.auto ? "auto-compacted" : "compacted"} />;

    case "file":
      return (
        <div className="my-1.5 flex items-center gap-2 rounded-[var(--radius-card)] border border-line bg-surface px-2.5 py-1.5 text-[0.78rem] text-ink-muted">
          <FileCode2 size={13} className="text-ink-faint" />
          {part.filename ?? part.url}
        </div>
      );

    case "subtask":
      return (
        <div className="my-1.5 rounded-[var(--radius-card)] border border-line bg-surface px-2.5 py-1.5">
          <div className="text-[0.72rem] text-ink-faint">{part.description}</div>
        </div>
      );

    default:
      return null;
  }
}
