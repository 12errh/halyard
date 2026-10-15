import { useMemo, useState, type ReactNode } from "react";
import { AnimatePresence, motion } from "motion/react";
import {
  AlertTriangle,
  Check,
  KeyRound,
  Loader2,
  LogIn,
  Plus,
  RefreshCw,
  Search,
  Trash2,
  Unplug,
  Upload,
} from "lucide-react";
import { save as saveDialog } from "@tauri-apps/plugin-dialog";
import { openPath } from "@tauri-apps/plugin-opener";
import { Button } from "@/components/ui/button";
import { Input, Textarea } from "@/components/ui/input";
import { Badge, Switch } from "@/components/ui/primitives";
import { Empty, Group } from "./settings-groups";
import { SkeletonBlock, SkeletonCard, SkeletonList, SkeletonRow } from "@/components/ui/skeleton";
import { addCustomAgent, addCustomModel, removeCustomAgent } from "@/actions/config-write";
import { formatContext } from "@/lib/opencode/models";
import { allModels, useSystem, type McpState } from "@/state/system";
import { CONFIG_SECTIONS, describeValue, getPath, useSettings } from "@/state/settings";
import { useMode } from "@/state/mode";
import { useModels } from "@/state/models";
import { useServer } from "@/state/server";
import { useUi } from "@/state/ui";
import { UpdatesSection } from "@/components/shell/updates-section";
import { useDesktop } from "@/state/desktop";
import { useTranscript } from "@/state/transcript";
import { FONT_OPTIONS } from "@/lib/fonts";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Primitives
// ---------------------------------------------------------------------------

function SearchInput({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange(next: string): void;
  placeholder: string;
}) {
  return (
    <div className="relative mb-2">
      <Search size={12} className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-ink-ghost" />
      <Input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        className="h-7 pl-7 text-[0.78rem]"
      />
    </div>
  );
}

/** Collapsible add-form used by Models and Agents. */
function AddPanel({
  title,
  onCancel,
  children,
}: {
  title: string;
  onCancel(): void;
  children: ReactNode;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, height: 0 }}
      animate={{ opacity: 1, height: "auto" }}
      exit={{ opacity: 0, height: 0 }}
      transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
      className="overflow-hidden"
    >
      <div className="rounded-[var(--radius-card)] border border-accent/35 bg-accent/[0.04] p-3">
        <div className="mb-2 flex items-center justify-between">
          <span className="text-[0.82rem] font-medium text-ink">{title}</span>
          <Button variant="ghost" size="sm" onClick={onCancel}>
            Cancel
          </Button>
        </div>
        {children}
      </div>
    </motion.div>
  );
}

function Notice({ kind, children }: { kind: "ok" | "error"; children: ReactNode }) {
  return (
    <div
      className={cn(
        "mb-3 flex items-start gap-2 rounded-[var(--radius-card)] border px-2.5 py-2 text-[0.78rem]",
        kind === "ok" ? "border-good/30 bg-good/[0.07] text-good" : "border-danger/30 bg-danger/[0.07] text-danger",
      )}
    >
      {kind === "ok" ? <Check size={13} className="mt-0.5 shrink-0" /> : <AlertTriangle size={13} className="mt-0.5 shrink-0" />}
      {children}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Appearance
// ---------------------------------------------------------------------------

export function AppearanceTab() {
  const ui = useUi();
  const appearance = ui.appearance;
  const desktop = useDesktop();
  const transcript = useTranscript();

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
              {choice[0]?.toUpperCase()}
              {choice.slice(1)}
            </Button>
          ))}
        </div>
      </Group>

      <Group label="Font" hint="Applies everywhere, including chat and code.">
        {/* One compact row per face. As tall cards the seven of them filled the
            whole tab and pushed everything below it off screen. */}
        <div className="overflow-hidden rounded-[var(--radius-card)] border border-line">
          {FONT_OPTIONS.map((font, index) => (
            <button
              key={font.id}
              type="button"
              onClick={() => ui.setFont(font.id)}
              aria-pressed={appearance.font === font.id}
              className={cn(
                "flex w-full items-baseline gap-3 px-3 py-1.5 text-left transition-colors",
                index > 0 && "border-t border-line/70",
                appearance.font === font.id ? "bg-accent/[0.08]" : "hover:bg-raised/60",
              )}
            >
              <span
                className={cn(
                  "w-[9.5rem] shrink-0 truncate text-[0.8rem]",
                  appearance.font === font.id ? "text-accent" : "text-ink",
                )}
                style={{ fontFamily: font.ui }}
              >
                {font.label}
              </span>
              <span className="min-w-0 flex-1 truncate text-[0.7rem] text-ink-faint">
                {font.hint}
              </span>
              {appearance.font === font.id && <Check size={11} className="shrink-0 text-accent" />}
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
          aria-label="Interface density"
          className="w-full accent-[var(--accent)]"
        />
      </Group>

      {/* Updates sit with the other whole-app concerns rather than at the
          bottom: it is the setting a user reaches for when something feels
          wrong, and they should not have to scroll past fonts to find it. */}
      <UpdatesSection />

      <Group label="Motion">
        {/* A Switch rather than a bare checkbox: the same control appears a
            few rows below, and two different toggles in one column reads as
            two different ideas. */}
        <Switch
          label="Reduce animation"
          hint="Suppress decorative motion. The OS setting is respected regardless."
          checked={appearance.reduceMotion}
          onChange={(next) => ui.setReduceMotion(next)}
        />
      </Group>

      <Group label="Desktop" hint="How Halyard behaves outside the window.">
        <div className="divide-y divide-line/60">
          <Switch
            label="Show tray icon"
            hint="Keeps Halyard reachable after the window is closed."
            checked={desktop.showTray}
            onChange={(next) => desktop.update({ showTray: next })}
          />
          <Switch
            label="Close to tray"
            hint={
              desktop.showTray
                ? "Closing the window hides it and leaves the agent running."
                : "Needs the tray icon — there would be no way back otherwise."
            }
            checked={desktop.closeToTray}
            disabled={!desktop.showTray}
            onChange={(next) => desktop.update({ closeToTray: next })}
          />
          <Switch
            label="Launch at login"
            hint="Starts Halyard when you sign in."
            checked={desktop.launchAtLogin}
            onChange={(next) => desktop.update({ launchAtLogin: next })}
          />
        </div>
      </Group>

      <Group label="Transcript" hint="How much of each turn to show.">
        <div className="divide-y divide-line/60">
          <Switch
            label="Show reasoning"
            hint="The agent's thinking between steps. Useful when debugging; noise when you just want the answer."
            checked={transcript.showThinking}
            onChange={() => transcript.toggle("showThinking")}
          />
          <Switch
            label="Show timestamps"
            hint="A time beside every turn. Off by default — hover a turn to see it without cluttering the column."
            checked={transcript.showTimestamps}
            onChange={() => transcript.toggle("showTimestamps")}
          />
          <Switch
            label="Pin the plan"
            hint="Keep the agent's todo list above the composer instead of only in the transcript."
            checked={transcript.pinPlan}
            onChange={() => transcript.toggle("pinPlan")}
          />
        </div>
      </Group>

      <Group label="Notifications">
        <Switch
          label="Notify when the agent finishes"
          hint="Only while Halyard is in the background, so it never interrupts you mid-sentence."
          checked={desktop.notifyOnFinish}
          onChange={(next) => desktop.update({ notifyOnFinish: next })}
        />
      </Group>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Providers
// ---------------------------------------------------------------------------

export function ProvidersTab() {
  const providers = useSystem((s) => s.providers);
  const connected = useSystem((s) => s.connected);
  const authMethods = useSystem((s) => s.authMethods);
  const client = useSystem((s) => s.client);
  const [query, setQuery] = useState("");
  const [onlyConnected, setOnlyConnected] = useState(false);
  const [editing, setEditing] = useState<{ id: string; label: string; oauth: boolean } | null>(null);
  const [secret, setSecret] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ kind: "ok" | "error"; text: string } | null>(null);

  const rows = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return providers
      .filter((provider) => !onlyConnected || connected.includes(provider.id))
      .filter((provider) => !needle || `${provider.id} ${provider.name}`.toLowerCase().includes(needle))
      .sort((a, b) => {
        const aOn = connected.includes(a.id) ? 0 : 1;
        const bOn = connected.includes(b.id) ? 0 : 1;
        return aOn !== bOn ? aOn - bOn : a.name.localeCompare(b.name);
      });
  }, [providers, connected, query, onlyConnected]);

  const submit = async () => {
    if (!client || !editing) return;
    setBusy(true);
    setNotice(null);
    try {
      await client.setAuth(editing.id, editing.oauth ? "oauth" : "api", secret);
      setSecret("");
      setEditing(null);
      await useSystem.getState().refreshCatalogue();
      setNotice({ kind: "ok", text: `Connected ${editing.id}` });
    } catch (error) {
      setNotice({ kind: "error", text: (error as Error).message });
    } finally {
      setBusy(false);
    }
  };

  const disconnect = async (id: string) => {
    if (!client) return;
    setBusy(true);
    try {
      await client.removeAuth(id);
      await useSystem.getState().refreshCatalogue();
      setNotice({ kind: "ok", text: `Disconnected ${id}` });
    } catch (error) {
      setNotice({ kind: "error", text: (error as Error).message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      {notice && <Notice kind={notice.kind}>{notice.text}</Notice>}

      <Group label="Connected" hint={`${connected.length} of ${providers.length}`}>
        <div className="flex flex-wrap gap-1.5">
          {connected.map((id) => (
            <Badge key={id} tone="good">
              {providers.find((p) => p.id === id)?.name ?? id}
            </Badge>
          ))}
        </div>
      </Group>

      <Group label="All providers" hint={`${rows.length} shown`}>
        <SearchInput value={query} onChange={setQuery} placeholder="Search providers…" />
        <label className="mb-2 flex items-center gap-1.5 text-[0.74rem] text-ink-faint">
          <input
            type="checkbox"
            checked={onlyConnected}
            onChange={(event) => setOnlyConnected(event.target.checked)}
            className="accent-[var(--accent)]"
          />
          Connected only
        </label>

        <div className="scroll-area max-h-[320px] overflow-auto rounded-[var(--radius-card)] border border-line">
          {rows.length === 0 ? (
            <Empty>No providers match.</Empty>
          ) : (
            rows.map((provider) => {
              const isConnected = connected.includes(provider.id);
              const methods = authMethods[provider.id] ?? [];
              const api = methods.find((m) => m.type === "api");
              const oauth = methods.find((m) => m.type === "oauth");

              return (
                <div
                  key={provider.id}
                  className="group flex items-center gap-2 border-b border-line/60 px-2.5 py-1.5 transition-colors last:border-b-0 hover:bg-raised/40"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[0.82rem] text-ink">{provider.name}</span>
                    <span className="block truncate font-mono text-[0.66rem] text-ink-ghost">
                      {provider.id} · {Object.keys(provider.models).length} models
                    </span>
                  </span>

                  {isConnected ? (
                    <>
                      <Badge tone="good">connected</Badge>
                      <Button size="sm" variant="ghost" disabled={busy} onClick={() => void disconnect(provider.id)}>
                        <Unplug size={11} />
                        Disconnect
                      </Button>
                    </>
                  ) : (
                    <div className="flex shrink-0 items-center gap-1">
                      {api && (
                        <Button
                          size="sm"
                          onClick={() => {
                            setEditing({ id: provider.id, label: api.label, oauth: false });
                            setSecret("");
                            setNotice(null);
                          }}
                        >
                          <KeyRound size={11} />
                          API key
                        </Button>
                      )}
                      {oauth && (
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => {
                            setEditing({ id: provider.id, label: oauth.label, oauth: true });
                            setSecret("");
                            setNotice(null);
                          }}
                        >
                          <LogIn size={11} />
                          OAuth
                        </Button>
                      )}
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      </Group>

      <AnimatePresence>
        {editing && (
          <AddPanel title={`${editing.label} — ${editing.id}`} onCancel={() => setEditing(null)}>
            <div className="flex gap-1.5">
              <Input
                autoFocus
                type="password"
                value={secret}
                onChange={(event) => setSecret(event.target.value)}
                placeholder={editing.oauth ? "Paste the token" : "sk-…"}
                className="font-mono text-[0.76rem]"
              />
              <Button size="sm" variant="primary" disabled={busy || !secret.trim()} onClick={() => void submit()}>
                {busy ? <Loader2 size={12} className="animate-spin" /> : "Connect"}
              </Button>
            </div>
            <p className="mt-1.5 text-[0.7rem] text-ink-ghost">
              Written to opencode's own auth store. Never to Halyard's settings.
            </p>
          </AddPanel>
        )}
      </AnimatePresence>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Models
// ---------------------------------------------------------------------------

export function ModelsTab() {
  const system = useSystem();
  const effective = useSettings((s) => s.effective);
  const draft = useSettings((s) => s.draft);
  const save = useSettings((s) => s.save);
  const project = useServer((s) => s.project);

  const [query, setQuery] = useState("");
  const [providerFilter, setProviderFilter] = useState<string>("");
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ providerID: "", modelID: "", name: "", npm: "", baseURL: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savingDefault, setSavingDefault] = useState(false);
  const [defaultNotice, setDefaultNotice] = useState<{ kind: "ok" | "error"; text: string } | null>(null);

  const models = useMemo(() => allModels(system), [system]);

  const rows = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return models
      .filter((model) => !providerFilter || model.providerID === providerFilter)
      .filter((model) => {
        if (!needle) return true;
        return `${model.id} ${model.name ?? ""} ${model.providerName}`.toLowerCase().includes(needle);
      })
      .sort((a, b) => {
        const aFree = !a.cost?.input && !a.cost?.output ? 0 : 1;
        const bFree = !b.cost?.input && !b.cost?.output ? 0 : 1;
        if (aFree !== bFree) return aFree - bFree;
        if (a.connected !== b.connected) return a.connected ? -1 : 1;
        return (a.name ?? a.id).localeCompare(b.name ?? b.id);
      });
  }, [models, query, providerFilter]);

  const configured = getPath(effective, ["model"], null);
  const selection = useModels((m) => m.selection);
  const scoped = useModels((m) => m.scoped(project));

  /** Write the default into opencode's config, which needs a restart to apply. */
  const commitDefault = async (providerID: string, modelID: string) => {
    setSavingDefault(true);
    setDefaultNotice(null);
    try {
      // Apply locally first so the picker reflects it immediately, then persist
      // it into opencode's own config so new sessions inherit it too.
      useModels.getState().select({ providerID, modelID });
      const { setPath, formatConfig, safeParseDraft } = await import("@/state/settings");
      const next = setPath(safeParseDraft(draft), ["model"], `${providerID}/${modelID}`);
      useSettings.getState().setDraft(formatConfig(next));
      const ok = await save();
      setDefaultNotice(
        ok
          ? { kind: "ok", text: `Default set to ${providerID}/${modelID}` }
          : { kind: "error", text: "could not save the config" },
      );
    } finally {
      setSavingDefault(false);
    }
  };

  const clearDefault = async () => {
    setSavingDefault(true);
    setDefaultNotice(null);
    try {
      useModels.getState().clear();
      const { setPath, formatConfig, safeParseDraft } = await import("@/state/settings");
      const next = setPath(safeParseDraft(draft), ["model"], null);
      useSettings.getState().setDraft(formatConfig(next));
      await save();
      setDefaultNotice({ kind: "ok", text: "Default cleared — the picker decides" });
    } finally {
      setSavingDefault(false);
    }
  };

  const submit = async () => {
    setBusy(true);
    setError(null);
    const ok = await addCustomModel(form);
    setBusy(false);
    if (ok) {
      setAdding(false);
      setForm({ providerID: "", modelID: "", name: "", npm: "", baseURL: "" });
      await useSystem.getState().refreshCatalogue();
    } else {
      setError("could not save — check the config is valid");
    }
  };

  return (
    <div>
      <DefaultModelSection
        models={rows}
        configured={typeof configured === "string" ? configured : null}
        selection={selection}
        scoped={scoped}
        saving={savingDefault}
        onPick={(providerID, modelID) => void commitDefault(providerID, modelID)}
        onClear={() => void clearDefault()}
      />

      {defaultNotice && <Notice kind={defaultNotice.kind}>{defaultNotice.text}</Notice>}

      <Group label="Browse models" hint={`${rows.length} shown`}>
        <SearchInput value={query} onChange={setQuery} placeholder="Search models…" />

        <select
          value={providerFilter}
          onChange={(event) => setProviderFilter(event.target.value)}
          className="mb-2 h-7 w-full rounded-[7px] border border-line bg-surface px-2 text-[0.78rem] text-ink outline-none focus:border-accent/60"
        >
          <option value="">All providers</option>
          {system.providers
            .filter((provider) => Object.keys(provider.models).length > 0)
            .map((provider) => (
              <option key={provider.id} value={provider.id}>
                {provider.name}
              </option>
            ))}
        </select>

        <div className="scroll-area max-h-[300px] overflow-auto rounded-[var(--radius-card)] border border-line">
          {rows.length === 0 ? (
            <Empty>No models match.</Empty>
          ) : (
            rows.slice(0, 200).map((model) => {
              const free = !model.cost?.input && !model.cost?.output;
              return (
                <div
                  key={`${model.providerID}/${model.id}`}
                  className="group flex items-center gap-2 border-b border-line/60 px-2.5 py-1.5 transition-colors last:border-b-0 hover:bg-raised/40"
                >
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-1.5">
                      <span className="truncate text-[0.8rem] text-ink">{model.name ?? model.id}</span>
                      {free && <Badge tone="good">free</Badge>}
                      {!model.connected && <Badge tone="neutral">not connected</Badge>}
                    </span>
                    <span className="block truncate font-mono text-[0.64rem] text-ink-ghost">
                      {model.providerName}
                      {model.limit?.context ? ` · ${formatContext(model.limit.context)} ctx` : ""}
                    </span>
                  </span>
                  {/* Hover-revealed. A list of models each carrying the same
                      button reads as a column of repeated instructions; one
                      appears only on the row you are looking at. */}
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={savingDefault}
                    onClick={() => void commitDefault(model.providerID, model.id)}
                    className="opacity-0 transition-opacity focus-visible:opacity-100 group-hover:opacity-100"
                  >
                    Make default
                  </Button>
                </div>
              );
            })
          )}
        </div>
        {rows.length > 200 && (
          <p className="mt-1 text-[0.68rem] text-ink-ghost">
            Showing the first 200 of {rows.length}. Narrow the search to see the rest.
          </p>
        )}
      </Group>

      <Group label="Add a model">
        <Button size="sm" onClick={() => setAdding((v) => !v)} aria-expanded={adding}>
          <Plus size={12} />
          {adding ? "Cancel" : "Add a custom model"}
        </Button>

        <AnimatePresence>
          {adding && (
            <AddPanel title="Add a model" onCancel={() => setAdding(false)}>
              <div className="grid grid-cols-2 gap-1.5">
                <Input
                  value={form.providerID}
                  onChange={(e) => setForm({ ...form, providerID: e.target.value })}
                  placeholder="provider id (e.g. myprovider)"
                />
                <Input
                  value={form.modelID}
                  onChange={(e) => setForm({ ...form, modelID: e.target.value })}
                  placeholder="model id"
                />
                <Input
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  placeholder="display name"
                />
                <Input
                  value={form.npm}
                  onChange={(e) => setForm({ ...form, npm: e.target.value })}
                  placeholder="npm package"
                />
                <Input
                  className="col-span-2"
                  value={form.baseURL}
                  onChange={(e) => setForm({ ...form, baseURL: e.target.value })}
                  placeholder="base URL (optional)"
                />
              </div>
              {error && <p className="mt-1.5 text-[0.74rem] text-danger">{error}</p>}
              <div className="mt-2 flex items-center gap-2">
                <Button
                  size="sm"
                  variant="primary"
                  disabled={busy || !form.providerID.trim() || !form.modelID.trim()}
                  onClick={() => void submit()}
                >
                  {busy ? <Loader2 size={12} className="animate-spin" /> : "Save & restart"}
                </Button>
                <span className="text-[0.68rem] text-ink-ghost">writes to provider config</span>
              </div>
            </AddPanel>
          )}
        </AnimatePresence>
      </Group>
    </div>
  );
}

/**
 * Default-model control.
 *
 * Two separate things are in play and conflating them would confuse:
 * the picker's choice is a Halyard preference that applies instantly, while
 * opencode's own `model` config key needs a restart. Both are written so the
 * default survives a fresh clone or a different machine.
 */
function DefaultModelSection({
  models,
  configured,
  selection,
  scoped,
  saving,
  onPick,
  onClear,
}: {
  models: Array<{ providerID: string; id: string; name?: string; connected: boolean }>;
  configured: string | null;
  selection: { providerID: string; modelID: string } | null;
  scoped: boolean;
  saving: boolean;
  onPick(providerID: string, modelID: string): void;
  onClear(): void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return models
      .filter((model) => !needle || `${model.id} ${model.name ?? ""} ${model.providerID}`.toLowerCase().includes(needle))
      .slice(0, 60);
  }, [models, query]);

  const label =
    (selection &&
      models.find((m) => m.providerID === selection.providerID && m.id === selection.modelID)?.name) ||
    selection?.modelID ||
    configured ||
    "Not set — the picker decides";

  return (
    <Group
      label="Default model"
      hint={scoped ? "this project" : configured ? "from config" : "picker decides"}
    >
      <div className="flex items-center gap-1.5">
        <button
          type="button"
          disabled={saving}
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          aria-haspopup="listbox"
          className="flex min-w-0 flex-1 items-center gap-2 rounded-[7px] border border-line bg-surface px-2.5 py-1.5 text-left transition-colors hover:border-line-strong disabled:opacity-50"
        >
          <SparklesIcon />
          <span className="min-w-0 flex-1 truncate text-[0.82rem] text-ink">{label}</span>
          {saving && <Loader2 size={12} className="shrink-0 animate-spin text-ink-faint" />}
          <ChevronDownIcon open={open} />
        </button>

        <Button size="sm" variant="ghost" disabled={saving} onClick={onClear} title="Clear the default">
          Clear
        </Button>
      </div>

      {configured && (
        <p className="mt-1.5 text-[0.7rem] text-ink-ghost">
          opencode config has <span className="font-mono">{configured}</span>. Changing this writes
          the config and restarts opencode.
        </p>
      )}

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.15 }}
            className="relative z-10 mt-1.5"
          >
            <SearchInput value={query} onChange={setQuery} placeholder="Search models…" />
            <div className="scroll-area max-h-64 overflow-auto rounded-[var(--radius-card)] border border-line">
              {filtered.length === 0 ? (
                <Empty>No models match.</Empty>
              ) : (
                filtered.map((model) => {
                  const active =
                    selection?.providerID === model.providerID && selection?.modelID === model.id;
                  return (
                    <button
                      key={`${model.providerID}/${model.id}`}
                      type="button"
                      onClick={() => {
                        onPick(model.providerID, model.id);
                        setOpen(false);
                        setQuery("");
                      }}
                      className="flex w-full items-center gap-2 border-b border-line/60 px-2.5 py-1.5 text-left last:border-b-0 hover:bg-raised"
                    >
                      <span className="w-3 shrink-0">
                        {active && <Check size={12} className="text-accent" />}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[0.8rem] text-ink">
                          {model.name ?? model.id}
                        </span>
                        <span className="block truncate font-mono text-[0.64rem] text-ink-ghost">
                          {model.providerID}
                          {!model.connected ? " · not connected" : ""}
                        </span>
                      </span>
                    </button>
                  );
                })
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </Group>
  );
}

function SparklesIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="shrink-0 text-accent">
      <path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M18.4 5.6l-2.1 2.1M7.7 16.3l-2.1 2.1" />
    </svg>
  );
}

function ChevronDownIcon({ open }: { open: boolean }) {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className={cn("shrink-0 text-ink-ghost transition-transform duration-150", open && "rotate-180")}>
      <path d="m6 9 6 6 6-6" />
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Agents
// ---------------------------------------------------------------------------

export function AgentsTab() {
  const agents = useSystem((s) => s.agents);
  const effective = useSettings((s) => s.effective);
  const modeValue = useMode((s) => s.value);
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ name: "", description: "", prompt: "", mode: "subagent" as "primary" | "subagent", model: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const primaries = agents.filter((a) => a.mode === "primary" && ["build", "plan"].includes(a.name));
  const subagents = agents.filter((a) => a.mode === "subagent");
  const custom = (getPath(effective, ["agent"], {}) ?? {}) as Record<string, unknown>;

  const submit = async () => {
    setBusy(true);
    setError(null);
    const ok = await addCustomAgent(form);
    setBusy(false);
    if (ok) {
      setAdding(false);
      setForm({ name: "", description: "", prompt: "", mode: "subagent", model: "" });
      await useSystem.getState().refreshAgents();
    } else {
      setError("could not save — check the name is unique and the config is valid");
    }
  };

  const remove = async (name: string) => {
    await removeCustomAgent(name);
    await useSystem.getState().refreshAgents();
  };

  return (
    <div>
      <Group label="Mode" hint="Also switchable from the composer.">
        <div className="flex gap-1.5">
          {primaries.map((agent) => (
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

      <Group label="Custom agents" hint={`${Object.keys(custom).length} defined`}>
        {Object.keys(custom).length === 0 ? (
          <Empty>No custom agents yet. Create one below.</Empty>
        ) : (
          <div className="flex flex-col gap-1">
            {Object.keys(custom).map((name) => (
              <div key={name} className="flex items-center gap-2 rounded-[var(--radius-card)] border border-line bg-raised/40 px-2.5 py-1.5">
                <span className="min-w-0 flex-1 truncate font-mono text-[0.78rem] text-ink">{name}</span>
                <span className="shrink-0 font-mono text-[0.66rem] text-ink-ghost">
                  {describeValue(getPath(custom, [name, "mode"]))}
                </span>
                <Button size="sm" variant="ghost" onClick={() => void remove(name)} aria-label={`Delete ${name}`}>
                  <Trash2 size={11} />
                </Button>
              </div>
            ))}
          </div>
        )}

        <div className="mt-2">
          <Button size="sm" onClick={() => setAdding((v) => !v)} aria-expanded={adding}>
            <Plus size={12} />
            {adding ? "Cancel" : "New agent"}
          </Button>
        </div>

        <AnimatePresence>
          {adding && (
            <AddPanel title="New agent" onCancel={() => setAdding(false)}>
              <div className="flex flex-col gap-1.5">
                <div className="grid grid-cols-2 gap-1.5">
                  <Input
                    value={form.name}
                    onChange={(e) => setForm({ ...form, name: e.target.value })}
                    placeholder="name (e.g. reviewer)"
                  />
                  <select
                    value={form.mode}
                    onChange={(e) => setForm({ ...form, mode: e.target.value as "primary" | "subagent" })}
                    className="h-8 rounded-[7px] border border-line bg-surface px-2 text-[0.8rem] text-ink outline-none focus:border-accent/60"
                  >
                    <option value="subagent">subagent</option>
                    <option value="primary">primary</option>
                  </select>
                </div>
                <Input
                  value={form.description}
                  onChange={(e) => setForm({ ...form, description: e.target.value })}
                  placeholder="short description"
                />
                <Input
                  value={form.model}
                  onChange={(e) => setForm({ ...form, model: e.target.value })}
                  placeholder="model override (optional, e.g. opencode/exo-free)"
                />
                <Textarea
                  value={form.prompt}
                  onChange={(e) => setForm({ ...form, prompt: e.target.value })}
                  placeholder="System prompt for this agent…"
                  rows={5}
                  className="text-[0.78rem]"
                />
              </div>
              {error && <p className="mt-1.5 text-[0.74rem] text-danger">{error}</p>}
              <div className="mt-2 flex items-center gap-2">
                <Button
                  size="sm"
                  variant="primary"
                  disabled={busy || !form.name.trim() || !form.prompt.trim()}
                  onClick={() => void submit()}
                >
                  {busy ? <Loader2 size={12} className="animate-spin" /> : "Save & restart"}
                </Button>
                <span className="text-[0.68rem] text-ink-ghost">writes to agent config</span>
              </div>
            </AddPanel>
          )}
        </AnimatePresence>
      </Group>

      <Group label="Built-in subagents" hint={`${subagents.length} available`}>
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

export function McpTab() {
  const servers = useSystem((s) => s.mcp);
  const refresh = useSystem((s) => s.refreshDiagnostics);
  const draft = useSettings((s) => s.draft);
  const setDraft = useSettings((s) => s.setDraft);
  const effective = useSettings((s) => s.effective);
  const save = useSettings((s) => s.save);
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ name: "", url: "", command: "", args: "" });
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ kind: "ok" | "error"; text: string } | null>(null);

  const rows = useMemo(
    () => Object.entries(servers).sort(([a], [b]) => a.localeCompare(b)),
    [servers],
  );

  /**
   * `POST /mcp` replaces a server's whole config and — verified on 1.18.35 —
   * never writes it to disk. So every change goes through the config file the
   * app already knows how to write, then restarts opencode. Live status still
   * comes from `GET /mcp`.
   */
  const configuredMcp = (): Record<string, unknown> => {
    const fromDraft = safeParse(draft).mcp;
    if (fromDraft && typeof fromDraft === "object") return fromDraft as Record<string, unknown>;
    const fromEffective = effective?.["mcp"];
    return fromEffective && typeof fromEffective === "object"
      ? (fromEffective as Record<string, unknown>)
      : {};
  };

  const commit = async (next: Record<string, unknown>) => {
    const { setPath, formatConfig } = await import("@/state/settings");
    setDraft(formatConfig(setPath(safeParse(draft), ["mcp"], next)));
    return save();
  };

  const add = async () => {
    setBusy(true);
    setNotice(null);
    try {
      const entry = form.command.trim()
        ? {
            type: "local",
            command: [form.command.trim(), ...form.args.split(/\s+/).filter(Boolean)],
            enabled: true,
          }
        : { type: "remote", url: form.url.trim(), enabled: true };

      const name = form.name.trim();
      const ok = await commit({ ...configuredMcp(), [name]: entry });
      if (!ok) {
        setNotice({ kind: "error", text: "could not save the config" });
        return;
      }
      setForm({ name: "", url: "", command: "", args: "" });
      setAdding(false);
      await refresh();
      setNotice({ kind: "ok", text: `Added ${name}` });
    } finally {
      setBusy(false);
    }
  };

  const toggle = async (name: string) => {
    setBusy(true);
    setNotice(null);
    try {
      const current = configuredMcp();
      const existing = current[name];
      const base =
        existing && typeof existing === "object"
          ? (existing as Record<string, unknown>)
          : { type: "remote", url: `https://${name}.invalid/mcp` };
      const ok = await commit({ ...current, [name]: { ...base, enabled: !base.enabled } });
      if (!ok) setNotice({ kind: "error", text: `could not toggle ${name}` });
      else await refresh();
    } finally {
      setBusy(false);
    }
  };

  const remove = async (name: string) => {
    setBusy(true);
    setNotice(null);
    try {
      const current = { ...configuredMcp() };
      delete current[name];
      const ok = await commit(current);
      if (!ok) setNotice({ kind: "error", text: `could not remove ${name}` });
      else {
        await refresh();
        setNotice({ kind: "ok", text: `Removed ${name}` });
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      {notice && <Notice kind={notice.kind}>{notice.text}</Notice>}

      <Group label="Servers" hint={`${rows.length} configured · live status`}>
        {rows.length === 0 ? (
          <Empty>No MCP servers. Add one below.</Empty>
        ) : (
          <div className="flex flex-col gap-1">
            {rows.map(([name, state]) => (
              <McpRow
                key={name}
                name={name}
                state={state}
                busy={busy}
                onToggle={() => toggle(name)}
                onRemove={() => remove(name)}
                onRetry={async () => {
                  await refresh();
                }}
              />
            ))}
          </div>
        )}
      </Group>

      <Group label="Add a server" hint="written to the config file, then opencode restarts">
        <Button size="sm" onClick={() => setAdding((v) => !v)} aria-expanded={adding}>
          <Plus size={12} />
          {adding ? "Cancel" : "Add server"}
        </Button>

        <AnimatePresence>
          {adding && (
            <AddPanel title="Add an MCP server" onCancel={() => setAdding(false)}>
              <div className="flex flex-col gap-1.5">
                <Input
                  autoFocus
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  placeholder="name (e.g. github)"
                />
                <Input
                  value={form.url}
                  onChange={(e) => setForm({ ...form, url: e.target.value })}
                  placeholder="remote URL — https://mcp.example.com"
                />
                <div className="flex items-center gap-2 text-[0.68rem] text-ink-ghost">
                  <span className="h-px flex-1 bg-line" />
                  or
                  <span className="h-px flex-1 bg-line" />
                </div>
                <Input
                  value={form.command}
                  onChange={(e) => setForm({ ...form, command: e.target.value })}
                  placeholder="local command — npx"
                />
                <Input
                  value={form.args}
                  onChange={(e) => setForm({ ...form, args: e.target.value })}
                  placeholder="arguments — -y @modelcontextprotocol/server-github"
                />
              </div>
              <div className="mt-2 flex items-center gap-2">
                <Button
                  size="sm"
                  variant="primary"
                  disabled={busy || !form.name.trim() || (!form.url.trim() && !form.command.trim())}
                  onClick={() => void add()}
                >
                  {busy ? <Loader2 size={12} className="animate-spin" /> : "Save & restart"}
                </Button>
                <span className="text-[0.68rem] text-ink-ghost">
                  {form.command.trim() ? "local" : "remote"} server
                </span>
              </div>
            </AddPanel>
          )}
        </AnimatePresence>
      </Group>
    </div>
  );
}

function McpRow({
  name,
  state,
  busy,
  onToggle,
  onRemove,
  onRetry,
}: {
  name: string;
  state: McpState;
  busy: boolean;
  onToggle(): Promise<void>;
  onRemove(): Promise<void>;
  onRetry(): Promise<void>;
}) {
  const status = state.status ?? "unknown";
  const disabled = status === "disabled";
  const needsAuth = status === "needs_auth" || status === "needs_client_registration";

  return (
    <div className="flex items-center gap-2 rounded-[var(--radius-card)] border border-line bg-raised/40 px-2.5 py-1.5">
      <span className="min-w-0 flex-1 truncate font-mono text-[0.78rem] text-ink">{name}</span>
      <Badge
        tone={
          status === "connected" ? "good" : disabled ? "neutral" : status === "failed" ? "danger" : "warn"
        }
      >
        {status}
      </Badge>

      {needsAuth && (
        <Badge tone="warn" className="cursor-help" title="This server needs authentication before it can be used.">
          needs login
        </Badge>
      )}

      {status === "failed" && (
        <Button size="sm" disabled={busy} onClick={() => void onRetry()}>
          <RefreshCw size={11} />
          Refresh
        </Button>
      )}

      <Button size="sm" variant="ghost" disabled={busy} onClick={() => void onToggle()}>
        {disabled ? "Enable" : "Disable"}
      </Button>

      <Button
        size="sm"
        variant="ghost"
        disabled={busy}
        onClick={() => void onRemove()}
        aria-label={`Remove ${name}`}
      >
        <Trash2 size={11} />
      </Button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Permissions
// ---------------------------------------------------------------------------

const PERMISSION_ACTIONS = ["read", "edit", "glob", "grep", "list", "bash", "task", "webfetch"];
const PERMISSION_VALUES = ["allow", "ask", "deny"] as const;

export function PermissionsTab() {
  const effective = useSettings((s) => s.effective);
  const draft = useSettings((s) => s.draft);
  const dirty = useSettings((s) => s.dirty);
  const saving = useSettings((s) => s.saving);
  const save = useSettings((s) => s.save);
  const [savingKey, setSavingKey] = useState<string | null>(null);

  const source = dirty ? safeParse(draft) : (effective ?? {});

  const update = async (action: string, value: string) => {
    setSavingKey(action);
    const { setPath, formatConfig } = await import("@/state/settings");
    const next = setPath(safeParse(draft), ["permission", action], value);
    useSettings.getState().setDraft(formatConfig(next));
    await save();
    setSavingKey(null);
  };

  return (
    <div>
      <Group label="Tool permissions" hint="ask stops the agent until you approve it in the thread">
        <div className="overflow-hidden rounded-[var(--radius-card)] border border-line">
          {PERMISSION_ACTIONS.map((action, index) => {
            const current = getPath(source, ["permission", action], "ask");
            return (
              <div
                key={action}
                className={cn("flex items-center gap-3 px-2.5 py-1.5", index > 0 && "border-t border-line/60")}
              >
                <span className="w-20 shrink-0 font-mono text-[0.78rem] text-ink">{action}</span>
                <div className="flex gap-1">
                  {PERMISSION_VALUES.map((value) => (
                    <Button
                      key={value}
                      size="sm"
                      variant={current === value ? "primary" : "ghost"}
                      disabled={saving || savingKey === action}
                      onClick={() => void update(action, value)}
                    >
                      {savingKey === action ? <Loader2 size={11} className="animate-spin" /> : value}
                    </Button>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
        <p className="mt-1.5 text-[0.7rem] text-ink-ghost">
          Saving restarts opencode. Per-glob rules go in the raw editor.
        </p>
      </Group>

      <SaveBar dirty={dirty} saving={saving} onSave={() => void save()} />
    </div>
  );
}

function safeParse(text: string): Record<string, unknown> {
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    return {};
  }
}

// ---------------------------------------------------------------------------
// Raw config
// ---------------------------------------------------------------------------

export function ConfigTab() {
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
          <span className="truncate font-mono">{file?.path ?? "…"}</span>
        </button>
        <Button
          size="sm"
          variant="ghost"
          aria-label="Choose a config file"
          onClick={async () => {
            const picked = await saveDialog({
              title: "Save config as",
              defaultPath: file?.path,
              filters: [{ name: "JSON", extensions: ["json", "jsonc"] }],
            });
            if (typeof picked === "string") await setDraft(await readTextFile(picked));
          }}
        >
          <Upload size={12} />
        </Button>
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
        placeholder={'{\n  "$schema": "https://opencode.ai/config.json"\n}'}
        className="scroll-area min-h-[240px] flex-1 resize-none font-mono text-[0.74rem] leading-[1.55]"
      />

      {error && (
        <p className="mt-1.5 flex items-start gap-1.5 text-[0.74rem] text-danger">
          <AlertTriangle size={11} className="mt-0.5 shrink-0" />
          {error}
        </p>
      )}

      <SaveBar dirty={dirty} saving={saving} onSave={() => void save()} onRevert={revert} />

      <Group label="Effective config" hint="merged, read-only">
        <pre className="scroll-area max-h-32 overflow-auto rounded-[var(--radius-card)] border border-line bg-raised/40 p-2 font-mono text-[0.68rem] text-ink-faint">
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
            <RefreshCw size={10} className="text-warn" />
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
            Revert
          </Button>
        )}
        <Button size="sm" variant="primary" disabled={!dirty || saving} onClick={onSave}>
          {saving ? <Loader2 size={12} className="animate-spin" /> : null}
          Save &amp; restart
        </Button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Diagnostics
// ---------------------------------------------------------------------------

export function DiagnosticsTab() {
  const lsp = useSystem((s) => s.lsp);
  const formatters = useSystem((s) => s.formatters);
  const loading = useSystem((s) => s.loading);

  const noneLoaded = !loading && lsp.length === 0 && formatters.length === 0;

  return (
    <div>
      <Group label="Language servers" hint={loading ? "loading…" : `${lsp.length} detected`}>
        {loading ? (
          <SkeletonList count={2} />
        ) : lsp.length === 0 ? (
          <Empty>No language servers detected for this project.</Empty>
        ) : (
          <div className="flex flex-col gap-1">
            {lsp.map((server) => (
              <div key={server.id ?? server.name} className="flex items-center gap-2 rounded-[var(--radius-card)] border border-line bg-raised/40 px-2.5 py-1.5">
                <span className="min-w-0 flex-1 truncate text-[0.8rem] text-ink">{server.name}</span>
                <Badge tone={server.status === "connected" || server.status === "ready" ? "good" : "neutral"}>
                  {server.status}
                </Badge>
              </div>
            ))}
          </div>
        )}
      </Group>

      <Group label="Formatters" hint={loading ? "loading…" : `${formatters.length} configured`}>
        {loading ? (
          <SkeletonList count={2} />
        ) : formatters.length === 0 ? (
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

      {!loading && noneLoaded && (
        <p className="text-[0.72rem] text-ink-ghost">
          Add servers under &quot;lsp&quot; and &quot;formatter&quot; in the Config tab.
        </p>
      )}
    </div>
  );
}

async function readTextFile(path: string): Promise<string> {
  const { readTextFile: read } = await import("@tauri-apps/plugin-fs");
  return read(path);
}

export { SkeletonBlock, SkeletonRow, SkeletonCard };