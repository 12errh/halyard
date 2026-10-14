import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

/**
 * Architecture guard: zustand selectors must return a stable reference.
 *
 * `useStore((s) => ({ ... }))` looks like it reads four fields. It does not — it
 * allocates a new object on every render, so `useSyncExternalStore` compares a
 * fresh snapshot against a fresh snapshot, concludes the store changed, and
 * re-renders. Forever. React then kills the tree with
 *
 *   "The result of getSnapshot should be cached to avoid an infinite loop"
 *   "Maximum update depth exceeded"
 *
 * and the whole shell unmounts. That crash happened in the running app, with
 * every unit test green, because no unit test mounts the component. This test
 * reads the source instead, so it covers every file — including the ones with
 * no tests at all — and costs nothing to run.
 *
 * The fix, in order of preference: select the fields separately (the common
 * case), wrap in `useShallow` when one object is genuinely wanted, or hoist the
 * object out of the selector.
 */

const ROOT = path.resolve(import.meta.dirname, "..");

/**
 * Selectors that allocate. Each produces a new reference on every render.
 *
 * The two literal forms are anchored to the start of the body, because that is
 * where the paren-then-brace of `=> ({` sits. The rest are matched anywhere in
 * the body, since `.filter()` can appear at any depth.
 */
const UNSTABLE = [
  { label: "object literal", re: /^\(\s*\{/ },
  { label: "array literal", re: /^\(\s*\[/ },
  { label: ".map(", re: /\.map\(/ },
  { label: ".filter(", re: /\.filter\(/ },
  { label: ".slice(", re: /\.slice\(/ },
  { label: ".concat(", re: /\.concat\(/ },
  { label: "new Set(", re: /new Set\(/ },
  { label: "new Map(", re: /new Map\(/ },
  { label: "JSON.parse", re: /JSON\.parse\(/ },
  { label: "Object.entries/keys/values", re: /Object\.(entries|keys|values)\(/ },
];

function sourceFiles(dir: string, found: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) {
      sourceFiles(full, found);
    } else if (/\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry)) {
      found.push(full);
    }
  }
  return found;
}

/** Line number of `offset`, 1-based. */
const lineAt = (text: string, offset: number) => text.slice(0, offset).split("\n").length;

/**
 * Find every `useSomething((s) => …)` selector and return the body of each.
 *
 * Brace-matched rather than regex-matched on a single line, because the
 * offending selector is usually written across five of them.
 */
function selectors(source: string): { start: number; end: number }[] {
  const found: { start: number; end: number }[] = [];
  const open = /use[A-Z][A-Za-z0-9]*\(\s*\(\s*[a-zA-Z_$][\w$]*\s*\)\s*=>/g;

  while (open.exec(source) !== null) {
    // Step past the `(s) =>` to the start of the returned expression.
    let i = open.lastIndex;
    while (i < source.length && /\s/.test(source[i]!)) i++;

    let depth = 0;
    let end = i;
    for (; end < source.length; end++) {
      const ch = source[end]!;
      if ("([{".includes(ch)) depth++;
      else if (")]}".includes(ch)) {
        // `})` closes the selector's own call, not a nested expression.
        if (depth === 0) break;
        depth--;
      } else if (ch === ";" || ch === "\n") {
        // A statement ended without ever closing the group: not a selector
        // body we can reason about. Give up rather than guess.
        if (depth === 0) break;
      }
    }
    found.push({ start: i, end });
    open.lastIndex = end;
  }

  return found;
}

const files = sourceFiles(ROOT);
const offenders: string[] = [];

for (const file of files) {
  const source = readFileSync(file, "utf8");
  const relative = path.relative(ROOT, file);

  for (const { start, end } of selectors(source)) {
    // Trim the trailing `)` that closes the hook call, then judge the rest.
    const body = source.slice(start, end).trimEnd().replace(/\)$/, "");
    const hit = UNSTABLE.find((rule) => rule.re.test(body));
    if (hit) {
      offenders.push(`${relative}:${lineAt(source, start)}  selector allocates — ${hit.label}`);
    }
  }
}

describe("zustand selector stability", () => {
  it("finds the source files it is guarding", () => {
    expect(files.length).toBeGreaterThan(50);
  });

  it("has no selector that allocates on every render", () => {
    expect(offenders).toEqual([]);
  });
});
