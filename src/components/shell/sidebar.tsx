import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import {
  Check,
  ChevronDown,
  FolderOpen,
  FolderPlus,
  GitBranch,
  Pencil,
  Plus,
  Search,
  Settings2,
  Trash2,
} from "lucide-react";
import { open } from "@tauri-apps/plugin-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Kbd } from "@/components/ui/primitives";
import { projectName, shortenPath, cn } from "@/lib/utils";
import type { Session } from "@/lib/opencode/types";
import { filterSessions, sortSessions, useSessions } from "@/state/sessions";
import { useProjects } from "@/state/projects";
import { switchProject } from "@/actions/project";
import {
  createSession as createSessionAction,
  deleteSession,
  forkSession,
  renameSession,
} from "@/actions/sessions";
import { useThreads } from "@/state/threads";

export function Sidebar({ onOpenSettings }: { onOpenSettings(): void }) {
  const sessions = useSessions((s) => s.sessions);
  const query = useSessions((s) => s.query);
  const setQuery = useSessions((s) => s.setQuery);
  const openTab = useSessions((s) => s.openTab);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftTitle, setDraftTitle] = useState("");
  const activeId = useSessions((s) => s.activeId);
  const busyId = useThreads((s) => s.busySessionId);

  const active = useProjects((s) => s.active);
  const recent = useProjects((s) => s.recent);
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
              className="absolute inset-x-2.5 top-[calc(100%+4px)] z-30 max-h-[60vh] overflow-y-auto rounded-[var(--radius-card)] border border-line bg-overlay py-1 shadow-[var(--shadow-panel)]"
            >
              {recent.length > 0 && (
                <>
                  <p className="px-2.5 pb-1 pt-0.5 text-[0.62rem] font-semibold uppercase tracking-[0.13em] text-ink-ghost">
                    Recent
                  </p>
                  {recent.map((path) => (
                    <button
                      key={path}
                      type="button"
                      onClick={() => {
                        setMenuOpen(false);
                        if (path !== active) void switchProject(path);
                      }}
                      className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left transition-colors hover:bg-raised"
                    >
                      <FolderOpen
                        size={12}
                        className={cn("shrink-0", path === active ? "text-accent" : "text-ink-faint")}
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[0.79rem] text-ink">
                          {projectName(path)}
                        </span>
                        <span className="block truncate font-mono text-[0.64rem] text-ink-ghost">
                          {path}
                        </span>
                      </span>
                      {path === active && (
                        <Check size={12} className="shrink-0 text-accent" />
                      )}
                    </button>
                  ))}
                  <div className="my-1 h-px bg-line" />
                </>
              )}

              <MenuItem
                icon={<FolderPlus size={12} />}
                onClick={() => {
                  setMenuOpen(false);
                  void pickFolder();
                }}
              >
                Open folder…
              </MenuItem>
              <MenuItem
                icon={<Settings2 size={12} />}
                onClick={() => {
                  setMenuOpen(false);
                  onOpenSettings();
                }}
              >
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
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={() => void createSessionAction()}
          aria-label="New session"
        >
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
                      // Middle-click deletes, like a browser tab. Destructive, so
                      // it goes through the same confirmed action as the button.
                      if (event.button === 1) void deleteSession(session.id);
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

                    {editingId === session.id ? (
                      <input
                        autoFocus
                        value={draftTitle}
                        onChange={(event) => setDraftTitle(event.target.value)}
                        onClick={(event) => event.stopPropagation()}
                        onBlur={() => setEditingId(null)}
                        onKeyDown={(event) => {
                          if (event.key === "Escape") {
                            event.stopPropagation();
                            setEditingId(null);
                          }
                          if (event.key === "Enter") {
                            event.stopPropagation();
                            const next = draftTitle.trim();
                            setEditingId(null);
                            if (next && next !== session.title) {
                              void renameSession(session.id, next);
                            }
                          }
                        }}
                        className="min-w-0 flex-1 rounded-[4px] border border-accent/60 bg-surface px-1 py-0.5 text-[0.79rem] text-ink outline-none"
                      />
                    ) : (
                      <span className="min-w-0 flex-1 truncate text-[0.79rem]">
                        {listTitle(session)}
                      </span>
                    )}

                    <span className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
                      <RowAction
                        label="Rename session"
                        onClick={(event) => {
                          event.stopPropagation();
                          setDraftTitle(session.title);
                          setEditingId(session.id);
                        }}
                      >
                        <Pencil size={11} />
                      </RowAction>
                      <RowAction
                        label="Fork session"
                        onClick={(event) => {
                          event.stopPropagation();
                          void forkSession(session.id);
                        }}
                      >
                        <GitBranch size={11} />
                      </RowAction>
                      <RowAction
                        label="Delete session"
                        danger
                        onClick={(event) => {
                          event.stopPropagation();
                          void deleteSession(session.id);
                        }}
                      >
                        <Trash2 size={11} />
                      </RowAction>
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

/** opencode seeds new sessions with a timestamp title; hide that noise. */
function listTitle(session: Session): string {
  if (!session.title || session.title.startsWith("New session -")) return "Untitled session";
  return session.title;
}

function RowAction({
  children,
  label,
  onClick,
  danger,
}: {
  children: React.ReactNode;
  label: string;
  onClick(event: React.MouseEvent): void;
  danger?: boolean;
}) {
  return (
    <span
      role="button"
      tabIndex={-1}
      aria-label={label}
      onClick={onClick}
      className={
        danger
          ? "cursor-default rounded p-0.5 text-ink-ghost transition-colors hover:text-danger"
          : "cursor-default rounded p-0.5 text-ink-ghost transition-colors hover:text-ink"
      }
    >
      {children}
    </span>
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
  if (typeof selected !== "string") return;
  // Re-selecting the current folder is a no-op rather than a needless restart.
  if (selected === useProjects.getState().active) return;
  await switchProject(selected);
}


