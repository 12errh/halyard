import { useEffect, useMemo, useState } from "react";
import { Package } from "lucide-react";
import { Empty, Group } from "./settings-groups";
import { Input } from "@/components/ui/input";
import { useSystem } from "@/state/system";
import type { SkillInfo } from "@/lib/opencode/types";

/**
 * Skills the agent can be given.
 *
 * Read-only on purpose: a skill is invoked by name in a prompt, so browsing
 * them here is about knowing what exists — a catalogue, not a settings page.
 */
export function ResourcesTab() {
  const client = useSystem((s) => s.client);

  const [skills, setSkills] = useState<SkillInfo[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");

  useEffect(() => {
    if (!client) return;
    let cancelled = false;
    void client
      .skills()
      .then((value) => {
        if (cancelled) return;
        setSkills(value);
        setError(null);
      })
      .catch(() => {
        if (cancelled) return;
        setError("Could not read the skill list.");
      });
    return () => {
      cancelled = true;
    };
  }, [client]);

  const rows = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return (skills ?? [])
      .map((skill) => ({
        name: skill.name,
        description: skill.description ?? "",
        path: skill.location ?? (typeof skill.path === "string" ? skill.path : ""),
      }))
      .filter(
        (skill) =>
          !needle || `${skill.name} ${skill.description} ${skill.path}`.toLowerCase().includes(needle),
      );
  }, [skills, query]);

  return (
    <div>
      <Group
        label="Skills"
        hint={`${skills?.length ?? 0} available · invoked by name in a prompt`}
      >
        <Input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Filter skills…"
          aria-label="Filter skills"
        />
      </Group>

      {error && <Empty>{error}</Empty>}
      {!error && skills === null && <Empty>Reading skills…</Empty>}
      {!error && skills !== null && rows.length === 0 && (
        <Empty>
          {query.trim() ? `No skill matches “${query}”.` : "No skills installed for this project."}
        </Empty>
      )}

      {rows.length > 0 && (
        <div className="overflow-hidden rounded-[var(--radius-card)] border border-line">
          {rows.map((skill, index) => (
            <div
              key={skill.path || skill.name}
              className={`flex items-start gap-2 px-2.5 py-1.5 ${index > 0 ? "border-t border-line/60" : ""}`}
            >
              <Package size={12} className="mt-0.5 shrink-0 text-ink-ghost" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[0.82rem] text-ink">{skill.name}</span>
                {skill.description && (
                  <span className="block truncate text-[0.72rem] text-ink-muted">
                    {skill.description}
                  </span>
                )}
                {skill.path && (
                  <span className="block truncate font-mono text-[0.66rem] text-ink-ghost">
                    {skill.path}
                  </span>
                )}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
