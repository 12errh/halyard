import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
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
    expect(onSubmit).toHaveBeenCalledWith("hello");
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
    await waitFor(() => expect(screen.getByText("init")).toBeInTheDocument());
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
