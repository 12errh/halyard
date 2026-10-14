import { useEffect, useMemo, useState } from "react";
import { FileText, Folder, Package } from "lucide-react";
import { Empty, Group } from "./settings-groups";
import { Input } from "@/components/ui/input";
import { groupResources, searchSkills, summariseSkill, type Skill } from "@/lib/resources";
import { useOpencodeClient } from "@/hooks/use-opencode-client";

/**
 * Skills and resources the agent can be given.
 *
 * Read-only on purpose: a skill is invoked by name in a prompt, so browsing
 * them here is about knowing what exists — a catalog, not a settings page.
 */
export function ResourcesTab() {
  const client = useOpencodeClient();

  const [raw, setRaw] = useState<Record<string, unknown> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [openSkill, setOpenSkill] = useState<string | null>(null);

  useEffect(() => {
    if (!client) return;
    let cancelled = false;
    void client
      .resources()
      .then((value: Record<string, unknown>) => {
        if (!cancelled) {
          setRaw(value);
          setError(null);
        }
      })
      .catch(() => {
        if (!cancelled) setError("Could not read the resource list.");
      });
    return () => {
      cancelled = true;
    };
  }, [client]);

  const { skills, loose } = useMemo(() => groupResources(raw), [raw]);
  const shown = useMemo(() => searchSkills(skills, query), [skills, query]);

  return (
    <div>
      <Group label="Search" hint={`${skills.length} skills · ${loose.length} other resources`}>
        <Input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Filter skills…"
          aria-label="Filter skills"
        />
      </Group>

      {error && <Empty>{error}</Empty>}
      {!error && raw === null && <Empty>Reading resources…</Empty>}
      {raw !== null && shown.length === 0 && <Empty>No skill matches “{query}”.</Empty>}

      {shown.map((skill) => (
        <SkillCard
          key={skill.name}
          skill={skill}
          expanded={openSkill === skill.name}
          onToggle={() => setOpenSkill(openSkill === skill.name ? null : skill.name)}
        />
      ))}

      {loose.length > 0 && (
        <Group label="Other resources" hint="Not a skill, but available to the agent.">
          <ul className="space-y-px">
            {loose.slice(0, 40).map((resource) => (
              <li
                key={resource.id}
                className="flex items-center gap-2 rounded-[6px] px-2 py-1.5 text-[0.76rem] text-ink-muted"
              >
                <FileText size={11} className="shrink-0 text-ink-ghost" />
                <span className="min-w-0 flex-1 truncate font-mono text-[0.72rem]">{resource.uri}</span>
                {resource.client && (
                  <span className="shrink-0 text-[0.68rem] text-ink-ghost">{resource.client}</span>
                )}
              </li>
            ))}
          </ul>
        </Group>
      )}
    </div>
  );
}

function SkillCard({
  skill,
  expanded,
  onToggle,
}: {
  skill: Skill;
  expanded: boolean;
  onToggle(): void;
}) {
  return (
    <section className="mb-1.5 overflow-hidden rounded-[var(--radius-card)] border border-line">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={expanded}
        className="flex w-full items-center gap-2 px-2.5 py-2 text-left transition-colors hover:bg-raised/60"
      >
        <Package size={12} className={skill.loadable ? "shrink-0 text-accent" : "shrink-0 text-ink-ghost"} />
        <span className="min-w-0 flex-1">
          <span className="block truncate font-mono text-[0.76rem] text-ink">{skill.name}</span>
          <span className="block truncate text-[0.68rem] text-ink-ghost">{summariseSkill(skill)}</span>
        </span>
        <span className="tabular shrink-0 text-[0.66rem] text-ink-ghost">{skill.files.length}</span>
      </button>

      {expanded && (
        <ul className="border-t border-line/70 bg-raised/30 px-2.5 py-1.5">
          {skill.files.map((file) => (
            <li key={file.path} className="flex items-center gap-2 py-0.5 text-[0.72rem] text-ink-faint">
              <Folder size={10} className="shrink-0 text-ink-ghost" />
              <span className="min-w-0 flex-1 truncate font-mono">{file.path}</span>
              {file.mimeType && <span className="shrink-0 text-[0.64rem] text-ink-ghost">{file.mimeType}</span>}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
