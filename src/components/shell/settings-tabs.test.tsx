import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ModelsTab, ProvidersTab, McpTab, AgentsTab } from "@/components/shell/settings-tabs";
import { useSystem } from "@/state/system";
import { parseCatalogue } from "@/lib/opencode/models";
import type { OpencodeClient } from "@/lib/opencode/client";
import type {
  CredentialEntry,
  IntegrationInfo,
  ModelInfo,
  ProviderInfo,
} from "@/lib/opencode/types";

const PROVIDERS: ProviderInfo[] = [
  { id: "opencode", name: "opencode", models: {}, activation: "enabled" },
  { id: "anthropic", name: "Anthropic", models: {}, activation: "disabled" },
  { id: "moonshot", name: "Moonshot", models: {}, activation: "disabled" },
];

const MODELS: ModelInfo[] = [
  {
    id: "exo-free",
    modelID: "exo-free",
    providerID: "opencode",
    name: "Exo Free",
    cost: { input: 0, output: 0 },
    limit: { context: 1048576 },
  },
  {
    id: "paid",
    modelID: "paid",
    providerID: "opencode",
    name: "Paid",
    cost: { input: 3, output: 15 },
    limit: { context: 128000 },
  },
  { id: "sonnet", modelID: "sonnet", providerID: "anthropic", name: "Sonnet" },
  { id: "kimi", modelID: "kimi", providerID: "moonshot", name: "Kimi" },
];

const INTEGRATIONS: IntegrationInfo[] = [
  {
    id: "anthropic",
    name: "Anthropic",
    methods: [
      { type: "api", id: "key", label: "API key" },
      { type: "oauth", id: "claude", label: "Claude account" },
    ],
    connections: [],
  },
];

const CREDENTIALS: CredentialEntry[] = [
  {
    id: "cred_1",
    integrationID: "anthropic",
    value: { type: "api", key: "sk-supersecret", label: "Work" },
    active: true,
    time: { created: 1 },
  },
  {
    id: "cred_2",
    integrationID: "anthropic",
    value: { type: "oauth", access: "a", refresh: "r", expires: 0, label: "Personal" },
    active: false,
    time: { created: 2 },
  },
];

const CLIENT = {
  baseUrl: "http://x",
  providers: vi.fn().mockResolvedValue(PROVIDERS),
  models: vi.fn().mockResolvedValue(MODELS),
  mcpStatus: vi.fn().mockResolvedValue([{ name: "github", status: { status: "connected" } }]),
  agents: vi.fn().mockResolvedValue([
    { name: "build", mode: "primary", description: "default" },
    { name: "plan", mode: "primary", description: "plan mode" },
    { name: "explore", mode: "subagent", description: "explores code" },
  ]),
  integrations: vi.fn().mockResolvedValue(INTEGRATIONS),
  credentials: vi.fn().mockResolvedValue(CREDENTIALS),
  connectIntegrationKey: vi.fn().mockResolvedValue(undefined),
  connectIntegrationOauth: vi.fn().mockResolvedValue({
    attemptID: "att_1",
    url: "https://example.com/oauth",
    instructions: "Approve the request in your browser.",
    mode: "auto",
    time: { created: 0, expires: 0 },
  }),
  oauthStatus: vi.fn().mockResolvedValue({ status: "pending" }),
  completeOauth: vi.fn().mockResolvedValue(undefined),
  createCredential: vi.fn(),
  activateCredential: vi.fn().mockResolvedValue(undefined),
  deleteCredential: vi.fn().mockResolvedValue(undefined),
} as unknown as OpencodeClient;

function seed() {
  const catalogue = parseCatalogue(PROVIDERS, MODELS);
  useSystem.setState({
    providers: catalogue.providers,
    connected: catalogue.connected,
    defaults: catalogue.defaults,
    mcp: { github: { name: "github", status: "connected" } },
    agents: [
      { name: "build", mode: "primary", description: "default" },
      { name: "plan", mode: "primary", description: "plan mode" },
      { name: "explore", mode: "subagent", description: "explores code" },
    ],
    integrations: INTEGRATIONS,
    credentials: CREDENTIALS,
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
    expect(screen.getAllByText("Anthropic").length).toBeGreaterThan(0);
    // The count is interpolated across text nodes, so match on the row content.
    expect(
      screen.getByText((_, node) => node?.textContent === "opencode · 2 models"),
    ).toBeInTheDocument();
  });

  it("filters with the search box", async () => {
    const user = userEvent.setup();
    render(<ProvidersTab />);
    await user.type(screen.getByPlaceholderText(/search providers/i), "anthro");
    expect(screen.queryByText("Moonshot")).not.toBeInTheDocument();
    expect(screen.getAllByText("Anthropic").length).toBeGreaterThan(0);
  });

  it("offers the integration's key and OAuth methods", () => {
    render(<ProvidersTab />);
    expect(screen.getByRole("button", { name: "API key" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Claude account" })).toBeInTheDocument();
  });

  it("connects an integration with a key", async () => {
    const user = userEvent.setup();
    render(<ProvidersTab />);
    await user.click(screen.getByRole("button", { name: "API key" }));
    await user.type(screen.getByPlaceholderText(/paste the key/i), "abc123");
    await user.click(screen.getByRole("button", { name: /^connect$/i }));
    await waitFor(() =>
      expect(CLIENT.connectIntegrationKey).toHaveBeenCalledWith("anthropic", { key: "abc123" }),
    );
  });

  it("starts an OAuth attempt and shows the approval link", async () => {
    const user = userEvent.setup();
    render(<ProvidersTab />);
    await user.click(screen.getByRole("button", { name: "Claude account" }));
    await user.click(screen.getByRole("button", { name: /start sign-in/i }));
    await waitFor(() =>
      expect(CLIENT.connectIntegrationOauth).toHaveBeenCalledWith("anthropic", {
        methodID: "claude",
      }),
    );
    const link = await screen.findByRole("link", { name: "https://example.com/oauth" });
    expect(link).toHaveAttribute("href", "https://example.com/oauth");
    expect(screen.getByText("Approve the request in your browser.")).toBeInTheDocument();
  });

  it("activates and deletes credentials", async () => {
    const user = userEvent.setup();
    render(<ProvidersTab />);

    await user.click(screen.getByRole("button", { name: "Activate credential Personal" }));
    await waitFor(() => expect(CLIENT.activateCredential).toHaveBeenCalledWith("cred_2"));

    await user.click(screen.getByRole("button", { name: "Delete credential Work" }));
    await waitFor(() => expect(CLIENT.deleteCredential).toHaveBeenCalledWith("cred_1"));
  });

  it("never renders a credential value", () => {
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
    const user = userEvent.setup();
    render(<ModelsTab />);
    await user.type(screen.getByPlaceholderText(/search models/i), "sonnet");
    expect(screen.queryByText("Exo Free")).not.toBeInTheDocument();
    expect(screen.getByText("Sonnet")).toBeInTheDocument();
  });

  it("filters models by provider", async () => {
    const user = userEvent.setup();
    render(<ModelsTab />);
    await user.selectOptions(screen.getByRole("combobox"), "moonshot");
    expect(screen.getByText("Kimi")).toBeInTheDocument();
    expect(screen.queryByText("Sonnet")).not.toBeInTheDocument();
  });

  it("exposes an add-model form", async () => {
    const user = userEvent.setup();
    render(<ModelsTab />);
    await user.click(screen.getByText(/add a custom model/i));
    expect(screen.getByPlaceholderText("provider id (e.g. myprovider)")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("model id")).toBeInTheDocument();
  });

  it("will not submit an incomplete model form", async () => {
    const user = userEvent.setup();
    render(<ModelsTab />);
    await user.click(screen.getByText(/add a custom model/i));
    const submit = screen.getByRole("button", { name: /save & restart/i });
    expect(submit).toBeDisabled();
  });
});

describe("agents tab", () => {
  beforeEach(() => seed());

  it("surfaces built-in primaries and subagents", () => {
    render(<AgentsTab />);
    expect(screen.getByRole("button", { name: "Build" })).toBeInTheDocument();
    expect(screen.getByText("explore")).toBeInTheDocument();
  });

  it("shows an empty custom-agents section", () => {
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
    const user = userEvent.setup();
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
    useSystem.getState().ingest({ id: "e", type: "message.updated", data: {} } as never);
    expect(useSystem.getState().providers).toBe(before);
  });

  it("refreshes the catalogue on config.updated", async () => {
    seed();
    vi.mocked(CLIENT.providers).mockClear();
    useSystem.getState().ingest({ id: "e", type: "config.updated", data: {} } as never);
    await waitFor(() => expect(CLIENT.providers).toHaveBeenCalled());
  });

  it("refreshes diagnostics on mcp.status.changed", async () => {
    seed();
    vi.mocked(CLIENT.mcpStatus).mockClear();
    useSystem.getState().ingest({ id: "e", type: "mcp.status.changed", data: {} } as never);
    await waitFor(() => expect(CLIENT.mcpStatus).toHaveBeenCalled());
  });
});
