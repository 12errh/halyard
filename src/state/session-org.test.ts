import { beforeEach, describe, expect, it } from "vitest";
import { useSessionOrg } from "@/state/session-org";
import { plural } from "@/components/chat/tool-view";

const PROJECT = "/repo";
const sessions = (...ids: string[]) => ids.map((id) => ({ id }));

function reset() {
  useSessionOrg.setState({ pinned: {}, archived: {}, unseen: {} });
}

describe("pinning", () => {
  beforeEach(reset);

  it("puts a pinned session at the top", () => {
    const org = useSessionOrg.getState();
    org.togglePin(PROJECT, "b");
    const result = org.arrange(PROJECT, sessions("a", "b", "c"));
    expect(result.pinned.map((s) => s.id)).toEqual(["b"]);
    expect(result.recent.map((s) => s.id)).toEqual(["a", "c"]);
  });

  it("puts the most recently pinned at the top", () => {
    const org = useSessionOrg.getState();
    org.togglePin(PROJECT, "c");
    org.togglePin(PROJECT, "a");
    org.togglePin(PROJECT, "b");
    // Pinning a second session puts it above the first, as pinning does
    // everywhere else — the thing you pinned last is the thing you want.
    expect(org.arrange(PROJECT, sessions("a", "b", "c")).pinned.map((s) => s.id)).toEqual(["b", "a", "c"]);
  });

  it("unpins on a second press", () => {
    const org = useSessionOrg.getState();
    org.togglePin(PROJECT, "a");
    org.togglePin(PROJECT, "a");
    expect(useSessionOrg.getState().isPinned(PROJECT, "a")).toBe(false);
  });

  it("scopes pins per project", () => {
    useSessionOrg.getState().togglePin(PROJECT, "a");
    expect(useSessionOrg.getState().isPinned("/other", "a")).toBe(false);
  });
});

describe("archiving", () => {
  beforeEach(reset);

  it("moves a session out of the working list but keeps it", () => {
    // Archiving is not deleting: opencode still holds the transcript, and the
    // user has to be able to change their mind.
    const org = useSessionOrg.getState();
    org.toggleArchive(PROJECT, "b");
    const result = org.arrange(PROJECT, sessions("a", "b"));
    expect(result.recent.map((s) => s.id)).toEqual(["a"]);
    expect(result.archived.map((s) => s.id)).toEqual(["b"]);
  });

  it("restores on a second press", () => {
    const org = useSessionOrg.getState();
    org.toggleArchive(PROJECT, "a");
    org.toggleArchive(PROJECT, "a");
    expect(useSessionOrg.getState().arrange(PROJECT, sessions("a")).recent).toHaveLength(1);
  });

  it("a pinned session can still be archived", () => {
    const org = useSessionOrg.getState();
    org.togglePin(PROJECT, "a");
    org.toggleArchive(PROJECT, "a");
    // Archive wins over pin — otherwise a session could be hidden and pinned
    // back into view at the same time.
    const result = org.arrange(PROJECT, sessions("a"));
    expect(result.pinned).toHaveLength(0);
    expect(result.archived).toHaveLength(1);
  });
});

describe("unread tracking", () => {
  beforeEach(reset);

  it("records and clears", () => {
    const org = useSessionOrg.getState();
    org.markUnseen(PROJECT, "a");
    expect(useSessionOrg.getState().isUnseen(PROJECT, "a")).toBe(true);
    org.markSeen(PROJECT, "a");
    expect(useSessionOrg.getState().isUnseen(PROJECT, "a")).toBe(false);
  });

  it("does not record the same session twice", () => {
    useSessionOrg.getState().markUnseen(PROJECT, "a");
    useSessionOrg.getState().markUnseen(PROJECT, "a");
    expect(useSessionOrg.getState().unseen[PROJECT]).toEqual(["a"]);
  });

  it("clearing an unseen session that was never unseen is harmless", () => {
    expect(() => useSessionOrg.getState().markSeen(PROJECT, "zzz")).not.toThrow();
  });
});

describe("plural", () => {
  it("handles the nouns the tool rows actually use", () => {
    // "filees" and "matchs" were both shipped by the first attempt.
    expect(plural(1, "file")).toBe("1 file");
    expect(plural(2, "file")).toBe("2 files");
    expect(plural(3, "match")).toBe("3 matches");
    expect(plural(1, "match")).toBe("1 match");
    expect(plural(2, "tool")).toBe("2 tools");
    expect(plural(2, "question")).toBe("2 questions");
    expect(plural(2, "class")).toBe("2 classes");
    expect(plural(2, "day")).toBe("2 days");
  });
});
