import { describe, expect, it, vi, beforeEach } from "vitest";
import { announceFinish, isWorking, justFinished } from "@/components/shell/desktop-bridge";
import * as desktop from "@/lib/desktop";
import type { SessionStatus } from "@/lib/opencode/types";

const busy: SessionStatus = { type: "busy" };
const idle: SessionStatus = { type: "idle" };
const retry: SessionStatus = { type: "retry", attempt: 1, message: "429", next: 2 };

describe("session activity", () => {
  it("treats busy as working", () => {
    expect(isWorking(busy)).toBe(true);
  });

  it("treats a retry as working", () => {
    // opencode parks in `retry` while backing off, which is still a turn in
    // flight. Reporting it as finished would notify mid-failure.
    expect(isWorking(retry)).toBe(true);
  });

  it("treats idle as not working", () => {
    expect(isWorking(idle)).toBe(false);
  });

  it("treats an unknown session as not working", () => {
    expect(isWorking(undefined)).toBe(false);
  });

  it("reports a turn that just ended", () => {
    expect(justFinished(busy, idle)).toBe(true);
    expect(justFinished(retry, idle)).toBe(true);
  });

  it("does not announce work that never started", () => {
    // opencode reports `idle` on start-up; without carrying the previous
    // state forward that would read as a finished turn.
    expect(justFinished(undefined, idle)).toBe(false);
    expect(justFinished(idle, idle)).toBe(false);
  });

  it("does not announce while the turn is still running", () => {
    expect(justFinished(busy, busy)).toBe(false);
    expect(justFinished(busy, retry)).toBe(false);
  });
});

describe("announcing a finished turn", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("badges and notifies when the window is in the background", async () => {
    vi.spyOn(desktop, "windowIsFocused").mockResolvedValue(false);
    const notify = vi.spyOn(desktop, "notify").mockResolvedValue(true);
    const attention = vi.spyOn(desktop, "setAttention").mockResolvedValue();

    const result = await announceFinish({
      enabled: true,
      title: "Fix login",
      body: "Fix login",
      unread: 1,
    });

    expect(result).toEqual({ notified: true, badged: true });
    expect(attention).toHaveBeenCalledWith(1);
    expect(notify).toHaveBeenCalledWith("Halyard", "Fix login — Fix login");
  });

  it("stays silent when the user is looking at it", async () => {
    vi.spyOn(desktop, "windowIsFocused").mockResolvedValue(true);
    const notify = vi.spyOn(desktop, "notify").mockResolvedValue(true);

    const result = await announceFinish({ enabled: true, title: "t", body: "b", unread: 1 });

    // Badged but not notified: the badge is cheap and harmless, a popup while
    // someone is mid-sentence is not.
    expect(result.notified).toBe(false);
    expect(notify).not.toHaveBeenCalled();
  });

  it("still badges when notifications are switched off", async () => {
    vi.spyOn(desktop, "windowIsFocused").mockResolvedValue(false);
    const notify = vi.spyOn(desktop, "notify").mockResolvedValue(true);
    const attention = vi.spyOn(desktop, "setAttention").mockResolvedValue();

    const result = await announceFinish({ enabled: false, title: "t", body: "b", unread: 3 });

    expect(result).toEqual({ notified: false, badged: true });
    expect(notify).not.toHaveBeenCalled();
    expect(attention).toHaveBeenCalledWith(3);
  });

  it("keeps the badge when the notification is refused", async () => {
    // A desktop with no notification daemon must not lose the badge too —
    // it is the only remaining way to know something finished.
    vi.spyOn(desktop, "windowIsFocused").mockResolvedValue(false);
    vi.spyOn(desktop, "notify").mockResolvedValue(false);
    const attention = vi.spyOn(desktop, "setAttention").mockResolvedValue();

    const result = await announceFinish({ enabled: true, title: "t", body: "b", unread: 2 });

    expect(result).toEqual({ notified: false, badged: true });
    expect(attention).toHaveBeenCalledWith(2);
  });

  it("counts every finished session, not just the newest", async () => {
    vi.spyOn(desktop, "windowIsFocused").mockResolvedValue(false);
    vi.spyOn(desktop, "notify").mockResolvedValue(true);
    const attention = vi.spyOn(desktop, "setAttention").mockResolvedValue();

    await announceFinish({ enabled: true, title: "a", body: "a", unread: 1 });
    await announceFinish({ enabled: true, title: "b", body: "b", unread: 2 });

    expect(attention).toHaveBeenNthCalledWith(1, 1);
    expect(attention).toHaveBeenNthCalledWith(2, 2);
  });

  it("does not throw when the platform refuses everything", async () => {
    vi.spyOn(desktop, "windowIsFocused").mockRejectedValue(new Error("gone"));
    vi.spyOn(desktop, "notify").mockRejectedValue(new Error("no daemon"));
    vi.spyOn(desktop, "setAttention").mockRejectedValue(new Error("no taskbar"));

    await expect(
      announceFinish({ enabled: true, title: "t", body: "b", unread: 1 }),
    ).resolves.toBeDefined();
  });
});
