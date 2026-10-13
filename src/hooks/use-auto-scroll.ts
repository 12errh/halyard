import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

/**
 * Auto-scroll that follows new content without ever stealing the scrollbar.
 *
 * Two requirements pull against each other: the view should follow the stream,
 * and a user reading earlier output must never be yanked back. The solution is
 * a sentinel at the bottom plus IntersectionObserver — whether we are "at the
 * bottom" is observed rather than recomputed from scroll metrics on every
 * token, which would fight sub-pixel layout shifts during streaming.
 */

/**
 * How to travel to the bottom.
 *
 * A smooth animation over a long distance never catches up with a fast token
 * stream and ends up permanently behind, so a big jump goes instantly and only
 * short hops animate.
 */
export function chooseScrollBehaviour(distance: number, viewportHeight: number): ScrollBehavior {
  if (distance <= 0) return "auto";
  return distance > viewportHeight * 2 ? "auto" : "smooth";
}

export interface AutoScroll {
  containerRef: React.RefObject<HTMLDivElement | null>;
  /** Attach to a zero-height element at the very end of the scroll content. */
  endRef: React.RefObject<HTMLDivElement | null>;
  /** True while the view is pinned to the newest content. */
  stuck: boolean;
  /** Jump back to the newest content, resuming following. */
  scrollToBottom(): void;
}

export function useAutoScroll(dependency: unknown): AutoScroll {
  const containerRef = useRef<HTMLDivElement>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const [stuck, setStuck] = useState(true);

  const scrollToBottom = useCallback(() => {
    const node = containerRef.current;
    if (!node) return;
    const distance = node.scrollHeight - node.scrollTop - node.clientHeight;
    const behavior = chooseScrollBehaviour(distance, node.clientHeight);
    if (typeof node.scrollTo === "function") {
      node.scrollTo({ top: node.scrollHeight, behavior });
    } else {
      node.scrollTop = node.scrollHeight;
    }
    setStuck(true);
  }, []);

  // Follow new content, but only while pinned.
  useLayoutEffect(() => {
    const node = containerRef.current;
    if (!node || !stuck) return;
    const distance = node.scrollHeight - node.scrollTop - node.clientHeight;
    if (distance <= 0) return;
    if (typeof node.scrollTo === "function") {
      node.scrollTo({ top: node.scrollHeight, behavior: chooseScrollBehaviour(distance, node.clientHeight) });
    } else {
      node.scrollTop = node.scrollHeight;
    }
  }, [dependency, stuck]);

  useEffect(() => {
    const sentinel = endRef.current;
    const node = containerRef.current;
    if (!sentinel || !node) return;

    // Without IntersectionObserver (jsdom, very old webviews) stay pinned and
    // rely on the scroll listener below as a fallback.
    if (typeof IntersectionObserver === "undefined") return;

    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[entries.length - 1];
        if (entry) setStuck(entry.isIntersecting);
      },
      // A thin band at the very bottom counts as "there".
      { root: node, rootMargin: "0px 0px 48px 0px", threshold: 0 },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, []);

  // Fallback for environments without IntersectionObserver, and a safety net
  // for the moment the user scrolls away from the very bottom.
  useEffect(() => {
    const node = containerRef.current;
    if (!node) return;
    const onScroll = () => {
      const distance = node.scrollHeight - node.scrollTop - node.clientHeight;
      setStuck(distance < 48);
    };
    node.addEventListener("scroll", onScroll, { passive: true });
    return () => node.removeEventListener("scroll", onScroll);
  }, []);

  return { containerRef, endRef, stuck, scrollToBottom };
}
