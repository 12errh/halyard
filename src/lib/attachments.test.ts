import { describe, expect, it } from "vitest";
import {
  formatSize,
  isImage,
  isSupportedMime,
  MAX_ATTACHMENT_BYTES,
  MAX_TOTAL_BYTES,
  screenAttachments,
  toCandidates,
  toFileParts,
  type Attachment,
  type BrowserFile,
} from "@/lib/attachments";

const MB = 1024 * 1024;
void MAX_TOTAL_BYTES;

function candidate(name: string, size: number, mime = "image/png") {
  return { name, size, mime };
}

function attachment(size: number, mime = "image/png"): Attachment {
  return { id: "a1", name: "a.png", mime, size, dataUrl: "data:image/png;base64,AA" };
}

describe("mime screening", () => {
  it("accepts images", () => {
    for (const mime of ["image/png", "image/jpeg", "image/webp", "image/svg+xml"]) {
      expect(isSupportedMime(mime)).toBe(true);
    }
  });

  it("accepts text and structured text", () => {
    for (const mime of ["text/plain", "text/x-python", "application/json", "application/yaml"]) {
      expect(isSupportedMime(mime)).toBe(true);
    }
  });

  it("rejects binaries that cannot be represented usefully", () => {
    expect(isSupportedMime("application/x-msdownload")).toBe(false);
    expect(isSupportedMime("video/mp4")).toBe(false);
  });

  it("recognises images for preview purposes", () => {
    expect(isImage({ mime: "image/png" })).toBe(true);
    expect(isImage({ mime: "text/plain" })).toBe(false);
  });
});

describe("screenAttachments", () => {
  it("accepts a normal file", () => {
    const { accepted, rejected } = screenAttachments([], [candidate("a.png", 100 * 1024)]);
    expect(accepted).toHaveLength(1);
    expect(rejected).toHaveLength(0);
  });

  it("rejects an unsupported type with a readable reason", () => {
    const { accepted, rejected } = screenAttachments([], [candidate("x.exe", 10, "application/x-msdownload")]);
    expect(accepted).toHaveLength(0);
    expect(rejected[0]).toMatchObject({ name: "x.exe", reason: "unsupported" });
    expect(rejected[0]!.message).toContain("x.exe");
  });

  it("rejects a file over the per-file ceiling", () => {
    const { rejected } = screenAttachments([], [candidate("big.png", MAX_ATTACHMENT_BYTES + 1)]);
    expect(rejected[0]).toMatchObject({ reason: "too-large" });
    expect(rejected[0]!.message).toContain("limit");
  });

  it("accepts a file exactly at the per-file ceiling", () => {
    const { accepted, rejected } = screenAttachments([], [candidate("edge.png", MAX_ATTACHMENT_BYTES)]);
    expect(accepted).toHaveLength(1);
    expect(rejected).toHaveLength(0);
  });

  it("accounts for files already attached", () => {
    // Two 8 MiB files are 16 MiB of the 24 MiB prompt budget; a third fits
    // exactly, a fourth does not.
    const chunk = MAX_ATTACHMENT_BYTES;
    const existing = [attachment(chunk), attachment(chunk)];

    const fits = screenAttachments(existing, [candidate("third.png", chunk)]);
    expect(fits.accepted.map((f) => f.name)).toEqual(["third.png"]);

    const overflows = screenAttachments(existing, [candidate("third.png", chunk), candidate("fourth.png", chunk)]);
    expect(overflows.accepted.map((f) => f.name)).toEqual(["third.png"]);
    expect(overflows.rejected[0]).toMatchObject({ name: "fourth.png", reason: "budget-exceeded" });
  });

  it("keeps the files that fit and rejects only the overflow", () => {
    const { accepted, rejected } = screenAttachments(
      [attachment(MAX_TOTAL_BYTES - 1024)],
      [candidate("ok.png", 512), candidate("too-much.png", MAX_TOTAL_BYTES)],
    );
    expect(accepted.map((f) => f.name)).toEqual(["ok.png"]);
    expect(rejected.map((f) => f.name)).toEqual(["too-much.png"]);
  });

  it("accumulates size across a batch", () => {
    const chunk = MAX_ATTACHMENT_BYTES;
    const { accepted, rejected } = screenAttachments([], [
      candidate("a.png", chunk),
      candidate("b.png", chunk),
      candidate("c.png", chunk),
      candidate("d.png", chunk),
    ]);
    // 3 x 8 MiB lands exactly on the 24 MiB budget; the fourth is over.
    expect(accepted.map((f) => f.name)).toEqual(["a.png", "b.png", "c.png"]);
    expect(rejected.map((f) => f.name)).toEqual(["d.png"]);
  });

  it("rejects everything when nothing is sent", () => {
    expect(screenAttachments([], []).accepted).toEqual([]);
  });
});

describe("formatSize", () => {
  it("scales units", () => {
    expect(formatSize(512)).toBe("512 B");
    expect(formatSize(2048)).toBe("2 KB");
    expect(formatSize(5 * MB)).toBe("5.0 MB");
  });
});

describe("toFileParts", () => {
  it("produces the part shape the prompt endpoint expects", () => {
    const parts = toFileParts([attachment(10, "image/png")]);
    expect(parts).toEqual([
      { type: "file", url: "data:image/png;base64,AA", mime: "image/png", filename: "a.png" },
    ]);
  });

  it("produces nothing for no attachments", () => {
    expect(toFileParts([])).toEqual([]);
  });
});

describe("toCandidates", () => {
  it("maps a browser File's `type` onto `mime`", () => {
    // Browser files call it `type`; a blob-like object is enough for this.
    const file = { name: "shot.png", size: 10, type: "image/png" } as BrowserFile;
    expect(toCandidates([file])).toEqual([{ name: "shot.png", size: 10, mime: "image/png" }]);
  });

  it("falls back to octet-stream when type is empty", () => {
    const file = { name: "mystery", size: 10, type: "" } as BrowserFile;
    expect(toCandidates([file])[0]!.mime).toBe("application/octet-stream");
  });
});
