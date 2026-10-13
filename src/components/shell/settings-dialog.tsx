import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/primitives";
import { SkeletonList } from "@/components/ui/skeleton";
import { OpencodeClient } from "@/lib/opencode/client";
import { cn } from "@/lib/utils";
import { useServer } from "@/state/server";
import { useSettings } from "@/state/settings";
import { useSystem } from "@/state/system";
import {
  AgentsTab,
  AppearanceTab,
  ConfigTab,
  DiagnosticsTab,
  McpTab,
  ModelsTab,
  PermissionsTab,
  ProvidersTab,
} from "./settings-tabs";

export type TabId =
  | "appearance"
  | "providers"
  | "models"
  | "agents"
  | "mcp"
  | "permissions"
  | "config"
  | "lsp";

const TABS: Array<{ id: TabId; label: string }> = [
  { id: "appearance", label: "Appearance" },
  { id: "providers", label: "Providers" },
  { id: "models", label: "Models" },
  { id: "agents", label: "Agents" },
  { id: "mcp", label: "MCP" },
  { id: "permissions", label: "Permissions" },
  { id: "config", label: "Config" },
  { id: "lsp", label: "LSP & Formatters" },
];

export function SettingsDialog({
  open,
  onClose,
  activeProject,
}: {
  open: boolean;
  onClose(): void;
  activeProject: string | null;
}) {
  const [tab, setTab] = useState<TabId>("appearance");
  const phase = useServer((s) => s.phase);
  const setSystemClient = useSystem((s) => s.setClient);
  const loadSystem = useSystem((s) => s.load);
  const loadConfig = useSettings((s) => s.load);

  // One client for the whole dialog, fetched once per server. Previously each
  // tab built its own client and refetched on mount, so switching tabs flashed
  // a spinner over data that was already loaded.
  useEffect(() => {
    if (phase.kind !== "ready") {
      setSystemClient(null);
      return;
    }
    setSystemClient(new OpencodeClient(phase.info.url));
    void loadSystem();
  }, [phase, setSystemClient, loadSystem]);

  // Config file contents only change when the user switches project or scope.
  useEffect(() => {
    if (open) void loadConfig(activeProject);
  }, [open, activeProject, loadConfig]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  return (
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-8" role="dialog" aria-modal="true">
          <motion.button
            type="button"
            aria-label="Close settings"
            onClick={onClose}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="absolute inset-0 cursor-default bg-black/50 backdrop-blur-[2px]"
          />

          <motion.div
            initial={{ opacity: 0, scale: 0.98, y: 6 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.985, y: 4 }}
            transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
            className="relative flex h-[min(700px,86vh)] w-[min(960px,94vw)] flex-col overflow-hidden rounded-[var(--radius-panel)] border border-line-strong bg-surface shadow-[var(--shadow-panel)]"
          >
            <header className="flex items-center justify-between border-b border-line px-4 py-2.5">
              <h2 className="text-[0.9rem] font-medium tracking-tight">Settings</h2>
              <div className="flex items-center gap-2">
                <Badge tone={phase.kind === "ready" ? "good" : phase.kind === "failed" ? "danger" : "neutral"}>
                  {phase.kind === "ready" ? `opencode ${phase.info.version}` : "disconnected"}
                </Badge>
                <Button variant="ghost" size="sm" onClick={() => void loadSystem()} aria-label="Refresh">
                  <RefreshIcon />
                </Button>
                <Button variant="ghost" size="sm" onClick={onClose} aria-label="Close settings">
                  <X size={13} />
                </Button>
              </div>
            </header>

            <div className="flex min-h-0 flex-1">
              <nav className="scroll-area w-[172px] shrink-0 border-r border-line p-2">
                {TABS.map((entry) => (
                  <button
                    key={entry.id}
                    type="button"
                    onClick={() => setTab(entry.id)}
                    className={cn(
                      "mb-px w-full rounded-[6px] px-2 py-1.5 text-left text-[0.8rem] transition-colors",
                      tab === entry.id
                        ? "bg-raised text-ink"
                        : "text-ink-muted hover:bg-raised/60 hover:text-ink",
                    )}
                  >
                    {entry.label}
                  </button>
                ))}
              </nav>

              <div className="scroll-area flex-1 p-5">
                <TabBody tab={tab} />
              </div>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}

function RefreshIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <path d="M21 12a9 9 0 1 1-2.64-6.36" />
      <path d="M21 3v6h-6" />
    </svg>
  );
}

/**
 * Renders the active tab, showing a skeleton only while the very first load is
 * in flight. Once loaded the data is shared, so switching tabs never flashes.
 */
function TabBody({ tab }: { tab: TabId }) {
  const loading = useSystem((s) => s.loading);
  const ready = useSystem((s) => s.providers.length > 0 || s.mcp !== null);

  if (loading && !ready) {
    return (
      <div className="space-y-4">
        <SkeletonList count={2} />
        <SkeletonList count={3} />
      </div>
    );
  }

  switch (tab) {
    case "appearance":
      return <AppearanceTab />;
    case "providers":
      return <ProvidersTab />;
    case "models":
      return <ModelsTab />;
    case "agents":
      return <AgentsTab />;
    case "mcp":
      return <McpTab />;
    case "permissions":
      return <PermissionsTab />;
    case "config":
      return <ConfigTab />;
    case "lsp":
      return <DiagnosticsTab />;
  }
}