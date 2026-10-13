import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { ChevronDown, FolderOpen, Plus, Search, Settings2, Trash2 } from "lucide-react";
import { open } from "@tauri-apps/plugin-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Kbd } from "@/components/ui/primitives";
import { projectName, shortenPath } from "@/lib/utils";
import { filterSessions, sortSessions, useSessions } from "@/state/sessions";
import { useProjects } from "@/state/projects";
import { useServer } from "@/state/server";
import { useThreads } from "@/state/threads";
import { OpencodeClient } from "@/lib/opencode/client";

export function Sidebar({ onOpenSettings }: { onOpenSettings(): void }) {
  const sessions = useSessions((s) => s.sessions);
  const query = useSessions((s) => s.query);
  const setQuery = useSessions((s) => s.setQuery);
  const openTab = useSessions((s) => s.openTab);
  const remove = useSessions((s) => s.remove);
  const activeId = useSessions((s) => s.activeId);
  const busyId = useThreads((s) => s.busySessionId);

  const active = useProjects((s) => s.active);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const onDown = (event: MouseEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setMenuOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [menuOpen]);

  const visible = sortSessions(filterSessions(sessions, query));

  return (
    <aside className="flex w-[248px] shrink-0 flex-col border-r border-line bg-canvas">
      {/* Project header */}
      <div className="relative border-b border-line px-2.5 py-2" ref={menuRef}>
        <button
          type="button"
          onClick={() => setMenuOpen((v) => !v)}
          aria-expanded={menuOpen}
          className="flex w-full items-center gap-2 rounded-[7px] px-1.5 py-1 text-left transition-colors hover:bg-raised"
        >
          <FolderOpen size={13} className="shrink-0 text-ink-faint" />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[0.8rem] text-ink">
              {active ? projectName(active) : "No project"}
            </span>
            {active && (
              <span className="block truncate font-mono text-[0.66rem] text-ink-ghost">
                {shortenPath(active)}
              </span>
            )}
          </span>
          <ChevronDown size={12} className="shrink-0 text-ink-ghost" />
        </button>

        <AnimatePresence>
          {menuOpen && (
            <motion.div
              initial={{ opacity: 0, y: -4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={{ duration: 0.14 }}
              className="absolute inset-x-2.5 top-[calc(100%+4px)] z-30 overflow-hidden rounded-[var(--radius-card)] border border-line bg-overlay py-1 shadow-[var(--shadow-panel)]"
            >
              <MenuItem icon={<FolderOpen size={12} />} onClick={pickFolder}>
                Open folder…
              </MenuItem>
              <MenuItem icon={<Settings2 size={12} />} onClick={onOpenSettings}>
                Settings
                <Kbd className="ml-auto">⌘,</Kbd>
              </MenuItem>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Session toolbar */}
      <div className="flex items-center gap-1.5 px-2.5 py-2">
        <div className="relative flex-1">
          <Search
            size={12}
            className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-ink-ghost"
          />
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search sessions"
            className="h-7 pl-7 text-[0.78rem]"
          />
        </div>
        <Button variant="ghost" size="icon-sm" onClick={createSession} aria-label="New session">
          <Plus size={13} />
        </Button>
      </div>

      {/* Session list */}
      <div className="scroll-area flex-1 px-1.5 pb-3">
        {visible.length === 0 ? (
          <p className="px-2 py-6 text-center text-[0.76rem] text-ink-ghost">
            {query ? "No sessions match." : "No sessions yet."}
          </p>
        ) : (
          <ul className="flex flex-col gap-px">
            {visible.map((session) => {
              const selected = session.id === activeId;
              return (
                <li key={session.id}>
                  <div
                    className={cnRow(selected)}
                    onClick={() => openTab(session.id)}
                    onAuxClick={(event) => {
                      if (event.button === 1) remove(session.id);
                    }}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") openTab(session.id);
                    }}
                  >
                    {busyId === session.id ? (
                      <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-live" />
                    ) : (
                      <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-transparent" />
                    )}

                    <span className="min-w-0 flex-1 truncate text-[0.79rem]">
                      {session.title}
                    </span>

                    <span
                      role="button"
                      tabIndex={-1}
                      aria-label="Delete session"
                      onClick={(event) => {
                        event.stopPropagation();
                        remove(session.id);
                      }}
                      className="shrink-0 rounded p-0.5 text-ink-ghost opacity-0 transition-opacity hover:text-danger group-hover:opacity-100"
                    >
                      <Trash2 size={11} />
                    </span>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </aside>
  );
}

function cnRow(selected: boolean) {
  return [
    "group flex cursor-default items-center gap-2 rounded-[6px] px-2 py-1.5 transition-colors duration-150",
    selected ? "bg-raised text-ink" : "text-ink-muted hover:bg-raised/60 hover:text-ink",
  ].join(" ");
}

function MenuItem({
  children,
  icon,
  onClick,
}: {
  children: React.ReactNode;
  icon: React.ReactNode;
  onClick(): void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-[0.79rem] text-ink-muted transition-colors hover:bg-raised hover:text-ink"
    >
      {icon}
      {children}
    </button>
  );
}

async function pickFolder() {
  const selected = await open({ directory: true, multiple: false, title: "Open project folder" });
  if (typeof selected === "string") await useProjects.getState().openProject(selected);
}

async function createSession() {
  const phase = useServer.getState().phase;
  if (phase.kind !== "ready") return;
  const client = new OpencodeClient(phase.info.url);
  const session = await client.createSession();
  useSessions.getState().upsert(session);
  useSessions.getState().openTab(session.id);
}
