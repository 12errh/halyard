import { describe, expect, it, vi } from "vitest";
import { OpencodeClient, OpencodeError } from "@/lib/opencode/client";

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response;
}

describe("OpencodeClient", () => {
  it("targets the configured base url", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse([]));
    const client = new OpencodeClient("http://127.0.0.1:5555", fetchImpl);

    await client.listSessions();

    expect(fetchImpl).toHaveBeenCalledWith("http://127.0.0.1:5555/session", expect.anything());
  });

  it("builds the event stream url", () => {
    expect(new OpencodeClient("http://127.0.0.1:4096").eventsUrl()).toBe(
      "http://127.0.0.1:4096/event",
    );
  });

  it("returns the parsed body on success", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse([{ id: "ses_1", title: "x" }]));
    const client = new OpencodeClient("http://x", fetchImpl);

    await expect(client.listSessions()).resolves.toEqual([{ id: "ses_1", title: "x" }]);
  });

  it("turns a non-2xx into OpencodeError carrying the status", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({}, 404));
    const client = new OpencodeClient("http://x", fetchImpl);

    await expect(client.messages("ses_missing")).rejects.toBeInstanceOf(OpencodeError);
    await expect(client.messages("ses_missing")).rejects.toMatchObject({ status: 404 });
  });

  it("explains an unreachable server rather than leaking a fetch TypeError", async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new TypeError("Failed to fetch"));
    const client = new OpencodeClient("http://127.0.0.1:4096", fetchImpl);

    await expect(client.health()).rejects.toThrow(/cannot reach opencode/);
  });

  it("sends a prompt to prompt_async, not the blocking message endpoint", async () => {
    // Verified against opencode 1.18.35: /message blocks for the whole turn and
    // returns nothing incremental, which would defeat token streaming.
    const fetchImpl = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    const client = new OpencodeClient("http://x", fetchImpl);

    await client.sendPrompt("ses_1", {
      model: { providerID: "opencode", modelID: "m" },
      parts: [{ type: "text", text: "hello" }],
    });

    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toBe("http://x/session/ses_1/prompt_async");
    expect(init?.method).toBe("POST");
    expect(JSON.parse(String(init?.body))).toEqual({
      model: { providerID: "opencode", modelID: "m" },
      parts: [{ type: "text", text: "hello" }],
    });
  });

  it("omits the title when creating a default session", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ id: "ses_1" }));
    const client = new OpencodeClient("http://x", fetchImpl);

    await client.createSession();
    expect(JSON.parse(String(fetchImpl.mock.calls[0]![1]?.body))).toEqual({});
  });

  it("sends a title when one is given", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ id: "ses_1" }));
    await new OpencodeClient("http://x", fetchImpl).createSession("My work");
    expect(JSON.parse(String(fetchImpl.mock.calls[0]![1]?.body))).toEqual({ title: "My work" });
  });

  it("encodes file search queries", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(["src/a.ts"]));
    const client = new OpencodeClient("http://x", fetchImpl);

    await client.files("a b&c", 5);
    expect(fetchImpl.mock.calls[0]![0]).toBe("http://x/find/file?query=a%20b%26c&limit=5&type=file");
  });

  it("issues DELETE for a session removal", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(true));
    await new OpencodeClient("http://x", fetchImpl).deleteSession("ses_1");
    expect(fetchImpl.mock.calls[0]![1]?.method).toBe("DELETE");
  });

  it("issues PATCH for a rename", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ id: "ses_1" }));
    await new OpencodeClient("http://x", fetchImpl).renameSession("ses_1", "New");
    const init = fetchImpl.mock.calls[0]![1]!;
    expect(init.method).toBe("PATCH");
    expect(JSON.parse(String(init.body))).toEqual({ title: "New" });
  });
});
