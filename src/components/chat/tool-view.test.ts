import { describe, expect, it } from "vitest";
import { describeTool, hasBody, shortenPath } from "@/components/chat/tool-view";
import { normaliseTodo, normaliseTodos, todoProgress, type ToolState } from "@/lib/opencode/types";

const running: ToolState = { status: "running", input: {} };
function done(input: Record<string, unknown>, metadata?: Record<string, unknown>, output = ""): ToolState {
  return { status: "completed", input, output, title: "", time: { created: 1, completed: 2 }, metadata };
}

describe("todo normalisation", () => {
  it("keeps the fields a plan actually renders from", () => {
    expect(
      normaliseTodo({ content: "write tests", status: "in_progress", priority: "high", id: "t1" }),
    ).toEqual({ content: "write tests", status: "in_progress", priority: "high", id: "t1" });
  });

  it("drops entries with no text", () => {
    // A blank row would render as an empty bullet that can never be ticked.
    expect(normaliseTodo({ status: "pending" })).toBeNull();
    expect(normaliseTodo({ content: "   " })).toBeNull();
  });

  it("defaults status and priority rather than leaving them blank", () => {
    expect(normaliseTodo({ content: "x" })).toMatchObject({ status: "pending", priority: "medium" });
  });

  it("survives junk", () => {
    expect(normaliseTodos(null)).toEqual([]);
    expect(normaliseTodos("nope")).toEqual([]);
    expect(normaliseTodos([null, 3, { content: "ok" }])).toHaveLength(1);
  });

  it("counts completed, cancelled and active separately", () => {
    const todos = normaliseTodos([
      { content: "a", status: "completed" },
      { content: "b", status: "in_progress" },
      { content: "c", status: "pending" },
      { content: "d", status: "cancelled" },
    ]);
    expect(todoProgress(todos)).toEqual({ done: 2, total: 4, active: 1 });
  });

  it("reports zero for an empty list rather than dividing by zero", () => {
    expect(todoProgress([])).toEqual({ done: 0, total: 0, active: 0 });
  });
});

describe("tool presentation", () => {
  it("titles a glob the way a person would say it", () => {
    const view = describeTool("glob", done({ pattern: "**/*.ts", path: "/repo/src" }, { count: 12 }));
    expect(view.icon).toBe("glob");
    expect(view.title).toBe('Glob "**/*.ts"');
    expect(view.description).toContain("12 matches");
  });

  it("singularises a single match", () => {
    expect(describeTool("grep", done({ pattern: "x" }, { matches: 1 })).description).toContain("1 match");
    expect(describeTool("grep", done({ pattern: "x" }, { matches: 1 })).description).not.toContain("matches");
  });

  it("surfaces the diff an edit actually made", () => {
    // Without metadata.diff an edit renders as a bare line with nothing behind
    // it, which is the whole point of the call.
    const view = describeTool("edit", done({ filePath: "/home/me/repo/src/a.ts" }, { diff: "@@ -1 +1 @@\n-a\n+b" }));
    expect(view.title).toBe("Edited …/repo/src/a.ts");
    expect(view.body).toEqual({ kind: "diff", text: "@@ -1 +1 @@\n-a\n+b" });
    expect(hasBody(view)).toBe(true);
  });

  it("shows the contents a write produced", () => {
    const view = describeTool("write", done({ filePath: "/home/me/repo/a.ts", content: "export const a = 1;" }));
    expect(view.body).toEqual({ kind: "code", text: "export const a = 1;", language: "ts" });
  });

  it("omits a body when there is nothing to show", () => {
    const view = describeTool("read", done({ filePath: "/home/me/repo/a.ts" }));
    expect(view.body).toBeUndefined();
    expect(hasBody(view)).toBe(false);
  });

  it("names the search provider when one answered", () => {
    expect(describeTool("websearch", done({ query: "rust async" }, { provider: "exa" })).description).toBe("via exa");
  });

  it("renders a todowrite as a plan rather than a blob of JSON", () => {
    const view = describeTool(
      "todowrite",
      done({ todos: [{ content: "one" }, { content: "two" }] }),
    );
    expect(view.icon).toBe("todo");
    expect(view.todos).toHaveLength(2);
  });

  it("prefers the metadata mirror of the plan", () => {
    // The server truncates very long lists in the input but keeps the full
    // set alongside, so the mirror is the better source.
    const view = describeTool(
      "todowrite",
      done({ todos: [{ content: "one" }] }, { todos: [{ content: "one" }, { content: "two" }], truncated: true }),
    );
    expect(view.todos).toHaveLength(2);
    expect(view.description).toContain("2 shown");
  });

  it("counts the files a patch touched", () => {
    const view = describeTool("patch", done({}, { files: [{ patch: "a" }, { patch: "b" }] }));
    expect(view.title).toBe("Patch 2 files");
    expect(view.body?.text).toContain("a");
  });

  it("summarises the answers a question collected", () => {
    const view = describeTool(
      "question",
      done({ questions: [{ question: "Which?" }] }, { answers: [["the second one"]] }),
    );
    expect(view.title).toBe("Asked 1 question");
    expect(view.description).toContain("the second one");
  });

  it("shows a running command as a shell line", () => {
    const view = describeTool("bash", { status: "running", input: { command: "pnpm test" } });
    expect(view.title).toBe("$ pnpm test");
    expect(view.icon).toBe("bash");
  });

  it("mentions the working directory when it is not the default", () => {
    expect(describeTool("bash", running).title).toBe("Run command");
    expect(describeTool("bash", { status: "running", input: { command: "ls", workdir: "/home/me/repo/api" } }).description)
      .toBe("in …/me/repo/api");
  });

  it("falls back gracefully for a tool it has never heard of", () => {
    // A newer opencode must still render something, not nothing.
    const view = describeTool("some_future_tool", done({}, undefined, "ok"));
    expect(view.icon).toBe("generic");
    expect(view.title).toBe("some_future_tool");
  });

  it("prefers the server's own title when it supplied one", () => {
    const view = describeTool("mystery", { status: "completed", input: {}, output: "", title: "Server says so", time: { created: 1 } });
    expect(view.title).toBe("Server says so");
  });
});

describe("path shortening", () => {
  it("leaves a bare filename alone", () => {
    expect(shortenPath("a.ts")).toBe("a.ts");
  });

  it("leaves a path that is already short enough to read", () => {
    expect(shortenPath("a/b/c.ts")).toBe("a/b/c.ts");
    expect(shortenPath("/repo/api")).toBe("/repo/api");
  });

  it("keeps the tail of a deep path", () => {
    expect(shortenPath("/home/me/projects/api/src/server/app.ts")).toBe("…/src/server/app.ts");
  });

  it("handles nothing at all", () => {
    expect(shortenPath(undefined)).toBe("");
  });
});
