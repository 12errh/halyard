import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { open } from "@tauri-apps/plugin-dialog";
import { FolderOpen, ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { CommandPalette, type Command } from "@/components/command/command-palette";
import { Composer, type ComposerSubmit } from "@/components/chat/composer";
import { MessageThread } from "@/components/chat/message-thread";
import { StatusBar } from "@/components/chat/status-bar";
import { UsageMeter } from "@/components/chat/usage-meter";
import { ModelPicker } from "@/components/chat/model-picker";
import { ModePicker } from "@/components/chat/mode-picker";
import { preloadHighlighter } from "@/components/chat/highlight";
import { SessionTabs } from "@/components/shell/session-tabs";
import { Sidebar } from "@/components/shell/sidebar";
import { TitleBar } from "@/components/shell/title-bar";
import { FileTree } from "@/components/shell/file-tree";
import { EmptyState } from "./empty-state";
import { Logo } from "@/components/shell/logo";
import { TodoPanel } from "@/components/chat/todo-panel";
import { SettingsDialog } from "./settings-dialog";
import { normaliseDiff } from "@/lib/diff";
import type { MessageEntry } from "@/lib/opencode/thread";
import {
  toMessageEntries,
  toPendingPermission,
  toSessionView,
  type Form,
} from "@/lib/opencode/types";
import { useProjects } from "@/state/projects";
import { useOpencodeClient } from "@/hooks/use-opencode-client";
import { useDesktop } from "@/state/desktop";
import { useTodos, todosFor } from "@/state/todos";
import { useTranscript } from "@/state/transcript";
import { useSessionOrg } from "@/state/session-org";
import { useProjectInfo } from "@/state/project-info";
import { announceFinish, useNativeShellActions, useSessionActivity } from "./desktop-bridge";
import { setAttention } from "@/lib/desktop";
import { useServer } from "@/state/server";
import { useSessions } from "@/state/sessions";
import { useThreads } from "@/state/threads";
import { useUi } from "@/state/ui";
import { pendingFor, usePermissions } from "@/state/permissions";
import { switchProject } from "@/actions/project";
import { useCatalogue } from "@/state/catalogue";
import { useModels } from "@/state/models";
import { useMode } from "@/state/mode";
import { useSystem } from "@/state/system";
import {
  pendingFor as pendingQuestionsFor,
  toPendingQuestion,
  useQuestions,
  type PendingQuestion,
} from "@/state/questions";
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
  const clearThread = useThreads((s) => s.clear);

  const sidebarOpen = useUi((s) => s.sidebarOpen);
  const toggleSidebar = useUi((s) => s.toggleSidebar);
  const fileTreeOpen = useUi((s) => s.fileTreeOpen);
  const toggleFileTree = useUi((s) => s.toggleFileTree);
  const settingsOpen = useUi((s) => s.settingsOpen);
  const setSettingsOpen = useUi((s) => s.setSettingsOpen);
  const notifyOnFinish = useDesktop((s) => s.notifyOnFinish);
  const paletteOpen = useUi((s) => s.paletteOpen);
  const togglePalette = useUi((s) => s.togglePalette);

  const activeId = useSessions((s) => s.activeId);
  const sessions = useSessions((s) => s.sessions);
  const setSessions = useSessions((s) => s.setSessions);
  const setDirectory = useSessions((s) => s.setDirectory);
  const upsert = useSessions((s) => s.upsert);
  const openTab = useSessions((s) => s.openTab);
  const closeTab = useSessions((s) => s.closeTab);
  const stepTab = useSessions((s) => s.stepTab);
  const allStatus = useSessions((s) => s.status);
  const todosBySession = useTodos((s) => s.bySession);
  const plan = todosFor(todosBySession, activeId);
  const pinPlan = useTranscript((s) => s.pinPlan);
  const hydrateDesktop = useDesktop((s) => s.hydrate);

  const thread = useThreads((s) => (activeId ? s.threads[activeId] : undefined));
  const busyId = useThreads((s) => s.busySessionId);
  const connection = useThreads((s) => s.connection);

  const permissions = usePermissions((s) => s.bySession);
  const ingestPermission = usePermissions((s) => s.ingest);
  const ingestSessionEvent = useSessions((s) => s.ingest);
  const ingestSystemEvent = useSystem((s) => s.ingest);
  const ingestQuestionEvent = useQuestions((s) => s.ingest);
  const ingestTodoEvent = useTodos((s) => s.ingest);
  const ingestProjectEvent = useProjectInfo((s) => s.ingest);
  const syncQuestions = useQuestions((s) => s.sync);
  const resolveQuestion = useQuestions((s) => s.resolve);
  const questionsState = useQuestions((s) => s.bySession);
  const syncPermissions = usePermissions((s) => s.sync);
  const resolvePermission = usePermissions((s) => s.resolve);

  const client = useOpencodeClient();

  /**
   * Pending forms, kept alongside the store's rendered view.
   *
   * `PendingQuestion` deliberately drops the field keys and option values a
   * reply needs, so the original form is retained here and paired back up by
   * position when the card answers.
   */
  const [forms, setForms] = useState<Record<string, Form.Info>>({});
  const rememberForm = useCallback((form: Form.Info) => {
    setForms((prev) => (prev[form.id] ? prev : { ...prev, [form.id]: form }));
  }, []);
  const forgetForm = useCallback((id: string) => {
    setForms((prev) => {
      if (!(id in prev)) return prev;
      const next = { ...prev };
      delete next[id];
      return next;
    });
  }, []);

  // --- Bootstrap -----------------------------------------------------------
  useEffect(() => {
    void hydrate();
    void attach();
    preloadHighlighter();
  }, [hydrate, attach]);

  // Branch and file status belong to the project, not the session, so they
  // are reloaded whenever the server is rebound to a different directory.
  useEffect(() => {
    if (phase.kind !== "ready" || !client) return;
    void useProjectInfo.getState().load(client);
    return () => useProjectInfo.getState().reset();
  }, [phase.kind, client]);

  // The default model is scoped per project, so switching repos must reload it.
  useEffect(() => {
    useModels.getState().sync(activeProject);
  }, [activeProject]);

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
    // One subscription fanned out: the thread reducer owns messages, and the
    // session and permission stores need the same events. Without the session
    // store in this path, a title generated after the first turn never lands.
    connect(client!, (event) => {
      const form = (event.data as Record<string, unknown> | undefined)?.form as
        | Form.Info
        | undefined;
      if (event.type === "form.created" && form) rememberForm(form);
      else if ((event.type === "form.replied" || event.type === "form.cancelled") && form) {
        forgetForm(form.id);
      }
      ingestPermission(event);
      ingestSessionEvent(event);
      // Keeps providers, models, agents and MCP status live: connecting a
      // provider or adding a server updates the settings tabs with no reload.
      ingestSystemEvent(event);
      // The chat picker keeps its own usable-model list; refresh it on the same
      // provider/model/credential changes that update Settings.
      useModels.getState().ingest(event);
      // A new plugin or skill lands as an event; the cached command list is
      // stale the moment it does.
      useCatalogue.getState().ingest(event);
      ingestQuestionEvent(event);
      ingestTodoEvent(event);
      ingestProjectEvent(event);
    });

    // The per-session hydration cache is scoped to a project; a new server means
    // a new project and every session needs reloading.
    loadedFor.current = new Set<string>();

    // Attach the client then pull the catalogue; model ids must come from the
    // server that will actually run the prompt.
    useModels.getState().setClient(client!);
    void useModels.getState().load();

    // Plan/Build are primary agents; load them so the picker has something to
    // show before the first prompt.
    void client!
      .agents()
      .then((agents) => useMode.getState().setModes(agents))
      .catch(() => undefined);

    void (async () => {
      // Scope the list to the directory this server was started in, before the
      // sessions land. `GET /session` answers for the entire database, so
      // without this the sidebar lists every conversation on the machine.
      setDirectory(phase.info.project);

      const [page, statuses] = await Promise.all([
        client!.listSessions().catch(() => null),
        client!.active().catch(() => ({})),
      ]);
      const all = (page?.data ?? []).map(toSessionView);
      setSessions(all);
      for (const [sessionID, status] of Object.entries(statuses)) {
        if (status.type !== "running") continue;
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

    return () => {
      useThreads.getState().disconnect();
      useModels.getState().setClient(null);
    };
  }, [
    phase,
    client,
    connect,
    setSessions,
    setDirectory,
    ingestPermission,
    ingestSessionEvent,
    ingestSystemEvent,
    ingestQuestionEvent,
  ]);

  // Hydrate a thread the first time its tab becomes active.
  const loadedFor = useRef(new Set<string>());
  useEffect(() => {
    if (!activeId || !client) return;
    if (loadedFor.current.has(activeId)) return;
    loadedFor.current.add(activeId);
    void (async () => {
      const page = await client.messages(activeId).catch(() => null);
      load(activeId, page ? toMessageEntries(page.data) : []);
      // Permissions asked before this tab was opened still need showing.
      const [pending, pendingForms] = await Promise.all([
        client.permissions(activeId).catch(() => []),
        client.forms(activeId).catch(() => []),
      ]);
      if (pending.length > 0) syncPermissions(activeId, pending.map(toPendingPermission));
      // A question asked before this tab was opened still needs answering.
      const restored: PendingQuestion[] = [];
      for (const form of pendingForms) {
        rememberForm(form);
        const view = toPendingQuestion(form, Date.now());
        if (view) restored.push(view);
      }
      if (restored.length > 0) syncQuestions(restored);
    })();
  }, [activeId, client, load, syncPermissions, syncQuestions, rememberForm]);

  /**
   * Re-read a thread after the server rewrote it.
   *
   * Undo, redo, compact and edit-and-resend all change history behind the
   * client's back. The stream reports message updates, not deletions, so
   * without this the transcript keeps showing turns that no longer exist and
   * every one of those actions looks like it did nothing. `load` merges, so the
   * thread is cleared first or the dropped messages simply stay.
   */
  const refreshThread = useCallback(
    async (sessionID: string) => {
      if (!client) return;
      const page = await client.messages(sessionID).catch(() => null);
      // Failed refetch: keep what is on screen. Clearing first and then loading
      // an empty page would erase a live transcript over a transient error.
      if (!page) return;
      clearThread(sessionID);
      load(sessionID, toMessageEntries(page.data));
    },
    [client, clearThread, load],
  );

  // --- Actions -------------------------------------------------------------

  const send = useCallback(
    async ({ text, attachments }: ComposerSubmit) => {
      // Throwing rather than swallowing is what puts the reason in front of
      // the user; the composer keeps their text when this rejects.
      if (!client) throw new Error("opencode is not running yet");
      try {
        const chosen = useModels.getState().selection;
        const agent = useMode.getState().value;
        // Typing before any session exists is the common first-run path, so the
        // first prompt creates the session rather than being swallowed.
        let target = activeId;
        if (!target) {
          const created = toSessionView(await client.createSession());
          upsert(created);
          openTab(created.id);
          target = created.id;
        }
        // Model and agent live on the session in v2; the prompt body is text
        // and files only. The session must exist before these run, which is
        // why creation happens first.
        if (chosen) {
          await client.setSessionModel(target, {
            id: chosen.modelID,
            providerID: chosen.providerID,
          });
        }
        if (agent) await client.setSessionAgent(target, agent);
        await client.sendPrompt(target, {
          text,
          files: attachments.map((attachment) => ({
            url: attachment.dataUrl,
            mime: attachment.mime,
            filename: attachment.name,
          })),
        });
        // The prompt is durable the moment it is accepted; re-read the thread
        // so the user's message appears even if the stream event is lost.
        void refreshThread(target);
      } catch (error) {
        console.error("prompt failed", error);
        throw error;
      }
    },
    [client, activeId, upsert, openTab, refreshThread],
  );

  const abort = useCallback(() => {
    if (client && activeId) void client.interrupt(activeId).catch(() => undefined);
  }, [client, activeId]);

  const replyPermission = useCallback(
    async (permission: PendingPermission, reply: PermissionReply) => {
      if (!client) throw new Error("not connected to opencode");
      await client.replyPermission(permission.sessionID, permission.id, reply);
      resolvePermission(permission.sessionID, permission.id);
    },
    [client, resolvePermission],
  );

  /** Rewind to just before `messageID`, then send the replacement. */
  const editAndResend = useCallback(
    async (messageID: string, text: string) => {
      if (!client || !activeId) return;
      await client.revertStage(activeId, messageID);
      await client.revertCommit(activeId);
      await client.sendPrompt(activeId, { text });
      await refreshThread(activeId);
    },
    [client, activeId, refreshThread],
  );

  const answerQuestion = useCallback(
    async (pending: PendingQuestion, answer: Form.Answer) => {
      if (!client) throw new Error("not connected to opencode");
      await client.replyForm(pending.sessionID, pending.id, answer);
      forgetForm(pending.id);
      resolveQuestion(pending.sessionID, pending.id);
    },
    [client, resolveQuestion, forgetForm],
  );

  const skipQuestion = useCallback(
    async (pending: PendingQuestion) => {
      if (!client) return;
      // An empty answer is how a form is dismissed; there is no cancel route.
      await client.replyForm(pending.sessionID, pending.id, {});
      forgetForm(pending.id);
      resolveQuestion(pending.sessionID, pending.id);
    },
    [client, resolveQuestion, forgetForm],
  );

  const pickFolder = useCallback(async () => {
    const selected = await open({ directory: true, multiple: false, title: "Open project folder" });
    if (typeof selected !== "string") return;
    if (selected === activeProject) return;
    await switchProject(selected);
  }, [activeProject]);

  // --- Turn controls -------------------------------------------------------

  // Undo rewinds to the message before the last user turn, which is what
  // "undo that prompt" means to someone looking at the transcript.
  const canUndo = useMemo(() => {
    if (!activeId || !thread) return false;
    const users = (thread.order ?? []).filter((id) => thread.messages[id]?.info?.role === "user");
    return users.length > 0;
  }, [activeId, thread]);

  const activeSessionInfo = sessions.find((s) => s.id === activeId);
  const canRedo = Boolean(activeSessionInfo?.revertedAt);

  const undo = useCallback(async () => {
    if (!client || !activeId || !thread) return;
    const users = (thread.order ?? []).filter((id) => thread.messages[id]?.info?.role === "user");
    const last = users[users.length - 1];
    if (!last) return;
    try {
      await client.revertStage(activeId, last);
    } catch (error) {
      console.error("undo failed", error);
      return;
    }
    await refreshThread(activeId);
  }, [client, activeId, thread, refreshThread]);

  const redo = useCallback(async () => {
    if (!client || !activeId) return;
    await client.revertClear(activeId).catch(() => undefined);
    await refreshThread(activeId);
  }, [client, activeId, refreshThread]);

  const compact = useCallback(async () => {
    if (!client || !activeId) return;
    try {
      await client.compact(activeId);
      // The server rewrites the whole transcript into a summary turn. Without
      // a re-read the old history stays on screen and the summary arrives as
      // an empty bubble.
      await refreshThread(activeId);
    } catch (error) {
      console.error("compact failed", error);
    }
  }, [client, activeId, refreshThread]);

  // --- @ and / suggestions -------------------------------------------------

  // Both lists are cached for the life of the connection. Fetching them from
  // the keystroke handler meant one request per character typed, and the menu
  // stayed empty for the duration — which read as "opencode only has a couple
  // of commands" and, when the request failed, as none at all.
  // Three selectors, never one object. Zustand compares the selector's return
  // value for identity, and an object literal is a new value on every render,
  // so a combined selector puts useSyncExternalStore into an infinite loop —
  // React throws "getSnapshot should be cached" and then "Maximum update depth
  // exceeded", and the whole shell unmounts.
  const skills = useCatalogue((s) => s.skills);
  const catalogueLoading = useCatalogue((s) => s.loading);
  const catalogueError = useCatalogue((s) => s.error);

  useEffect(() => {
    useCatalogue.getState().setClient(client);
  }, [client]);

  useEffect(() => {
    void useCatalogue.getState().load();
  }, [client]);

  const suggestCommands = useCallback(async () => {
    await useCatalogue.getState().load();
    return useCatalogue.getState().commands;
  }, []);

  /**
   * Files and agents, for `@`.
   *
   * Agents were missing entirely: `@` is how you reach the agent catalogue, and
   * a thread could only be steered through files the server happened to index.
   */
  const suggestMentions = useCallback(
    async (query: string) => {
      const [paths, roster] = await Promise.all([
        client ? client.files(query, 12).catch(() => [] as string[]) : Promise.resolve([] as string[]),
        Promise.resolve(useSystem.getState().agents),
      ]);
      const needle = query.trim().toLowerCase();
      return [
        ...roster
          .filter((agent) => !needle || agent.name.toLowerCase().includes(needle))
          .map((agent) => ({
            value: agent.name,
            label: agent.name,
            hint: agent.description ?? agent.mode,
            kind: "agent" as const,
          })),
        ...paths.map((path) => ({
          value: path,
          label: path.split("/").pop() ?? path,
          hint: path,
          kind: "file" as const,
        })),
      ];
    },
    [client],
  );

  const newSession = useCallback(async () => {
    if (!client) return;
    const session = toSessionView(await client.createSession());
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
      // Ctrl+T used to live on the native menu bar. It is a browser reflex for
      // "new tab", and the menu bar is gone.
      if (mod && event.key.toLowerCase() === "t") {
        event.preventDefault();
        void newSession();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [togglePalette, settingsOpen, setSettingsOpen, stepTab, toggleSidebar, toggleFileTree, closeTab, activeId, newSession]);

  // --- Desktop shell -------------------------------------------------------

  // Finished sessions the user has not looked at yet. Kept in a ref because it
  // only drives an imperative call and a badge, and re-rendering the whole
  // shell every time a background agent finishes would be wasteful.
  const unread = useRef(new Set<string>());
  const markUnseen = useSessionOrg((s) => s.markUnseen);
  const markSeen = useSessionOrg((s) => s.markSeen);

  useEffect(() => {
    void hydrateDesktop();
  }, [hydrateDesktop]);

  const onFinished = useCallback(
    async (sessionID: string) => {
      const info = sessions.find((s) => s.id === sessionID);
      unread.current.add(sessionID);
      if (activeProject) markUnseen(activeProject, sessionID);

      // Only interrupt for a session the user is not already watching.
      const watching = sessionID === activeId;
      await announceFinish({
        enabled: notifyOnFinish && !watching,
        title: info?.title ?? "Agent finished",
        body: info?.title ?? "The agent finished a turn.",
        unread: unread.current.size,
      });
    },
    [sessions, notifyOnFinish, activeId, activeProject, markUnseen],
  );

  useSessionActivity(allStatus, onFinished);

  // Opening a session clears its badge: a marker for a result the user is
  // already reading is a lie.
  useEffect(() => {
    if (!activeId) return;
    markSeen(activeProject ?? "", activeId);
    if (!unread.current.delete(activeId)) return;
    void setAttention(unread.current.size);
  }, [activeId]);

  // And so does regaining focus — the window is in front, so everything in it
  // has been seen.
  useEffect(() => {
    const onFocus = () => {
      if (document.visibilityState !== "visible") return;
      if (!unread.current.size) return;
      unread.current.clear();
      void setAttention(0);
    };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onFocus);
    return () => {
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onFocus);
    };
  }, []);

  useNativeShellActions({
    onNewThread: () => void newSession(),
    onOpenSettings: () => setSettingsOpen(true),
  });

  // --- Render --------------------------------------------------------------

  // These three are rebuilt on every render otherwise, which means every
  // streaming delta re-reconciles the entire history rather than the one
  // message that changed. On a long thread that is the difference between
  // instant and visibly slow.
  const entries: MessageEntry[] = useMemo(
    () =>
      activeId && thread
        ? thread.order.map((id) => thread.messages[id]!).filter(Boolean)
        : [],
    [activeId, thread],
  );

  const status: SessionStatus = thread?.status ?? { type: "idle" };
  const busy = busyId !== null && status.type === "busy";
  const activeSession = sessions.find((s) => s.id === activeId);
  const pending = useMemo(() => pendingFor({ bySession: permissions }, activeId), [permissions, activeId]);
  const askedQuestions = useMemo(
    () =>
      pendingQuestionsFor({ bySession: questionsState }, activeId).map((pending) => ({
        pending,
        fields: (forms[pending.id]?.fields ?? []).filter(isAnswerable),
      })),
    [questionsState, activeId, forms],
  );
  const modelList = useModels((s) => s.models);
  const modelSelection = useModels((s) => s.selection);
  const modelsLoading = useModels((s) => s.loading);
  const selectModel = useModels((s) => s.select);
  const modes = useMode((s) => s.modes);
  const modeValue = useMode((s) => s.value);
  const setModeValue = useMode((s) => s.setValue);
  const diffs = useMemo(
    () => (thread?.diffs ?? []).map(normaliseDiff).filter((d) => d !== null),
    [thread?.diffs],
  );

  return (
    <div className="flex h-full flex-col bg-canvas">
      {/* Tabs first, toolbar second: the order a browser uses. They span the
          full window rather than sitting over the chat column, because that is
          what makes them read as tabs for windows rather than a strip bolted
          onto one pane. */}
      <SessionTabs />
      <TitleBar
        onToggleSidebar={() => toggleSidebar()}
        onToggleFileTree={() => toggleFileTree()}
        fileTreeOpen={fileTreeOpen}
        onOpenSettings={() => setSettingsOpen(true)}
      />

      <div className="flex min-h-0 flex-1">
        <AnimatePresence initial={false}>
          {sidebarOpen && (
            <motion.div
              key="sidebar"
              initial={{ width: 0 }}
              animate={{ width: 280 }}
              exit={{ width: 0 }}
              /* A plain block here would let the sidebar size itself to its
                 content and let `overflow-hidden` crop the rest, which is how
                 the bottom of the session list became unreachable: the list had
                 all the height it wanted, just not on screen. Flex makes the
                 sidebar take the row's height instead, so its own scroll area
                 does the scrolling. 280 is the sidebar's width — animating to
                 anything narrower sheared the timestamps off the edge. */
              className="flex min-h-0 shrink-0 overflow-hidden"
            >
              <Sidebar onOpenSettings={() => setSettingsOpen(true)} />
            </motion.div>
          )}
        </AnimatePresence>

        <main className="flex min-w-0 flex-1 flex-col">

          {phase.kind === "failed" ? (
            <ServerFailure message={phase.message} logs={useServer.getState().logs} />
          ) : phase.kind === "ready" ? (
            <>
              {connection === "unauthorized" && (
                <div
                  role="alert"
                  className="flex items-center gap-2 border-b border-danger/30 bg-danger/10 px-4 py-2 text-[12px] text-danger"
                >
                  <ShieldAlert className="size-3.5 shrink-0" />
                  <span>
                    opencode rejected the connection credentials. Restart the server to
                    reconnect.
                  </span>
                </div>
              )}
              <MessageThread
                entries={entries}
                live={busy}
                agent={activeSession?.agent}
                model={activeSession?.model?.id}
                permissions={pending}
                onPermissionReply={replyPermission}
                questions={askedQuestions}
                onQuestionAnswer={answerQuestion}
                onQuestionSkip={skipQuestion}
                diffs={diffs}
                onEditAndResend={editAndResend}
              />

              <UsageMeter
                sessions={sessions}
                activeSession={activeSession}
                messages={thread?.order
                  .map((id) => thread.messages[id]?.info)
                  .filter((info): info is NonNullable<typeof info> => Boolean(info))}
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
                suggestMentions={suggestMentions}
                suggestCommands={suggestCommands}
                listSkills={() => ({ skills, loading: catalogueLoading, error: catalogueError })}
                plan={plan.length && pinPlan ? <TodoPanel todos={plan} /> : undefined}
                canUndo={canUndo && !busy}
                canRedo={canRedo && !busy}
                canCompact={Boolean(activeId)}
                onUndo={() => void undo()}
                onRedo={() => void redo()}
                onCompact={() => void compact()}
                modelPicker={
                  <>
                    <ModePicker modes={modes} value={modeValue} onChange={setModeValue} />
                    <ModelPicker
                      models={modelList}
                      selection={modelSelection}
                      loading={modelsLoading}
                      onSelect={(next) => selectModel(next)}
                    />
                  </>
                }
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
              className="shrink-0 overflow-hidden"
            >
              <FileTree />
            </motion.aside>
          )}
        </AnimatePresence>
      </div>

      <CommandPalette open={paletteOpen} commands={commands} onClose={() => togglePalette(false)} />
      <SettingsDialog
        open={settingsOpen}
        activeProject={activeProject}
        onClose={() => setSettingsOpen(false)}
      />
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
          mark
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

  // Waiting on the server is exactly when the companion should look busy, so
  // this reads as progress rather than a stalled screen.
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 text-ink-faint">
      <Logo className="h-11 w-11" />
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

/** The form fields the question card renders, in the same order as the view. */
function isAnswerable(field: Form.Field): boolean {
  if (field.hidden) return false;
  switch (field.type) {
    case "string":
      return true;
    case "enum":
    case "multiselect":
      return (field.options?.length ?? 0) > 0;
    default:
      return false;
  }
}
