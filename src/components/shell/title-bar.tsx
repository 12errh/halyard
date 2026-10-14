import { GitBranch, PanelLeft, PanelRight, Settings2 } from "lucide-react";
import { LogoLockup } from "@/components/shell/wordmark";
import { changedCount, onDefaultBranch, useProjectInfo } from "@/state/project-info";
import { Button } from "@/components/ui/button";
import { Pulse } from "@/components/ui/primitives";
import { useServer } from "@/state/server";
import { projectName } from "@/lib/utils";

/**
 * Window title bar.
 *
 * Uses the native decorations on Linux but reserves a slim strip for identity
 * and server state, which is the information the TUI used to put in its status
 * line.
 */
export function TitleBar({
  onToggleSidebar,
  onToggleFileTree,
  fileTreeOpen,
  onOpenSettings,
}: {
  onToggleSidebar(): void;
  onToggleFileTree(): void;
  fileTreeOpen: boolean;
  onOpenSettings(): void;
}) {
  const active = useServerProject();

  return (
    <header
      data-tauri-drag-region
      className="flex h-10 shrink-0 items-center gap-2 bg-raised px-2.5"
    >
      <Button
        variant="ghost"
        size="icon-sm"
        onClick={() => onToggleSidebar()}
        aria-label="Toggle sidebar"
      >
        <PanelLeft size={14} />
      </Button>

      <LogoLockup className="h-[15px] w-auto shrink-0 text-ink" />

      {active && (
        <>
          <span className="text-line-strong">/</span>
          <span className="truncate font-mono text-[0.74rem] text-ink-faint">
            {projectName(active)}
          </span>
        </>
      )}

      <BranchIndicator />

      <div className="flex-1" />

      <ServerIndicator />

      <Button
        variant="ghost"
        size="icon-sm"
        onClick={() => onToggleFileTree()}
        aria-label="Toggle file explorer"
        aria-pressed={fileTreeOpen}
        className={fileTreeOpen ? "bg-raised text-ink" : undefined}
      >
        <PanelRight size={14} />
      </Button>

      <Button variant="ghost" size="icon-sm" onClick={onOpenSettings} aria-label="Settings">
        <Settings2 size={14} />
      </Button>
    </header>
  );
}

function ServerIndicator() {
  const phase = useServer((s) => s.phase);

  return (
    <span className="flex items-center gap-1.5 rounded-full border border-line bg-raised px-2 py-0.5 text-[0.68rem] text-ink-faint">
      {phase.kind === "ready" && (
        <>
          <span className="h-1.5 w-1.5 rounded-full bg-good" />
          <span className="tabular font-mono">opencode {phase.info.version}</span>
        </>
      )}
      {phase.kind === "starting" && (
        <>
          <Pulse tone="live" />
          <span>starting…</span>
        </>
      )}
      {phase.kind === "failed" && (
        <>
          <span className="h-1.5 w-1.5 rounded-full bg-danger" />
          <span className="text-danger">offline</span>
        </>
      )}
      {phase.kind === "stopped" && (
        <>
          <span className="h-1.5 w-1.5 rounded-full bg-ink-ghost" />
          <span>stopped</span>
        </>
      )}
    </span>
  );
}

function useServerProject() {
  return useServer((s) =>
    s.phase.kind === "ready" ? s.phase.info.project : null,
  );
}

/**
 * The branch the project is on, and how much the agent has changed on it.
 *
 * Worth the space in the header: "which branch am I about to hand a diff on"
 * is the question that costs the most when the answer is wrong.
 */
function BranchIndicator() {
  const branch = useProjectInfo((s) => s.branch);
  const defaultBranch = useProjectInfo((s) => s.defaultBranch);
  const fileStatus = useProjectInfo((s) => s.fileStatus);
  if (!branch) return null;

  const changed = changedCount(fileStatus);
  const isDefault = onDefaultBranch({ branch, defaultBranch });

  return (
    <span
      className="ml-1 flex items-center gap-1.5 rounded-full border border-line bg-raised/60 px-2 py-0.5"
      title={isDefault ? `On ${branch}` : `On ${branch}, branched from ${defaultBranch}`}
    >
      <GitBranch size={10} className={isDefault ? "text-ink-ghost" : "text-accent"} />
      <span className="max-w-[16ch] truncate font-mono text-[0.68rem] text-ink-faint">
        {branch}
      </span>
      {changed > 0 && (
        <span className="tabular shrink-0 rounded-full bg-accent/15 px-1 text-[0.62rem] text-accent">
          {changed}
        </span>
      )}
    </span>
  );
}
