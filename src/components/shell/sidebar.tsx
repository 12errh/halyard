import { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import {
  Check,
  ChevronDown,
  ChevronRight,
  Download,
  FolderOpen,
  FolderPlus,
  GitBranch,
  Pencil,
  Plus,
  Search,
  Settings2,
  Sparkles,
  Trash2,
  Upload,
} from "lucide-react";
import { open } from "@tauri-apps/plugin-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Kbd } from "@/components/ui/primitives";
import { projectName, shortenPath, cn } from "@/lib/utils";
import type { Session } from "@/lib/opencode/types";
import {
  childLabel,
  filterSessions,
  sortSessions,
  useSessions,
} from "@/state/sessions";
import { useProjects } from "@/state/projects";
import { switchProject } from "@/actions/project";
import { exportSession as exportSessionFile, importSession as importSessionFile } from "@/actions/transfer";
import {
  createSession as createSessionAction,
  deleteSession,
  forkSession,
  loadChildSessions,
  renameSession,
} from "@/actions/sessions";
import { useServer } from "@/state/server";
import { useSessionOrg } from "@/state/session-org";
import { OpencodeClient } from "@/lib/opencode/client";
import { Archive, MoreHorizontal, Pin, Share2 } from "lucide-react";
import { useThreads } from "@/state/threads";

/** A stable identity for "nothing pinned here", so selectors stay referentially equal. */
const EMPTY_IDS: string[] = [];

export function Sidebar({ onOpenSettings }: { onOpenSettings(): void }) {
  const sessions = useSessions((s) => s.sessions);
  const query = useSessions((s) => s.query);
  const setQuery = useSessions((s) => s.setQuery);
  const openTab = useSessions((s) => s.openTab);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftTitle, setDraftTitle] = useState("");
  const children = useSessions((s) => s.children);
  const expandedParents = useSessions((s) => s.expandedParents);
  const toggleParent = useSessions((s) => s.toggleParent);
  // Roots come from `sessions`; subagent runs are fetched lazily per parent so
  // opening the app never walks every delegated task up front.
  const activeId = useSessions((s) => s.activeId);
  const busyId = useThreads((s) => s.busySessionId);
  const active = useProjects((s) => s.active);
  const [notice, setNotice] = useState<string | null>(null);
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  // Select the whole map, then derive the per-project list.
  //
  // Selecting `(s.pinned[active] ?? [])` would build a fresh array on every
  // read, and Zustand compares snapshots by identity — so the component would
  // re-render forever. It bites hardest in the common case, where a project
  // has no pins yet and the fallback `[]` is a new object each time.
  const pinnedMap = useSessionOrg((s) => s.pinned);
  const archivedMap = useSessionOrg((s) => s.archived);
  const unseenMap = useSessionOrg((s) => s.unseen);
  const pinnedIds = useMemo(() => (active ? pinnedMap[active] ?? EMPTY_IDS : EMPTY_IDS), [active, pinnedMap]);
  const archivedIds = useMemo(() => (active ? archivedMap[active] ?? EMPTY_IDS : EMPTY_IDS), [active, archivedMap]);
  const unseenIds = useMemo(() => (active ? unseenMap[active] ?? EMPTY_IDS : EMPTY_IDS), [active, unseenMap]);
  const isPinned = (id: string) => pinnedIds.includes(id);
  const isArchived = (id: string) => archivedIds.includes(id);

  const handleExport = async (sessionId: string) => {
    const session = useSessions.getState().sessions.find((s) => s.id === sessionId);
    const result = await exportSessionFile(sessionId, session?.title ?? "");
    setNotice(result.message);
  };

  const handleImport = async () => {
    const result = await importSessionFile();
    if (result.ok) {
      // The importer writes into opencode's store; re-read the list.
      const client = useServer.getState().phase;
      if (client.kind === "ready") {
        const { OpencodeClient } = await import("@/lib/opencode/client");
        const fresh = await new OpencodeClient(client.info.url).listSessions().catch(() => []);
        useSessions.getState().setSessions(fresh);
      }
    }
    setNotice(result.ok ? result.message : null);
  };
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

  const searched = sortSessions(filterSessions(sessions, query));
  // Searching is an explicit request to see everything, archived included —
  // otherwise a search for a title you archived last month returns nothing and
  // looks like the session was lost.
  // Read through `getState` rather than a subscribed handle: `arrange` is a
  // pure derivation from state this component already subscribes to, and
  // subscribing to the whole store as well would re-render it on every
  // unrelated change — including the ones this very render performs.
  const arranged = useSessionOrg.getState().arrange(active ?? "", searched);
  const visible = query
    ? searched
    : [...arranged.pinned, ...arranged.recent, ...arranged.archived];
  const nextRecent = arranged.recent[0]?.id ?? arranged.pinned[0]?.id ?? null;
  const upsertSession = useSessions((s) => s.upsert);


  const handleShare = async (session: Session) => {
    const phase = useServer.getState().phase;
    if (phase.kind !== "ready") return;
    try {
      const next = session.slug
        ? session
        : await new OpencodeClient(phase.info.url).share(session.id);
      upsertSession(next);
      const url = `${window.location.origin}/s/${next.slug}`;
      await navigator.clipboard.writeText(url);
      setNotice(`Share link copied for "${next.title}"`);
    } catch {
      setNotice("Could not share that session");
    }
  };

  return (
    <aside className="flex w-[280px] shrink-0 flex-col border-r border-line bg-canvas">
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
              {/* Import and export belong to the project, not beside the search
                  field: they act on a whole session rather than the list. */}
              <MenuItem
                icon={<Upload size={12} />}
                onClick={() => {
                  setMenuOpen(false);
                  void handleImport();
                }}
              >
                Import session…
              </MenuItem>
              <MenuItem
                icon={<Download size={12} />}
                disabled={!activeId}
                onClick={() => {
                  setMenuOpen(false);
                  if (activeId) void handleExport(activeId);
                }}
              >
                Export current session
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

      {/* Search and one primary action. Import and export moved into the
          project menu and the row menu, where they are contextual rather than
          sitting permanently beside the search field. */}
      <div className="flex items-center gap-1.5 px-2.5 pb-1.5 pt-1">
        <div className="relative min-w-0 flex-1">
          <Search
            size={12}
            className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-ghost"
          />
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search"
            aria-label="Search sessions"
            className="h-7 pl-7 text-[0.78rem]"
          />
        </div>
        <Button
          variant="secondary"
          size="sm"
          onClick={() => void createSessionAction()}
          aria-label="New session"
          title="New session"
          className="h-7 shrink-0 gap-1 px-2 text-[0.76rem]"
        >
          <Plus size={12} />
          New
        </Button>
      </div>

      {notice && (
        <p className="mx-2.5 mb-1 rounded-[6px] border border-line bg-raised px-2 py-1 text-[0.7rem] text-ink-muted">
          {notice}
        </p>
      )}

      {/* Session list.
          `min-h-0` is what makes this scroll rather than push the window: a
          flex child defaults to `min-height: auto`, so it refuses to shrink
          below its content and the sidebar grows until the page scrolls. */}
      <div className="scroll-area min-h-0 flex-1 overflow-y-auto overscroll-contain px-1.5 pb-3">
        {visible.length === 0 ? (
          <p className="px-2 py-6 text-center text-[0.76rem] text-ink-ghost">
            {query ? "No sessions match." : "No sessions yet."}
          </p>
        ) : (
          <ul className="flex flex-col gap-px">
            {([
              ...(arranged.pinned.length && !query
                ? [{ label: "Pinned", items: arranged.pinned }] : []),
              ...(arranged.recent.length && !query
                ? [
                    {
                      // Only label the middle group when something separates
                      // it; a bare "Recent" above an unpartitioned list is a
                      // heading for nothing.
                      label: arranged.pinned.length || arranged.archived.length ? "Recent" : null,
                      items: arranged.recent,
                    },
                  ]
                : []),
              ...(arranged.archived.length && !query
                ? [{ label: "Archived", items: arranged.archived }] : []),
              ...(query ? [{ label: null, items: searched }] : []),
            ] as Array<{ label: string | null; items: typeof searched }>).map((group) => (
              <SectionGroup key={group.label ?? "recent"} label={group.label} count={group.items.length}>
              {group.items.map((session) => {
              const selected = session.id === activeId;
              return (
                <li key={session.id}>
                  <div
                    className={cn(cnRow(selected), "group/session relative")}
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
                    {/* Status first, and only when there is status to show.
                        An always-present chevron and an invisible dot put two
                        columns of empty space down every row, which is most of
                        why eighteen sessions looked like eighteen identical
                        strips. */}
                    {busyId === session.id ? (
                      <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-live" />
                    ) : unseenIds.includes(session.id) && session.id !== activeId ? (
                      <span title="Unread" className="h-1.5 w-1.5 shrink-0 rounded-full bg-accent" />
                    ) : null}


                    {/* The expander appears only once the row actually has
                        subagents to reveal, rather than on every session in
                        the list. */}
                    {(expandedParents[session.id] || (children[session.id]?.length ?? 0) > 0) && (
                      <button
                        type="button"
                        aria-label={expandedParents[session.id] ? "Hide subagents" : "Show subagents"}
                        onClick={(event) => {
                          event.stopPropagation();
                          toggleParent(session.id);
                          void loadChildSessions(session.id);
                        }}
                        className="-ml-0.5 shrink-0 rounded p-0.5 text-ink-ghost transition-colors hover:text-ink"
                      >
                        <ChevronRight
                          size={11}
                          className={cn(
                            "transition-transform duration-150",
                            expandedParents[session.id] && "rotate-90",
                          )}
                        />
                      </button>
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

                    {/* How old, in the quietest way that still answers the
                        question. */}
                    <span className="shrink-0 tabular text-[0.64rem] text-ink-ghost/80 transition-opacity duration-120 group-hover/session:opacity-0">
                      {relativeTime(session.time?.updated ?? session.time?.created)}
                    </span>

                    {/* One menu, not seven buttons. Even overlaid, a strip of
                        icons crowding the right of every row is what made this
                        read as a toolbar rather than a list of conversations. */}
                    <span
                      className={cn(
                        "absolute right-1.5 top-1/2 -translate-y-1/2 transition-opacity duration-120",
                        // Open must win over hover: the menu is triggered from
                        // the keyboard and by click, and in both cases the
                        // pointer may not be over the row. Leaving it on
                        // hover alone would make the menu open invisibly.
                        openMenuId === session.id
                          ? "pointer-events-auto opacity-100"
                          : "pointer-events-none opacity-0 group-hover/session:pointer-events-auto group-hover/session:opacity-100 focus-within:pointer-events-auto focus-within:opacity-100",
                        // The menu has to out-paint the rows below it, and
                        // z-index on the menu alone is not enough: this
                        // wrapper is `position: absolute` with `z-index:
                        // auto`, which does not establish a stacking context,
                        // so the menu's own z-40 competes against ancestors
                        // it cannot see. Raising the wrapper puts the pair
                        // above the following rows.
                        openMenuId === session.id && "z-50",
                      )}
                    >
                      <RowMenu
                        open={openMenuId === session.id}
                        onOpenChange={(next) => setOpenMenuId(next ? session.id : null)}
                        items={[
                          {
                            id: "rename",
                            label: "Rename",
                            icon: <Pencil size={11} />,
                            run: () => {
                              setDraftTitle(session.title);
                              setEditingId(session.id);
                            },
                          },
                          {
                            id: "pin",
                            label: isPinned(session.id) ? "Unpin" : "Pin to top",
                            icon: (
                              <Pin size={11} className={isPinned(session.id) ? "fill-current" : ""} />
                            ),
                            run: () => {
                              if (active) useSessionOrg.getState().togglePin(active, session.id);
                            },
                          },
                          {
                            id: "archive",
                            label: isArchived(session.id) ? "Unarchive" : "Archive",
                            icon: <Archive size={11} />,
                            run: () => {
                              if (!active) return;
                              useSessionOrg.getState().toggleArchive(active, session.id);
                              if (isArchived(session.id) && activeId === session.id && nextRecent) {
                                openTab(nextRecent);
                              }
                            },
                          },
                          {
                            id: "subagents",
                            label: expandedParents[session.id] ? "Hide subagents" : "Show subagents",
                            icon: <ChevronRight size={11} />,
                            run: () => {
                              toggleParent(session.id);
                              void loadChildSessions(session.id);
                            },
                          },
                          {
                            id: "fork",
                            label: "Fork",
                            icon: <GitBranch size={11} />,
                            run: () => void forkSession(session.id),
                          },
                          {
                            id: "share",
                            label: session.slug ? "Copy share link" : "Share",
                            icon: <Share2 size={11} />,
                            run: () => void handleShare(session),
                          },
                          {
                            id: "export",
                            label: "Export",
                            icon: <Download size={11} />,
                            run: () => void handleExport(session.id),
                          },
                          { id: "sep-1", separator: true },
                          {
                            id: "delete",
                            label: "Delete",
                            icon: <Trash2 size={11} />,
                            danger: true,
                            run: () => void deleteSession(session.id),
                          },
                        ]}
                      />
                    </span>
                  </div>

                  <AnimatePresence initial={false}>
                    {expandedParents[session.id] && (
                      <motion.ul
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: "auto", opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
                        className="overflow-hidden"
                      >
                        {(children[session.id] ?? []).length === 0 ? (
                          <li className="py-1 pl-7 text-[0.72rem] text-ink-ghost">
                            No subagent runs
                          </li>
                        ) : (
                          (children[session.id] ?? []).map((child) => (
                            <li key={child.id}>
                              <div
                                role="button"
                                tabIndex={0}
                                onClick={() => openTab(child.id)}
                                onKeyDown={(event) => {
                                  if (event.key === "Enter") openTab(child.id);
                                }}
                                title={childLabel(child)}
                                className="flex cursor-default items-center gap-1.5 rounded-[6px] py-1 pl-7 pr-2 text-left transition-colors hover:bg-raised/60"
                              >
                                <Sparkles size={10} className="shrink-0 text-accent/70" />
                                <span
                                  className={cn(
                                    "min-w-0 flex-1 truncate text-[0.74rem]",
                                    selected === false ? "text-ink-faint" : "text-ink-muted",
                                  )}
                                >
                                  {childLabel(child)}
                                </span>
                                <span className="shrink-0 rounded-full border border-accent/25 px-1 py-px text-[0.56rem] uppercase tracking-wider text-accent/80">
                                  agent
                                </span>
                              </div>
                            </li>
                          ))
                        )}
                      </motion.ul>
                    )}
                  </AnimatePresence>
                </li>
              );
            })}
              </SectionGroup>
            ))}
          </ul>
        )}
      </div>
    </aside>
  );
}

/** A titled run of session rows: pinned, recent, archived. */
function SectionGroup({
  label,
  count,
  children,
}: {
  label: string | null;
  count: number;
  children: React.ReactNode;
}) {
  if (!label) return <>{children}</>;
  return (
    <>
      <li className="flex items-center gap-2 px-2.5 pb-1 pt-4 first:pt-1" role="presentation">
        <span className="text-[0.62rem] font-semibold uppercase tracking-[0.12em] text-ink-ghost">
          {label}
        </span>
        <span className="text-[0.62rem] text-ink-ghost/70">{count}</span>
      </li>
      {children}
    </>
  );
}

/**
 * A compact age. Anything older than a week falls back to a date, because
 * "43d" stops meaning anything and a wrong recency is worse than none.
 */
export function relativeTime(stamp: number | undefined): string {
  if (!stamp) return "";
  const seconds = Math.max(0, (Date.now() - stamp) / 1000);
  if (seconds < 60) return "now";
  const minutes = seconds / 60;
  if (minutes < 60) return `${Math.floor(minutes)}m`;
  const hours = minutes / 60;
  if (hours < 24) return `${Math.floor(hours)}h`;
  const days = hours / 24;
  if (days < 7) return `${Math.floor(days)}d`;
  return new Date(stamp).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/** opencode seeds new sessions with a timestamp title; hide that noise. */
function listTitle(session: Session): string {
  if (!session.title || session.title.startsWith("New session -")) return "Untitled session";
  return session.title;
}

export interface RowMenuItem {
  id: string;
  label?: string;
  icon?: React.ReactNode;
  danger?: boolean;
  separator?: boolean;
  run?(): void;
}

/**
 * The overflow menu for a session row.
 *
 * Closes on outside click, on Escape, and after a choice — the three things a
 * person tries without being told. Rendered inline rather than portalled so it
 * cannot escape the sidebar's stacking context.
 */
function RowMenu({
  items,
  open,
  onOpenChange,
}: {
  items: RowMenuItem[];
  open: boolean;
  onOpenChange(next: boolean): void;
}) {
  const setOpen = onOpenChange;
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (event: MouseEvent) => {
      if (!ref.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        aria-label="Session actions"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={(event) => {
          event.stopPropagation();
          setOpen(!open);
        }}
        onDoubleClick={(event) => event.stopPropagation()}
        className={cn(
          // The hit area grows leftwards only, staying inside the row.
          //
          // Growing it outwards would be worse than no change: the button only
          // stays visible while the row is hovered, so a target that poked past
          // the row's edge would be reached by leaving the row — at which point
          // the button vanished and the click landed on nothing. This way you
          // can come at it from anywhere in its neighbourhood.
          "relative flex h-[26px] w-[26px] items-center justify-center rounded-[5px] text-ink-ghost transition-colors",
          "after:absolute after:bottom-0 after:left-[-10px] after:right-0 after:top-0 after:content-['']",
          open ? "bg-raised text-ink" : "hover:bg-raised hover:text-ink",
        )}
      >
        <MoreHorizontal size={13} />
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            role="menu"
            initial={{ opacity: 0, y: -3, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -3, scale: 0.98 }}
            transition={{ duration: 0.12 }}
            onClick={(event) => event.stopPropagation()}
            className="absolute right-0 top-full z-40 mt-1 w-[178px] overflow-hidden rounded-[7px] border border-line bg-overlay py-1 shadow-[var(--shadow-panel)]"
          >
            {items.map((item) =>
              item.separator ? (
                <div key={item.id} className="my-1 h-px bg-line" />
              ) : (
                <button
                  key={item.id}
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setOpen(false);
                    item.run?.();
                  }}
                  className={cn(
                    "flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-[0.78rem] transition-colors",
                    item.danger
                      ? "text-danger hover:bg-danger/10"
                      : "text-ink-muted hover:bg-raised hover:text-ink",
                  )}
                >
                  <span className="shrink-0 text-ink-ghost">{item.icon}</span>
                  {item.label}
                </button>
              ),
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function cnRow(selected: boolean) {
  return [
    "group/session group flex cursor-default items-center gap-2 rounded-[7px] py-[6px] pl-2.5 pr-1.5 transition-colors duration-150",
    selected ? "bg-raised text-ink" : "text-ink-muted hover:bg-raised/60 hover:text-ink",
  ].join(" ");
}

function MenuItem({
  children,
  icon,
  onClick,
  disabled = false,
}: {
  children: React.ReactNode;
  icon: React.ReactNode;
  onClick(): void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-[0.79rem] transition-colors",
        disabled
          ? "cursor-not-allowed text-ink-ghost"
          : "text-ink-muted hover:bg-raised hover:text-ink",
      )}
    >
      <span className="shrink-0">{icon}</span>
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


