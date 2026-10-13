/**
 * Thin REST client for the opencode server.
 *
 * Deliberately hand-rolled over `fetch` rather than pulling in the generated
 * SDK: Halyard needs a dozen endpoints, and this keeps the transport (and its
 * failure modes) visible in one file.
 */

import type {
  AssistantMessage,
  MessageInfo,
  Part,
  ServerEvent,
  Session,
  SessionStatus,
} from "./types";

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
    private readonly fetchImpl: typeof fetch = fetch,
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

  diff(sessionID: string) {
    return this.request<{ diff: unknown[] }>(`/session/${sessionID}/diff`);
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

export type { ServerEvent, AssistantMessage };
