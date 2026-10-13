/**
 * Composer attachments.
 *
 * Files are inlined as data URLs because that is what the opencode server
 * accepts (verified against 1.18.35). The cost is real, though: base64 inflates
 * by a third, so anything large has to be refused up front rather than turned
 * into a multi-megabyte request that stalls the turn.
 */

export interface Attachment {
  /** Stable local id; not sent to the server. */
  id: string;
  name: string;
  mime: string;
  size: number;
  /** `data:` URL, sent verbatim as the part's `url`. */
  dataUrl: string;
  /** Object URL for local preview. Revoked on removal. */
  previewUrl?: string;
}

/**
 * A browser file, described structurally.
 *
 * Naming the bare `File` type here would resolve to Node's `File` (which has
 * `type`, not `mime`) because @types/node shadows lib.dom's global. The DOM
 * `File` is exactly `Blob & { name }`, so say that instead.
 */
export type BrowserFile = Blob & { name: string };

/** Per-file ceiling. Base64 adds ~33%, so 8 MiB becomes ~11 MiB on the wire. */
export const MAX_ATTACHMENT_BYTES = 8 * 1024 * 1024;

/** Total ceiling across one prompt. */
export const MAX_TOTAL_BYTES = 24 * 1024 * 1024;

const IMAGE_MIME = /^image\/(png|jpeg|jpg|gif|webp|bmp|svg\+xml|avif)$/;
const TEXT_MIME = /^(text\/.*|application\/(json|xml|yaml|x-yaml))$/;

/** Mimes worth sending; anything else is almost certainly a mistake. */
export function isSupportedMime(mime: string): boolean {
  return IMAGE_MIME.test(mime) || TEXT_MIME.test(mime) ||
    mime === "application/pdf" || mime === "application/zip";
}

export function isImage(attachment: Pick<Attachment, "mime">): boolean {
  return IMAGE_MIME.test(attachment.mime);
}

export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** The subset of `File` that screening needs, so it can be tested without one. */
export interface CandidateFile {
  name: string;
  size: number;
  /** The browser calls this `type` on a File; normalised to `mime` here. */
  mime: string;
}

/** Adapt browser files into the shape screening works with. */
export function toCandidates(files: BrowserFile[]): CandidateFile[] {
  return files.map((file) => ({
    name: file.name,
    size: file.size,
    mime: file.type || "application/octet-stream",
  }));
}

export type RejectionReason = "too-large" | "unsupported" | "budget-exceeded";

export interface Rejection {
  name: string;
  reason: RejectionReason;
  message: string;
}

/**
 * Decide which of `incoming` may be added alongside `existing`.
 *
 * Pure, so the budget and type rules are testable without touching File.
 */
export function screenAttachments(
  existing: Attachment[],
  incoming: CandidateFile[],
): { accepted: CandidateFile[]; rejected: Rejection[] } {
  const accepted: CandidateFile[] = [];
  const rejected: Rejection[] = [];

  let running = existing.reduce((sum, a) => sum + a.size, 0);

  for (const file of incoming) {
    if (!isSupportedMime(file.mime)) {
      rejected.push({
        name: file.name,
        reason: "unsupported",
        message: `${file.name} is ${file.mime || "an unknown type"} and cannot be sent`,
      });
      continue;
    }
    if (file.size > MAX_ATTACHMENT_BYTES) {
      rejected.push({
        name: file.name,
        reason: "too-large",
        message: `${file.name} is ${formatSize(file.size)}; the limit is ${formatSize(MAX_ATTACHMENT_BYTES)}`,
      });
      continue;
    }
    if (running + file.size > MAX_TOTAL_BYTES) {
      rejected.push({
        name: file.name,
        reason: "budget-exceeded",
        message: `adding ${file.name} would exceed the ${formatSize(MAX_TOTAL_BYTES)} prompt budget`,
      });
      continue;
    }
    running += file.size;
    accepted.push(file);
  }

  return { accepted, rejected };
}

/** Read a File as a data URL plus a local preview URL. */
export function readAttachment(file: BrowserFile): Promise<Omit<Attachment, "id">> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error(`could not read ${file.name}`));
    reader.onload = () => {
      const dataUrl = String(reader.result ?? "");
      resolve({
        name: file.name,
        mime: file.type || "application/octet-stream",
        size: file.size,
        dataUrl,
        previewUrl: typeof URL !== "undefined" ? URL.createObjectURL(file) : undefined,
      });
    };
    reader.readAsDataURL(file);
  });
}

export function newAttachmentId(): string {
  return `att_${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Collect files from a drop or paste event.
 *
 * Drop carries `dataTransfer.files`; paste may carry files or a screenshot as
 * an image item with a name like `image.png`.
 */
export function filesFromTransfer(transfer: DataTransfer | null): BrowserFile[] {
  if (!transfer) return [];
  const files = Array.from(transfer.files ?? []) as BrowserFile[];
  if (files.length > 0) return files;

  const items = Array.from(transfer.items ?? []);
  const collected: BrowserFile[] = [];
  for (const item of items) {
    if (item.kind !== "file") continue;
    const file = item.getAsFile() as BrowserFile | null;
    if (file) collected.push(file);
  }
  return collected;
}

/** Turn attachments into the `file` parts the prompt body expects. */
export function toFileParts(attachments: Attachment[]) {
  return attachments.map((attachment) => ({
    type: "file" as const,
    url: attachment.dataUrl,
    mime: attachment.mime,
    filename: attachment.name,
  }));
}
