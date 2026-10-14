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
 *
 * Chrome's look, minus its lines. A tab strip made of outlined boxes reads as a
 * stack of cards; a browser gets its shape from tone alone — inactive tabs sit
 * a shade off the strip, the active one takes the page colour and hangs off the
 * bottom edge, and the only rule anywhere is a coloured line along the top of
 * the tab you are on.
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
      className="scroll-area flex h-9 shrink-0 items-end gap-1 overflow-x-auto bg-raised px-1.5 pb-0 pt-1"
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
                "group relative flex h-8 max-w-[220px] shrink-0 items-center gap-1.5 rounded-t-[9px] px-2.5 text-[0.78rem] transition-colors duration-150",
                active
                  ? "bg-canvas text-ink"
                  : "text-ink-faint hover:bg-surface/70 hover:text-ink-muted",
              )}
            >
              {active && (
                <motion.span
                  layoutId="tab-underline"
                  className="absolute inset-x-1 top-0 h-[2px] rounded-full bg-accent"
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

