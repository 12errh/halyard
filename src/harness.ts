/**
 * A browser harness for looking at the real UI.
 *
 * Not shipped: this file is only reachable from `harness.html`, which is a
 * local review tool. It stands in for the two things a browser does not have
 * — Tauri's IPC and the opencode server — so the actual components render
 * with realistic data instead of a hand-built mock-up that drifts from them.
 */

import "./index.css";

const now = Date.now();

const m = (id: string, name: string, extra: Record<string, unknown> = {}) => ({
  id,
  name,
  family: "mock",
  cost: { input: 0, output: 0 },
  limit: { context: 128000, output: 32000 },
  release_date: "2026-08-01",
  capabilities: { attachment: false, reasoning: true, tool_call: true, temperature: true },
  ...extra,
});

/** `/provider` answers with `{ all, connected }`, not a bare map. */
const PROVIDERS = {
  all: [
    {
      id: "opencode",
      name: "opencode",
      models: {
        "step-5-preview-free": m("step-5-preview-free", "Step 5 Preview (free)"),
        "exo-free": m("exo-free", "Exo (free)"),
        "gpt-oss-120b": m("gpt-oss-120b", "GPT OSS 120B", { cost: { input: 0.1, output: 0.5 } }),
      },
    },
    {
      id: "anthropic",
      name: "Anthropic",
      models: {
        "claude-opus-4": m("claude-opus-4", "Claude Opus 4", { cost: { input: 15, output: 75 } }),
        "claude-sonnet-4": m("claude-sonnet-4", "Claude Sonnet 4", { cost: { input: 3, output: 15 } }),
      },
    },
    {
      id: "openai",
      name: "OpenAI",
      models: {
        "gpt-5": m("gpt-5", "GPT-5", { cost: { input: 1.25, output: 10 } }),
      },
    },
  ],
  connected: ["opencode"],
};

const SESSIONS = [
  {
    id: "ses_a",
    slug: "quiet-harbour",
    projectID: "p1",
    directory: "/home/me/repo/api",
    title: "Fix the retry loop",
    version: "1.18.35",
    time: { created: now - 7200_000, updated: now - 60_000 },
    cost: 0.042,
    tokens: { input: 18400, output: 3200, reasoning: 900, cache: { read: 12000, write: 0 } },
  },
  {
    id: "ses_b",
    slug: "amber-lark",
    projectID: "p1",
    directory: "/home/me/repo/api",
    title: "Add pagination to /users",
    version: "1.18.35",
    time: { created: now - 86400_000, updated: now - 3600_000 },
  },
  {
    id: "ses_c",
    slug: "soft-ember",
    projectID: "p1",
    directory: "/home/me/repo/api",
    title: "Investigate flaky integration test",
    version: "1.18.35",
    time: { created: now - 200000_000, updated: now - 172800_000 },
  },
  {
    id: "ses_d",
    slug: "cold-harbor",
    projectID: "p1",
    directory: "/home/me/repo/api",
    title: "Upgrade the postgres driver",
    version: "1.18.35",
    time: { created: now - 400000_000, updated: now - 345600_000 },
  },
  {
    id: "ses_child",
    slug: "",
    projectID: "p1",
    parentID: "ses_a",
    directory: "/home/me/repo/api",
    title: "Find the reconnect handler",
    version: "1.18.35",
    time: { created: now - 3600_000, updated: now - 3500_000 },
  },
];

const TOOL = (id: string, tool: string, state: Record<string, unknown>) => ({
  id,
  sessionID: "ses_a",
  messageID: "m2",
  callID: `c_${id}`,
  type: "tool",
  tool,
  state,
});

const done = (input: Record<string, unknown>, metadata?: Record<string, unknown>) => ({
  status: "completed",
  input,
  output: "",
  title: "",
  time: { created: now - 900, completed: now },
  metadata,
});

const MESSAGES = [
  {
    info: {
      id: "m1",
      sessionID: "ses_a",
      role: "user",
      time: { created: now - 7200_000 },
      agent: "build",
      model: { providerID: "opencode", modelID: "step-5-preview-free" },
    },
    parts: [
      {
        id: "p1",
        sessionID: "ses_a",
        messageID: "m1",
        type: "text",
        text: "Why does the retry loop spin forever when the server restarts mid-request?",
      },
    ],
  },
  {
    info: {
      id: "m2",
      sessionID: "ses_a",
      role: "assistant",
      parentID: "m1",
      time: { created: now - 7100_000, completed: now - 7000_000 },
      cost: 0.011,
      tokens: { input: 4200, output: 890, reasoning: 320, cache: { read: 2100, write: 0 } },
      modelID: "step-5-preview-free",
      providerID: "opencode",
      agent: "build",
      mode: "build",
      path: { cwd: "/home/me/repo/api", root: "/home/me/repo/api" },
    },
    parts: [
      {
        id: "p2",
        sessionID: "ses_a",
        messageID: "m2",
        type: "reasoning",
        text: "The reconnect path re-subscribes to the event feed without cancelling the previous subscription, so two readers end up competing for the same stream and each one re-triggers the retry.",
        time: { created: now - 7100_000 },
      },
      TOOL("p3", "bash", done({ command: "rg -n 'subscribe' src/realtime", workdir: "/home/me/repo/api" })),
      TOOL("p4", "read", done({ filePath: "/home/me/repo/api/src/realtime/client.ts" })),
      {
        id: "p5",
        sessionID: "ses_a",
        messageID: "m2",
        type: "text",
        text: "The reconnect handler re-subscribes without cancelling the previous stream, so two readers end up competing for the same event feed and each re-triggers the retry.\n\nThe fix is to cancel before subscribing:",
      },
      TOOL("p6", "todowrite", done({ todos: [] }, { todos: [
        { content: "Cancel the previous subscription on reconnect", status: "completed", priority: "high" },
        { content: "Add a regression test", status: "in_progress", priority: "high" },
        { content: "Document the invariant", status: "pending", priority: "low" },
      ] })),
      TOOL("p7", "edit", done(
        { filePath: "/home/me/repo/api/src/realtime/client.ts" },
        { diff: "@@ -41,7 +41,11 @@\n   private connect() {\n-    this.source = open(this.url);\n-    this.source.onmessage = this.handle;\n+    this.source?.close();\n+    const source = open(this.url);\n+    source.onmessage = this.handle;\n+    this.source = source;" },
      )),
      TOOL("p8", "glob", done({ pattern: "src/**/*.test.ts", path: "/home/me/repo/api" }, { count: 34 })),
      {
        id: "p9",
        sessionID: "ses_a",
        messageID: "m2",
        type: "text",
        text: "That guarantees at most one live reader per client, whatever the restart timing.",
      },
    ],
  },
];

const TODOS = [
  { content: "Cancel the previous subscription on reconnect", status: "completed", priority: "high" },
  { content: "Add a regression test", status: "in_progress", priority: "high" },
  { content: "Document the invariant", status: "pending", priority: "low" },
];

const CONFIG = {
  model: "opencode/step-5-preview-free",
  permission: { edit: "allow", bash: { "*": "ask", "git status": "allow" } },
  mcp: {},
};

/** Resolve one opencode request. */
function route(url: string, method: string): unknown {
  // `url` is absolute, so take the pathname; strip the /api prefix some
  // callers use.
  const path = new URL(url).pathname.replace(/^\/api\/?/, "") || "/";

  if (path === "/session") return method === "POST" ? SESSIONS[0] : SESSIONS;
  if (path === "/session/status") return { ses_a: { type: "idle" } };
  if (path.endsWith("/message")) return MESSAGES;
  if (path.endsWith("/todo")) return TODOS;
  if (path.endsWith("/diff")) return [];
  if (path.endsWith("/children")) return [SESSIONS[4]];
  if (path === "/vcs") return { branch: "fix/retry-loop", default_branch: "main" };
  if (path === "/file/status") return [{ file: "src/realtime/client.ts", status: "modified" }];
  if (path === "/lsp") return [{ id: "typescript", status: "connected" }];
  if (path === "/formatter") return [{ id: "prettier", status: "connected" }];
  if (path === "/mcp") return {};
  if (path === "/provider") return PROVIDERS;
  if (path === "/config/providers") return { providers: { anthropic: { name: "Anthropic", models: {} } }, default: { anthropic: "claude-opus-4" } };
  if (path === "/config") return CONFIG;
  if (path === "/agent") return [
    { name: "build", description: "Full access. Writes code.", mode: "primary" },
    { name: "plan", description: "Read-only. Plans before acting.", mode: "primary" },
  ];
  if (path === "/command") return [
    { name: "init", description: "Analyse the codebase", source: "command" },
    { name: "compact", description: "Summarise the conversation", source: "command" },
  ];
  if (path === "/experimental/resource") return {};
  if (path === "/global/health") return { healthy: true, version: "1.18.35" };
  if (path.startsWith("/session/")) {
    const id = path.split("/")[2];
    return SESSIONS.find((s) => s.id === id) ?? SESSIONS[0];
  }
  return {};
}

let nextEventId = 1;

const IPC: Record<string, unknown> = {
  get_settings: { recentProjects: ["/home/me/repo/api"], lastProject: "/home/me/repo/api", binaryOverride: null, showTray: true, closeToTray: true, notifyOnFinish: true },
  remember_project: { recentProjects: ["/home/me/repo/api"], lastProject: "/home/me/repo/api", binaryOverride: null },
  start_server: { url: "http://127.0.0.1:4096", port: 4096, version: "1.18.35", project: "/home/me/repo/api" },
  server_status: { status: "ready", url: "http://127.0.0.1:4096", port: 4096, version: "1.18.35", project: "/home/me/repo/api" },
  read_config_file: { path: "/home/me/repo/api/opencode.json", content: JSON.stringify(CONFIG, null, 2), exists: true },
  global_config: { path: "~/.config/opencode/opencode.json", content: "{}", exists: true },
};

// The event plugin keeps its listener table here; without it every unlisten
// throws during teardown.
Object.defineProperty(window, "__TAURI_EVENT_PLUGIN_INTERNALS__", {
  value: {
    unregisterListener: (_event: unknown, _id: number) => Promise.resolve(),
    unregisterListeners: (_events: unknown) => Promise.resolve(),
  },
  configurable: true,
});

Object.defineProperty(window, "__TAURI_INTERNALS__", {
  value: {
    invoke: async (cmd: string) => {
      if (cmd === "plugin:event|listen") return nextEventId++;
      if (cmd === "plugin:event|unlisten") return null;
      if (cmd.startsWith("plugin:notification|")) return true;
      if (cmd.startsWith("plugin:autostart|")) return false;
      if (cmd in IPC) return IPC[cmd];
      return null;
    },
    transformCallback: (cb: unknown) => cb,
    metadata: { currentWindow: { label: "main" }, currentWebview: { label: "main" } },
  },
  configurable: true,
});

const realFetch = window.fetch.bind(window);
window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  if (url.includes("127.0.0.1:4096")) {
    if (url.includes("/event")) return new Response(new ReadableStream({ start() {} }), { status: 200 });
    const method = init?.method ?? "GET";
    return new Response(JSON.stringify(route(url, method)), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }
  return realFetch(input, init);
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).__IS_REVIEW__ = true;

// `initAppearance` runs inside main and applies whatever is stored, so seed
// the preference rather than the attribute.
const theme = new URLSearchParams(location.search).get("theme");
if (theme) {
  localStorage.setItem(
    "halyard.appearance",
    JSON.stringify({ theme, font: "pixelcode", density: 1, reduceMotion: false }),
  );
}

await import("./main");

// Open a surface for review: ?panel=settings | palette
const panel = new URLSearchParams(location.search).get("panel");
if (panel === "settings" || panel === "palette" || panel === "files") {
  setTimeout(() => {
    const labels: Record<string, string> = {
      settings: "Settings",
      palette: "Show all commands",
      files: "Toggle file explorer",
    };
    const wanted = labels[panel]!;
    const button = [...document.querySelectorAll("button")].find(
      (b) => b.getAttribute("aria-label") === wanted,
    );
    button?.click();
  }, 2000);
}
