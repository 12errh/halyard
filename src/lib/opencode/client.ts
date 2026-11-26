/**
 * Thin REST client for the opencode v2 server.
 *
 * Deliberately hand-rolled over `fetch` rather than pulling in the generated
 * SDK: Halyard needs a few dozen endpoints, and this keeps the transport (and
 * its failure modes) visible in one file.
 *
 * v2.4.x requires HTTP Basic auth on every route — user `opencode`, password
 * generated per server boot and handed to us by the Rust side. The credential
 * never appears in logs or error messages; it is only ever put on the wire.
 */

import { httpFetch } from "@/lib/http";
import {
  subscribe,
  type SseHandle,
  type SseOptions,
} from "./sse";
import type {
  AgentInfoV2,
  ConfigEntry,
  CredentialEntry,
  CursorV2,
  FileDiff,
  FileStatus,
  Form,
  FormValue,
  InboxCompaction,
  InboxUser,
  IntegrationAttemptEncoded,
  IntegrationAttemptStatus,
  IntegrationInfo,
  McpServer,
  MessageV2,
  ModelInfo,
  Permission,
  PermissionReply,
  ProviderInfo,
  ServerInfoV2,
  SessionInfoV2,
  SessionRevert,
  SkillInfo,
  V2Event,
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

/** One page of a cursor-paginated v2 list. */
export interface Page<T> {
  data: T[];
  cursor: CursorV2;
}

/** A cursor that says "no more pages", for responses that omit one. */
const NO_CURSOR: CursorV2 = { previous: null, next: null };

type QueryValue = string | number | boolean | undefined;

function queryString(params: Record<string, QueryValue>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined) continue;
    search.set(key, String(value));
  }
  const encoded = search.toString();
  return encoded ? `?${encoded}` : "";
}

interface RequestOptions {
  method?: string;
  body?: unknown;
  query?: Record<string, QueryValue>;
}

interface RawEntry {
  path?: string;
  type?: string;
  [key: string]: unknown;
}

export class OpencodeClient {
  readonly baseUrl: string;
  private readonly authorization: string;
  private readonly fetchImpl: typeof fetch;

  constructor(baseUrl: string, password: string, fetchImpl: typeof fetch = httpFetch) {
    this.baseUrl = baseUrl.replace(/\/+$/, "");
    // btoa needs latin-1; opencode passwords are hex, so this is safe.
    this.authorization = `Basic ${btoa(`opencode:${password}`)}`;
    this.fetchImpl = fetchImpl;
  }

  // --- Transport ----------------------------------------------------------

  private url(path: string): string {
    return `${this.baseUrl}${path}`;
  }

  /**
   * Run a request and return the response for the caller to decode.
   *
   * Content-type is only set when a body is going out: sending it on a GET
   * makes some proxies treat the request as preflighted and mutating.
   */
  private async request(path: string, options: RequestOptions = {}): Promise<Response> {
    const headers = new Headers();
    headers.set("Authorization", this.authorization);
    if (options.body !== undefined) headers.set("Content-Type", "application/json");

    const response = await this.fetchImpl(
      this.url(path) + queryString(options.query ?? {}),
      {
        method: options.method ?? "GET",
        headers,
        body: options.body === undefined ? undefined : JSON.stringify(options.body),
      },
    );

    if (!response.ok) throw await this.failure(response);
    return response;
  }

  /** Decode a JSON body, treating 204 and empty bodies as `undefined`. */
  private async body<T>(response: Response): Promise<T | undefined> {
    if (response.status === 204) return undefined;
    const text = await response.text();
    if (!text.trim()) return undefined;
    return JSON.parse(text) as T;
  }

  /** Unwrap the v2 `{data: T}` envelope. */
  private async requestData<T>(path: string, options: RequestOptions = {}): Promise<T> {
    const parsed = await this.body<{ data?: T }>(await this.request(path, options));
    return parsed?.data as T;
  }

  /** Unwrap a cursor-paginated list, defaulting a missing cursor to empty. */
  private async requestList<T>(
    path: string,
    options: RequestOptions = {},
  ): Promise<Page<T>> {
    const parsed = await this.body<{ data?: T[]; cursor?: CursorV2 }>(
      await this.request(path, options),
    );
    return {
      data: Array.isArray(parsed?.data) ? parsed.data : [],
      cursor: parsed?.cursor ?? NO_CURSOR,
    };
  }

  private async failure(response: Response): Promise<OpencodeError> {
    let message = response.statusText || `HTTP ${response.status}`;

    try {
      const text = await response.text();
      if (text.trim()) {
        const parsed = JSON.parse(text) as { _tag?: string; message?: unknown; kind?: string };
        if (typeof parsed.message === "string") message = parsed.message;
        else if (parsed._tag) message = parsed._tag;
      }
    } catch {
      // Not a JSON error envelope; the status text stands in.
    }

    return new OpencodeError(message, response.status);
  }

  // --- Server -------------------------------------------------------------

  info(): Promise<ServerInfoV2> {
    return this.request("/api/info").then((response) => response.json() as Promise<ServerInfoV2>);
  }

  // --- Sessions -----------------------------------------------------------

  listSessions(opts: {
    limit?: number;
    cursor?: string;
    search?: string;
    parentID?: string;
    archived?: boolean;
  } = {}): Promise<Page<SessionInfoV2>> {
    return this.requestList<SessionInfoV2>("/api/session", { query: { ...opts } });
  }

  getSession(id: string): Promise<SessionInfoV2> {
    return this.requestData<SessionInfoV2>(`/api/session/${encodeURIComponent(id)}`);
  }

  createSession(body: { title?: string } = {}): Promise<SessionInfoV2> {
    return this.requestData<SessionInfoV2>("/api/session", { method: "POST", body });
  }

  async updateSession(
    id: string,
    patch: { title?: string; archived?: boolean; metadata?: Record<string, unknown> },
  ): Promise<void> {
    await this.request(`/api/session/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: patch,
    });
  }

  async deleteSession(id: string): Promise<void> {
    await this.request(`/api/session/${encodeURIComponent(id)}`, { method: "DELETE" });
  }

  forkSession(id: string, before?: string): Promise<SessionInfoV2> {
    return this.requestData<SessionInfoV2>(`/api/session/${encodeURIComponent(id)}/fork`, {
      method: "POST",
      body: { before },
    });
  }

  messages(id: string, opts: { cursor?: string; limit?: number } = {}): Promise<Page<MessageV2>> {
    return this.requestList<MessageV2>(`/api/session/${encodeURIComponent(id)}/message`, {
      query: { ...opts },
    });
  }

  sendPrompt(
    id: string,
    body: {
      text: string;
      files?: { url: string; mime?: string; filename?: string }[];
      agents?: { name: string }[];
      skills?: { name: string }[];
      resume?: boolean;
      delivery?: string;
    },
  ): Promise<InboxUser> {
    return this.requestData<InboxUser>(`/api/session/${encodeURIComponent(id)}/prompt`, {
      method: "POST",
      body,
    });
  }

  async interrupt(id: string): Promise<{ interrupted: boolean }> {
    const parsed = await this.body<{ interrupted?: boolean; data?: { interrupted?: boolean } }>(
      await this.request(`/api/session/${encodeURIComponent(id)}/interrupt`, { method: "POST" }),
    );
    return { interrupted: parsed?.data?.interrupted ?? parsed?.interrupted ?? false };
  }

  async active(): Promise<Record<string, { type: "running" }>> {
    const parsed = await this.body<{ data?: Record<string, { type: "running" }> }>(
      await this.request("/api/session/active"),
    );
    return parsed?.data ?? {};
  }

  async setSessionModel(
    id: string,
    model: { id: string; providerID: string; variant?: string },
  ): Promise<void> {
    await this.request(`/api/session/${encodeURIComponent(id)}/model`, {
      method: "POST",
      body: { model },
    });
  }

  async setSessionAgent(id: string, agent: string): Promise<void> {
    await this.request(`/api/session/${encodeURIComponent(id)}/agent`, {
      method: "POST",
      body: { agent },
    });
  }

  // --- Workspace ----------------------------------------------------------

  async vcs(): Promise<{ branch: string | null; defaultBranch: string | null }> {
    const parsed = await this.body<{
      data?: { branch?: { current?: string | null; default?: string | null } };
    }>(await this.request("/api/vcs"));
    const branch = parsed?.data?.branch;
    return {
      branch: branch?.current ?? null,
      defaultBranch: branch?.default ?? null,
    };
  }

  async fileStatus(): Promise<FileStatus[]> {
    const parsed = await this.body<{ data?: FileStatus[] }>(
      await this.request("/api/vcs/status"),
    );
    return Array.isArray(parsed?.data) ? parsed.data : [];
  }

  async diff(id: string): Promise<FileDiff[]> {
    const parsed = await this.body<{ data?: FileDiff[] }>(
      await this.request(`/api/session/${encodeURIComponent(id)}/diff`),
    );
    return Array.isArray(parsed?.data) ? parsed.data : [];
  }

  // --- Catalogue ----------------------------------------------------------

  agents(): Promise<AgentInfoV2[]> {
    return this.requestData<AgentInfoV2[]>("/api/agent").then((data) =>
      Array.isArray(data) ? data : [],
    );
  }

  async commands(): Promise<{ name: string; description?: string; source?: string }[]> {
    const parsed = await this.body<{
      data?: { name: string; description?: string; source?: string }[];
    }>(await this.request("/api/command"));
    return Array.isArray(parsed?.data) ? parsed.data : [];
  }

  providers(): Promise<ProviderInfo[]> {
    return this.requestData<ProviderInfo[]>("/api/provider").then((data) =>
      Array.isArray(data) ? data : [],
    );
  }

  models(): Promise<ModelInfo[]> {
    return this.requestData<ModelInfo[]>("/api/model").then((data) =>
      Array.isArray(data) ? data : [],
    );
  }

  skills(): Promise<SkillInfo[]> {
    return this.requestData<SkillInfo[]>("/api/skill").then((data) =>
      Array.isArray(data) ? data : [],
    );
  }

  async config(): Promise<ConfigEntry[]> {
    // Unlike every other catalogue route, /api/config returns a bare array of
    // source entries rather than a `{data:[...]}` envelope.
    const parsed = await this.body<ConfigEntry[] | { data?: ConfigEntry[] }>(
      await this.request("/api/config"),
    );
    if (Array.isArray(parsed)) return parsed;
    return Array.isArray(parsed?.data) ? parsed.data : [];
  }

  mcpStatus(): Promise<McpServer[]> {
    return this.requestData<McpServer[]>("/api/mcp").then((data) =>
      Array.isArray(data) ? data : [],
    );
  }

  integrations(): Promise<IntegrationInfo[]> {
    return this.requestData<IntegrationInfo[]>("/api/integration").then((data) =>
      Array.isArray(data) ? data : [],
    );
  }

  credentials(): Promise<CredentialEntry[]> {
    return this.requestData<CredentialEntry[]>("/api/credential").then((data) =>
      Array.isArray(data) ? data : [],
    );
  }

  // --- Integrations and credentials ---------------------------------------

  async connectIntegrationKey(
    id: string,
    body: { key: string; label?: string; answer?: Record<string, string> },
  ): Promise<void> {
    await this.request(`/api/integration/${encodeURIComponent(id)}/connect/key`, {
      method: "POST",
      body,
    });
  }

  connectIntegrationOauth(
    id: string,
    body: { methodID: string; answer?: Record<string, string>; label?: string },
  ): Promise<IntegrationAttemptEncoded> {
    return this.requestData<IntegrationAttemptEncoded>(
      `/api/integration/${encodeURIComponent(id)}/connect/oauth`,
      { method: "POST", body },
    );
  }

  oauthStatus(id: string, attemptID: string): Promise<IntegrationAttemptStatus> {
    return this.requestData<IntegrationAttemptStatus>(
      `/api/integration/${encodeURIComponent(id)}/connect/oauth/${encodeURIComponent(attemptID)}`,
    );
  }

  async completeOauth(id: string, attemptID: string, code?: string): Promise<void> {
    await this.request(
      `/api/integration/${encodeURIComponent(id)}/connect/oauth/${encodeURIComponent(attemptID)}/complete`,
      { method: "POST", body: { code } },
    );
  }

  createCredential(body: {
    integrationID: string;
    value: CredentialEntry["value"];
    label?: string;
    activate?: boolean;
  }): Promise<CredentialEntry> {
    return this.requestData<CredentialEntry>("/api/credential", { method: "POST", body });
  }

  async activateCredential(id: string): Promise<void> {
    await this.request(`/api/credential/${encodeURIComponent(id)}/activate`, { method: "POST" });
  }

  async deleteCredential(id: string): Promise<void> {
    await this.request(`/api/credential/${encodeURIComponent(id)}`, { method: "DELETE" });
  }

  // --- Forms and permissions ---------------------------------------------

  forms(sessionID: string): Promise<Form.Info[]> {
    return this.requestData<Form.Info[]>(
      `/api/session/${encodeURIComponent(sessionID)}/form`,
    ).then((data) => (Array.isArray(data) ? data : []));
  }

  async replyForm(
    sessionID: string,
    formID: string,
    answer: Record<string, FormValue>,
  ): Promise<void> {
    await this.request(
      `/api/session/${encodeURIComponent(sessionID)}/form/${encodeURIComponent(formID)}/reply`,
      { method: "POST", body: { answer } },
    );
  }

  permissions(sessionID: string): Promise<Permission.Request[]> {
    return this.requestData<Permission.Request[]>(
      `/api/session/${encodeURIComponent(sessionID)}/permission`,
    ).then((data) => (Array.isArray(data) ? data : []));
  }

  async replyPermission(
    sessionID: string,
    requestID: string,
    decision: PermissionReply,
  ): Promise<void> {
    await this.request(
      `/api/session/${encodeURIComponent(sessionID)}/permission/${encodeURIComponent(requestID)}/reply`,
      { method: "POST", body: { decision } },
    );
  }

  // --- Filesystem ---------------------------------------------------------

  async files(query: string, limit = 20): Promise<string[]> {
    const parsed = await this.body<{ data?: RawEntry[] }>(
      await this.request("/api/fs/find", {
        query: { query, type: "file", limit },
      }),
    );
    if (!Array.isArray(parsed?.data)) return [];
    return parsed.data
      .map((entry) => entry.path)
      .filter((path): path is string => typeof path === "string");
  }

  async listFiles(path = ""): Promise<FileNode[]> {
    const parsed = await this.body<{ data?: RawEntry[] }>(
      await this.request("/api/fs/list", { query: { path } }),
    );
    if (!Array.isArray(parsed?.data)) return [];

    return parsed.data
      .filter((entry): entry is RawEntry & { path: string } => typeof entry.path === "string")
      .map((entry) => {
        // Directory entries arrive with a trailing slash ("home/"), which
        // would otherwise make the derived name an empty string.
        const trimmed = entry.path.replace(/\/+$/, "");
        return {
          name: trimmed.split("/").pop() ?? trimmed,
          path: entry.path,
          absolute: `${this.baseUrl}/api/fs/read/${encodePath(entry.path)}`,
          type: entry.type ?? "file",
          ignored: typeof entry.ignored === "boolean" ? entry.ignored : undefined,
        };
      });
  }

  readFile(path: string): Promise<string> {
    return this.request(`/api/fs/read/${encodePath(path)}`).then((response) =>
      response.text(),
    );
  }

  // --- Revert and compaction ---------------------------------------------

  revertStage(
    id: string,
    messageID: string,
    files?: string[],
  ): Promise<SessionRevert> {
    return this.requestData<SessionRevert>(
      `/api/session/${encodeURIComponent(id)}/revert/stage`,
      { method: "POST", body: { messageID, files } },
    );
  }

  async revertClear(id: string): Promise<void> {
    await this.request(`/api/session/${encodeURIComponent(id)}/revert`, {
      method: "DELETE",
    });
  }

  async revertCommit(id: string): Promise<void> {
    await this.request(`/api/session/${encodeURIComponent(id)}/revert/commit`, {
      method: "POST",
    });
  }

  compact(id: string): Promise<InboxCompaction> {
    return this.requestData<InboxCompaction>(
      `/api/session/${encodeURIComponent(id)}/compact`,
      { method: "POST", body: {} },
    );
  }

  // --- Events -------------------------------------------------------------

  /**
   * Identity of the server this client talks to, credential included.
   *
   * Stores use it to decide whether a client is genuinely a different server.
   * Comparing the URL alone missed a restart that reused the port with a new
   * password, so every caller kept the stale credential and got a 401.
   */
  get serverKey(): string {
    return `${this.baseUrl}\n${this.authorization}`;
  }

  eventsUrl(): string {
    return `${this.baseUrl}/api/event`;
  }

  /** Subscribe to the event bus with credentials already attached. */
  subscribeEvents(options: Omit<SseOptions, "headers">): SseHandle {
    return subscribe(this.eventsUrl(), {
      ...options,
      headers: { Authorization: this.authorization },
    });
  }
}

function encodePath(path: string): string {
  return path
    .split("/")
    .filter((segment) => segment.length > 0)
    .map((segment) => encodeURIComponent(segment))
    .join("/");
}

/** Re-exported so callers can name the event type without reaching past this module. */
export type { V2Event };
