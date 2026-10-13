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

/**
 * Structured extras the server attaches to a tool call.
 *
 * These are not decoration. The tool's *input* says what was asked for; the
 * metadata says what came back in a form worth showing. An `edit` carries its
 * unified diff here, `glob`/`grep` carry match counts, `question` carries the
 * answers. Without them a completed tool call is just a name and a blob of
 * text.
 *
 * Declared as a loose record because the set differs per tool and grows with
 * opencode's versions; the readers below narrow it and tolerate absence.
 */
export interface ToolMetadata {
  /** `edit` — unified diff for the change. */
  diff?: string;
  /** `glob` — how many paths matched. */
  count?: number;
  /** `grep` — how many matches. */
  matches?: number;
  /** `websearch` — which search backend answered. */
  provider?: string;
  /** `question` — the answers, parallel to the questions that were asked. */
  answers?: string[][];
  /** `patch` — per-file patches applied together. */
  files?: Array<{
    filePath?: string;
    relativePath?: string;
    movePath?: string;
    patch?: string;
    additions?: number;
    deletions?: number;
    type?: string;
  }>;
  /** `todowrite` — the list, mirrored from the input for convenience. */
  todos?: Todo[];
  /** Set when a long list was cut short for display. */
  truncated?: boolean;
  [key: string]: unknown;
}

export type ToolState =
  | {
      status: "pending" | "running";
      input?: Record<string, unknown>;
      title?: string;
      time?: TimeParts;
      metadata?: ToolMetadata;
    }
  | {
      status: "completed";
      input: Record<string, unknown>;
      output: string;
      title: string;
      time: TimeParts;
      metadata?: ToolMetadata;
    }
  | {
      status: "error";
      input?: Record<string, unknown>;
      title?: string;
      error: string;
      time?: TimeParts;
      metadata?: ToolMetadata;
    };

/**
 * A single entry in an agent's plan.
 *
 * `status` and `priority` are read from the server and can both be absent or
 * carry a value this build does not know about, so the narrowers below are
 * deliberately forgiving rather than a hard union.
 */
export interface Todo {
  content?: string;
  status?: string;
  priority?: string;
  id?: string;
}

export const TODO_STATUSES = ["pending", "in_progress", "completed", "cancelled"] as const;
export type TodoStatus = (typeof TODO_STATUSES)[number];

export const TODO_PRIORITIES = ["high", "medium", "low"] as const;
export type TodoPriority = (typeof TODO_PRIORITIES)[number];

/** Coerce a server todo into one we can render, or `null` if unusable. */
export function normaliseTodo(raw: unknown): Todo | null {
  if (!raw || typeof raw !== "object") return null;
  const record = raw as Record<string, unknown>;
  const content = typeof record.content === "string" ? record.content.trim() : "";
  if (!content) return null;
  return {
    content,
    status: typeof record.status === "string" ? record.status : "pending",
    priority: typeof record.priority === "string" ? record.priority : "medium",
    id: typeof record.id === "string" ? record.id : undefined,
  };
}

/** Normalise a whole list, dropping entries that carry no text. */
export function normaliseTodos(raw: unknown): Todo[] {
  if (!Array.isArray(raw)) return [];
  return raw.map(normaliseTodo).filter((t): t is Todo => t !== null);
}

/** How much of a todo list is done, for the progress bar. */
export function todoProgress(todos: Todo[]): { done: number; total: number; active: number } {
  let done = 0;
  let active = 0;
  for (const todo of todos) {
    if (todo.status === "completed" || todo.status === "cancelled") done += 1;
    else if (todo.status === "in_progress") active += 1;
  }
  return { done, total: todos.length, active };
}

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
  /** The agent's plan changed. Carries the whole list, not a delta. */
  "todo.updated": { sessionID: string; todos: unknown[] };
  /** A part was retracted by the server rather than edited. */
  "message.part.removed": { sessionID: string; messageID: string; partID: string };
  "permission.replied": { sessionID: string; requestID: string; reply: string };
  [key: string]: { sessionID?: string } & Record<string, unknown>;

}

export type EventType = keyof Events & string;
