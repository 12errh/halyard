import { useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import {
  AlertTriangle,
  Check,
  CircleDot,
  ExternalLink,
  FileJson,
  Loader2,
  Plug,
  RefreshCw,
  Save,
  Server,
  Undo2,
} from "lucide-react";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { openPath } from "@tauri-apps/plugin-opener";
import { Button } from "@/components/ui/button";
import { Input, Textarea } from "@/components/ui/input";
import { Badge, SectionLabel } from "@/components/ui/primitives";
import { OpencodeClient, type FormatterStatus, type LspStatus } from "@/lib/opencode/client";
import { stripSecrets } from "@/lib/opencode/models";
import {
  CONFIG_SECTIONS,
  describeValue,
  formatConfig,
  getPath,
  setPath,
  useSettings,
} from "@/state/settings";
import { useServer } from "@/state/server";
import { useMode } from "@/state/mode";
import { useUi } from "@/state/ui";
import { FONT_OPTIONS } from "@/lib/fonts";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Shell
// ---------------------------------------------------------------------------

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
  const load = useSettings((s) => s.load);
  const phase = useServer((s) => s.phase);

  // Config is fetched once per dialog open, not per tab switch.
  useEffect(() => {
    if (!open) return;
    void load(activeProject);
  }, [open, activeProject, load]);

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
            className="relative flex h-[min(680px,84vh)] w-[min(940px,94vw)] flex-col overflow-hidden rounded-[var(--radius-panel)] border border-line-strong bg-surface shadow-[var(--shadow-panel)]"
          >
            <header className="flex items-center justify-between border-b border-line px-4 py-2.5">
              <h2 className="text-[0.9rem] font-medium tracking-tight">Settings</h2>
              <div className="flex items-center gap-2">
                <Badge tone={phase.kind === "ready" ? "good" : phase.kind === "failed" ? "danger" : "neutral"}>
                  {phase.kind === "ready" ? `opencode ${phase.info.version}` : "disconnected"}
                </Badge>
                <Button variant="ghost" size="sm" onClick={() => void load(activeProject)} aria-label="Reload settings">
                  <RefreshCw size={12} />
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
                {tab === "appearance" && <AppearanceTab />}
                {tab === "providers" && <ProvidersTab />}
                {tab === "models" && <ModelsTab />}
                {tab === "agents" && <AgentsTab />}
                {tab === "mcp" && <McpTab />}
                {tab === "permissions" && <PermissionsTab />}
                {tab === "config" && <ConfigTab />}
                {tab === "lsp" && <DiagnosticsTab />}
              </div>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}

function useClient(): OpencodeClient | null {
  const phase = useServer((s) => s.phase);
  return useMemo(
    () => (phase.kind === "ready" ? new OpencodeClient(phase.info.url) : null),
    [phase],
  );
}

function Group({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <section className="mb-6 last:mb-0">
      <div className="mb-2 flex items-baseline gap-2">
        <SectionLabel>{label}</SectionLabel>
        {hint && <span className="text-[0.68rem] text-ink-ghost">{hint}</span>}
      </div>
      {children}
    </section>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="rounded-[var(--radius-card)] border border-line bg-raised/40 px-3 py-4 text-center text-[0.8rem] text-ink-ghost">{children}</p>;
}

function Loading() {
  return (
    <div className="flex items-center gap-2 py-6 text-[0.82rem] text-ink-faint">
      <Loader2 size={13} className="animate-spin" />
      Loading…
    </div>
  );
}

// ---------------------------------------------------------------------------
// Appearance (lives in Halyard, not opencode)
// ---------------------------------------------------------------------------

function AppearanceTab() {
  const ui = useUi();
  const appearance = ui.appearance;
  const binaryOverride = useServer((s) => s.binaryOverride);
  const project = useServer((s) => s.project);
  const start = useServer((s) => s.start);

  return (
    <div>
      <Group label="Theme">
        <div className="flex gap-1.5">
          {(["dark", "light", "system"] as const).map((choice) => (
            <Button
              key={choice}
              size="sm"
              variant={appearance.theme === choice ? "primary" : "secondary"}
              onClick={() => ui.setTheme(choice)}
            >
              {choice[0]?.toUpperCase()}{choice.slice(1)}
            </Button>
          ))}
        </div>
      </Group>

      <Group label="Font" hint="Applies everywhere, including chat and code.">
        <div className="grid grid-cols-2 gap-1.5">
          {FONT_OPTIONS.map((font) => (
            <button
              key={font.id}
              type="button"
              onClick={() => ui.setFont(font.id)}
              className={cn(
                "flex flex-col items-start gap-0.5 rounded-[7px] border px-2.5 py-2 text-left transition-colors",
                appearance.font === font.id
                  ? "border-accent/55 bg-accent/10"
                  : "border-line hover:border-line-strong hover:bg-raised",
              )}
            >
              <span className="text-[0.82rem] text-ink" style={{ fontFamily: font.ui }}>
                {font.label}
              </span>
              <span className="text-[0.66rem] text-ink-ghost">{font.hint}</span>
            </button>
          ))}
        </div>
      </Group>

      <Group label="Density" hint={`${Math.round(appearance.density * 100)}%`}>
        <input
          type="range"
          min={0.85}
          max={1.25}
          step={0.05}
          value={appearance.density}
          onChange={(event) => ui.setDensity(Number(event.target.value))}
          className="w-full accent-[var(--accent)]"
        />
      </Group>

      <Group label="Motion">
        <label className="flex items-center gap-2 text-[0.82rem] text-ink-muted">
          <input
            type="checkbox"
            checked={appearance.reduceMotion}
            onChange={(event) => ui.setReduceMotion(event.target.checked)}
            className="accent-[var(--accent)]"
          />
          Reduce animation
        </label>
      </Group>

      <Group label="opencode binary" hint="Leave empty to use the copy on PATH.">
        <div className="flex gap-1.5">
          <Input
            value={binaryOverride ?? ""}
            onChange={(event) => {
              if (project) void start(project, event.target.value || null);
            }}
            placeholder="opencode"
            className="font-mono text-[0.76rem]"
          />
          <Button
            size="sm"
            onClick={async () => {
              const picked = await openDialog({ multiple: false, title: "Select opencode binary" });
              if (typeof picked === "string" && project) await start(project, picked);
            }}
          >
            Browse…
          </Button>
          {binaryOverride && (
            <Button size="sm" variant="ghost" onClick={() => project && void start(project, null)}>
              Reset
            </Button>
          )}
        </div>
      </Group>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Providers
// ---------------------------------------------------------------------------

interface AuthMethod {
  type: string;
  label: string;
}

function ProvidersTab() {
  const client = useClient();
  const [providers, setProviders] = useState<Array<{ id: string; name: string }>>([]);
  const [authMethods, setAuthMethods] = useState<Record<string, AuthMethod[]>>({});
  const [connected, setConnected] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<{ id: string; method: AuthMethod } | null>(null);
  const [secret, setSecret] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const load = async () => {
    if (!client) return;
    setLoading(true);
    try {
      const [catalogue, methods] = await Promise.all([
        client.providerCatalogue(),
        client.authMethods().catch(() => ({}) as Record<string, AuthMethod[]>),
      ]);
      // Never let a credential reach component state, even from this endpoint.
      const safe = stripSecrets(catalogue) as {
        all?: Array<{ id: string; name: string }>;
        connected?: string[];
      };
      setProviders(safe.all ?? []);
      setConnected(safe.connected ?? []);
      setAuthMethods(stripSecrets(methods) as Record<string, AuthMethod[]>);
    } catch (error) {
      setMessage((error as Error).message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client]);

  const submit = async () => {
    if (!client || !editing) return;
    setBusy(true);
    setMessage(null);
    try {
      await client.setAuth(editing.id, editing.method.type === "oauth" ? "oauth" : "api", secret);
      setSecret("");
      setEditing(null);
      await load();
      setMessage(`Saved credentials for ${editing.id}`);
    } catch (error) {
      setMessage((error as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const disconnect = async (id: string) => {
    if (!client) return;
    setBusy(true);
    try {
      await client.removeAuth(id);
      await load();
    } finally {
      setBusy(false);
    }
  };

  if (loading) return <Loading />;

  const withAuth = providers.filter((p) => (authMethods[p.id]?.length ?? 0) > 0);

  return (
    <div>
      <Group label="Connected" hint={`${connected.length} of ${providers.length}`}>
        <div className="flex flex-wrap gap-1.5">
          {connected.map((id) => (
            <Badge key={id} tone="good">
              {providers.find((p) => p.id === id)?.name ?? id}
            </Badge>
          ))}
        </div>
      </Group>

      {message && (
        <div className="mb-4 flex items-start gap-2 rounded-[var(--radius-card)] border border-line bg-raised px-2.5 py-2 text-[0.78rem] text-ink-muted">
          {message.startsWith("Saved") ? (
            <Check size={13} className="mt-0.5 shrink-0 text-good" />
          ) : (
            <AlertTriangle size={13} className="mt-0.5 shrink-0 text-warn" />
          )}
          {message}
        </div>
      )}

      <Group label="Add credentials">
        {withAuth.length === 0 ? (
          <Empty>No provider offers a credential entry point.</Empty>
        ) : (
          <div className="flex flex-col gap-1.5">
            {withAuth.map((provider) => (
              <div
                key={provider.id}
                className="flex items-center gap-2 rounded-[var(--radius-card)] border border-line bg-raised/40 px-2.5 py-1.5"
              >
                <span className="min-w-0 flex-1 truncate text-[0.82rem] text-ink">{provider.name}</span>
                {connected.includes(provider.id) ? (
                  <>
                    <Badge tone="good">connected</Badge>
                    <Button size="sm" variant="ghost" disabled={busy} onClick={() => void disconnect(provider.id)}>
                      Disconnect
                    </Button>
                  </>
                ) : (
                  <Button
                    size="sm"
                    onClick={() => {
                      const method = authMethods[provider.id]?.find((m) => m.type === "api") ?? authMethods[provider.id]?.[0];
                      if (method) {
                        setEditing({ id: provider.id, method });
                        setSecret("");
                      }
                    }}
                  >
                    Add key
                  </Button>
                )}
              </div>
            ))}
          </div>
        )}
      </Group>

      {editing && (
        <Group label={`Key for ${editing.id}`} hint={editing.method.label}>
          <div className="flex gap-1.5">
            <Input
              autoFocus
              type="password"
              value={secret}
              onChange={(event) => setSecret(event.target.value)}
              placeholder={editing.method.type === "oauth" ? "Paste the token" : "sk-…"}
              className="font-mono text-[0.76rem]"
            />
            <Button size="sm" variant="primary" disabled={busy || !secret.trim()} onClick={() => void submit()}>
              {busy ? <Loader2 size={12} className="animate-spin" /> : "Save"}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setEditing(null)}>
              Cancel
            </Button>
          </div>
          <p className="mt-1.5 text-[0.7rem] text-ink-ghost">
            Written to opencode's own auth store, never to Halyard's settings.
          </p>
        </Group>
      )}

      <Group label="All providers">
        <p className="text-[0.76rem] text-ink-faint">
          {providers.length} discovered. Only connected providers appear in the model picker.
        </p>
      </Group>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Models
// ---------------------------------------------------------------------------

function ModelsTab() {
  const client = useClient();
  const effective = useSettings((s) => s.effective);
  const [providers, setProviders] = useState<Array<{ id: string; name: string; models: Record<string, { name?: string }> }>>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!client) return;
    void (async () => {
      setLoading(true);
      try {
        const raw = stripSecrets(await client.providerCatalogue()) as {
          all?: Array<{ id: string; name: string; models?: Record<string, { name?: string }> }>;
        };
        setProviders(
          (raw.all ?? []).map((p) => ({ id: p.id, name: p.name, models: p.models ?? {} })),
        );
      } finally {
        setLoading(false);
      }
    })();
  }, [client]);

  if (loading) return <Loading />;

  const configured = getPath(effective, ["model"], null);
  const [query, setQuery] = useState("");

  const rows = providers
    .map((p) => ({ provider: p, count: Object.keys(p.models).length }))
    .filter((r) => r.count > 0)
    .filter((r) => !query || r.provider.name.toLowerCase().includes(query.toLowerCase()));

  return (
    <div>
      <Group label="Default model" hint="Set in the Config tab; applies to new sessions.">
        <div className="rounded-[var(--radius-card)] border border-line bg-raised/40 px-2.5 py-2 font-mono text-[0.78rem] text-ink-muted">
          {typeof configured === "string" ? configured : "not set — sessions use the picker default"}
        </div>
      </Group>

      <Group label="Browse" hint={`${rows.length} providers with models`}>
        <Input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Filter providers"
          className="mb-2"
        />
        <div className="scroll-area max-h-[280px] overflow-auto rounded-[var(--radius-card)] border border-line">
          {rows.length === 0 ? (
            <Empty>No providers match.</Empty>
          ) : (
            rows.map((row) => (
              <div
                key={row.provider.id}
                className="flex items-center justify-between border-b border-line/60 px-2.5 py-1.5 last:border-b-0"
              >
                <span className="truncate text-[0.82rem] text-ink">{row.provider.name}</span>
                <span className="tabular shrink-0 font-mono text-[0.7rem] text-ink-ghost">
                  {row.count} models
                </span>
              </div>
            ))
          )}
        </div>
      </Group>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Agents
// ---------------------------------------------------------------------------

function AgentsTab() {
  const client = useClient();
  const effective = useSettings((s) => s.effective);
  const modeValue = useMode((s) => s.value);
  const [agents, setAgents] = useState<Array<{ name: string; description?: string; mode?: string; native?: boolean }>>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!client) return;
    void (async () => {
      setLoading(true);
      try {
        setAgents(await client.agents());
      } finally {
        setLoading(false);
      }
    })();
  }, [client]);

  if (loading) return <Loading />;

  const custom = getPath(effective, ["agent"], {}) as Record<string, unknown>;
  const customNames = Object.keys(custom ?? {});
  const primaries = agents.filter((a) => a.mode === "primary");
  const subagents = agents.filter((a) => a.mode === "subagent");

  return (
    <div>
      <Group label="Mode" hint="Switched per conversation from the composer.">
        <div className="flex gap-1.5">
          {primaries
            .filter((a) => ["build", "plan"].includes(a.name))
            .map((agent) => (
              <Button
                key={agent.name}
                size="sm"
                variant={modeValue === agent.name ? "primary" : "secondary"}
                onClick={() => useMode.getState().setValue(agent.name)}
              >
                {agent.name === "plan" ? "Plan" : "Build"}
              </Button>
            ))}
        </div>
        <p className="mt-1.5 text-[0.72rem] text-ink-ghost">
          {primaries.find((a) => a.name === modeValue)?.description}
        </p>
      </Group>

      <Group label="Custom agents" hint={customNames.length ? `${customNames.length} defined` : "none"}>
        {customNames.length === 0 ? (
          <Empty>No custom agents. Define them in the Config tab under &quot;agent&quot;.</Empty>
        ) : (
          <div className="flex flex-col gap-1">
            {customNames.map((name) => (
              <div key={name} className="flex items-center gap-2 rounded-[var(--radius-card)] border border-line bg-raised/40 px-2.5 py-1.5">
                <span className="truncate font-mono text-[0.78rem] text-ink">{name}</span>
                <span className="ml-auto shrink-0 font-mono text-[0.68rem] text-ink-ghost">
                  {describeValue(getPath(custom, [name, "mode"]))}
                </span>
              </div>
            ))}
          </div>
        )}
      </Group>

      <Group label="Subagents" hint={`${subagents.length} available`}>
        <div className="flex flex-col gap-1">
          {subagents.map((agent) => (
            <div key={agent.name} className="rounded-[var(--radius-card)] border border-line bg-raised/40 px-2.5 py-1.5">
              <div className="font-mono text-[0.78rem] text-ink">{agent.name}</div>
              {agent.description && (
                <div className="text-[0.72rem] leading-snug text-ink-faint">{agent.description}</div>
              )}
            </div>
          ))}
        </div>
      </Group>
    </div>
  );
}

// ---------------------------------------------------------------------------
// MCP
// ---------------------------------------------------------------------------

interface McpState {
  status?: string;
  error?: string;
}

function McpTab() {
  const client = useClient();
  const [servers, setServers] = useState<Record<string, McpState>>({});
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    if (!client) return;
    setLoading(true);
    try {
      setServers(await client.mcpStatus());
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client]);

  const add = async () => {
    if (!client || !name.trim() || !url.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await client.addMcp(name.trim(), { type: "remote", url: url.trim(), enabled: true });
      setName("");
      setUrl("");
      await load();
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const toggle = async (server: string, enable: boolean) => {
    if (!client) return;
    setBusy(true);
    try {
      await client.addMcp(server, { type: "remote", enabled: enable });
      await load();
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (loading) return <Loading />;

  const rows = Object.entries(servers);

  return (
    <div>
      <Group label="Servers" hint={`${rows.length} configured`}>
        {rows.length === 0 ? (
          <Empty>No MCP servers configured. Add one below, or in the Config tab.</Empty>
        ) : (
          <div className="flex flex-col gap-1">
            {rows.map(([server, state]) => (
              <div key={server} className="flex items-center gap-2 rounded-[var(--radius-card)] border border-line bg-raised/40 px-2.5 py-1.5">
                <Plug size={12} className="shrink-0 text-ink-faint" />
                <span className="min-w-0 flex-1 truncate font-mono text-[0.78rem] text-ink">{server}</span>
                <Badge tone={state.status === "connected" ? "good" : state.status === "disabled" ? "neutral" : "warn"}>
                  {state.status ?? "unknown"}
                </Badge>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={busy}
                  onClick={() => void toggle(server, state.status === "disabled")}
                >
                  {state.status === "disabled" ? "Enable" : "Disable"}
                </Button>
              </div>
            ))}
          </div>
        )}
      </Group>

      <Group label="Add a remote server">
        <div className="flex flex-col gap-1.5">
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="name" />
          <Input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://mcp.example.com" />
          {error && <p className="text-[0.74rem] text-danger">{error}</p>}
          <div>
            <Button size="sm" variant="primary" disabled={busy || !name.trim() || !url.trim()} onClick={() => void add()}>
              {busy ? <Loader2 size={12} className="animate-spin" /> : "Add server"}
            </Button>
          </div>
          <p className="text-[0.7rem] text-ink-ghost">
            Local servers using a command line belong in the Config tab under &quot;mcp&quot;.
          </p>
        </div>
      </Group>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Permissions
// ---------------------------------------------------------------------------

const PERMISSION_ACTIONS = ["read", "edit", "glob", "grep", "list", "bash", "task", "webfetch"];
const PERMISSION_VALUES = ["allow", "ask", "deny"] as const;

/** Parse the draft, falling back to an empty document while it is mid-edit. */
function parseDraft(text: string): Record<string, unknown> {
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function PermissionsTab() {
  const effective = useSettings((s) => s.effective);
  const draft = useSettings((s) => s.draft);
  const setDraft = useSettings((s) => s.setDraft);
  const dirty = useSettings((s) => s.dirty);
  const saving = useSettings((s) => s.saving);
  const save = useSettings((s) => s.save);
  // The effective view merges defaults; the draft is the file the user owns.
  const source = dirty ? parseDraft(draft) : (effective ?? {});

  const current = (action: string) =>
    getPath(source ?? {}, ["permission", action], "ask");

  const update = (action: string, value: string) => {
    const base = parseDraft(draft);
    const next = setPath(base, ["permission", action], value);
    setDraft(formatConfig(next));
  };

  return (
    <div>
      <Group
        label="Tool permissions"
        hint="ask stops the agent until you approve it in the thread"
      >
        <div className="overflow-hidden rounded-[var(--radius-card)] border border-line">
          {PERMISSION_ACTIONS.map((action, index) => (
            <div
              key={action}
              className={cn(
                "flex items-center gap-3 px-2.5 py-1.5",
                index > 0 && "border-t border-line/60",
              )}
            >
              <span className="w-20 shrink-0 font-mono text-[0.78rem] text-ink">{action}</span>
              <div className="flex gap-1">
                {PERMISSION_VALUES.map((value) => (
                  <Button
                    key={value}
                    size="sm"
                    variant={current(action) === value ? "primary" : "ghost"}
                    onClick={() => update(action, value)}
                  >
                    {value}
                  </Button>
                ))}
              </div>
            </div>
          ))}
        </div>
        <p className="mt-1.5 text-[0.7rem] text-ink-ghost">
          Writes to the config file. Rules per glob go in the raw editor.
        </p>
      </Group>

      <SaveBar dirty={dirty} saving={saving} onSave={() => void save()} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Raw config
// ---------------------------------------------------------------------------

function ConfigTab() {
  const file = useSettings((s) => s.file);
  const draft = useSettings((s) => s.draft);
  const setDraft = useSettings((s) => s.setDraft);
  const dirty = useSettings((s) => s.dirty);
  const saving = useSettings((s) => s.saving);
  const error = useSettings((s) => s.error);
  const save = useSettings((s) => s.save);
  const revert = useSettings((s) => s.revert);
  const scope = useSettings((s) => s.scope);
  const setScope = useSettings((s) => s.setScope);
  const effective = useSettings((s) => s.effective);

  return (
    <div className="flex h-full flex-col">
      <div className="mb-2 flex items-center gap-2">
        <div className="flex rounded-[6px] border border-line p-0.5">
          {(["project", "global"] as const).map((value) => (
            <button
              key={value}
              type="button"
              onClick={() => void setScope(value)}
              className={cn(
                "rounded-[4px] px-2 py-0.5 text-[0.74rem] transition-colors",
                scope === value ? "bg-raised text-ink" : "text-ink-muted hover:text-ink",
              )}
            >
              {value}
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={() => file && void openPath(file.path).catch(() => undefined)}
          className="flex min-w-0 flex-1 items-center gap-1.5 text-[0.72rem] text-ink-ghost hover:text-ink-muted"
        >
          <FileJson size={11} className="shrink-0" />
          <span className="truncate font-mono">{file?.path ?? "…"}</span>
          <ExternalLink size={9} className="shrink-0" />
        </button>
      </div>

      {file && !file.exists && (
        <p className="mb-2 rounded-[var(--radius-card)] border border-line bg-raised/50 px-2.5 py-1.5 text-[0.72rem] text-ink-faint">
          No config file yet. Saving creates one.
        </p>
      )}

      <Textarea
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        spellCheck={false}
        placeholder='{\n  "$schema": "https://opencode.ai/config.json"\n}'
        className="scroll-area min-h-[280px] flex-1 resize-none font-mono text-[0.74rem] leading-[1.55]"
      />

      {error && (
        <p className="mt-1.5 flex items-start gap-1.5 text-[0.74rem] text-danger">
          <AlertTriangle size={11} className="mt-0.5 shrink-0" />
          {error}
        </p>
      )}

      <SaveBar dirty={dirty} saving={saving} onSave={() => void save()} onRevert={revert} />

      <Group label="Effective config" hint="Merged view, read-only">
        <pre className="scroll-area max-h-40 overflow-auto rounded-[var(--radius-card)] border border-line bg-raised/40 p-2 font-mono text-[0.68rem] text-ink-faint">
          {effective ? JSON.stringify(effective, null, 2) : "not loaded"}
        </pre>
      </Group>

      <Group label="Keys in effect">
        <div className="flex flex-wrap gap-1">
          {CONFIG_SECTIONS.filter((section) => effective && section.key in effective).map((section) => (
            <span
              key={section.key}
              title={section.hint}
              className="rounded-[5px] border border-line bg-raised/50 px-1.5 py-0.5 font-mono text-[0.66rem] text-ink-muted"
            >
              {section.label}
            </span>
          ))}
        </div>
      </Group>
    </div>
  );
}

function SaveBar({
  dirty,
  saving,
  onSave,
  onRevert,
}: {
  dirty: boolean;
  saving: boolean;
  onSave(): void;
  onRevert?(): void;
}) {
  return (
    <div className="mt-2 flex items-center justify-between gap-2">
      <span className="flex items-center gap-1.5 text-[0.72rem] text-ink-ghost">
        {dirty ? (
          <>
            <CircleDot size={10} className="text-warn" />
            Unsaved changes
          </>
        ) : (
          <>
            <Check size={10} className="text-good" />
            Saved
          </>
        )}
      </span>
      <div className="flex gap-1.5">
        {onRevert && (
          <Button size="sm" variant="ghost" disabled={!dirty || saving} onClick={onRevert}>
            <Undo2 size={11} />
            Revert
          </Button>
        )}
        <Button size="sm" variant="primary" disabled={!dirty || saving} onClick={onSave}>
          {saving ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} />}
          Save &amp; restart
        </Button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// LSP and formatters
// ---------------------------------------------------------------------------

function DiagnosticsTab() {
  const client = useClient();
  const [lsp, setLsp] = useState<LspStatus[]>([]);
  const [formatters, setFormatters] = useState<FormatterStatus[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!client) return;
    void (async () => {
      setLoading(true);
      setError(null);
      try {
        const [servers, formats] = await Promise.all([
          client.lspStatus().catch(() => []),
          client.formatterStatus().catch(() => []),
        ]);
        setLsp(servers);
        setFormatters(formats);
      } catch (cause) {
        setError((cause as Error).message);
      } finally {
        setLoading(false);
      }
    })();
  }, [client]);

  if (loading) return <Loading />;

  return (
    <div>
      {error && (
        <p className="mb-3 rounded-[var(--radius-card)] border border-warn/35 bg-warn/[0.08] px-2.5 py-1.5 text-[0.76rem] text-warn">
          {error}
        </p>
      )}

      <Group label="Language servers" hint="status from the running server">
        {lsp.length === 0 ? (
          <Empty>No language servers detected for this project.</Empty>
        ) : (
          <div className="flex flex-col gap-1">
            {lsp.map((server) => (
              <div key={server.id ?? server.name} className="flex items-center gap-2 rounded-[var(--radius-card)] border border-line bg-raised/40 px-2.5 py-1.5">
                <Server size={12} className="shrink-0 text-ink-faint" />
                <span className="min-w-0 flex-1 truncate text-[0.8rem] text-ink">{server.name}</span>
                <Badge tone={server.status === "connected" || server.status === "ready" ? "good" : "neutral"}>
                  {server.status}
                </Badge>
              </div>
            ))}
          </div>
        )}
      </Group>

      <Group label="Formatters" hint="status from the running server">
        {formatters.length === 0 ? (
          <Empty>No formatters configured.</Empty>
        ) : (
          <div className="flex flex-col gap-1">
            {formatters.map((formatter) => (
              <div key={formatter.name} className="flex items-center gap-2 rounded-[var(--radius-card)] border border-line bg-raised/40 px-2.5 py-1.5">
                <span className="min-w-0 flex-1 truncate text-[0.8rem] text-ink">{formatter.name}</span>
                <span className="truncate font-mono text-[0.68rem] text-ink-ghost">
                  {formatter.extensions?.join(" ") ?? ""}
                </span>
                <Badge tone={formatter.enabled ? "good" : "neutral"}>
                  {formatter.enabled ? "on" : "off"}
                </Badge>
              </div>
            ))}
          </div>
        )}
      </Group>

      <p className="text-[0.72rem] text-ink-ghost">
        Add servers under &quot;lsp&quot; and &quot;formatter&quot; in the Config tab.
      </p>
    </div>
  );
}

