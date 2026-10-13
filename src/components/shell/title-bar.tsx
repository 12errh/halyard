import { PanelLeft, Settings2, Sparkles } from "lucide-react";
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
  onOpenSettings,
}: {
  onToggleSidebar(): void;
  onOpenSettings(): void;
}) {
  const active = useServerProject();

  return (
    <header
      data-tauri-drag-region
      className="flex h-10 shrink-0 items-center gap-2 border-b border-line bg-canvas px-2.5"
    >
      <Button
        variant="ghost"
        size="icon-sm"
        onClick={onToggleSidebar}
        aria-label="Toggle sidebar"
      >
        <PanelLeft size={14} />
      </Button>

      <div className="flex items-center gap-1.5">
        <Sparkles size={12} className="text-accent" />
        <span className="text-[0.8rem] font-medium tracking-tight text-ink">Halyard</span>
      </div>

      {active && (
        <>
          <span className="text-line-strong">/</span>
          <span className="truncate font-mono text-[0.74rem] text-ink-faint">
            {projectName(active)}
          </span>
        </>
      )}

      <div className="flex-1" />

      <ServerIndicator />

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
