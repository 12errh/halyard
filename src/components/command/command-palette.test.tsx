import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CommandPalette, type Command } from "@/components/command/command-palette";

const run = { new: vi.fn(), open: vi.fn(), settings: vi.fn() };

const commands: Command[] = [
  { id: "new", label: "New session", group: "Session", run: run.new },
  { id: "open", label: "Open folder", group: "Project", run: run.open },
  { id: "settings", label: "Open settings", group: "App", keywords: "prefs", run: run.settings },
];

const onClose = vi.fn();

beforeEach(() => {
  onClose.mockClear();
  for (const spy of Object.values(run)) spy.mockClear();
});

describe("CommandPalette", () => {
  it("renders nothing when closed", () => {
    render(<CommandPalette open={false} commands={commands} onClose={onClose} />);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("lists every command when open", () => {
    render(<CommandPalette open commands={commands} onClose={onClose} />);
    expect(screen.getByText("New session")).toBeInTheDocument();
    expect(screen.getByText("Open folder")).toBeInTheDocument();
  });

  it("focuses the input once open", async () => {
    render(<CommandPalette open commands={commands} onClose={onClose} />);
    await waitFor(() => expect(screen.getByPlaceholderText(/type a command/i)).toHaveFocus());
  });

  it("filters as you type", async () => {
    const user = userEvent.setup();
    render(<CommandPalette open commands={commands} onClose={onClose} />);

    await user.type(screen.getByPlaceholderText(/type a command/i), "folder");
    expect(screen.getByText("Open folder")).toBeInTheDocument();
    expect(screen.queryByText("New session")).not.toBeInTheDocument();
  });

  it("searches keywords as well as labels", async () => {
    const user = userEvent.setup();
    render(<CommandPalette open commands={commands} onClose={onClose} />);

    await user.type(screen.getByPlaceholderText(/type a command/i), "prefs");
    expect(screen.getByText("Open settings")).toBeInTheDocument();
  });

  it("reports when nothing matches", async () => {
    const user = userEvent.setup();
    render(<CommandPalette open commands={commands} onClose={onClose} />);

    await user.type(screen.getByPlaceholderText(/type a command/i), "zzzz");
    expect(screen.getByText(/no matching commands/i)).toBeInTheDocument();
  });

  it("runs a command and closes", async () => {
    const user = userEvent.setup();
    render(<CommandPalette open commands={commands} onClose={onClose} />);

    await user.click(screen.getByText("Open folder"));
    expect(run.open).toHaveBeenCalledOnce();
    expect(onClose).toHaveBeenCalled();
  });

  it("runs the highlighted command on Enter", async () => {
    const user = userEvent.setup();
    render(<CommandPalette open commands={commands} onClose={onClose} />);

    const input = screen.getByPlaceholderText(/type a command/i);
    await user.click(input);
    await user.keyboard("{ArrowDown}{Enter}");
    expect(run.open).toHaveBeenCalledOnce();
  });

  it("wraps the highlight with the arrow keys", async () => {
    const user = userEvent.setup();
    render(<CommandPalette open commands={commands} onClose={onClose} />);

    const input = screen.getByPlaceholderText(/type a command/i);
    await user.click(input);
    await user.keyboard("{ArrowUp}{Enter}");
    // From the first entry, ArrowUp wraps to the last.
    expect(run.settings).toHaveBeenCalledOnce();
  });

  it("closes on Escape without running anything", async () => {
    const user = userEvent.setup();
    render(<CommandPalette open commands={commands} onClose={onClose} />);

    await user.type(screen.getByPlaceholderText(/type a command/i), "{Escape}");
    expect(onClose).toHaveBeenCalled();
    for (const spy of Object.values(run)) expect(spy).not.toHaveBeenCalled();
  });

  it("closes when the backdrop is clicked", async () => {
    const user = userEvent.setup();
    render(<CommandPalette open commands={commands} onClose={onClose} />);

    await user.click(screen.getByRole("button", { name: /close command palette/i }));
    expect(onClose).toHaveBeenCalled();
  });
});
