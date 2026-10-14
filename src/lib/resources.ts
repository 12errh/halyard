/**
 * Skills and other resources opencode can offer the agent.
 *
 * These arrive as one flat map keyed by a prefixed id, where a skill is a set
 * of files sharing a `skill://<name>/` prefix and `SKILL.md` is the entry
 * point. Regrouping them here means the UI can show a skill as one thing with
 * its supporting files underneath, rather than 158 unrelated rows.
 */

import type { ClientResources } from "@/lib/opencode/types";

export interface SkillFile {
  /** Path within the skill, e.g. `scripts/setup_env.py`. */
  path: string;
  mimeType?: string;
  /** The server that supplied it, e.g. an MCP client name. */
  client?: string;
}

export interface Skill {
  name: string;
  description?: string;
  files: SkillFile[];
  /** True when a `SKILL.md` is present, which is what makes it loadable. */
  loadable: boolean;
}

/** Entries whose uri is not under a `skill://` scheme. */
export interface LooseResource {
  id: string;
  uri: string;
  description?: string;
  client?: string;
}

const SKILL = /^skill:\/\/([^/]+)\/(.+)$/;

/**
 * Group a flat resource map into skills and leftovers.
 *
 * Tolerant by design: a resource missing its id, or with an unrecognised
 * scheme, is still worth listing rather than dropping — the whole point is to
 * show what is available.
 */
export function groupResources(raw: Record<string, unknown> | null | undefined): {
  skills: Skill[];
  loose: LooseResource[];
} {
  const skills = new Map<string, Skill>();
  const loose: LooseResource[] = [];

  for (const [id, value] of Object.entries(raw ?? {})) {
    const record = (value ?? {}) as Record<string, unknown>;
    const uri = typeof record.uri === "string" ? record.uri : id;
    const client = typeof record.client === "string" ? record.client : undefined;
    const mimeType = typeof record.mimeType === "string" ? record.mimeType : undefined;

    const match = SKILL.exec(uri);
    if (!match) {
      loose.push({
        id,
        uri,
        description: typeof record.description === "string" ? record.description : undefined,
        client,
      });
      continue;
    }

    const name = match[1];
    const path = match[2];
    // The pattern has two capture groups, so these are always present; the
    // guard is here because the type system cannot know that.
    if (!name || !path) continue;

    const skill: Skill = skills.get(name) ?? { name, files: [], loadable: false };
    skill.files.push({ path, mimeType, client });

    // The manifest is what the agent actually reads; anything else is
    // supporting material the skill may pull in on demand.
    if (path === "SKILL.md") {
      skill.loadable = true;
      if (typeof record.description === "string") skill.description = record.description;
    }
    skills.set(name, skill);
  }

  for (const skill of skills.values()) {
    // The manifest leads: it is the one file worth reading, and a plain
    // alphabetical sort puts `scripts/...` before `SKILL.md` because locale
    // comparison ignores case.
    skill.files.sort((a, b) => {
      if (a.path === "SKILL.md") return -1;
      if (b.path === "SKILL.md") return 1;
      return a.path.localeCompare(b.path);
    });
  }

  return {
    // Skills with a manifest first: those are the ones that can be invoked.
    skills: [...skills.values()].sort(
      (a, b) => Number(b.loadable) - Number(a.loadable) || a.name.localeCompare(b.name),
    ),
    loose: loose.sort((a, b) => a.uri.localeCompare(b.uri)),
  };
}

/** A one-line summary for a skill, falling back to its file count. */
export function summariseSkill(skill: Skill): string {
  if (skill.description) return skill.description;
  const extras = skill.files.length - 1;
  return extras > 0 ? `${extras} supporting file${extras === 1 ? "" : "s"}` : "No description";
}

/** Filter skills by a free-text query over name and description. */
export function searchSkills(skills: Skill[], query: string): Skill[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return skills;
  return skills.filter(
    (skill) =>
      skill.name.toLowerCase().includes(needle) ||
      (skill.description ?? "").toLowerCase().includes(needle),
  );
}

export type { ClientResources };
