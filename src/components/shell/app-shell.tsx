import { useCallback, useEffect, useMemo, useRef } from "react";
import { AnimatePresence, motion } from "motion/react";
import { open } from "@tauri-apps/plugin-dialog";
import { FolderOpen } from "lucide-react";
import { Button } from "@/components/ui/button";
import { CommandPalette, type Command } from "@/components/command/command-palette";
import { Composer, type ComposerSubmit } from "@/components/chat/composer";
import { MessageThread } from "@/components/chat/message-thread";
import { StatusBar } from "@/components/chat/status-bar";
import { preloadHighlighter } from "@/components/chat/highlight";
import { SessionTabs } from "@/components/shell/session-tabs";
import { Sidebar } from "@/components/shell/sidebar";
import { TitleBar } from "@/components/shell/title-bar";
import { FileTree } from "@/components/shell/file-tree";
import { EmptyState } from "./empty-state";
import { SettingsDialog } from "./settings-dialog";
import { OpencodeClient } from "@/lib/opencode/client";
import { toFileParts } from "@/lib/attachments";
import { normaliseDiff } from "@/lib/diff";
import type { MessageEntry } from "@/lib/opencode/thread";
import { useProjects } from "@/state/projects";
import { useServer } from "@/state/server";
import { useSessions } from "@/state/sessions";
import { useThreads } from "@/state/threads";
import { useUi } from "@/state/ui";
import { pendingFor, usePermissions } from "@/state/permissions";
import { switchProject } from "@/actions/project";
import type { PermissionReply, PendingPermission, SessionStatus } from "@/lib/opencode/types";

export function AppShell() {
  const phase = useServer((s) => s.phase);
  const activeProject = useProjects((s) => s.active);
  const hydrate = useProjects((s) => s.hydrate);
  const binaryOverride = useProjects((s) => s.binaryOverride);
  const start = useServer((s) => s.start);
  const attach = useServer((s) => s.attach);
  const connect = useThreads((s) => s.connect);
  const load = useThreads((s) => s.load);

  const sidebarOpen = useUi((s) => s.sidebarOpen);
  const toggleSidebar = useUi((s) => s.toggleSidebar);
  const fileTreeOpen = useUi((s) => s.fileTreeOpen);
  const toggleFileTree = useUi((s) => s.toggleFileTree);
  const settingsOpen = useUi((s) => s.settingsOpen);
  const setSettingsOpen = useUi((s) => s.setSettingsOpen);
  const paletteOpen = useUi((s) => s.paletteOpen);
  const togglePalette = useUi((s) => s.togglePalette);

  const activeId = useSessions((s) => s.activeId);
  const sessions = useSessions((s) => s.sessions);
  const setSessions = useSessions((s) => s.setSessions);
  const upsert = useSessions((s) => s.upsert);
  const openTab = useSessions((s) => s.openTab);
  const closeTab = useSessions((s) => s.closeTab);
  const stepTab = useSessions((s) => s.stepTab);

  const thread = useThreads((s) => (activeId ? s.threads[activeId] : undefined));
  const busyId = useThreads((s) => s.busySessionId);

  const permissions = usePermissions((s) => s.bySession);
  const ingestPermission = usePermissions((s) => s.ingest);
  const syncPermissions = usePermissions((s) => s.sync);
  const resolvePermission = usePermissions((s) => s.resolve);

  const client = useMemo(
    () => (phase.kind === "ready" ? new OpencodeClient(phase.info.url) : null),
    [phase],
  );

  // --- Bootstrap -----------------------------------------------------------
  useEffect(() => {
    void hydrate();
    void attach();
    preloadHighlighter();
  }, [hydrate, attach]);

  // Start the server once we know whether a project was remembered.
  //
  // This must depend on the hydrated values, not just on `start`: `hydrate()`
  // resolves asynchronously, so an effect keyed only on `start` runs once on
  // mount (before settings arrive) and never again — leaving a remembered
  // project with no server, forever.
  const projectsLoaded = useProjects((s) => s.loaded);
  const bootstrapped = useRef(false);

  useEffect(() => {
    if (bootstrapped.current || !projectsLoaded) return;
    bootstrapped.current = true;
    if (activeProject) void start(activeProject, binaryOverride);
  }, [projectsLoaded, activeProject, binaryOverride, start]);

  // Bind the event stream to the live server.
  useEffect(() => {
    if (phase.kind !== "ready") return;
    // One subscription, fanned out: the thread reducer owns messages, the
    // permission store owns prompts. A second connection would double every
    // event and race on reconnect.
    connect(client!.eventsUrl(), ingestPermission);

    // The per-session hydration cache is scoped to a project; a new server means
    // a new project and every session needs reloading.
    loadedFor.current = new Set<string>();

    void (async () => {
      const [all, statuses] = await Promise.all([
        client!.listSessions().catch(() => []),
        client!.status().catch(() => ({})),
      ]);
      setSessions(all);
      for (const [sessionID, status] of Object.entries(statuses)) {
        if (status.type !== "busy") continue;
        useThreads.setState({ busySessionId: sessionID });
      }

      // Open something on arrival. Without this the composer renders disabled
      // (there is no active session) and the app looks broken until the user
      // goes and creates a session by hand.
      const first = useSessions.getState();
      if (!first.activeId) {
        const mostRecent = [...all].sort(
          (a, b) => (b.time?.updated ?? b.time?.created ?? 0) - (a.time?.updated ?? a.time?.created ?? 0),
        )[0];
        if (mostRecent) first.openTab(mostRecent.id);
      }
    })();

    return () => useThreads.getState().disconnect();
  }, [phase, client, connect, setSessions, ingestPermission]);

  // Hydrate a thread the first time its tab becomes active.
  const loadedFor = useRef(new Set<string>());
  useEffect(() => {
    if (!activeId || !client) return;
    if (loadedFor.current.has(activeId)) return;
    loadedFor.current.add(activeId);
    void (async () => {
      const entries = await client.messages(activeId).catch(() => []);
      load(activeId, entries);
      // Permissions asked before this tab was opened still need showing.
      const pending = await client.listPermissions(activeId).catch(() => []);
      if (pending.length > 0) syncPermissions(activeId, pending);
    })();
  }, [activeId, client, load, syncPermissions]);

  // --- Actions -------------------------------------------------------------

  const send = useCallback(
    async ({ text, attachments }: ComposerSubmit) => {
      if (!client) return;
      try {
        // Typing before any session exists is the common first-run path, so the
        // first prompt creates the session rather than being swallowed.
        let target = activeId;
        if (!target) {
          const created = await client.createSession();
          upsert(created);
          openTab(created.id);
          target = created.id;
        }
        await client.sendPrompt(target, {
          parts: [
            ...(text ? [{ type: "text" as const, text }] : []),
            ...toFileParts(attachments),
          ],
        });
      } catch (error) {
        console.error("prompt failed", error);
      }
    },
    [client, activeId, upsert, openTab],
  );

  const abort = useCallback(() => {
    if (client && activeId) void client.abort(activeId).catch(() => undefined);
  }, [client, activeId]);

  const replyPermission = useCallback(
    async (permission: PendingPermission, reply: PermissionReply) => {
      if (!client) throw new Error("not connected to opencode");
      await client.replyPermission(permission.sessionID, permission, reply);
      resolvePermission(permission.sessionID, permission.id);
    },
    [client, resolvePermission],
  );

  /** Rewind to just before `messageID`, then send the replacement. */
  const editAndResend = useCallback(
    async (messageID: string, text: string) => {
      if (!client || !activeId) return;
      await client.revert(activeId, messageID);
      await client.sendPrompt(activeId, { parts: [{ type: "text", text }] });
    },
    [client, activeId],
  );

  const pickFolder = useCallback(async () => {
    const selected = await open({ directory: true, multiple: false, title: "Open project folder" });
    if (typeof selected !== "string") return;
    if (selected === activeProject) return;
    await switchProject(selected);
  }, [activeProject]);

  const newSession = useCallback(async () => {
    if (!client) return;
    const session = await client.createSession();
    upsert(session);
    openTab(session.id);
  }, [client, upsert, openTab]);

  // --- Commands ------------------------------------------------------------

  const commands = useMemo<Command[]>(() => {
    const mod = navigator.platform.includes("Mac") ? "⌘" : "Ctrl";
    const list: Command[] = [
      { id: "new-session", label: "New session", group: "Session", hint: `${mod}N`, run: () => void newSession() },
      { id: "close-tab", label: "Close current tab", group: "Session", hint: `${mod}W`, run: () => activeId && closeTab(activeId) },
      { id: "next-tab", label: "Next tab", group: "Session", hint: "Ctrl Tab", run: () => stepTab(1) },
      { id: "prev-tab", label: "Previous tab", group: "Session", hint: "Ctrl Shift Tab", run: () => stepTab(-1) },
      { id: "open-project", label: "Open folder…", group: "Project", run: () => void pickFolder() },
      { id: "toggle-sidebar", label: "Toggle sidebar", group: "View", hint: `${mod}B`, run: () => toggleSidebar() },
      { id: "toggle-files", label: "Toggle file explorer", group: "View", hint: `${mod}E`, run: () => toggleFileTree() },
      { id: "settings", label: "Open settings", group: "App", hint: `${mod},`, run: () => setSettingsOpen(true) },
      { id: "palette", label: "Show all commands", group: "App", hint: `${mod}K`, run: () => togglePalette(true) },
    ];
    for (const session of sessions.slice(0, 25)) {
      list.push({
        id: `session:${session.id}`,
        label: session.title,
        group: "Go to session",
        keywords: session.id,
        run: () => openTab(session.id),
      });
    }
    return list;
  }, [newSession, closeTab, activeId, stepTab, pickFolder, toggleSidebar, toggleFileTree, setSettingsOpen, togglePalette, sessions, openTab]);

  // --- Keyboard ------------------------------------------------------------

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const mod = event.metaKey || event.ctrlKey;

      if (mod && event.key.toLowerCase() === "k") {
        event.preventDefault();
        togglePalette();
        return;
      }
      if (mod && event.key === ",") {
        event.preventDefault();
        setSettingsOpen(!settingsOpen);
        return;
      }
      if (event.key === "Escape") {
        if (useUi.getState().paletteOpen) togglePalette(false);
        else if (settingsOpen) setSettingsOpen(false);
        return;
      }
      if (event.ctrlKey && event.key === "Tab") {
        event.preventDefault();
        stepTab(event.shiftKey ? -1 : 1);
        return;
      }
      if (mod && event.key.toLowerCase() === "b") {
        event.preventDefault();
        toggleSidebar();
        return;
      }
      if (mod && event.key.toLowerCase() === "e") {
        event.preventDefault();
        toggleFileTree();
        return;
      }
      if (mod && event.key.toLowerCase() === "w" && activeId) {
        event.preventDefault();
        closeTab(activeId);
        return;
      }
      if (mod && event.key.toLowerCase() === "n") {
        event.preventDefault();
        void newSession();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [togglePalette, settingsOpen, setSettingsOpen, stepTab, toggleSidebar, toggleFileTree, closeTab, activeId, newSession]);

  // --- Render --------------------------------------------------------------

  const entries: MessageEntry[] = activeId
    ? (thread?.order ?? []).map((id) => thread!.messages[id]!).filter(Boolean)
    : [];

  const status: SessionStatus = thread?.status ?? { type: "idle" };
  const busy = busyId !== null && status.type === "busy";
  const activeSession = sessions.find((s) => s.id === activeId);
  const pending = pendingFor({ bySession: permissions }, activeId);
  const diffs = (thread?.diffs ?? []).map(normaliseDiff).filter((d) => d !== null);

  return (
    <div className="flex h-full flex-col bg-canvas">
      <TitleBar
        onToggleSidebar={() => toggleSidebar()}
        onToggleFileTree={() => toggleFileTree()}
        fileTreeOpen={fileTreeOpen}
        onOpenSettings={() => setSettingsOpen(true)}
      />

      <div className="flex min-h-0 flex-1">
        <AnimatePresence initial={false}>
          {sidebarOpen && (
            <motion.div key="sidebar" initial={{ width: 0 }} animate={{ width: 248 }} exit={{ width: 0 }}>
              <Sidebar onOpenSettings={() => setSettingsOpen(true)} />
            </motion.div>
          )}
        </AnimatePresence>

        <main className="flex min-w-0 flex-1 flex-col">
          <SessionTabs />

          {phase.kind === "failed" ? (
            <ServerFailure message={phase.message} logs={useServer.getState().logs} />
          ) : phase.kind === "ready" ? (
            <>
              <MessageThread
                entries={entries}
                live={busy}
                agent={activeSession?.agent}
                model={activeSession?.model?.id}
                permissions={pending}
                onPermissionReply={replyPermission}
                diffs={diffs}
                onEditAndResend={editAndResend}
              />

              <StatusBar
                entries={entries}
                busy={busy}
                agent={activeSession?.agent}
                model={activeSession?.model?.id}
                onAbort={abort}
              />

              <Composer
                onSubmit={send}
                onAbort={abort}
                busy={busy}
                disabled={false}
                placeholder="Ask opencode to do something…"
                suggestFiles={(query) => client?.files(query, 12) ?? Promise.resolve([])}
                suggestCommands={async () => {
                  if (!client) return [];
                  const commands = await client.commands().catch(() => []);
                  return commands.map((c) => ({
                    value: c.name,
                    label: c.name,
                    hint: c.description,
                    kind: "command" as const,
                  }));
                }}
              />
            </>
          ) : (
            <Booting project={activeProject} onPickFolder={() => void pickFolder()} />
          )}
        </main>

        <AnimatePresence initial={false}>
          {fileTreeOpen && (
            <motion.aside
              key="files"
              initial={{ width: 0 }}
              animate={{ width: 260 }}
              exit={{ width: 0 }}
              className="shrink-0 overflow-hidden border-l border-line"
            >
              <FileTree />
            </motion.aside>
          )}
        </AnimatePresence>
      </div>

      <CommandPalette open={paletteOpen} commands={commands} onClose={() => togglePalette(false)} />
      <SettingsDialog open={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </div>
  );
}

function Booting({ project, onPickFolder }: { project: string | null; onPickFolder(): void }) {
  // No project means nothing can start. Say so and offer the one useful action
  // rather than showing a spinner that never resolves.
  if (!project) {
    return (
      <div className="flex flex-1 items-center justify-center px-8">
        <EmptyState
          title="Open a folder to begin"
          body="Halyard runs opencode against a project directory. Pick one and it will start a server scoped to that folder."
          action={
            <Button variant="primary" size="lg" onClick={onPickFolder}>
              <FolderOpen size={14} />
              Open folder…
            </Button>
          }
        />
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 text-ink-faint">
      <span className="h-2 w-2 animate-pulse rounded-full bg-live" />
      <p className="font-mono text-[0.84rem]">Starting opencode in {project}</p>
    </div>
  );
}

function ServerFailure({ message, logs }: { message: string; logs: Array<{ message: string; at: number }> }) {
  return (
    <div className="scroll-area flex flex-1 flex-col items-center justify-center px-8 text-center">
      <EmptyState tone="danger" title="opencode could not start" body={message} />
      {logs.length > 0 && (
        <pre className="scroll-area mt-4 max-h-64 w-full max-w-[720px] overflow-auto rounded-[var(--radius-card)] border border-line bg-surface p-3 text-left font-mono text-[0.72rem] text-ink-faint">
          {logs.map((line) => line.message).join("\n")}
        </pre>
      )}
    </div>
  );
}

