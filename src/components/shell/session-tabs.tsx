import { AnimatePresence, motion } from "motion/react";
import { useEffect, useRef } from "react";
import { X } from "lucide-react";
import { useSessions, tabTitle } from "@/state/sessions";
import { cn } from "@/lib/utils";

/**
 * Browser-style session tabs.
 *
 * The user asked for sessions to sit as switchable tabs across the top of the
 * workspace, so this behaves like a browser tab strip: click to activate, the
 * middle-click / close button to dismiss, and Ctrl+Tab to cycle.
 */
export function SessionTabs() {
  const tabs = useSessions((s) => s.tabs);
  const activeId = useSessions((s) => s.activeId);
  const sessions = useSessions((s) => s.sessions);
  const selectTab = useSessions((s) => s.selectTab);
  const closeTab = useSessions((s) => s.closeTab);
  const strip = useRef<HTMLDivElement>(null);

  // Keep the active tab in view when cycling from the keyboard.
  useEffect(() => {
    if (!activeId) return;
    strip.current
      ?.querySelector<HTMLElement>(`[data-tab="${CSS.escape(activeId)}"]`)
      ?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [activeId]);

  return (
    <div
      ref={strip}
      className="scroll-area flex h-9 shrink-0 items-stretch gap-px overflow-x-auto border-b border-line bg-canvas pl-1.5"
      role="tablist"
      aria-label="Open sessions"
    >
      <AnimatePresence initial={false}>
        {tabs.map((id) => {
          const active = id === activeId;
          return (
            <motion.button
              key={id}
              layout
              initial={{ opacity: 0, width: 0 }}
              animate={{ opacity: 1, width: "auto" }}
              exit={{ opacity: 0, width: 0 }}
              transition={{ duration: 0.16, ease: [0.22, 1, 0.36, 1] }}
              data-tab={id}
              role="tab"
              aria-selected={active}
              type="button"
              onClick={() => selectTab(id)}
              onAuxClick={(event) => {
                // Middle click closes, like a browser.
                if (event.button === 1) {
                  event.preventDefault();
                  closeTab(id);
                }
              }}
              className={cn(
                "group relative flex max-w-[220px] shrink-0 items-center gap-1.5 rounded-t-[8px] border border-b-0 px-2.5 text-[0.78rem] transition-colors duration-150",
                active
                  ? "border-line bg-surface text-ink"
                  : "border-transparent text-ink-faint hover:bg-raised/60 hover:text-ink-muted",
              )}
            >
              {active && (
                <motion.span
                  layoutId="tab-underline"
                  className="absolute inset-x-0 -top-px h-px bg-accent"
                  transition={{ type: "spring", stiffness: 420, damping: 34 }}
                />
              )}
              <span className="truncate">{tabTitle(sessions, id)}</span>
              <span
                role="button"
                tabIndex={-1}
                aria-label="Close tab"
                onClick={(event) => {
                  event.stopPropagation();
                  closeTab(id);
                }}
                className={cn(
                  "shrink-0 rounded p-0.5 text-ink-ghost transition-colors hover:bg-raised hover:text-ink",
                  active ? "opacity-70" : "opacity-0 group-hover:opacity-70",
                )}
              >
                <X size={11} />
              </span>
            </motion.button>
          );
        })}
      </AnimatePresence>
    </div>
  );
}
