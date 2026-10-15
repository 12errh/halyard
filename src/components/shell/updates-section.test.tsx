import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { UpdatesSection } from "@/components/shell/updates-section";
import type { UpdateSummary, UpdateSupport } from "@/lib/tauri";

/**
 * The update panel's job is not "check for updates". It is to tell the truth
 * about what kind of install this is, because the answer differs per platform
 * and getting it wrong means either a button that cannot work or an
 * administrator prompt nobody asked for.
 *
 * The `.deb` case is the one worth testing hardest: a system package cannot
 * replace itself, so the panel has to say where updates come from instead of
 * offering an install that would fail.
 */

const mock = vi.hoisted(() => ({
  support: { canSelfUpdate: true, reason: null, currentVersion: "0.1.0" } as UpdateSupport,
  update: null as UpdateSummary | null,
  installError: undefined as string | undefined,
}));

vi.mock("@/lib/tauri", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/tauri")>();
  return {
    ...actual,
    checkForUpdate: vi.fn(async () => mock.update),
    installUpdate: vi.fn(async () => {
      if (mock.installError) throw new Error(mock.installError);
    }),
    updateSupport: vi.fn(async () => mock.support),
  };
});

const update = (over: Partial<UpdateSummary>): UpdateSummary => ({
  version: "0.2.0",
  currentVersion: "0.1.0",
  notes: null,
  date: null,
  ...over,
});

describe("UpdatesSection", () => {
  beforeEach(() => {
    mock.support = { canSelfUpdate: true, reason: null, currentVersion: "0.1.0" };
    mock.update = null;
    mock.installError = undefined;
  });

  it("shows the installed version", async () => {
    render(<UpdatesSection />);
    await waitFor(() => expect(screen.getByText("Halyard 0.1.0")).toBeInTheDocument());
  });

  it("reports when there is nothing to install", async () => {
    const user = userEvent.setup();
    render(<UpdatesSection />);

    await user.click(screen.getByRole("button", { name: /check for updates/i }));
    await waitFor(() => expect(screen.getByText(/no update available/i)).toBeInTheDocument());
  });

  it("offers an install when a newer release exists", async () => {
    mock.update = update({ notes: "Fixes things" });
    const user = userEvent.setup();
    render(<UpdatesSection />);

    await user.click(screen.getByRole("button", { name: /check for updates/i }));

    await waitFor(() => expect(screen.getByText(/0\.2\.0 is available/)).toBeInTheDocument());
    expect(screen.getByRole("button", { name: /install 0\.2\.0/i })).toBeInTheDocument();
    expect(screen.getByText("Fixes things")).toBeInTheDocument();
  });

  it("says which version you are on, not just that one is available", async () => {
    mock.update = update({});
    const user = userEvent.setup();
    render(<UpdatesSection />);

    await user.click(screen.getByRole("button", { name: /check for updates/i }));
    await waitFor(() => expect(screen.getByText(/you have 0\.1\.0/)).toBeInTheDocument());
  });

  it("does not promise a self-update it cannot do on a system package", async () => {
    // The sudo case: a `.deb` can check, but replacing itself needs root, so
    // the panel must name the package manager rather than offer a dead button.
    mock.support = {
      canSelfUpdate: false,
      reason: "This is a system package. Updates come from your package manager.",
      currentVersion: "0.1.0",
    };
    render(<UpdatesSection />);

    await waitFor(() =>
      expect(screen.getByText(/updates come from your package manager/i)).toBeInTheDocument(),
    );
    // The manual check stays: knowing a release exists is still useful.
    expect(screen.getByRole("button", { name: /check for updates/i })).toBeInTheDocument();
  });

  it("still says something reassuring where self-update does work", async () => {
    render(<UpdatesSection />);
    await waitFor(() => expect(screen.getByText(/compiled into the app/i)).toBeInTheDocument());
  });

  it("surfaces a failed check rather than silently doing nothing", async () => {
    const user = userEvent.setup();
    const tauri = await import("@/lib/tauri");
    vi.mocked(tauri.checkForUpdate).mockRejectedValueOnce(new Error("network is unreachable"));
    render(<UpdatesSection />);

    await user.click(screen.getByRole("button", { name: /check for updates/i }));
    await waitFor(() => expect(screen.getByText(/network is unreachable/)).toBeInTheDocument());
  });

  it("reports a failed install rather than leaving the button spinning", async () => {
    mock.update = update({});
    mock.installError = "signature did not verify";
    const user = userEvent.setup();
    render(<UpdatesSection />);

    await user.click(screen.getByRole("button", { name: /check for updates/i }));
    await user.click(await screen.findByRole("button", { name: /install 0\.2\.0/i }));

    await waitFor(() => expect(screen.getByText(/signature did not verify/)).toBeInTheDocument());
  });
});
