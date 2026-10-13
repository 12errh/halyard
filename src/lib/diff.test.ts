import { describe, expect, it } from "vitest";
import { formatCounts, normaliseDiff, parsePatch } from "@/lib/diff";

const SAMPLE = [
  "diff --git a/src/a.ts b/src/a.ts",
  "index 1234567..89abcde 100644",
  "--- a/src/a.ts",
  "+++ b/src/a.ts",
  "@@ -1,4 +1,5 @@",
  " const a = 1;",
  "-const b = 2;",
  "+const b = 3;",
  "+const c = 4;",
  " export { a };",
].join("\n");

describe("parsePatch", () => {
  it("returns nothing for absent input", () => {
    expect(parsePatch(undefined)).toEqual({ hunks: [], additions: 0, deletions: 0 });
    expect(parsePatch("")).toEqual({ hunks: [], additions: 0, deletions: 0 });
    expect(parsePatch(null)).toEqual({ hunks: [], additions: 0, deletions: 0 });
  });

  it("ignores the file header before the first hunk", () => {
    const { hunks } = parsePatch(SAMPLE);
    expect(hunks).toHaveLength(1);
    expect(hunks[0]!.lines.map((l) => l.text)).not.toContain("diff --git a/src/a.ts b/src/a.ts");
  });

  it("reads hunk start positions", () => {
    const [hunk] = parsePatch(SAMPLE).hunks;
    expect(hunk).toMatchObject({ oldStart: 1, oldLines: 4, newStart: 1, newLines: 5 });
  });

  it("defaults an omitted hunk count to one", () => {
    const [hunk] = parsePatch("@@ -3 +3 @@\n-a\n+b").hunks;
    expect(hunk).toMatchObject({ oldStart: 3, oldLines: 1, newStart: 3, newLines: 1 });
  });

  it("captures the section heading after the closing @@", () => {
    const [hunk] = parsePatch("@@ -1,2 +1,2 @@ function foo() {\n a\n-b\n+b").hunks;
    expect(hunk!.header).toBe("function foo() {");
  });

  it("counts additions and deletions", () => {
    const parsed = parsePatch(SAMPLE);
    expect(parsed.additions).toBe(2);
    expect(parsed.deletions).toBe(1);
  });

  it("tracks line numbers across both sides", () => {
    const lines = parsePatch(SAMPLE).hunks[0]!.lines;
    expect(lines[0]).toMatchObject({ kind: "context", oldLine: 1, newLine: 1 });
    expect(lines[1]!.kind).toBe("del");
    expect(lines[1]!.oldLine).toBe(2);
    // A deleted line has no position in the new file at all.
    expect("newLine" in lines[1]!).toBe(false);
    expect(lines[2]!.kind).toBe("add");
    expect(lines[2]!.newLine).toBe(2);
    expect("oldLine" in lines[2]!).toBe(false);
    expect(lines[3]).toMatchObject({ kind: "add", newLine: 3 });
    expect(lines[4]).toMatchObject({ kind: "context", oldLine: 3, newLine: 4 });
  });

  it("handles CRLF patches", () => {
    const parsed = parsePatch(SAMPLE.replace(/\n/g, "\r\n"));
    expect(parsed.additions).toBe(2);
    expect(parsed.deletions).toBe(1);
  });

  it("treats a bare empty line as an empty context line", () => {
    const [hunk] = parsePatch("@@ -1,2 +1,2 @@\n a\n\n").hunks;
    expect(hunk!.lines[1]).toMatchObject({ kind: "context", text: "" });
  });

  it("skips the no-newline marker", () => {
    const [hunk] = parsePatch("@@ -1,1 +1,1 @@\n-a\n+b\n\\ No newline at end of file").hunks;
    expect(hunk!.lines).toHaveLength(2);
  });

  it("stops trusting a hunk it does not understand", () => {
    // Better to render nothing than to render a corrupt patch as if it were real.
    const parsed = parsePatch("@@ -1,2 +1,2 @@\n a\n!!!garbage!!!\n+b");
    expect(parsed.hunks[0]!.lines).toHaveLength(1);
  });

  it("drops a trailing empty hunk", () => {
    const parsed = parsePatch("@@ -1,2 +1,2 @@\n-a\n+b\n@@ -10,2 +10,2 @@");
    expect(parsed.hunks).toHaveLength(1);
  });

  it("parses multiple hunks independently", () => {
    const parsed = parsePatch(
      ["@@ -1,2 +1,2 @@", " a", "+b", "@@ -20,2 +20,3 @@", " c", "+d", "+e"].join("\n"),
    );
    expect(parsed.hunks).toHaveLength(2);
    expect(parsed.hunks[1]).toMatchObject({ oldStart: 20 });
    expect(parsed.additions).toBe(3);
  });

  it("handles a patch with no trailing newline", () => {
    expect(parsePatch("@@ -1,1 +1,1 @@\n-a\n+b").additions).toBe(1);
  });
});

describe("normaliseDiff", () => {
  it("reads the SnapshotFileDiff shape keyed by file", () => {
    const diff = normaliseDiff({ file: "src/a.ts", additions: 2, deletions: 1, status: "modified" });
    expect(diff).toMatchObject({ path: "src/a.ts", status: "modified", additions: 2, deletions: 1 });
  });

  it("reads the FileDiff shape keyed by path", () => {
    const diff = normaliseDiff({ path: "src/b.ts", additions: 0, deletions: 3 });
    expect(diff).toMatchObject({ path: "src/b.ts", status: "unknown", deletions: 3 });
  });

  it("derives counts from the patch when the server omits them", () => {
    const diff = normaliseDiff({ file: "src/c.ts", patch: SAMPLE });
    expect(diff!.additions).toBe(2);
    expect(diff!.deletions).toBe(1);
  });

  it("rejects entries with no usable path", () => {
    expect(normaliseDiff({ additions: 1 })).toBeNull();
    expect(normaliseDiff(null)).toBeNull();
    expect(normaliseDiff("nope")).toBeNull();
  });
});

describe("formatCounts", () => {
  it("uses a proper minus sign for readability", () => {
    expect(formatCounts(3, 1)).toBe("+3 −1");
  });
});
