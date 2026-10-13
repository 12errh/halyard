import { useEffect, useLayoutEffect, useRef } from "react";
import { AnimatePresence, motion } from "motion/react";
import { PartView } from "./part-view";
import { isStreaming, orderedParts, type MessageEntry } from "@/lib/opencode/thread";
import { cn } from "@/lib/utils";

/** True when this is the last message and the turn has not gone idle. */
function usePinnedToBottom(dependency: unknown) {
  const ref = useRef<HTMLDivElement>(null);
  const pinned = useRef(true);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    const onScroll = () => {
      // 48px of slack: the moment a user scrolls up to read, stop yanking them
      // back down as tokens arrive.
      pinned.current = node.scrollHeight - node.scrollTop - node.clientHeight < 48;
    };
    node.addEventListener("scroll", onScroll, { passive: true });
    return () => node.removeEventListener("scroll", onScroll);
  }, []);

  useLayoutEffect(() => {
    const node = ref.current;
    if (node && pinned.current) node.scrollTop = node.scrollHeight;
  }, [dependency]);

  return ref;
}

export function MessageThread({
  entries,
  live,
  agent,
  model,
}: {
  entries: MessageEntry[];
  live: boolean;
  agent?: string;
  model?: string;
}) {
  const scrollRef = usePinnedToBottom(entries.length);

  // Entries whose `message.updated` has not arrived yet render nothing; drop
  // them here so the rest of the component can assume `info` is present.
  const visible = entries.filter((entry) => entry.info !== null);

  return (
    <div ref={scrollRef} className="scroll-area flex-1 px-5 pb-6" data-selectable>
      <div className="mx-auto flex w-full max-w-[760px] flex-col gap-1 pt-6">
        <AnimatePresence initial={false}>
          {visible.map((entry, index) => (
            <Turn
              key={entry.info!.id}
              entry={entry}
              streaming={live && index === visible.length - 1}
            />
          ))}
        </AnimatePresence>

        {live && visible.length === 0 && (
          <div className="flex items-center gap-2 py-6 text-[0.84rem] text-ink-faint">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-live" />
            {agent && model ? `${agent} · ${model}` : "Working…"}
          </div>
        )}
      </div>
    </div>
  );
}

function Turn({ entry, streaming }: { entry: MessageEntry; streaming: boolean }) {
  const { info } = entry;
  const parts = orderedParts(entry);
  const flowing = streaming || isStreaming(entry);

  // A delta can arrive before `message.updated`. Nothing is rendered until we
  // know the message's role, but the parts are already buffered in the store.
  if (!info) return null;

  const assistant = info.role === "assistant";
  const createdAt = info.time?.created;

  return (
    <motion.article
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
      className={cn("py-2", assistant ? "pl-7" : "pr-7")}
    >
      {!assistant && (
        <div className="mb-1 flex items-baseline gap-2">
          <span className="text-[0.74rem] font-semibold uppercase tracking-[0.1em] text-accent">
            You
          </span>
          <time className="text-[0.68rem] text-ink-ghost">
            {formatTime(createdAt)}
          </time>
        </div>
      )}

      <div className="text-[0.88rem] text-ink">
        {parts.map((part) => (
          <PartView key={part.id} part={part} streaming={flowing && part.type === "text"} />
        ))}
      </div>

      {assistant && !parts.length && flowing && <TypingIndicator />}
    </motion.article>
  );
}

function TypingIndicator() {
  return (
    <span className="inline-flex items-center gap-1 py-1" aria-label="Assistant is responding">
      {[0, 1, 2].map((index) => (
        <motion.span
          key={index}
          className="h-1.5 w-1.5 rounded-full bg-ink-ghost"
          animate={{ opacity: [0.25, 0.9, 0.25], y: [0, -2, 0] }}
          transition={{ duration: 1.1, repeat: Infinity, delay: index * 0.14 }}
        />
      ))}
    </span>
  );
}

function formatTime(ms?: number): string {
  if (!ms) return "";
  return new Date(ms).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}
