/**
 * Unified-diff parsing.
 *
 * opencode hands us raw patches as strings; rendering needs structure. Kept as
 * a pure module so the (fiddly) hunk-header and line-prefix rules are pinned by
 * tests rather than discovered in production.
 */

export type DiffLineKind = "context" | "add" | "del" | "meta";

export interface DiffLine {
  kind: DiffLineKind;
  text: string;
  /** 1-based line number in the old file, when the line exists there. */
  oldLine?: number;
  /** 1-based line number in the new file, when the line exists there. */
  newLine?: number;
}

export interface DiffHunk {
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  header: string;
  lines: DiffLine[];
}

export interface ParsedPatch {
  hunks: DiffHunk[];
  additions: number;
  deletions: number;
}

/** `@@ -12,7 +12,9 @@ optional section heading` */
const HUNK = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(.*)$/;

export function parsePatch(patch: string | undefined | null): ParsedPatch {
  const result: ParsedPatch = { hunks: [], additions: 0, deletions: 0 };
  if (!patch) return result;

  // Normalise CRLF first. `.` in the hunk regex excludes `\r` (a JS line
  // terminator), so a CRLF patch would never match a hunk header at all — and
  // leaving it in would also show up as trailing whitespace in every line.
  const lines = patch.replace(/\r\n?/g, "\n").split("\n");

  let current: DiffHunk | null = null;
  let oldLine = 0;
  let newLine = 0;

  for (const raw of lines) {
    const match = HUNK.exec(raw);

    if (match) {
      const oldStart = Number(match[1]);
      const newStart = Number(match[3]);
      current = {
        oldStart,
        oldLines: match[2] === undefined ? 1 : Number(match[2]),
        newStart,
        newLines: match[4] === undefined ? 1 : Number(match[4]),
        header: (match[5] ?? "").trim(),
        lines: [],
      };
      result.hunks.push(current);
      oldLine = oldStart;
      newLine = newStart;
      continue;
    }

    // Anything before the first hunk header is file metadata (diff --git, index,
    // --- / +++). Keep it out of the body.
    if (!current) continue;

    // Trailing "\ No newline at end of file" is metadata, not content.
    if (raw.startsWith("\\")) continue;

    if (raw.startsWith("+")) {
      current.lines.push({ kind: "add", text: raw.slice(1), newLine });
      newLine += 1;
      result.additions += 1;
    } else if (raw.startsWith("-")) {
      current.lines.push({ kind: "del", text: raw.slice(1), oldLine });
      oldLine += 1;
      result.deletions += 1;
    } else if (raw.startsWith(" ") || raw === "") {
      // A truly empty line in a patch means an empty context line; git emits it
      // without the leading space only for the final newline of the file.
      current.lines.push({ kind: "context", text: raw.slice(1), oldLine, newLine });
      oldLine += 1;
      newLine += 1;
    } else {
      // Unknown prefix: stop trusting the hunk rather than render garbage.
      current = null;
    }
  }

  // Drop a trailing hunk that produced nothing, which happens when the patch
  // ends on a header.
  if (current && current.lines.length === 0) result.hunks.pop();

  return result;
}

export interface NormalisedDiff {
  /** Path under either key, since the server uses `file` and `path`. */
  path: string;
  status: "added" | "deleted" | "modified" | "unknown";
  additions: number;
  deletions: number;
  patch?: string;
}

/**
 * Normalise the two diff shapes the server emits.
 *
 * `GET /session/:id/diff` returns `SnapshotFileDiff` (keyed `file`), while the
 * `session.diff` event carries `FileDiff` (keyed `path`).
 */
export function normaliseDiff(raw: unknown): NormalisedDiff | null {
  if (!raw || typeof raw !== "object") return null;
  const record = raw as Record<string, unknown>;

  const path = typeof record.file === "string" ? record.file : typeof record.path === "string" ? record.path : "";
  if (!path) return null;

  const statusRaw = typeof record.status === "string" ? record.status : "";
  const status =
    statusRaw === "added" || statusRaw === "deleted" || statusRaw === "modified"
      ? statusRaw
      : "unknown";

  // Prefer counting from the patch itself; the server's counters can be stale
  // for binary files and are absent entirely on some payloads.
  const parsed = parsePatch(typeof record.patch === "string" ? record.patch : "");
  const additions =
    typeof record.additions === "number" ? record.additions : parsed.additions;
  const deletions =
    typeof record.deletions === "number" ? record.deletions : parsed.deletions;

  return {
    path,
    status,
    additions,
    deletions,
    patch: typeof record.patch === "string" ? record.patch : undefined,
  };
}

export function formatCounts(additions: number, deletions: number): string {
  return `+${additions} −${deletions}`;
}
