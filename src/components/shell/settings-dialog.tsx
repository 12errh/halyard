import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { open } from "@tauri-apps/plugin-dialog";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SectionLabel } from "@/components/ui/primitives";
import { FONT_OPTIONS } from "@/lib/fonts";
import { cn } from "@/lib/utils";
import { useProjects } from "@/state/projects";
import { DEFAULT_APPEARANCE, useUi, type ThemeChoice } from "@/state/ui";

type TabId =
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
  { id: "lsp", label: "LSP" },
];

export function SettingsDialog({ open, onClose }: { open: boolean; onClose(): void }) {
  const [tab, setTab] = useState<TabId>("appearance");

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
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            onClick={onClose}
            className="absolute inset-0 bg-black/50 backdrop-blur-[2px]"
          />

          <motion.div
            initial={{ opacity: 0, scale: 0.98, y: 6 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.985, y: 4 }}
            transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
            className="relative flex h-[min(620px,80vh)] w-[min(880px,92vw)] flex-col overflow-hidden rounded-[var(--radius-panel)] border border-line-strong bg-surface shadow-[var(--shadow-panel)]"
          >
            <header className="flex items-center justify-between border-b border-line px-4 py-2.5">
              <h2 className="text-[0.9rem] font-medium tracking-tight">Settings</h2>
              <Button variant="ghost" size="icon-sm" onClick={onClose} aria-label="Close settings">
                <X size={14} />
              </Button>
            </header>

            <div className="flex min-h-0 flex-1">
              <nav className="scroll-area w-[168px] shrink-0 border-r border-line p-2">
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
                {tab === "appearance" ? (
                  <AppearanceTab />
                ) : (
                  <DeferredTab label={TABS.find((t) => t.id === tab)?.label ?? tab} />
                )}
              </div>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}

function DeferredTab({ label }: { label: string }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 text-center">
      <SectionLabel>{label}</SectionLabel>
      <p className="max-w-xs text-[0.82rem] text-ink-faint">
        This tab is wired up in slice 3. The navigation and layout are final.
      </p>
    </div>
  );
}

function AppearanceTab() {
  const appearance = useUi((s) => s.appearance);
  const setTheme = useUi((s) => s.setTheme);
  const setFont = useUi((s) => s.setFont);
  const setDensity = useUi((s) => s.setDensity);
  const setReduceMotion = useUi((s) => s.setReduceMotion);

  const binaryOverride = useProjects((s) => s.binaryOverride);
  const setBinaryOverride = useProjects((s) => s.setBinaryOverride);

  return (
    <div className="flex flex-col gap-6">
      <Group label="Theme">
        <div className="flex gap-1.5">
          {(["dark", "light", "system"] as ThemeChoice[]).map((choice) => (
            <Button
              key={choice}
              size="sm"
              variant={appearance.theme === choice ? "primary" : "secondary"}
              onClick={() => setTheme(choice)}
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
              onClick={() => setFont(font.id)}
              className={cn(
                "flex flex-col items-start gap-0.5 rounded-[7px] border px-2.5 py-2 text-left transition-colors",
                appearance.font === font.id
                  ? "border-accent/55 bg-accent/10"
                  : "border-line hover:border-line-strong hover:bg-raised",
              )}
            >
              <span
                className="text-[0.82rem] text-ink"
                style={{ fontFamily: font.ui }}
              >
                {font.label}
              </span>
              <span className="text-[0.66rem] text-ink-ghost">{font.hint}</span>
            </button>
          ))}
        </div>
        {appearance.font === "pixelcode" && (
          <p className="mt-1.5 text-[0.72rem] text-warn/85">
            PixelCode is a pixel face. If it reads as too retro for long sessions, try Geist or Inter.
          </p>
        )}
      </Group>

      <Group label="Density" hint={`${Math.round(appearance.density * 100)}%`}>
        <input
          type="range"
          min={0.85}
          max={1.25}
          step={0.05}
          value={appearance.density}
          onChange={(event) => setDensity(Number(event.target.value))}
          className="w-full accent-[var(--accent)]"
        />
      </Group>

      <Group label="Motion">
        <label className="flex items-center gap-2 text-[0.82rem] text-ink-muted">
          <input
            type="checkbox"
            checked={appearance.reduceMotion}
            onChange={(event) => setReduceMotion(event.target.checked)}
            className="accent-[var(--accent)]"
          />
          Reduce animation
        </label>
      </Group>

      <Group label="opencode binary" hint="Leave empty to use the copy on PATH.">
        <div className="flex gap-1.5">
          <Input
            value={binaryOverride ?? ""}
            onChange={(event) => setBinaryOverride(event.target.value || null)}
            placeholder="opencode"
            className="font-mono text-[0.76rem]"
          />
          <Button
            size="sm"
            onClick={async () => {
              const picked = await open({ multiple: false, title: "Select opencode binary" });
              if (typeof picked === "string") await setBinaryOverride(picked);
            }}
          >
            Browse…
          </Button>
          {binaryOverride && (
            <Button size="sm" variant="ghost" onClick={() => void setBinaryOverride(null)}>
              Reset
            </Button>
          )}
        </div>
      </Group>

      <div className="rounded-[var(--radius-card)] border border-line bg-raised/50 px-3 py-2 text-[0.72rem] text-ink-ghost">
        Changes apply immediately. Defaults: {DEFAULT_APPEARANCE.theme} theme, {DEFAULT_APPEARANCE.font} font.
      </div>
    </div>
  );
}

function Group({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <section>
      <div className="mb-2 flex items-baseline gap-2">
        <SectionLabel>{label}</SectionLabel>
        {hint && <span className="text-[0.68rem] text-ink-ghost">{hint}</span>}
      </div>
      {children}
    </section>
  );
}
