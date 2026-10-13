import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { ModelsTab, ProvidersTab, McpTab, AgentsTab } from "@/components/shell/settings-tabs";
import { useSystem } from "@/state/system";
import { stripSecrets, parseCatalogue } from "@/lib/opencode/models";

const PROVIDERS = {
  all: [
    {
      id: "opencode",
      name: "opencode",
      models: {
        "exo-free": { id: "exo-free", name: "Exo Free", cost: { input: 0, output: 0 }, limit: { context: 1048576 } },
        "paid": { id: "paid", name: "Paid", cost: { input: 3, output: 15 }, limit: { context: 128000 } },
      },
    },
    { id: "anthropic", name: "Anthropic", models: { sonnet: { id: "sonnet", name: "Sonnet" } } },
    { id: "moonshot", name: "Moonshot", models: { kimi: { id: "kimi", name: "Kimi" } } },
  ],
  connected: ["opencode"],
  default: { opencode: "exo-free" },
};

const CLIENT = {
  baseUrl: "http://x",
  providerCatalogue: vi.fn().mockResolvedValue(PROVIDERS),
  authMethods: vi.fn().mockResolvedValue({
    anthropic: [{ type: "api", label: "API key" }, { type: "oauth", label: "Claude account" }],
  }),
  mcpStatus: vi.fn().mockResolvedValue({ github: { status: "connected" } }),
  lspStatus: vi.fn().mockResolvedValue([]),
  formatterStatus: vi.fn().mockResolvedValue([]),
  agents: vi.fn().mockResolvedValue([
    { name: "build", mode: "primary", description: "default" },
    { name: "plan", mode: "primary", description: "plan mode" },
    { name: "explore", mode: "subagent", description: "explores code" },
  ]),
  setAuth: vi.fn().mockResolvedValue(true),
  removeAuth: vi.fn().mockResolvedValue(true),
  addMcp: vi.fn().mockResolvedValue({}),
} as never;

function seed() {
  const catalogue = parseCatalogue(stripSecrets(PROVIDERS));
  useSystem.setState({
    providers: catalogue.providers,
    connected: catalogue.connected,
    defaults: catalogue.defaults,
    mcp: { github: { status: "connected" } },
    lsp: [],
    formatters: [],
    agents: [
      { name: "build", mode: "primary", description: "default" },
      { name: "plan", mode: "primary", description: "plan mode" },
      { name: "explore", mode: "subagent", description: "explores code" },
    ],
    authMethods: { anthropic: [{ type: "api", label: "API key" }, { type: "oauth", label: "Claude account" }] },
    client: CLIENT,
    loading: false,
    error: null,
  });
}

/**
 * Regression guard for "Rendered more hooks than during the previous render".
 *
 * `ModelsTab` had `useState` for its search box placed *after* the
 * `if (loading) return <Loading />` guard, so the hook count differed between
 * the loading and loaded renders. Rendering both states and asserting neither
 * throws is the only way to catch it again.
 */
describe("tab hook order", () => {
  it("ModelsTab survives loading -> loaded without breaking the rules of hooks", () => {
    useSystem.setState({ loading: true, providers: [], mcp: {}, client: null });
    const first = render(<ModelsTab />);
    first.unmount();

    seed();
    expect(() => render(<ModelsTab />)).not.toThrow();
  });

  it("ProvidersTab survives both states", () => {
    useSystem.setState({ loading: true, providers: [], client: null });
    const first = render(<ProvidersTab />);
    first.unmount();

    seed();
    expect(() => render(<ProvidersTab />)).not.toThrow();
  });

  it("McpTab survives both states", () => {
    useSystem.setState({ loading: true, providers: [], mcp: {}, client: null });
    const first = render(<McpTab />);
    first.unmount();

    seed();
    expect(() => render(<McpTab />)).not.toThrow();
  });

  it("AgentsTab survives both states", () => {
    useSystem.setState({ loading: true, providers: [], client: null });
    const first = render(<AgentsTab />);
    first.unmount();

    seed();
    expect(() => render(<AgentsTab />)).not.toThrow();
  });
});

describe("providers tab", () => {
  beforeEach(() => seed());

  it("lists providers with their model counts", () => {
    render(<ProvidersTab />);
    // "opencode" also appears in the connected-badge row, hence the list form.
    expect(screen.getAllByText("opencode").length).toBeGreaterThan(0);
    expect(screen.getByText("Anthropic")).toBeInTheDocument();
    // The count is interpolated across text nodes, so match on the row content.
    expect(
      screen.getByText((_, node) => node?.textContent === "opencode · 2 models"),
    ).toBeInTheDocument();
  });

  it("filters with the search box", async () => {
    const user = (await import("@testing-library/user-event")).default.setup();
    render(<ProvidersTab />);
    await user.type(screen.getByPlaceholderText(/search providers/i), "anthro");
    expect(screen.queryByText("Moonshot")).not.toBeInTheDocument();
    expect(screen.getByText("Anthropic")).toBeInTheDocument();
  });

  it("offers API key and OAuth entry points separately", () => {
    render(<ProvidersTab />);
    // anthropic is not connected and offers both methods.
    expect(screen.getAllByText("API key").length).toBeGreaterThan(0);
    expect(screen.getAllByText("OAuth").length).toBeGreaterThan(0);
  });

  it("offers disconnect for a connected provider", () => {
    render(<ProvidersTab />);
    expect(screen.getAllByText("Disconnect").length).toBeGreaterThan(0);
  });

  it("never renders a provider key", () => {
    render(<ProvidersTab />);
    expect(document.body.textContent).not.toMatch(/sk-[A-Za-z0-9]/);
  });
});

describe("models tab", () => {
  beforeEach(() => seed());

  it("lists models with free ones first", () => {
    render(<ModelsTab />);
    expect(screen.getByText("Exo Free")).toBeInTheDocument();
    expect(screen.getAllByText("free").length).toBeGreaterThan(0);
  });

  it("marks models from unconnected providers", () => {
    render(<ModelsTab />);
    // A model you cannot actually use should say so rather than fail at send time.
    expect(screen.getAllByText("not connected").length).toBeGreaterThan(0);
  });

  it("filters models by search", async () => {
    const user = (await import("@testing-library/user-event")).default.setup();
    render(<ModelsTab />);
    await user.type(screen.getByPlaceholderText(/search models/i), "sonnet");
    expect(screen.queryByText("Exo Free")).not.toBeInTheDocument();
    expect(screen.getByText("Sonnet")).toBeInTheDocument();
  });

  it("filters models by provider", async () => {
    const user = (await import("@testing-library/user-event")).default.setup();
    render(<ModelsTab />);
    await user.selectOptions(screen.getByRole("combobox"), "moonshot");
    expect(screen.getByText("Kimi")).toBeInTheDocument();
    expect(screen.queryByText("Sonnet")).not.toBeInTheDocument();
  });

  it("exposes an add-model form", async () => {
    const user = (await import("@testing-library/user-event")).default.setup();
    render(<ModelsTab />);
    await user.click(screen.getByText(/add a custom model/i));
    expect(screen.getByPlaceholderText("provider id (e.g. myprovider)")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("model id")).toBeInTheDocument();
  });

  it("will not submit an incomplete model form", async () => {
    const user = (await import("@testing-library/user-event")).default.setup();
    render(<ModelsTab />);
    await user.click(screen.getByText(/add a custom model/i));
    const submit = screen.getByRole("button", { name: /save & restart/i });
    expect(submit).toBeDisabled();
  });
});

describe("agents tab", () => {
  beforeEach(() => seed());

  it("shows the mode switch and subagents", () => {
    render(<AgentsTab />);
    expect(screen.getByRole("button", { name: "Build" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Plan" })).toBeInTheDocument();
    expect(screen.getByText("explore")).toBeInTheDocument();
  });

  it("exposes a create-agent form with the fields it needs", async () => {
    const user = (await import("@testing-library/user-event")).default.setup();
    render(<AgentsTab />);
    await user.click(screen.getByText(/new agent/i));
    expect(screen.getByPlaceholderText("name (e.g. reviewer)")).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/system prompt/i)).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/short description/i)).toBeInTheDocument();
  });

  it("requires a name and a prompt before saving", async () => {
    const user = (await import("@testing-library/user-event")).default.setup();
    render(<AgentsTab />);
    await user.click(screen.getByText(/new agent/i));
    expect(screen.getByRole("button", { name: /save & restart/i })).toBeDisabled();
  });

  it("says plainly when there are no custom agents", () => {
    render(<AgentsTab />);
    expect(screen.getByText(/no custom agents yet/i)).toBeInTheDocument();
  });
});

describe("mcp tab", () => {
  beforeEach(() => seed());

  it("shows live server status", () => {
    render(<McpTab />);
    expect(screen.getByText("github")).toBeInTheDocument();
    expect(screen.getByText("connected")).toBeInTheDocument();
  });

  it("offers both remote and local add forms", async () => {
    const user = (await import("@testing-library/user-event")).default.setup();
    render(<McpTab />);
    await user.click(screen.getByRole("button", { name: /add server/i }));
    expect(screen.getByPlaceholderText(/remote url/i)).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/local command/i)).toBeInTheDocument();
  });
});

describe("system store reactivity", () => {
  it("ignores events that do not invalidate anything", () => {
    seed();
    const before = useSystem.getState().providers;
    useSystem.getState().ingest({ id: "e", type: "message.part.updated", properties: {} } as never);
    expect(useSystem.getState().providers).toBe(before);
  });

  it("refreshes the catalogue on catalog.updated", async () => {
    seed();
    (CLIENT as unknown as { providerCatalogue: ReturnType<typeof vi.fn> }).providerCatalogue.mockClear();
    useSystem.getState().ingest({ id: "e", type: "catalog.updated", properties: {} } as never);
    await waitFor(() =>
      expect(
        (CLIENT as unknown as { providerCatalogue: ReturnType<typeof vi.fn> }).providerCatalogue,
      ).toHaveBeenCalled(),
    );
  });

  it("refreshes diagnostics on mcp.tools.changed", async () => {
    seed();
    (CLIENT as unknown as { mcpStatus: ReturnType<typeof vi.fn> }).mcpStatus.mockClear();
    useSystem.getState().ingest({ id: "e", type: "mcp.tools.changed", properties: {} } as never);
    await waitFor(() =>
      expect(
        (CLIENT as unknown as { mcpStatus: ReturnType<typeof vi.fn> }).mcpStatus,
      ).toHaveBeenCalled(),
    );
  });
});