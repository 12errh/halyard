/**
 * Thin REST client for the opencode server.
 *
 * Deliberately hand-rolled over `fetch` rather than pulling in the generated
 * SDK: Halyard needs a dozen endpoints, and this keeps the transport (and its
 * failure modes) visible in one file.
 */

import { httpFetch } from "@/lib/http";
import type {
  AssistantMessage,
  MessageInfo,
  Part,
  PermissionReply,
  PendingPermission,
  ServerEvent,
  Session,
  SessionStatus,
} from "./types";

export interface FileNode {
  name: string;
  path: string;
  absolute: string;
  type: string;
  ignored?: boolean;
}

export class OpencodeError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "OpencodeError";
  }
}

export interface StatusEntry {
  name?: string;
  status?: string;
  [key: string]: unknown;
}

export interface MessageEntry {
  info: MessageInfo;
  parts: Part[];
}

export interface PromptOptions {
  model?: { providerID: string; modelID: string };
  agent?: string;
  parts: Array<{ type: "text"; text: string } | { type: "file"; url: string; mime: string; filename?: string }>;
}

export class OpencodeClient {
  constructor(
    readonly baseUrl: string,
    private readonly fetchImpl: typeof fetch = httpFetch,
  ) {}

  private async request<T>(path: string, init?: RequestInit): Promise<T> {
    let response: Response;
    try {
      response = await this.fetchImpl(`${this.baseUrl}${path}`, {
        ...init,
        headers: {
          "content-type": "application/json",
          ...(init?.headers ?? {}),
        },
      });
    } catch (cause) {
      throw new OpencodeError(`cannot reach opencode at ${this.baseUrl}: ${(cause as Error).message}`);
    }

    if (!response.ok) {
      throw new OpencodeError(
        `${init?.method ?? "GET"} ${path} failed with ${response.status}`,
        response.status,
      );
    }

    if (response.status === 204) return undefined as T;
    return (await response.json()) as T;
  }

  health() {
    return this.request<{ healthy: boolean; version: string }>("/global/health");
  }

  listSessions() {
    return this.request<Session[]>("/session");
  }

  createSession(title?: string) {
    return this.request<Session>("/session", {
      method: "POST",
      body: JSON.stringify(title ? { title } : {}),
    });
  }

  deleteSession(id: string) {
    return this.request<boolean>(`/session/${id}`, { method: "DELETE" });
  }

  renameSession(id: string, title: string) {
    return this.request<Session>(`/session/${id}`, {
      method: "PATCH",
      body: JSON.stringify({ title }),
    });
  }

  children(id: string) {
    return this.request<Session[]>(`/session/${id}/children`);
  }

  forkSession(id: string, messageID?: string) {
    return this.request<Session>(`/session/${id}/fork`, {
      method: "POST",
      body: JSON.stringify(messageID ? { messageID } : {}),
    });
  }

  messages(id: string) {
    return this.request<MessageEntry[]>(`/session/${id}/message`);
  }

  /**
   * Send a prompt *asynchronously*.
   *
   * The synchronous `/message` endpoint blocks until the whole turn completes
   * and returns nothing incremental — verified against opencode 1.18.35. All
   * output arrives over the event stream instead, which is what makes token
   * streaming possible.
   */
  sendPrompt(id: string, options: PromptOptions) {
    return this.request<void>(`/session/${id}/prompt_async`, {
      method: "POST",
      body: JSON.stringify(options),
    });
  }

  abort(id: string) {
    return this.request<boolean>(`/session/${id}/abort`, { method: "POST" });
  }

  status() {
    return this.request<Record<string, SessionStatus>>("/session/status");
  }

  agents() {
    return this.request<Array<{ name: string; description?: string; mode?: string }>>("/agent");
  }

  commands() {
    return this.request<Array<{ name: string; description?: string }>>("/command");
  }

  models() {
    return this.request<{
      providers: Array<{
        id: string;
        name: string;
        models: Record<string, { id: string; name?: string }>;
      }>;
      default: Record<string, string>;
    }>("/config/providers");
  }

  agentsConfig() {
    return this.request<Record<string, unknown>>("/config");
  }

  mcpStatus() {
    return this.request<Record<string, StatusEntry>>("/mcp");
  }

  lspStatus() {
    return this.request<StatusEntry[]>("/lsp");
  }

  config() {
    return this.request<Record<string, unknown>>("/config");
  }

  updateConfig(patch: Record<string, unknown>) {
    return this.request<Record<string, unknown>>("/config", {
      method: "PATCH",
      body: JSON.stringify(patch),
    });
  }

  diff(sessionID: string, messageID?: string) {
    const query = messageID ? `?messageID=${encodeURIComponent(messageID)}` : "";
    // Shape is SnapshotFileDiff[]: keyed by `file`, not `path`.
    return this.request<unknown[]>(`/session/${sessionID}/diff${query}`);
  }

  // --- Permissions (v2 is current; v1 kept as a fallback) ------------------

  /** Pending v2 permission requests, wrapped in `{ data }`. */
  async listPermissions(sessionID: string): Promise<PendingPermission[]> {
    const raw = await this.request<{ data?: unknown[] }>(
      `/api/session/${sessionID}/permission`,
    );
    const rows = raw?.data ?? [];
    return rows
      .map((row) => toPending(row, 2))
      .filter((row): row is PendingPermission => row !== null);
  }

  async replyPermissionV2(sessionID: string, requestID: string, reply: PermissionReply) {
    return this.request<unknown>(
      `/api/session/${sessionID}/permission/${requestID}/reply`,
      { method: "POST", body: JSON.stringify({ reply }) },
    );
  }

  async replyPermissionV1(sessionID: string, requestID: string, reply: PermissionReply) {
    return this.request<boolean>(`/session/${sessionID}/permissions/${requestID}`, {
      method: "POST",
      body: JSON.stringify({ response: reply }),
    });
  }

  /**
   * Reply using v2, falling back to v1.
   *
   * A server that only speaks v1 answers 404 here. Falling back keeps the
   * approve button working rather than leaving the agent blocked forever.
   */
  async replyPermission(sessionID: string, permission: PendingPermission, reply: PermissionReply) {
    if (permission.version === 1) {
      return this.replyPermissionV1(sessionID, permission.id, reply);
    }
    try {
      return await this.replyPermissionV2(sessionID, permission.id, reply);
    } catch (error) {
      if (error instanceof OpencodeError && error.status === 404) {
        return this.replyPermissionV1(sessionID, permission.id, reply);
      }
      throw error;
    }
  }

  // --- Files ---------------------------------------------------------------

  /**
   * List a directory. `path` must always be present — the server rejects the
   * request outright when the key is missing, so an empty string is how you ask
   * for the project root.
   */
  listFiles(path = "") {
    return this.request<FileNode[]>(`/file?path=${encodeURIComponent(path)}`);
  }

  readFile(path: string) {
    return this.request<{ type: string; content: string }>(
      `/file/content?path=${encodeURIComponent(path)}`,
    );
  }

  // --- Editing a prior turn ------------------------------------------------

  /** Rewind the conversation to just before `messageID`. */
  revert(sessionID: string, messageID: string, partID?: string) {
    return this.request<Session>(`/session/${sessionID}/revert`, {
      method: "POST",
      body: JSON.stringify(partID ? { messageID, partID } : { messageID }),
    });
  }

  unrevert(sessionID: string) {
    return this.request<Session>(`/session/${sessionID}/unrevert`, { method: "POST" });
  }

  files(query: string, limit = 20) {
    return this.request<string[]>(
      `/find/file?query=${encodeURIComponent(query)}&limit=${limit}&type=file`,
    );
  }

  eventsUrl(): string {
    return `${this.baseUrl}/event`;
  }
}

/** Adapt a raw permission row into the UI's single shape, or reject it. */
function toPending(raw: unknown, version: 1 | 2): PendingPermission | null {
  if (!raw || typeof raw !== "object") return null;
  const record = raw as Record<string, unknown>;
  const id = typeof record.id === "string" ? record.id : null;
  const sessionID = typeof record.sessionID === "string" ? record.sessionID : null;
  if (!id || !sessionID) return null;

  const source = record.source as { messageID?: string; callID?: string } | undefined;
  const tool =
    source && typeof source.messageID === "string" && typeof source.callID === "string"
      ? { messageID: source.messageID, callID: source.callID }
      : undefined;

  return {
    id,
    sessionID,
    action: typeof record.action === "string" ? record.action : "unknown",
    resources: Array.isArray(record.resources) ? (record.resources as string[]) : [],
    save: Array.isArray(record.save) ? (record.save as string[]) : undefined,
    tool,
    version,
    askedAt: Date.now(),
  };
}

export type { ServerEvent, AssistantMessage };
