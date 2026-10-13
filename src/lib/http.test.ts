import { describe, expect, it, vi } from "vitest";
import { OpencodeClient } from "@/lib/opencode/client";
import { subscribe } from "@/lib/opencode/sse";

/**
 * Regression guard for "Can only call Window.fetch on instances of Window".
 *
 * Tauri replaces `window.fetch` with an implementation that asserts its
 * receiver. Capturing the bare global and invoking it as a method passes the
 * wrong `this`, so every request throws. These tests fail if the receiver is
 * ever lost again — something the type system cannot catch.
 */
function installStrictFetch() {
  const original = window.fetch;
  const calls: Array<{ thisArg: unknown; url: string }> = [];

  window.fetch = function strictFetch(this: unknown, input: RequestInfo | URL) {
    calls.push({ thisArg: this, url: String(input) });
    if (this !== window) {
      throw new TypeError("Can only call Window.fetch on instances of Window");
    }
    return Promise.resolve(
      new Response(JSON.stringify({ healthy: true, version: "1.18.35" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
  } as typeof fetch;

  return {
    calls,
    restore() {
      window.fetch = original;
    },
  };
}

describe("http receiver", () => {
  it("the client calls fetch with the window as receiver", async () => {
    const harness = installStrictFetch();
    try {
      // No fetchImpl passed: this is the default path the app actually uses.
      const client = new OpencodeClient("http://127.0.0.1:4096");
      await expect(client.health()).resolves.toEqual({ healthy: true, version: "1.18.35" });
      expect(harness.calls).toHaveLength(1);
      expect(harness.calls[0]!.thisArg).toBe(window);
    } finally {
      harness.restore();
    }
  });

  it("the SSE transport calls fetch with the window as receiver", async () => {
    const harness = installStrictFetch();
    try {
      const handle = subscribe("http://127.0.0.1:4096/event", { onEvent: () => {} });
      await vi.waitFor(() => expect(harness.calls.length).toBeGreaterThan(0));
      expect(harness.calls[0]!.thisArg).toBe(window);
      handle.close();
    } finally {
      harness.restore();
    }
  });
});

describe("project toggle flags", () => {
  /**
   * `onClick={toggleSidebar}` passes the MouseEvent as the first argument, and
   * a MouseEvent is truthy — so `open ?? !open` became permanently true and the
   * panel could never be closed. Callers must wrap; this documents the shape
   * the store expects so the mistake is visible.
   */
  it("treats an explicit boolean as authoritative", async () => {
    const { useUi } = await import("@/state/ui");
    const { DEFAULT_APPEARANCE } = await import("@/state/ui");
    useUi.setState({ sidebarOpen: false, fileTreeOpen: false, appearance: DEFAULT_APPEARANCE });

    useUi.getState().toggleSidebar(true);
    expect(useUi.getState().sidebarOpen).toBe(true);

    useUi.getState().toggleSidebar(false);
    expect(useUi.getState().sidebarOpen).toBe(false);

    useUi.getState().toggleFileTree(true);
    expect(useUi.getState().fileTreeOpen).toBe(true);
    useUi.getState().toggleFileTree(false);
    expect(useUi.getState().fileTreeOpen).toBe(false);
  });

  it("still flips when called with no argument", async () => {
    const { useUi } = await import("@/state/ui");
    useUi.setState({ sidebarOpen: false });
    useUi.getState().toggleSidebar();
    expect(useUi.getState().sidebarOpen).toBe(true);
    useUi.getState().toggleSidebar();
    expect(useUi.getState().sidebarOpen).toBe(false);
  });
});
