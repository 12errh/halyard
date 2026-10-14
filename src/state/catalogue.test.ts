import { beforeEach, describe, expect, it, vi } from "vitest";
import { useCatalogue } from "@/state/catalogue";
import { OpencodeClient } from "@/lib/opencode/client";

interface Route {
  match: RegExp;
  body: unknown;
  fail?: boolean;
}

function fakeClient(routes: Route[]) {
  const calls: string[] = [];
  const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    calls.push(url);
    const route = routes.find((r) => r.match.test(url));
    if (!route) return new Response("[]", { status: 404 });
    if (route.fail) return new Response("nope", { status: 500 });
    return new Response(JSON.stringify(route.body), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  });
  return { client: new OpencodeClient("http://127.0.0.1:1", fetchImpl as unknown as typeof fetch), calls, fetchImpl };
}

const COMMANDS = [
  { name: "init", description: "Analyse the repo" },
  { name: "brainstorming", description: "Think out loud", source: "skill" },
];

const RESOURCES = {
  "skill://brainstorming/SKILL.md": { uri: "skill://brainstorming/SKILL.md", mimeType: "text/markdown" },
  "skill://writing/SKILL.md": { uri: "skill://writing/SKILL.md" },
  "skill://writing/refs/style.md": { uri: "skill://writing/refs/style.md" },
};

describe("catalogue", () => {
  beforeEach(() => {
    useCatalogue.setState({
      commands: [],
      skills: [],
      loaded: false,
      loading: false,
      error: null,
      client: null,
    });
  });

  it("fetches once however many times it is asked", async () => {
    const { client, calls } = fakeClient([
      { match: /\/command$/, body: COMMANDS },
      { match: /\/experimental\/resource/, body: RESOURCES },
    ]);
    useCatalogue.getState().setClient(client);

    await Promise.all([
      useCatalogue.getState().load(),
      useCatalogue.getState().load(),
      useCatalogue.getState().load(),
    ]);
    await useCatalogue.getState().load();

    expect(calls.filter((url) => url.endsWith("/command"))).toHaveLength(1);
    expect(useCatalogue.getState().commands.map((c) => c.label)).toEqual([
      "skill",
      "init",
      "brainstorming",
    ]);
  });

  it("puts /skill first, because it is the one worth reaching for", async () => {
    const { client } = fakeClient([
      { match: /\/command$/, body: COMMANDS },
      { match: /\/experimental\/resource/, body: RESOURCES },
    ]);
    useCatalogue.getState().setClient(client);
    await useCatalogue.getState().load();

    expect(useCatalogue.getState().commands[0]).toMatchObject({
      label: "skill",
      opens: "skills",
    });
  });

  it("marks skills as skills so the menu can group them", async () => {
    const { client } = fakeClient([
      { match: /\/command$/, body: COMMANDS },
      { match: /\/experimental\/resource/, body: RESOURCES },
    ]);
    useCatalogue.getState().setClient(client);
    await useCatalogue.getState().load();

    const skill = useCatalogue.getState().commands.find((c) => c.label === "brainstorming");
    expect(skill?.source).toBe("skill");
  });

  it("collects skills for the picker, one entry per skill", async () => {
    const { client } = fakeClient([
      { match: /\/command$/, body: COMMANDS },
      { match: /\/experimental\/resource/, body: RESOURCES },
    ]);
    useCatalogue.getState().setClient(client);
    await useCatalogue.getState().load();

    expect(useCatalogue.getState().skills.map((s) => s.name).sort()).toEqual([
      "brainstorming",
      "writing",
    ]);
  });

  it("says so when the command list cannot be read, instead of showing nothing", async () => {
    const { client } = fakeClient([
      { match: /\/command$/, body: [], fail: true },
      { match: /\/experimental\/resource/, body: RESOURCES },
    ]);
    useCatalogue.getState().setClient(client);
    await useCatalogue.getState().load();

    expect(useCatalogue.getState().error).not.toBeNull();
  });

  it("drops the old list when the server changes", async () => {
    const first = fakeClient([
      { match: /\/command$/, body: COMMANDS },
      { match: /\/experimental\/resource/, body: RESOURCES },
    ]);
    useCatalogue.getState().setClient(first.client);
    await useCatalogue.getState().load();
    expect(useCatalogue.getState().commands.length).toBeGreaterThan(0);

    useCatalogue.getState().setClient(
      fakeClient([
        { match: /\/command$/, body: [] },
        { match: /\/experimental\/resource/, body: {} },
      ]).client,
    );
    expect(useCatalogue.getState().commands).toEqual([]);
    expect(useCatalogue.getState().loaded).toBe(false);
  });

  it("re-reads after opencode announces a change", async () => {
    const { client, calls } = fakeClient([
      { match: /\/command$/, body: COMMANDS },
      { match: /\/experimental\/resource/, body: RESOURCES },
    ]);
    useCatalogue.getState().setClient(client);
    await useCatalogue.getState().load();
    expect(calls.filter((u) => u.endsWith("/command"))).toHaveLength(1);

    useCatalogue.getState().ingest({ type: "plugin.added" } as never);
    await Promise.resolve();
    await new Promise((r) => setTimeout(r, 0));
    expect(calls.filter((u) => u.endsWith("/command"))).toHaveLength(2);
  });

  it("ignores events that cannot change the command list", async () => {
    const { client, calls } = fakeClient([
      { match: /\/command$/, body: COMMANDS },
      { match: /\/experimental\/resource/, body: RESOURCES },
    ]);
    useCatalogue.getState().setClient(client);
    await useCatalogue.getState().load();

    useCatalogue.getState().ingest({ type: "lsp.updated" } as never);
    await new Promise((r) => setTimeout(r, 0));
    expect(calls.filter((u) => u.endsWith("/command"))).toHaveLength(1);
  });
});
