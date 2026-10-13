/**
 * How each opencode tool presents itself.
 *
 * Every tool used to render as a generic row with a title guessed from the
 * first argument it recognised, which made a glob search and a todo read
 * indistinguishable from each other. Each tool actually has a
 * natural way of reading — a match count, a diff, a provider name — and this
 * module is where that knowledge lives.
 *
 * Kept free of React so the decisions can be tested directly.
 */

import { normaliseTodos, type Todo, type ToolState } from "@/lib/opencode/types";

export interface ToolView {
  /** Icon key, resolved to a component by the caller. */
  icon: "bash" | "read" | "write" | "edit" | "search" | "glob" | "grep" | "list" | "web" | "task" | "todo" | "skill" | "patch" | "question" | "lsp" | "batch" | "agent" | "invalid" | "generic";
  /** Headline. */
  title: string;
  /** Secondary line, e.g. "12 matches". */
  description?: string;
  /** Body to reveal when expanded: diff or file contents. */
  body?: { kind: "diff"; text: string } | { kind: "code"; text: string; language?: string };
  /** Parsed todos, for the todo renderer. */
  todos?: Todo[];
}

function str(input: Record<string, unknown> | undefined, key: string): string | undefined {
  const value = input?.[key];
  return typeof value === "string" && value.trim() ? value : undefined;
}

/** The server's title, but only when it actually said something. */
function titleOf(state: ToolState): string | undefined {
  return state.title?.trim() ? state.title.trim() : undefined;
}

function count(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

/**
 * English pluralisation for the handful of nouns used here.
 *
 * Naive `word + "s"` gives "matchs" and "filees", and `word + "es"` gives
 * "tooles", so the usual three rules cover it: sibilant endings take -es, a
 * consonant plus y becomes -ies, everything else takes -s.
 */
export function plural(n: number, word: string): string {
  if (n === 1) return `${n} ${word}`;
  if (/(s|x|z|ch|sh)$/.test(word)) return `${n} ${word}es`;
  if (/[^aeiou]y$/.test(word)) return `${n} ${word.slice(0, -1)}ies`;
  return `${n} ${word}s`;
}

/**
 * Shorten a path for display.
 *
 * Absolute paths from the agent are mostly noise — the interesting part is the
 * tail. Keeping a couple of leading segments preserves context when the file
 * sits in a nested directory.
 */
export function shortenPath(path: string | undefined): string {
  if (!path) return "";
  const segments = path.replaceAll("\\", "/").split("/").filter(Boolean);
  if (segments.length <= 3) return path;
  return `…/${segments.slice(-3).join("/")}`;
}

function languageFor(path: string | undefined): string | undefined {
  if (!path) return undefined;
  const ext = path.split(".").pop()?.toLowerCase();
  const map: Record<string, string> = {
    ts: "ts", tsx: "tsx", js: "js", jsx: "jsx", rs: "rust", py: "python",
    go: "go", rb: "ruby", java: "java", c: "c", cpp: "cpp", h: "c", cs: "csharp",
    sh: "bash", bash: "bash", zsh: "bash", json: "json", yaml: "yaml", yml: "yaml",
    toml: "toml", md: "markdown", css: "css", html: "html", sql: "sql", vue: "vue",
    svelte: "svelte", php: "php", lua: "lua", swift: "swift", kt: "kotlin",
  };
  return map[ext ?? ""];
}

/**
 * Build the presentation for a tool call.
 *
 * Falls back to the server's own title, then to a generic row, so a tool added
 * to a newer opencode still renders something sensible rather than nothing.
 */
export function describeTool(tool: string, state: ToolState): ToolView {
  const input = state.input;
  const meta = state.metadata ?? {};

  switch (tool) {
    case "bash": {
      const command = str(input, "command");
      const workdir = str(input, "workdir");
      return {
        icon: "bash",
        title: command ? `$ ${command}` : titleOf(state) ?? "Run command",
        description: workdir && workdir !== "." ? `in ${shortenPath(workdir)}` : undefined,
      };
    }

    case "read":
      return {
        icon: "read",
        title: `Read ${shortenPath(str(input, "filePath")) || "file"}`,
        description: str(input, "offset") ? `offset ${input?.offset}` : undefined,
      };

    case "write": {
      const path = str(input, "filePath");
      const content = str(input, "content") ?? (state.status === "completed" ? state.output : undefined);
      return {
        icon: "write",
        title: `Wrote ${shortenPath(path) || "file"}`,
        body: content && path ? { kind: "code", text: content, language: languageFor(path) } : undefined,
      };
    }

    case "edit": {
      const path = str(input, "filePath");
      // The diff arrives in metadata, not output, so without this an edit
      // renders as a bare line with nothing to show.
      const diff = meta.diff ?? (state.status === "completed" ? state.output : undefined);
      return {
        icon: "edit",
        title: `Edited ${shortenPath(path) || "file"}`,
        body: diff?.trim() ? { kind: "diff", text: diff } : undefined,
      };
    }

    case "glob": {
      const pattern = str(input, "pattern");
      const path = str(input, "path");
      const n = count(meta.count);
      return {
        icon: "glob",
        title: `Glob "${pattern ?? ""}"`,
        description: [path ? `in ${shortenPath(path)}` : undefined, n === undefined ? undefined : plural(n, "match")]
          .filter(Boolean)
          .join(" · ") || undefined,
      };
    }

    case "grep": {
      const pattern = str(input, "pattern");
      const path = str(input, "path");
      const n = count(meta.matches);
      return {
        icon: "grep",
        title: `Grep "${pattern ?? ""}"`,
        description: [path ? `in ${shortenPath(path)}` : undefined, n === undefined ? undefined : plural(n, "match")]
          .filter(Boolean)
          .join(" · ") || undefined,
      };
    }

    case "list":
    case "ls":
      return { icon: "list", title: `List ${shortenPath(str(input, "path")) || "directory"}` };

    case "webfetch": {
      const url = str(input, "url");
      return { icon: "web", title: url ? `Fetch ${url}` : "Fetch page" };
    }

    case "websearch": {
      const query = str(input, "query");
      const provider = typeof meta.provider === "string" ? meta.provider : undefined;
      return {
        icon: "search",
        title: query ? `Search "${query}"` : "Search",
        description: provider ? `via ${provider}` : undefined,
      };
    }

    case "task":
      return {
        icon: "task",
        title: titleOf(state) ?? str(input, "description") ?? "Run agent",
        description: str(input, "subagent_type") ? `${input?.subagent_type} agent` : undefined,
      };

    case "todowrite": {
      // Prefer the metadata mirror: it survives truncation of a long list, and
      // it is the same list the sidebar and /session/todo serve.
      const todos = normaliseTodos(meta.todos ?? input?.todos);
      return {
        icon: "todo",
        title: "Todos",
        todos,
        description: meta.truncated ? `${todos.length} shown` : undefined,
      };
    }

    case "todoread":
      return { icon: "todo", title: "Read todos", description: state.status === "completed" ? undefined : undefined };

    case "skill":
      return { icon: "skill", title: `Skill "${str(input, "name") ?? ""}"` };

    case "patch": {
      const files = Array.isArray(meta.files) ? meta.files : [];
      const combined = files
        .map((f) => f.patch ?? "")
        .filter(Boolean)
        .join("\n");
      return {
        icon: "patch",
        title: files.length ? `Patch ${plural(files.length, "file")}` : "Patch",
        body: combined.trim() ? { kind: "diff", text: combined } : undefined,
      };
    }

    case "question": {
      const questions = Array.isArray(input?.questions) ? (input.questions as Array<Record<string, unknown>>) : [];
      const answers = Array.isArray(meta.answers) ? (meta.answers as string[][]) : [];
      return {
        icon: "question",
        title: `Asked ${plural(questions.length, "question")}`,
        description: answers.flat().filter(Boolean).slice(0, 2).join("; ") || undefined,
      };
    }

    case "lsp":
      return {
        icon: "lsp",
        title: titleOf(state) ?? `LSP ${str(input, "operation") ?? "request"}`,
      };

    case "batch": {
      const calls = Array.isArray(input?.tool_calls) ? (input.tool_calls as unknown[]).length : 0;
      return {
        icon: "batch",
        title: titleOf(state) ?? (calls ? `Batch ${plural(calls, "tool")}` : "Batch"),
      };
    }

    case "switch_agent":
    case "agent":
      return {
        icon: "agent",
        title: titleOf(state) ?? "Switch agent",
        description: str(input, "agent") ?? undefined,
      };

    case "invalid":
      return { icon: "invalid", title: titleOf(state) ?? "Invalid tool call" };

    default:
      return { icon: "generic", title: titleOf(state) ?? tool };
  }
}

/** Whether a tool has something worth revealing when clicked. */
export function hasBody(view: ToolView): boolean {
  return Boolean(view.body?.text.trim());
}
