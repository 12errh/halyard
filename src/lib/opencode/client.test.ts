import { describe, expect, it } from "vitest";
import { OpencodeClient, OpencodeError } from "@/lib/opencode/client";

const BASE = "http://127.0.0.1:4096";
const PASSWORD = "hunter2";
const AUTH = `Basic ${btoa(`opencode:${PASSWORD}`)}`;

type Handler = (url: string, init: RequestInit) => Response | Promise<Response>;

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function harness(handler: Handler) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    const url =
      typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const request = init ?? {};
    calls.push({ url, init: request });
    return handler(url, request);
  };
  return { client: new OpencodeClient(BASE, PASSWORD, fetchImpl), calls };
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}

function header(init: RequestInit, name: string): string | undefined {
  const headers = init.headers;
  if (!headers) return undefined;
  if (headers instanceof Headers) return headers.get(name) ?? undefined;
  const record = headers as Record<string, string>;
  return record[name] ?? record[name.toLowerCase()];
}

// ---------------------------------------------------------------------------

describe("auth", () => {
  it("sends the exact Basic header on every request", async () => {
    const { client, calls } = harness((url) => {
      if (url.includes("/api/info")) return json({ version: "2.4.2" });
      if (url.includes("/api/vcs")) return json({ data: {} });
      if (url.includes("/api/fs/read")) return new Response("text");
      return new Response(null, { status: 204 });
    });

    await client.info();
    await client.listSessions();
    await client.createSession();
    await client.updateSession("ses_1", { title: "T" });
    await client.deleteSession("ses_1");
    await client.vcs();
    await client.readFile("README.md");

    expect(calls).toHaveLength(7);
    for (const call of calls) {
      expect(header(call.init, "Authorization")).toBe(AUTH);
    }
  });

  it("sets content-type only when it sends a body", async () => {
    const { client, calls } = harness((url) =>
      url.includes("/api/info")
        ? json({ version: "2.4.2" })
        : json({ data: { id: "ses_1" } }),
    );

    await client.info();
    await client.createSession({ title: "New" });

    expect(header(calls[0]!.init, "Content-Type")).toBeUndefined();
    expect(header(calls[1]!.init, "Content-Type")).toBe("application/json");
    expect(calls[1]!.init.body).toBe(JSON.stringify({ title: "New" }));
  });

  it("never carries the password in the query or body", async () => {
    const { client, calls } = harness(() => json({ data: [] }));

    await client.info();

    expect(calls[0]!.url).not.toContain(PASSWORD);
    expect(calls[0]!.init.body).toBeUndefined();
  });
});

describe("transport", () => {
  it("returns undefined for a 204", async () => {
    const { client } = harness(() => new Response(null, { status: 204 }));
    await expect(client.updateSession("ses_1", { archived: true })).resolves.toBeUndefined();
  });

  it("surfaces the flat error envelope", async () => {
    const { client } = harness(() =>
      json({ _tag: "BadRequest", message: "session not found", kind: "BadRequest" }, 404),
    );

    await expect(client.getSession("ses_missing")).rejects.toMatchObject({
      message: "session not found",
      status: 404,
    });
    await expect(client.getSession("ses_missing")).rejects.toBeInstanceOf(OpencodeError);
  });

  it("maps list options onto the camelCase query keys", async () => {
    const { client, calls } = harness(() =>
      json({ data: [], cursor: { next: "n2", previous: null } }),
    );

    const page = await client.listSessions({
      limit: 5,
      cursor: "c1",
      search: "hi",
      parentID: "ses_parent",
      archived: true,
    });

    expect(page).toEqual({ data: [], cursor: { next: "n2", previous: null } });
    const url = calls[0]!.url;
    expect(url).toContain("limit=5");
    expect(url).toContain("cursor=c1");
    expect(url).toContain("search=hi");
    expect(url).toContain("parentID=ses_parent");
    expect(url).toContain("archived=true");
  });

  it("unwraps data pages for messages", async () => {
    const { client } = harness(() =>
      json({ data: [{ id: "msg_1" }], cursor: { next: "n1" } }),
    );

    const page = await client.messages("ses_1", { limit: 10 });
    expect(page.data).toEqual([{ id: "msg_1" }]);
    expect(page.cursor).toEqual({ next: "n1" });
  });

  it("unwraps the active session map", async () => {
    const { client } = harness(() => json({ data: { ses_1: { type: "running" } } }));
    await expect(client.active()).resolves.toEqual({ ses_1: { type: "running" } });
  });

  it("flattens the vcs branch names", async () => {
    const withBranches = harness(() =>
      json({ data: { branch: { current: "feature", default: "main" } } }),
    );
    await expect(withBranches.client.vcs()).resolves.toEqual({
      branch: "feature",
      defaultBranch: "main",
    });

    const empty = harness(() => json({ data: {} }));
    await expect(empty.client.vcs()).resolves.toEqual({ branch: null, defaultBranch: null });
  });

  it("maps fs entries to paths", async () => {
    const { client, calls } = harness(() =>
      json({
        data: [
          { path: "src/a.ts", type: "file" },
          { path: "src/b.ts", type: "file" },
        ],
      }),
    );

    await expect(client.files("index", 5)).resolves.toEqual(["src/a.ts", "src/b.ts"]);
    expect(calls[0]!.url).toContain("query=index");
    expect(calls[0]!.url).toContain("type=file");
    expect(calls[0]!.url).toContain("limit=5");
  });

  it("reads files as raw text and encodes each path segment", async () => {
    const { client, calls } = harness(() => new Response("export const x = 1;\n"));

    await expect(client.readFile("src/my file.ts")).resolves.toBe("export const x = 1;\n");
    expect(calls[0]!.url).toBe(`${BASE}/api/fs/read/src/my%20file.ts`);
  });

  it("posts the session model and agent as wrapped bodies", async () => {
    const { client, calls } = harness(() => new Response(null, { status: 204 }));

    await client.setSessionModel("ses_1", { id: "claude", providerID: "anthropic" });
    await client.setSessionAgent("ses_1", "build");

    expect(calls[0]!.url).toBe(`${BASE}/api/session/ses_1/model`);
    expect(calls[0]!.init.body).toBe(
      JSON.stringify({ model: { id: "claude", providerID: "anthropic" } }),
    );
    expect(calls[1]!.init.body).toBe(JSON.stringify({ agent: "build" }));
  });
});

describe("events", () => {
  it("builds the v2 events URL", () => {
    const { client } = harness(() => new Response(null, { status: 204 }));
    expect(client.eventsUrl()).toBe(`${BASE}/api/event`);
  });

  it("changes serverKey when only the password changes", () => {
    const first = new OpencodeClient(BASE, "first");
    const second = new OpencodeClient(BASE, "second");
    const same = new OpencodeClient(BASE, "first");

    expect(first.serverKey).not.toBe(second.serverKey);
    expect(first.serverKey).toBe(same.serverKey);
  });

  it("attaches credentials and the SSE accept header", async () => {
    let headers: Record<string, string> | undefined;
    const connected = deferred();
    const fetchImpl: typeof fetch = async (_input, init) => {
      headers = init?.headers as Record<string, string> | undefined;
      connected.resolve();
      return new Response("", { status: 200 });
    };

    const client = new OpencodeClient(BASE, PASSWORD);
    const handle = client.subscribeEvents({
      onEvent: () => {},
      fetchImpl,
      retryDelayMs: 1000,
    });
    await connected.promise;
    handle.close();

    expect(headers?.Authorization).toBe(AUTH);
    expect(headers?.Accept).toBe("text/event-stream");
  });
});
