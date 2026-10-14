/** Dev-only: render one component in isolation for review shots. */
import { createRoot } from "react-dom/client";
import { Sidebar } from "@/components/shell/sidebar";
import { Composer } from "@/components/chat/composer";
import { MessageThread } from "@/components/chat/message-thread";
import { TodoPanel } from "@/components/chat/todo-panel";
import { useSessions } from "@/state/sessions";
import { useProjects } from "@/state/projects";
import { useThreads } from "@/state/threads";
import type { Part, Session, ToolState } from "@/lib/opencode/types";
import { useSessionOrg } from "@/state/session-org";
import "./index.css";

const now = Date.now();
const TITLES = [
  "Fix the websocket reconnect loop", "Add cursor pagination to /users",
  "Investigate the flaky auth integration test", "Upgrade the postgres driver to 16",
  "Refactor the billing webhook handler", "Why is CI red on the docs build?",
  "Migrate the queue to bullmq", "Remove the legacy /v1 endpoints",
  "Speed up the cold start on Lambda", "Add dark mode to the marketing site",
  "Handle timezone correctly in reports", "Audit the auth middleware",
  "Retry uploads with exponential backoff", "Split the monolith's admin panel",
  "Fix memory leak in the SSE client", "Write integration tests for payments",
  "Cache the pricing endpoint", "Deprecate the old SDK",
  "Trace the memory spike in the parser", "Add E2E coverage for checkout",
  "Migrate secrets to the vault", "Kill the legacy feature flags",
  "Reduce cold start below 500ms", "Fix flaky snapshot assertions",
  "Rework the auth token refresh", "Split the workers into their own repo",
  "Upgrade Node to 22", "Add structured logging everywhere",
  "Investigate the prod 502s", "Tighten the CI cache keys",
  "Document the release process", "Drop the unused feature flags",
  "Rate limit the public API", "Move assets to object storage",
];
const sessions: Session[] = TITLES.map((title, i) => ({
  id: `s${i}`, slug: "", projectID: "p", directory: "/home/me/repo/api", title,
  version: "1.18.35", time: { created: now - i * 3600_000, updated: now - i * 3600_000 },
  cost: i * 0.01, tokens: { input: 12000, output: 2000, reasoning: 400, cache: { read: 4000, write: 0 } },
}));

const mode: string | null = new URLSearchParams(location.search).get("view");

useProjects.setState({ active: "/home/me/repo/api", recent: ["/home/me/repo/api", "/home/me/repo/web"], loaded: true });
useSessions.setState({ sessions, tabs: ["s0"], activeId: "s0" });
useSessionOrgPin();
useThreads.setState({ threads: {} });

function useSessionOrgPin() {
  useSessionOrg.getState().togglePin("/home/me/repo/api", "s2");
  useSessionOrg.getState().toggleArchive("/home/me/repo/api", "s16");
}

const tool = (id: string, name: string, state: ToolState) =>
  ({ id, sessionID: "s0", messageID: "m2", callID: id, type: "tool", tool: name, state }) as Part;
const done = (input: Record<string, unknown>, metadata?: Record<string, unknown>): ToolState => ({
  status: "completed", input, output: "", title: "", time: { created: now - 900, completed: now }, metadata,
});

const entries = [
  { info: { id: "m1", sessionID: "s0", role: "user", time: { created: now - 600_000 }, agent: "build", model: { providerID: "opencode", modelID: "step-5-preview-free" } },
    parts: [{ id: "q1", sessionID: "s0", messageID: "m1", type: "text", text: "The websocket client reconnects forever after the server restarts. Can you fix it?" }] },
  { info: { id: "m2", sessionID: "s0", role: "assistant", parentID: "m1", time: { created: now - 590_000, completed: now - 60_000 },
      cost: 0.03, tokens: { input: 18000, output: 3200, reasoning: 900, cache: { read: 12000, write: 0 } },
      modelID: "step-5-preview-free", providerID: "opencode", agent: "build", mode: "build", path: { cwd: "/repo", root: "/repo" } },
    parts: [
      tool("t1", "bash", done({ command: "rg -n 'reconnect|backoff' src/realtime", workdir: "/home/me/repo/api" })),
      tool("t2", "grep", done({ pattern: "setTimeout\\(.*connect" }, { matches: 4 })),
      { id: "x1", sessionID: "s0", messageID: "m2", type: "text",
        text: "The reconnect handler re-subscribes without cancelling the previous stream, so two readers compete for the same event feed and each re-triggers the retry." },
      tool("t3", "todowrite", done({ todos: [] }, { todos: [
        { content: "Cancel the previous subscription", status: "completed", priority: "high" },
        { content: "Cap the backoff at 30s", status: "in_progress", priority: "high" },
        { content: "Add a regression test", status: "pending", priority: "high" },
      ] })),
      tool("t4", "edit", done({ filePath: "/home/me/repo/api/src/realtime/client.ts" },
        { diff: "@@ -41,7 +41,11 @@\n   private connect() {\n-    this.source = open(this.url);\n+    this.source?.close();\n+    const source = open(this.url);\n+    this.source = source;" })),
      { id: "x2", sessionID: "s0", messageID: "m2", type: "text",
        text: "That guarantees at most one live reader per client, whatever the restart timing." },
    ] },
].map((m) => ({
  ...m,
  parts: Object.fromEntries((m.parts as Array<{ id: string }>).map((part) => [part.id, part])),
  pending: {},
  partOrder: (m.parts as Array<{ id: string }>).map((part) => part.id),
})) as never;

const PLAN = [
  { content: "Cancel the previous subscription", status: "completed", priority: "high" },
  { content: "Cap the backoff at 30s", status: "in_progress", priority: "high" },
  { content: "Add a regression test", status: "pending", priority: "high" },
];

createRoot(document.getElementById("root")!).render(
  <div className="flex h-screen">
    <Sidebar onOpenSettings={() => {}} />
    {mode === "chat" && (
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="min-h-0 flex-1">
          <MessageThread entries={entries} live={false} agent="build" model="step-5-preview-free" />
        </div>
        <div className="border-t border-line/0">
          <Composer
            onSubmit={() => {}} onAbort={() => {}} busy={false}
            suggestFiles={() => Promise.resolve([])}
            suggestCommands={() => Promise.resolve([])}
            canUndo={mode === "chat"} canRedo={false} canCompact={mode === "chat"}
            onUndo={() => {}} onRedo={() => {}} onCompact={() => {}}
            plan={mode === "chat" ? <TodoPanel todos={PLAN} /> : undefined}
          />
        </div>
      </div>
    )}
    {mode === "composer" && (
      <div className="flex flex-1 items-end bg-canvas p-6">
        <div className="w-full">
          <Composer
            onSubmit={() => {}} onAbort={() => {}} busy={false}
            suggestFiles={() => Promise.resolve([])}
            suggestCommands={() => Promise.resolve([])}
            modelPicker={
              <span className="flex items-center gap-1.5">
                <span className="rounded-full border border-line px-2 py-[3px] text-[0.72rem] text-ink-muted">Build</span>
                <span className="rounded-full border border-line px-2 py-[3px] text-[0.72rem] text-ink-muted">Step 5 Preview (free)</span>
              </span>
            }
            canUndo={false} canRedo={false} canCompact={false}
            onUndo={() => {}} onRedo={() => {}} onCompact={() => {}}
          />
        </div>
      </div>
    )}
  </div>,
);
