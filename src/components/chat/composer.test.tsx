import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Composer } from "@/components/chat/composer";

function setup(overrides: Partial<Parameters<typeof Composer>[0]> = {}) {
  const onSubmit = vi.fn();
  const onAbort = vi.fn();
  const props = {
    onSubmit,
    onAbort,
    busy: false,
    suggestFiles: vi.fn().mockResolvedValue([] as string[]),
    suggestCommands: vi.fn().mockResolvedValue([] as never[]),
    // Turn controls are opt-in from the caller's point of view; defaulting
    // them here keeps these tests about composing, not about the toolbar.
    canUndo: false,
    canRedo: false,
    canCompact: false,
    onUndo: vi.fn(),
    onRedo: vi.fn(),
    onCompact: vi.fn(),
    ...overrides,
  };
  render(<Composer {...props} />);
  return { onSubmit, onAbort, props, box: screen.getByPlaceholderText(/ask opencode/i) };
}

describe("Composer", () => {
  it("sends on Enter", async () => {
    const user = userEvent.setup();
    const { onSubmit, box } = setup();
    await user.type(box, "hello");
    await user.keyboard("{Enter}");
    expect(onSubmit).toHaveBeenCalledWith({ text: "hello", attachments: [] });
  });

  it("inserts a newline on Shift+Enter without sending", async () => {
    const user = userEvent.setup();
    const { onSubmit, box } = setup();
    await user.type(box, "line one");
    await user.keyboard("{Shift>}{Enter}{/Shift}");
    await user.type(box, "line two");
    expect(onSubmit).not.toHaveBeenCalled();
    expect(box).toHaveValue("line one\nline two");
  });

  it("clears after sending", async () => {
    const user = userEvent.setup();
    const { box } = setup();
    await user.type(box, "hi");
    await user.keyboard("{Enter}");
    await waitFor(() => expect(box).toHaveValue(""));
  });

  it("does not send whitespace only", async () => {
    const user = userEvent.setup();
    const { onSubmit, box } = setup();
    await user.type(box, "   ");
    await user.keyboard("{Enter}");
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("attaches a pasted file and sends it with the prompt", async () => {
    const user = userEvent.setup();
    const { onSubmit, box } = setup();

    const file = new File([new Uint8Array([137, 80, 78, 71])], "shot.png", {
      type: "image/png",
    });
    fireEvent.paste(box, { clipboardData: { files: [file], items: [] } });

    await waitFor(() => expect(screen.getByText("shot.png")).toBeInTheDocument());

    await user.type(box, "what is this");
    await user.keyboard("{Enter}");

    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
    const payload = onSubmit.mock.calls[0]![0];
    expect(payload.text).toBe("what is this");
    expect(payload.attachments).toHaveLength(1);
    expect(payload.attachments[0]).toMatchObject({ name: "shot.png", mime: "image/png" });
    expect(payload.attachments[0].dataUrl).toMatch(/^data:image\/png;base64,/);
  });

  it("refuses an unsupported file type and says why", async () => {
    const { box } = setup();
    const file = new File([new Uint8Array([0])], "tool.exe", {
      type: "application/x-msdownload",
    });
    fireEvent.paste(box, { clipboardData: { files: [file], items: [] } });

    await waitFor(() => expect(screen.getByText(/cannot be sent/i)).toBeInTheDocument());
    expect(screen.queryByText("tool.exe")).not.toBeInTheDocument();
  });

  it("removes an attachment on request", async () => {
    const user = userEvent.setup();
    const { box } = setup();
    const file = new File([new Uint8Array([1, 2, 3])], "notes.txt", { type: "text/plain" });

    fireEvent.paste(box, { clipboardData: { files: [file], items: [] } });
    await waitFor(() => expect(screen.getByText("notes.txt")).toBeInTheDocument());

    await user.click(screen.getByLabelText("Remove notes.txt"));
    await waitFor(() => expect(screen.queryByText("notes.txt")).not.toBeInTheDocument());
  });

  it("swaps send for abort while busy", async () => {
    const user = userEvent.setup();
    const { onAbort } = setup({ busy: true });
    await user.click(screen.getByLabelText("Stop"));
    expect(onAbort).toHaveBeenCalledOnce();
  });

  it("is inert while disabled", async () => {
    const user = userEvent.setup();
    const { onSubmit } = setup({ disabled: true });
    await user.type(screen.getByPlaceholderText(/ask opencode/i), "hi");
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("offers file suggestions after @", async () => {
    const user = userEvent.setup();
    const suggestFiles = vi.fn().mockResolvedValue(["src/lib/thread.ts", "src/main.tsx"]);
    const { box } = setup({ suggestFiles });

    await user.type(box, "look at @thr");

    await waitFor(() => expect(screen.getByText("thread.ts")).toBeInTheDocument());
    expect(suggestFiles).toHaveBeenCalledWith("thr");
  });

  it("inserts the full path when a file suggestion is chosen", async () => {
    const user = userEvent.setup();
    const { box } = setup({
      suggestFiles: vi.fn().mockResolvedValue(["src/lib/thread.ts"]),
    });

    await user.type(box, "@thr");
    await waitFor(() => expect(screen.getByText("thread.ts")).toBeInTheDocument());
    await user.keyboard("{Enter}");

    // The full path matters: opencode resolves @-mentions against the project root.
    await waitFor(() => expect(box).toHaveValue("@src/lib/thread.ts "));
  });

  it("does not suggest on a bare @ mid-word", async () => {
    const user = userEvent.setup();
    const suggestFiles = vi.fn().mockResolvedValue(["a.ts"]);
    const { box } = setup({ suggestFiles });
    await user.type(box, "email@");
    expect(suggestFiles).not.toHaveBeenCalled();
  });

  it("lists slash commands", async () => {
    const user = userEvent.setup();
    const { box } = setup({
      suggestCommands: vi.fn().mockResolvedValue([
        { value: "init", label: "init", hint: "Analyse the repo", kind: "command" },
      ]),
    });

    await user.type(box, "/in");
    // Rendered with the sigil, as the user typed it.
    await waitFor(() => expect(screen.getByText("/init")).toBeInTheDocument());
  });

  it("closes the suggestion list on Escape", async () => {
    const user = userEvent.setup();
    const { box } = setup({ suggestFiles: vi.fn().mockResolvedValue(["a.ts"]) });

    await user.type(box, "@a");
    await waitFor(() => expect(screen.getByText("a.ts")).toBeInTheDocument());
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByText("a.ts")).not.toBeInTheDocument());
  });
});
