import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Auto-scroll that follows new content and still lets you scroll away.
 *
 * Two bugs this replaces:
 *
 * 1. Following was keyed on a message count, which does not change while tokens
 *    stream — so the view sat still through a whole reply. Content height is
 *    now observed with a ResizeObserver, which catches deltas, expanding tool
 *    rows and diffs alike.
 * 2. A programmatic smooth scroll fires scroll events mid-animation. Reading
 *    "am I at the bottom" from those un-pinned the view permanently. Programmatic
 *    scrolls are now marked, and any real input (wheel, touch, pointer) ends
 *    that marking instantly so a manual scroll is never ignored.
 */

/** How long a programmatic scroll suppresses the stickiness check. */
const PROGRAMMATIC_MS = 700;

export interface AutoScroll {
  containerRef: React.RefObject<HTMLDivElement | null>;
  /** Attach to the scrolling content itself, so its height can be observed. */
  contentRef: React.RefObject<HTMLDivElement | null>;
  /** True while pinned to the newest content. */
  stuck: boolean;
  scrollToBottom(): void;
}

export function useAutoScroll(): AutoScroll {
  const containerRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const [stuck, setStuck] = useState(true);

  // Refs, not state: these change on every frame of a scroll animation and
  // must not trigger a render.
  const programmaticUntil = useRef(0);
  const stuckRef = useRef(true);

  const setStuckBoth = useCallback((value: boolean) => {
    stuckRef.current = value;
    setStuck(value);
  }, []);

  const isProgrammatic = () => Date.now() < programmaticUntil.current;

  const distanceFromBottom = useCallback(() => {
    const node = containerRef.current;
    if (!node) return 0;
    return node.scrollHeight - node.scrollTop - node.clientHeight;
  }, []);

  const scrollToBottom = useCallback(
    (behavior: ScrollBehavior = "smooth") => {
      const node = containerRef.current;
      if (!node) return;
      programmaticUntil.current = Date.now() + PROGRAMMATIC_MS;
      if (typeof node.scrollTo === "function") {
        node.scrollTo({ top: node.scrollHeight, behavior });
      } else {
        node.scrollTop = node.scrollHeight;
      }
      setStuckBoth(true);
    },
    [setStuckBoth],
  );

  // Follow content growth — tokens, tool rows, diffs — while pinned.
  useEffect(() => {
    const content = contentRef.current;
    const container = containerRef.current;
    if (!content || !container) return;

    if (typeof ResizeObserver === "undefined") return;

    const observer = new ResizeObserver(() => {
      if (!stuckRef.current) return;
      const node = containerRef.current;
      if (!node) return;
      // Follow instantly. Animating here would restart the animation on every
      // token and never actually arrive.
      programmaticUntil.current = Date.now() + PROGRAMMATIC_MS;
      node.scrollTop = node.scrollHeight;
    });
    observer.observe(content);
    return () => observer.disconnect();
  }, []);

  // Track manual scrolling. Ignored while we are animating ourselves.
  useEffect(() => {
    const node = containerRef.current;
    if (!node) return;

    const onScroll = () => {
      if (isProgrammatic()) return;
      setStuckBoth(distanceFromBottom() < 64);
    };
    const endProgrammatic = () => {
      // Real input means the user is driving; stop second-guessing them.
      programmaticUntil.current = 0;
      setStuckBoth(distanceFromBottom() < 64);
    };

    node.addEventListener("scroll", onScroll, { passive: true });
    node.addEventListener("wheel", endProgrammatic, { passive: true });
    node.addEventListener("touchstart", endProgrammatic, { passive: true });
    node.addEventListener("pointerdown", endProgrammatic, { passive: true });

    return () => {
      node.removeEventListener("scroll", onScroll);
      node.removeEventListener("wheel", endProgrammatic);
      node.removeEventListener("touchstart", endProgrammatic);
      node.removeEventListener("pointerdown", endProgrammatic);
    };
  }, [distanceFromBottom, setStuckBoth]);

  return { containerRef, contentRef, stuck, scrollToBottom: () => scrollToBottom("smooth") };
}