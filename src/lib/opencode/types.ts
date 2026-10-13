/**
 * Wire types for the opencode server.
 *
 * These mirror the server's OpenAPI spec (`GET /doc`) for opencode 1.18.x.
 * Fields are typed as the server actually sends them; anything genuinely
 * untyped upstream is `unknown` rather than a hopeful guess.
 */

export interface ModelRef {
  providerID: string;
  modelID: string;
}

export interface TimeParts {
  created: number;
  updated?: number;
  completed?: number;
}

export interface TokenUsage {
  input: number;
  output: number;
  reasoning: number;
  cache?: { read: number; write: number };
}

// --- Sessions -------------------------------------------------------------

export interface Session {
  id: string;
  slug: string;
  projectID: string;
  directory: string;
  parentID?: string;
  title: string;
  agent?: string;
  model?: { id: string; providerID: string; variant?: string };
  version: string;
  cost?: number;
  tokens?: TokenUsage;
  summary?: { additions: number; deletions: number; files: number };
  time: TimeParts;
}

// --- Messages -------------------------------------------------------------

export interface UserMessage {
  id: string;
  sessionID: string;
  role: "user";
  time: TimeParts;
  agent: string;
  model: ModelRef;
  error?: MessageError;
}

export interface AssistantMessage {
  id: string;
  sessionID: string;
  role: "assistant";
  parentID: string;
  providerID: string;
  modelID: string;
  agent: string;
  mode: string;
  path: { cwd: string; root: string };
  cost: number;
  tokens: TokenUsage;
  time: TimeParts;
  error?: MessageError;
  summary?: boolean;
}

export type MessageInfo = UserMessage | AssistantMessage;

export interface MessageError {
  name: string;
  data?: { message?: string; statusCode?: number; isRetryable?: boolean };
}

// --- Parts ----------------------------------------------------------------

export interface BasePart {
  id: string;
  sessionID: string;
  messageID: string;
  type: PartType;
  synthetic?: boolean;
  /**
   * True while this part exists only as accumulated deltas, before the server
   * sent the authoritative `message.part.updated`.
   */
  streaming?: boolean;
}

export interface TextPart extends BasePart {
  type: "text";
  text: string;
}

export interface ReasoningPart extends BasePart {
  type: "reasoning";
  text: string;
  time: TimeParts;
}

export type ToolStatus = "pending" | "running" | "completed" | "error";

export type ToolState =
  | { status: "pending" | "running"; input?: Record<string, unknown>; title?: string; time?: TimeParts }
  | { status: "completed"; input: Record<string, unknown>; output: string; title: string; time: TimeParts }
  | { status: "error"; input?: Record<string, unknown>; title?: string; error: string; time?: TimeParts };

/** Human-readable label for a tool call, falling back to its arguments. */
export function toolTitle(tool: string, state: ToolState): string {
  if (state.title) return state.title;
  const input = state.input;
  if (input) {
    for (const key of ["command", "pattern", "filePath", "path", "query", "url", "description"]) {
      const value = input[key];
      if (typeof value === "string" && value.trim()) return value;
    }
  }
  return tool;
}


export interface ToolPart extends BasePart {
  type: "tool";
  callID: string;
  tool: string;
  state: ToolState;
}

export interface StepStartPart extends BasePart {
  type: "step-start";
  snapshot?: string;
}

export interface StepFinishPart extends BasePart {
  type: "step-finish";
  reason: string;
  cost: number;
  tokens: TokenUsage;
}

export interface AgentPart extends BasePart {
  type: "agent";
  name: string;
}

export interface FilePart extends BasePart {
  type: "file";
  mime: string;
  filename?: string;
  url: string;
}

export interface RetryPart extends BasePart {
  type: "retry";
  attempt: number;
  error: MessageError;
  time: TimeParts;
}

export interface CompactionPart extends BasePart {
  type: "compaction";
  auto: boolean;
}

export interface SubtaskPart extends BasePart {
  type: "subtask";
  prompt: string;
  description: string;
  agent?: string;
}

export type Part =
  | TextPart
  | ReasoningPart
  | ToolPart
  | StepStartPart
  | StepFinishPart
  | AgentPart
  | FilePart
  | RetryPart
  | CompactionPart
  | SubtaskPart;

export type PartType = Part["type"];

export function isTextPart(part: Part): part is TextPart {
  return part.type === "text";
}

export function isReasoningPart(part: Part): part is ReasoningPart {
  return part.type === "reasoning";
}

export function isToolPart(part: Part): part is ToolPart {
  return part.type === "tool";
}

// --- Session status -------------------------------------------------------

export type SessionStatus =
  | { type: "idle" }
  | { type: "busy" }
  | { type: "retry"; attempt: number; message: string; next: number };

// --- Diffs ----------------------------------------------------------------

export interface FileDiff {
  path?: string;
  file?: string;
  additions: number;
  deletions: number;
  status?: string;
  patch?: string;
}

// --- Permissions ----------------------------------------------------------

/**
 * opencode exposes two permission generations. `permission.asked` is the
 * original shape; `permission.v2.asked` is the current one. Both are
 * normalised into `PendingPermission` so the UI has a single thing to render.
 */
export type PermissionReply = "once" | "always" | "reject";

export interface PendingPermission {
  /** Stable across both generations; the id the reply endpoint expects. */
  id: string;
  sessionID: string;
  /** v1 `permission`, v2 `action`. */
  action: string;
  /** v1 `patterns`, v2 `resources`. */
  resources: string[];
  /** Actions that "always allow" would persist, when the server supplies them. */
  save?: string[];
  tool?: { messageID: string; callID: string };
  /** Which event produced this, so the card can label itself accurately. */
  version: 1 | 2;
  /** Local-only: when Halyard first learned about it, for stable ordering. */
  askedAt: number;
}

export interface PermissionAskedV1 {
  id: string;
  sessionID: string;
  permission: string;
  patterns: string[];
  always?: string[];
  tool?: { messageID: string; callID: string };
}

export interface PermissionAskedV2 {
  id: string;
  sessionID: string;
  action: string;
  resources: string[];
  save?: string[];
  source?: { type: string; messageID: string; callID: string };
}

// --- Events ---------------------------------------------------------------

/** Every event the server emits is `{ id, type, properties }`. */
export interface ServerEvent<T = Record<string, unknown>> {
  id: string;
  type: string;
  properties: T;
}

export interface Events {
  "server.connected": Record<string, never>;
  "server.heartbeat": Record<string, never>;
  "session.updated": { sessionID: string; info: Session };
  "session.deleted": { sessionID: string };
  "message.updated": { sessionID: string; info: MessageInfo };
  "message.removed": { sessionID: string; messageID: string };
  "message.part.updated": { sessionID: string; part: Part };
  "message.part.delta": {
    sessionID: string;
    messageID: string;
    partID: string;
    field: string;
    delta: string;
  };
  "session.status": { sessionID: string; status: SessionStatus };
  "session.idle": { sessionID: string };
  "session.error": { sessionID: string; error: MessageError };
  "session.diff": { sessionID: string; diff: FileDiff[] };
  "permission.replied": { sessionID: string; requestID: string; reply: string };
  [key: string]: { sessionID?: string } & Record<string, unknown>;

}

export type EventType = keyof Events & string;
