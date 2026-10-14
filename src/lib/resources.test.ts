import { describe, expect, it } from "vitest";
import { groupResources, searchSkills, summariseSkill } from "@/lib/resources";
import { changedCount, indexFiles, onDefaultBranch } from "@/state/project-info";

const entry = (extra: Record<string, unknown> = {}) => extra;

describe("grouping resources into skills", () => {
  it("collects a skill's files under one entry", () => {
    const { skills } = groupResources({
      "HF:skill://hf-cli/SKILL.md": entry({ uri: "skill://hf-cli/SKILL.md", client: "HF" }),
      "HF:skill://setup/scripts/run.py": entry({ uri: "skill://setup/scripts/run.py" }),
      "HF:skill://setup/SKILL.md": entry({ uri: "skill://setup/SKILL.md" }),
    });

    expect(skills.map((s) => s.name).sort()).toEqual(["hf-cli", "setup"]);
    const setup = skills.find((s) => s.name === "setup");
    expect(setup?.files.map((f) => f.path)).toEqual(["SKILL.md", "scripts/run.py"]);
  });

  it("marks a skill loadable only when it has a manifest", () => {
    // Without SKILL.md the agent has nothing to read, so it is not something
    // that can be invoked by name.
    const { skills } = groupResources({
      a: entry({ uri: "skill://with/SKILL.md" }),
      b: entry({ uri: "skill://without/notes.md" }),
    });
    expect(skills.find((s) => s.name === "with")?.loadable).toBe(true);
    expect(skills.find((s) => s.name === "without")?.loadable).toBe(false);
  });

  it("puts loadable skills first", () => {
    const { skills } = groupResources({
      a: entry({ uri: "skill://aaa/notes.md" }),
      b: entry({ uri: "skill://zzz/SKILL.md" }),
    });
    expect(skills[0]?.name).toBe("zzz");
  });

  it("keeps non-skill resources rather than dropping them", () => {
    const { loose } = groupResources({
      x: entry({ uri: "file:///tmp/readme.md", client: "MCP" }),
    });
    expect(loose).toHaveLength(1);
    expect(loose[0]?.client).toBe("MCP");
  });

  it("survives an empty, null or malformed payload", () => {
    expect(groupResources(null)).toEqual({ skills: [], loose: [] });
    expect(groupResources({})).toEqual({ skills: [], loose: [] });
    expect(groupResources({ a: null }).loose).toHaveLength(1);
    expect(groupResources({ a: 42 }).loose).toHaveLength(1);
  });

  it("summarises a skill that has no description", () => {
    const { skills } = groupResources({
      a: entry({ uri: "skill://x/SKILL.md" }),
      b: entry({ uri: "skill://x/scripts/a.py" }),
    });
    expect(summariseSkill(skills[0]!)).toBe("1 supporting file");
  });
});

describe("searching skills", () => {
  const { skills } = groupResources({
    a: entry({ uri: "skill://aws-context/SKILL.md", description: "Discover your AWS profile" }),
    b: entry({ uri: "skill://pdf-extract/SKILL.md", description: "Pull tables out of PDFs" }),
  });

  it("matches on name", () => {
    expect(searchSkills(skills, "pdf").map((s) => s.name)).toEqual(["pdf-extract"]);
  });

  it("matches on description", () => {
    expect(searchSkills(skills, "profile").map((s) => s.name)).toEqual(["aws-context"]);
  });

  it("is case insensitive", () => {
    expect(searchSkills(skills, "PDF")).toHaveLength(1);
  });

  it("returns everything for an empty query", () => {
    expect(searchSkills(skills, "   ")).toHaveLength(2);
  });
});

describe("project info", () => {
  it("indexes file status by path", () => {
    expect(indexFiles([{ file: "a.ts", status: "modified" }, { path: "b.ts" }])).toEqual({
      "a.ts": "modified",
      "b.ts": "modified",
    });
  });

  it("ignores entries with no path", () => {
    expect(indexFiles([{ status: "modified" }])).toEqual({});
  });

  it("counts changed files", () => {
    expect(changedCount({ "a.ts": "modified", "b.ts": "added" })).toBe(2);
    expect(changedCount({})).toBe(0);
  });

  it("treats an unknown branch as the default one", () => {
    // A repository with no commits has neither branch; showing a warning
    // badge for "you are not on master" would be wrong.
    expect(onDefaultBranch({ branch: null, defaultBranch: null })).toBe(true);
    expect(onDefaultBranch({ branch: "feat/x", defaultBranch: "master" })).toBe(false);
    expect(onDefaultBranch({ branch: "master", defaultBranch: "master" })).toBe(true);
  });
});
