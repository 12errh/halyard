import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { AppShell } from "@/components/shell/app-shell";
import { useProjects } from "@/state/projects";
import { useServer } from "@/state/server";

/**
 * Smoke test: the real shell, mounted.
 *
 * This exists because the unit tests were all green while the app crashed on
 * launch with "Maximum update depth exceeded". A component can only break on
 * mount by mounting, and AppShell was never mounted by anything. Store
 * selectors, the SSE wiring, the server lifecycle and every child all get
 * exercised here the way they get exercised when a person opens the window.
 *
 * React reports the infinite-render failure through console.error before it
 * unmounts the tree, so the assertions watch for the specific messages rather
 * than trusting that "it rendered" means "it was well behaved".
 */

function silenceFetch() {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(typeof input === "string" ? input : input.toString());
      if (url.includes("/event")) {
        // An SSE stream that never yields, so the connection stays open.
        return new Response(new ReadableStream({ start() {} }), {
          headers: { "content-type": "text/event-stream" },
        });
      }
      if (url.includes("/session")) {
        return new Response(JSON.stringify([]), {
          headers: { "content-type": "application/json" },
        });
      }
      if (url.includes("/command")) {
        return new Response(JSON.stringify([]), {
          headers: { "content-type": "application/json" },
        });
      }
      if (url.includes("/experimental/resource")) {
        return new Response(JSON.stringify([]), {
          headers: { "content-type": "application/json" },
        });
      }
      return new Response(JSON.stringify({}), {
        headers: { "content-type": "application/json" },
      });
    }),
  );
}

describe("AppShell mounts", () => {
  beforeEach(() => {
    silenceFetch();
    useServer.setState({ phase: { kind: "stopped" }, logs: [], project: null });
    // `loaded` is what gates the boot effect. Left false, the shell waits on an
    // async hydrate() before it will start a server, and the test races that
    // rather than testing anything. Set it, and set the project, so the boot
    // path under test is the deterministic one.
    useProjects.setState({ loaded: true, active: "/tmp/project" });
  });

  /**
   * Waits on what a person would see — the version badge — rather than on the
   * store's phase field. The badge only appears once the server is up, so this
   * covers the whole boot path without coupling the test to internals.
   */
  const ready = () => screen.findByText(/opencode 1\.18\.35/, {}, { timeout: 5000 });

  it("mounts without the infinite-render failure", async () => {
    // Capture, but still call through. Swallowing the output hid a real boot
    // failure behind a timeout, which is worse than the crash being loud.
    const errors: string[] = [];
    const original = console.error;
    const spy = vi.spyOn(console, "error").mockImplementation((...args) => {
      errors.push(args.map(String).join(" "));
      original(...args);
    });

    render(<AppShell />);
    await ready();

    const joined = errors.join("\n");
    expect(joined).not.toMatch(/getSnapshot should be cached/);
    expect(joined).not.toMatch(/Maximum update depth exceeded/);

    spy.mockRestore();
    // The first mount does the whole cold boot — server start, thread connect,
    // highlighter preload — so it needs more room than the 5s default.
  }, 20000);

  it("renders the chrome: tabs, title bar and sidebar", async () => {
    render(<AppShell />);
    await ready();

    expect(screen.getByLabelText("Open sessions")).toBeInTheDocument();
    expect(screen.getByLabelText("Toggle sidebar")).toBeInTheDocument();
    expect(screen.getByLabelText("Toggle file explorer")).toBeInTheDocument();
    expect(screen.getByLabelText("Settings")).toBeInTheDocument();
  });

  it("shows an empty state rather than a blank pane", async () => {
    render(<AppShell />);
    await ready();

    expect(screen.getByPlaceholderText("Ask opencode to do something…")).toBeInTheDocument();
  });
});
