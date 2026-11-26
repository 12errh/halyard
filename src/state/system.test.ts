import { beforeEach, describe, expect, it } from "vitest";
import { OpencodeClient } from "@/lib/opencode/client";
import { useSystem } from "@/state/system";

const BASE = "http://127.0.0.1:4096";

describe("useSystem.setClient", () => {
  beforeEach(() => {
    useSystem.setState({
      providers: [],
      connected: [],
      defaults: {},
      mcp: {},
      agents: [],
      integrations: [],
      credentials: [],
      loading: false,
      error: null,
      client: null,
    });
  });

  it("keeps the catalogue when the same server reconnects", () => {
    useSystem.getState().setClient(new OpencodeClient(BASE, "pw"));
    useSystem.setState({ agents: [{ name: "build" }], connected: ["anthropic"] });

    useSystem.getState().setClient(new OpencodeClient(BASE, "pw"));

    expect(useSystem.getState().agents).toHaveLength(1);
    expect(useSystem.getState().connected).toEqual(["anthropic"]);
  });

  it("invalidates the catalogue when the password changes on the same URL", () => {
    useSystem.getState().setClient(new OpencodeClient(BASE, "old"));
    useSystem.setState({ agents: [{ name: "build" }], connected: ["anthropic"] });

    useSystem.getState().setClient(new OpencodeClient(BASE, "new"));

    // Same port, different credential: this is a different server instance and
    // everything cached from the old one is now suspect.
    expect(useSystem.getState().agents).toEqual([]);
    expect(useSystem.getState().connected).toEqual([]);
    expect(useSystem.getState().client?.serverKey).toContain(btoa("opencode:new"));
  });
});
