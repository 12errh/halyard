import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { ChevronDown, FileCode2, FilePlus2, FileX2 } from "lucide-react";
import { formatCounts, parsePatch, type NormalisedDiff } from "@/lib/diff";
import { cn } from "@/lib/utils";

/**
 * Inline unified-diff renderer.
 *
 * Collapsed by default: a single line with the path and counts, expanding to a
 * coloured patch. Long diffs are capped so one huge generated file cannot lock
 * up the webview mid-stream.
 */
export function DiffView({ diff, defaultOpen = false }: { diff: NormalisedDiff; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  const parsed = useMemoPatch(diff.patch);
  const StatusIcon =
    diff.status === "added" ? FilePlus2 : diff.status === "deleted" ? FileX2 : FileCode2;

  return (
    <div className="my-1.5 overflow-hidden rounded-[var(--radius-card)] border border-line bg-surface">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left transition-colors hover:bg-raised"
      >
        <ChevronDown
          size={12}
          className={cn("shrink-0 text-ink-ghost transition-transform duration-150", open && "rotate-180")}
        />
        <StatusIcon size={12} className={cn("shrink-0", diff.status === "deleted" ? "text-danger" : "text-ink-faint")} />
        <span data-selectable className="min-w-0 flex-1 truncate font-mono text-[0.73rem] text-ink-muted">
          {diff.path}
        </span>
        <span className="tabular shrink-0 font-mono text-[0.7rem]">
          <span className="text-good">+{diff.additions}</span>{" "}
          <span className="text-danger">−{diff.deletions}</span>
        </span>
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
            <div className="scroll-area max-h-[420px] overflow-auto border-t border-line py-1 text-[0.74rem] leading-[1.55]">
              {parsed.hunks.length === 0 ? (
                <p className="px-3 py-2 text-[0.74rem] text-ink-ghost">
                  No textual patch — this file is binary or was fully rewritten.
                </p>
              ) : (
                parsed.hunks.map((hunk, hunkIndex) => (
                  <div key={hunkIndex} className="mb-1">
                    <div className="sticky top-0 bg-raised/95 px-3 py-0.5 font-mono text-[0.68rem] text-ink-ghost backdrop-blur">
                      @@ -{hunk.oldStart},{hunk.oldLines} +{hunk.newStart},{hunk.newLines} @@
                      {hunk.header ? ` ${hunk.header}` : ""}
                    </div>
                    {hunk.lines.slice(0, MAX_LINES).map((line, index) => (
                      <div
                        key={index}
                        className={cn(
                          "flex gap-2 px-3",
                          line.kind === "add" && "bg-diff-add",
                          line.kind === "del" && "bg-diff-del",
                        )}
                      >
                        <span className="tabular w-8 shrink-0 select-none text-right text-[0.66rem] text-ink-ghost">
                          {line.newLine ?? ""}
                        </span>
                        <span className="tabular w-8 shrink-0 select-none text-right text-[0.66rem] text-ink-ghost">
                          {line.oldLine ?? ""}
                        </span>
                        <span
                          data-selectable
                          className={cn(
                            "w-3 shrink-0 select-none font-mono",
                            line.kind === "add" && "text-good",
                            line.kind === "del" && "text-danger",
                            line.kind === "context" && "text-ink-ghost",
                          )}
                        >
                          {line.kind === "add" ? "+" : line.kind === "del" ? "−" : " "}
                        </span>
                        <span
                          data-selectable
                          className="min-w-0 flex-1 whitespace-pre-wrap break-all font-mono text-ink-muted"
                        >
                          {line.text || " "}
                        </span>
                      </div>
                    ))}
                    {hunk.lines.length > MAX_LINES && (
                      <p className="px-3 py-1 text-[0.7rem] text-ink-ghost">
                        …{hunk.lines.length - MAX_LINES} more lines
                      </p>
                    )}
                  </div>
                ))
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

const MAX_LINES = 400;

function useMemoPatch(patch: string | undefined) {
  const [parsed, setParsed] = useState(() => parsePatch(patch));
  useEffect(() => setParsed(parsePatch(patch)), [patch]);
  return parsed;
}

/** File-change summary strip: "+12 −3 across 4 files". */
export function DiffSummary({ diffs }: { diffs: NormalisedDiff[] }) {
  const [open, setOpen] = useState(false);
  const additions = diffs.reduce((sum, d) => sum + d.additions, 0);
  const deletions = diffs.reduce((sum, d) => sum + d.deletions, 0);
  if (diffs.length === 0) return null;

  return (
    <div className="my-1.5 overflow-hidden rounded-[var(--radius-card)] border border-line bg-surface">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left transition-colors hover:bg-raised"
      >
        <ChevronDown
          size={12}
          className={cn("shrink-0 text-ink-ghost transition-transform duration-150", open && "rotate-180")}
        />
        <span className="text-[0.78rem] text-ink-muted">
          {diffs.length} file{diffs.length === 1 ? "" : "s"} changed
        </span>
        <span className="tabular font-mono text-[0.7rem]">
          <span className="text-good">+{additions}</span> <span className="text-danger">−{deletions}</span>
        </span>
      </button>

      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
            className="overflow-hidden border-t border-line"
          >
            {diffs.map((diff) => (
              <DiffView key={diff.path} diff={diff} />
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export { formatCounts };

/**
 * A diff that arrived as a raw patch string, with no file wrapper.
 *
 * `edit` and `patch` tools carry their changes as a bare unified diff in the
 * tool metadata rather than through the session diff feed, so it has to be
 * shaped here. The counts come from parsing the patch because there is no
 * envelope carrying them.
 */
export function RawDiff({ patch, path = "" }: { patch: string; path?: string }) {
  const parsed = parsePatch(patch);

  // A patch with no hunk header is not a unified diff; showing it verbatim
  // beats showing an empty file header.
  if (!parsed.hunks.length) {
    return (
      <pre className="scroll-area max-h-64 overflow-auto whitespace-pre-wrap rounded-[5px] bg-raised px-2 py-1.5 font-mono text-[0.71rem] leading-[1.55] text-ink-faint">
        {patch}
      </pre>
    );
  }

  return (
    <DiffView
      defaultOpen
      diff={{
        path,
        status: parsed.additions > 0 && parsed.deletions === 0 ? "added" : "modified",
        additions: parsed.additions,
        deletions: parsed.deletions,
        patch,
      }}
    />
  );
}
