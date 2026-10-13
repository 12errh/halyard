import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { Companion } from "@/components/chat/companion";
import { MessageThread } from "@/components/chat/message-thread";
import { EmptyState } from "@/components/shell/empty-state";
import type { MessageEntry } from "@/lib/opencode/thread";
import type { AssistantMessage, MessageInfo, Part, UserMessage } from "@/lib/opencode/types";

function userMessage(id: string): UserMessage {
  return {
    id,
    role: "user",
    sessionID: "s",
    time: { created: 1_700_000_000_000 },
    agent: "build",
    model: { providerID: "opencode", modelID: "fast" },
  };
}

function assistantMessage(id: string): AssistantMessage {
  return {
    id,
    role: "assistant",
    sessionID: "s",
    parentID: "u1",
    time: { created: 1_700_000_000_001 },
    cost: 0,
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    modelID: "fast",
    providerID: "opencode",
    agent: "build",
    mode: "build",
    path: { cwd: "/tmp", root: "/tmp" },
  };
}

function entry(info: MessageInfo, parts: Part[]): MessageEntry {
  // `parts` is keyed by id in the store, with `partOrder` preserving arrival
  // order. Mirroring that shape matters: the thread renders from the map.
  return {
    info,
    parts: Object.fromEntries(parts.map((part) => [part.id, part])),
    pending: {},
    partOrder: parts.map((part) => part.id),
  };
}

const text = (id: string, value: string): Part =>
  ({ id, sessionID: "s", messageID: "m", type: "text", text: value }) as Part;

type ThreadProps = Parameters<typeof MessageThread>[0];

function thread(props: ThreadProps) {
  return render(<MessageThread {...props} />);
}

describe("companion sprite", () => {
  it("renders as themed rectangles rather than a bitmap image", () => {
    const { container } = render(<Companion />);
    // No <image> element: the sprite is vector rects that follow CSS variables.
    expect(container.querySelector("image")).toBeNull();
    expect(container.querySelectorAll("rect").length).toBeGreaterThan(20);
  });

  it("takes its colours from theme tokens so it re-themes", () => {
    const { container } = render(<Companion />);
    const fills = [...container.querySelectorAll("rect")].map((r) => r.getAttribute("fill"));
    expect(fills.every((f) => f === null || f.includes("var(--"))).toBe(true);
    expect(fills.some((f) => f?.includes("--color-accent"))).toBe(true);
  });

  it("scales from the requested size", () => {
    const { container } = render(<Companion size={200} />);
    const svg = container.querySelector("svg")!;
    expect(svg.getAttribute("width")).toBe("200");
  });

  it("is hidden from assistive tech", () => {
    const { container } = render(<Companion />);
    expect(container.querySelector("[aria-hidden]")).not.toBeNull();
  });

  it("replaces the generic icon when an empty state asks for it", () => {
    const { container } = render(<EmptyState companion title="Open a folder to begin" />);
    expect(screen.getByRole("heading", { name: "Open a folder to begin" })).toBeInTheDocument();
    // The sprite replaced the folder glyph.
    expect(container.querySelectorAll("rect").length).toBeGreaterThan(20);
  });

  it("keeps the alert icon for a dangerous empty state", () => {
    const { container } = render(<EmptyState tone="danger" companion title="It broke" />);
    expect(container.querySelector("svg")).not.toBeNull();
    expect(screen.getByRole("heading", { name: "It broke" })).toBeInTheDocument();
  });
});

describe("conversation layout", () => {
  it("greets the user with the companion when a thread is empty", async () => {
    thread({ entries: [], live: false });
    expect(screen.getByRole("heading", { name: "What are we working on?" })).toBeInTheDocument();
    expect(document.querySelectorAll("rect").length).toBeGreaterThan(20);
  });

  it("uses the given heading for a fresh thread", async () => {
    thread({ entries: [], live: false, title: "Fix the login bug" });
    expect(screen.getByRole("heading", { name: "Fix the login bug" })).toBeInTheDocument();
  });

  it("hides the greeting once there are messages", async () => {
    thread({
      entries: [entry(userMessage("u1"), [text("p1", "hello")])],
      live: false,
    });
    expect(screen.queryByRole("heading", { name: "What are we working on?" })).toBeNull();
  });

  it("does not greet while the agent is already working", async () => {
    thread({ entries: [], live: true, agent: "build", model: "fast" });
    expect(screen.queryByRole("heading", { name: "What are we working on?" })).toBeNull();
    expect(screen.getByText(/build · fast/)).toBeInTheDocument();
  });

  it("puts user turns on the right and assistant turns on the left", async () => {
    const { container } = thread({
      entries: [
        entry(userMessage("u1"), [text("p1", "what is 2+2?")]),
        entry(assistantMessage("a1"), [text("p2", "4")]),
      ],
      live: false,
    });

    const articles = container.querySelectorAll("article");
    expect(articles).toHaveLength(2);

    // The user turn is right-aligned; the assistant turn is not.
    expect(articles[0]!.className).toContain("justify-end");
    expect(articles[1]!.className).not.toContain("justify-end");

    // The assistant side carries the spark mark rather than a bubble.
    expect(articles[1]!.querySelector("article, .max-w-\\[85\\%\\]")).toBeNull();
  });

  it("caps the user bubble width so long prompts do not span the pane", async () => {
    const { container } = thread({
      entries: [entry(userMessage("u1"), [text("p1", "x".repeat(500))])],
      live: false,
    });
    const bubble = container.querySelector("article .max-w-\\[85\\%\\]");
    expect(bubble).not.toBeNull();
  });

  it("renders user text without markdown emphasis inside the bubble", async () => {
    const { container } = thread({
      entries: [entry(userMessage("u1"), [text("p1", "**not bold**")])],
      live: false,
    });
    // Prose in a bubble should stay prose: the asterisks survive as text and
    // no emphasis element is produced, which would make the bubble read like an
    // assistant turn.
    const para = container.querySelector<HTMLElement>("article p")!;
    expect(para.textContent).toBe("**not bold**");
    expect(container.querySelector("article strong")).toBeNull();
    expect(para.querySelector("strong")).toBeNull();
  });
});