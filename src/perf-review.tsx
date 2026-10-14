/** Dev-only: measure how long a long thread takes to render, and to update. */
import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { MessageThread } from "@/components/chat/message-thread";
import type { MessageEntry } from "@/lib/opencode/thread";
import type { Part } from "@/lib/opencode/types";
import "./index.css";

const now = Date.now();
const COUNT = Number(new URLSearchParams(location.search).get("n") ?? 400);

function build(): MessageEntry[] {
  const out: MessageEntry[] = [];
  for (let i = 0; i < COUNT; i++) {
    const parts: Part[] =
      i % 2 === 0
        ? [
            {
              id: `p${i}`, sessionID: "s", messageID: `m${i}`, type: "text",
              text: `Turn ${i}. The reconnect handler re-subscribes without cancelling the previous stream, so two readers compete for the same event feed.\n\nFix it by cancelling first.`,
            } as Part,
          ]
        : [
            { id: `q${i}`, sessionID: "s", messageID: `m${i}`, type: "text", text: `And on turn ${i}?` } as Part,
            { id: `r${i}`, sessionID: "s", messageID: `m${i}`, callID: `c${i}`, type: "tool", tool: "bash",
              state: { status: "completed", input: { command: `pnpm test --filter pkg-${i}` }, output: "ok", title: "", time: { created: now, completed: now + 40 } } } as Part,
          ];
    out.push({
      info: {
        id: `m${i}`, sessionID: "s", role: i % 2 === 0 ? "assistant" : "user",
        parentID: i % 2 === 0 ? `m${i - 1}` : undefined, time: { created: now - (COUNT - i) * 1000 },
        cost: 0.01, tokens: { input: 100, output: 50, reasoning: 10, cache: { read: 0, write: 0 } },
        modelID: "fast", providerID: "opencode", agent: "build", mode: "build",
        path: { cwd: "/repo", root: "/repo" },
      },
      parts: Object.fromEntries(parts.map((p) => [p.id, p])),
      pending: {},
      partOrder: parts.map((p) => p.id),
    } as MessageEntry);
  }
  return out;
}

const ENTRIES = build();

function Probe({ entries }: { entries: MessageEntry[] }) {
  const [, force] = useState(0);
  useEffect(() => {
    const mount = performance.now();
    requestAnimationFrame(() => {
      const painted = performance.now() - mount;
      const before = performance.now();
      force((n) => n + 1);
      requestAnimationFrame(() => {
        const updated = performance.now() - before;
        document.title = `mount=${Math.round(painted)}ms update=${Math.round(updated)}ms n=${COUNT}`;
        const g = globalThis as unknown as Record<string, unknown>;
        g.__metrics = { mount: Math.round(painted), update: Math.round(updated), n: COUNT };
      });
    });
  }, []);
  return (
    <div className="flex h-screen flex-col">
      <div className="min-h-0 flex-1">
        <MessageThread entries={entries} live={false} agent="build" model="fast" />
      </div>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(<Probe entries={ENTRIES} />);
