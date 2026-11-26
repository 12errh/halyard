/**
 * opencode v2 wire types plus the view model the UI renders.
 *
 * The v2.4.x server has no v1 routes left: events arrive as a uniform
 * `V2Event` envelope on `/api/event`, message history is a flat tagged union
 * (assistant content is inline, there are no separate part objects), and every
 * request needs HTTP Basic auth. These types mirror that wire format; the
 * adapters at the bottom turn it into the flatter view model the components
 * already speak, so the rendering layer stays free of envelope noise.
 */

// --- Shared primitives ----------------------------------------------------

/** How the view model names a model. */
export interface ModelRef {
  providerID: string;
  modelID: string;
}

/** How the v2 wire names a model: `Session.ModelRef`. */
export interface ModelRefV2 {
  id: string;
  providerID: string;
  variant?: string;
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

/** `TokenUsage` as the v2 wire requires it: every counter present. */
export interface TokenUsageV2 {
  input: number;
  output: number;
  reasoning: number;
  cache: { read: number; write: number };
}

export interface StructuredError {
  type: string;
  message: string;
  status?: number;
  response?: { body: string };
  retryAfterMs?: number;
  [key: string]: unknown;
}

export interface CursorV2 {
  previous: string | null;
  next: string | null;
}

export interface ServerInfoV2 {
  version: string;
  pid: number;
  hostname?: string | null;
  urls: string[];
  paths: { tmp: string; [key: string]: string };
  capabilities?: { persistentPty?: boolean | null; [key: string]: unknown };
}

export interface LocationRef {
  directory: string;
  workspaceID?: string;
}

export interface LocationPublicRef {
  directory: string;
}

// --- Events ---------------------------------------------------------------

/** Every event on `/api/event` is this envelope; `data` varies by type. */
export interface V2Event<T = Record<string, unknown>> {
  id: string;
  created?: number;
  type: string;
  data: T;
  location?: LocationRef | LocationPublicRef | null;
  metadata?: Record<string, unknown>;
  durable?: { aggregateID: string; seq: number; version: number };
}

// --- Sessions -------------------------------------------------------------

/** `Session.Info` as the v2 wire sends it. */
export interface SessionInfoV2 {
  id: string;
  projectID: string;
  cost: number;
  tokens: TokenUsageV2;
  time: { created: number; updated: number; archived?: number };
  location: LocationPublicRef;
  title?: string;
  slug?: string;
  parentID?: string;
  agent?: string;
  model?: ModelRefV2;
  archived?: boolean;
  metadata?: Record<string, unknown>;
  version?: string;
}

/** The session shape the UI consumes. */
export interface Session {
  id: string;
  title: string;
  directory: string;
  parentID?: string;
  archived?: boolean;
  agent?: string;
  model?: ModelRefV2;
  slug?: string;
  projectID?: string;
  version?: string;
  cost?: number;
  tokens?: TokenUsage;
  summary?: { additions: number; deletions: number; files: number };
  /** Set while a revert is staged, meaning the session can roll forward. */
  revertedAt?: number;
  time: TimeParts;
}

export interface SessionRevert {
  messageID: string;
  partID?: string;
  snapshot?: unknown;
  files?: FileDiff[];
}

// --- Messages -------------------------------------------------------------

export type FinishReason =
  | "stop"
  | "length"
  | "tool-calls"
  | "content-filter"
  | "error"
  | "unknown";

export interface PromptFileAttachment {
  url: string;
  mime?: string;
  filename?: string;
  [key: string]: unknown;
}

export interface PromptAgentAttachment {
  name: string;
  [key: string]: unknown;
}

export interface PromptSkillAttachment {
  name: string;
  [key: string]: unknown;
}

export interface MessageTimeV2 {
  created: number;
  firstToken?: number;
  streamed?: number;
  completed?: number;
}

export interface UserMessageV2 {
  id: string;
  time: MessageTimeV2;
  type: "user";
  text: string;
  metadata?: Record<string, unknown>;
  files?: PromptFileAttachment[];
  agents?: PromptAgentAttachment[];
  skills?: PromptSkillAttachment[];
}

export interface ToolContent {
  type: string;
  text?: string;
  uri?: string;
  mime?: string;
  name?: string | null;
  [key: string]: unknown;
}

export type ToolStateV2 =
  | { status: "streaming"; input: string }
  | { status: "running"; input: Record<string, unknown>; metadata: Record<string, unknown> }
  | {
      status: "completed";
      input: Record<string, unknown>;
      content: ToolContent[];
      metadata?: Record<string, unknown>;
    }
  | {
      status: "error";
      input: Record<string, unknown>;
      error: StructuredError;
      content?: ToolContent[];
      metadata?: Record<string, unknown>;
    };

export type AssistantContent =
  | { type: "text"; text: string; native?: Record<string, unknown> }
  | {
      type: "reasoning";
      text: string;
      native?: Record<string, unknown>;
      time?: { created: number; completed?: number };
    }
  | {
      type: "tool";
      id: string;
      name: string;
      executed?: boolean;
      state: ToolStateV2;
      time: { created: number; ran?: number; completed?: number };
      native?: Record<string, unknown>;
    };

export interface AssistantMessageV2 {
  id: string;
  time: MessageTimeV2;
  type: "assistant";
  agent: string;
  model: ModelRefV2;
  content: AssistantContent[];
  metadata?: Record<string, unknown>;
  snapshot?: { start?: string; end?: string; files?: string[] };
  finish?: FinishReason;
  rawFinish?: string;
  native?: Record<string, unknown>;
  cost?: number;
  tokens?: TokenUsageV2;
  error?: StructuredError;
  retry?: { attempt: number; at: number; error: StructuredError };
}

export interface ModelSwitchedV2 {
  id: string;
  time: MessageTimeV2;
  type: "model-switched";
  model: ModelRefV2;
  previous?: ModelRefV2;
}

export interface AgentSwitchedV2 {
  id: string;
  time: MessageTimeV2;
  type: "agent-switched";
  agent: string;
  previous?: string;
}

export interface LocationSwitchedV2 {
  id: string;
  time: MessageTimeV2;
  type: "location-switched";
  location: LocationPublicRef;
  projectID?: string;
  subpath?: string;
  previous?: LocationPublicRef;
}

export interface SyntheticMessageV2 {
  id: string;
  time: MessageTimeV2;
  type: "synthetic";
  text: string;
  description?: string;
}

export interface SystemMessageV2 {
  id: string;
  time: MessageTimeV2;
  type: "system";
  text: string;
  description?: string;
}

export interface SkillMessageV2 {
  id: string;
  time: MessageTimeV2;
  type: "skill";
  skill: string;
  name: string;
  text: string;
}

export interface ShellOutputStream {
  output: string;
  cursor?: number;
  size?: number;
  truncated?: boolean;
}

export interface ShellMessageV2 {
  id: string;
  time: MessageTimeV2;
  type: "shell";
  shellID: string;
  command: string;
  status: string;
  exit?: number;
  output?: ShellOutputStream;
}

export interface CompactionMessageV2 {
  id: string;
  time: MessageTimeV2;
  type: "compaction";
  reason: string;
  status: string;
  text?: string;
  model?: ModelRefV2;
  native?: Record<string, unknown>;
  cost?: number;
  tokens?: TokenUsageV2;
  error?: StructuredError;
}

export interface IdleMessageV2 {
  id: string;
  time: MessageTimeV2;
  type: "idle";
  outcome: string;
  error?: StructuredError;
}

export type MessageV2 =
  | AgentSwitchedV2
  | ModelSwitchedV2
  | LocationSwitchedV2
  | UserMessageV2
  | SyntheticMessageV2
  | SystemMessageV2
  | SkillMessageV2
  | ShellMessageV2
  | AssistantMessageV2
  | CompactionMessageV2
  | IdleMessageV2;

// --- View messages --------------------------------------------------------

export interface UserMessage {
  id: string;
  sessionID?: string;
  role: "user";
  time: TimeParts;
  agent?: string;
  model?: ModelRef;
  text?: string;
  error?: MessageError;
}

export interface AssistantMessage {
  id: string;
  sessionID?: string;
  role: "assistant";
  parentID?: string;
  providerID?: string;
  modelID?: string;
  agent?: string;
  mode?: string;
  path?: { cwd: string; root: string };
  cost: number;
  tokens: TokenUsage;
  time: TimeParts;
  /** Set by `session.step.ended`. */
  finish?: string;
  error?: MessageError;
  summary?: boolean;
}

export type MessageInfo = UserMessage | AssistantMessage;

export interface MessageError {
  name: string;
  data?: { message: string };
}

// --- Parts ----------------------------------------------------------------

export interface BasePart {
  id: string;
  sessionID: string;
  messageID: string;
}

export interface TextPart extends BasePart {
  type: "text";
  text: string;
  /** Local-only: true while the text is still being streamed. */
  streaming?: boolean;
}

export interface ReasoningPart extends BasePart {
  type: "reasoning";
  text: string;
  time: TimeParts;
  streaming?: boolean;
}

export type ToolStatus = "pending" | "running" | "completed" | "error";

/**
 * Structured extras the server attaches to a tool call. A side-effecting tool
 * can report them alongside its `content`, which is why this is data rather
 * than a rendered message.
 */
export interface ToolMetadata {
  diagnostics?: Record<string, unknown>;
  truncated?: boolean;
  [key: string]: unknown;
}

export type ToolState =
  | {
      status: "pending";
      input?: Record<string, unknown>;
    }
  | {
      status: "running";
      input?: Record<string, unknown>;
      title?: string;
      metadata?: ToolMetadata;
    }
  | {
      status: "completed";
      input?: Record<string, unknown>;
      output: string;
      title: string;
      metadata?: ToolMetadata;
      time: TimeParts;
    }
  | {
      status: "error";
      input?: Record<string, unknown>;
      error: string;
    };

/**
 * A single entry in an agent's plan.
 */
export interface Todo {
  id: string;
  content: string;
  status: TodoStatus;
  priority: TodoPriority;
}

export const TODO_STATUSES = ["pending", "in_progress", "completed", "cancelled"] as const;
export type TodoStatus = (typeof TODO_STATUSES)[number];

export const TODO_PRIORITIES = ["high", "medium", "low"] as const;
export type TodoPriority = (typeof TODO_PRIORITIES)[number];

/** Coerce a server todo into one we can render, or `null` if unusable. */
export function normaliseTodo(raw: unknown): Todo | null {
  if (!raw || typeof raw !== "object") return null;
  const record = raw as Record<string, unknown>;
  const content = typeof record.content === "string" ? record.content : null;
  if (!content) return null;
  const status = TODO_STATUSES.includes(record.status as TodoStatus)
    ? (record.status as TodoStatus)
    : "pending";
  const priority = TODO_PRIORITIES.includes(record.priority as TodoPriority)
    ? (record.priority as TodoPriority)
    : "medium";
  return {
    id: typeof record.id === "string" ? record.id : content,
    content,
    status,
    priority,
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
  if (state.status === "running" && state.title) return state.title;
  if (state.status === "completed" && state.title) return state.title;
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
  /** Raw JSON accumulated while a v2 tool input is still streaming. */
  inputRaw?: string;
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
  /** Summary text, present once compaction ends. */
  text?: string;
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

export interface FileStatus {
  file?: string;
  path?: string;
  status?: string;
  additions?: number;
  deletions?: number;
  [key: string]: unknown;
}

// --- Permissions ----------------------------------------------------------

export type PermissionReply = "once" | "always" | "reject";

export namespace Permission {
  export type Decision = PermissionReply;

  /** v2 `Permission.Request`. The reply body field is `decision`. */
  export interface Request {
    id: string;
    sessionID: string;
    action: string;
    resources: string[];
    save?: string[];
    metadata?: Record<string, unknown>;
    source?: { type: string; messageID: string; id: string };
    message?: string;
  }
}

/**
 * The UI's single permission shape. `version` is retained so the card can
 * label itself; v2 is the only generation the current server speaks.
 */
export interface PendingPermission {
  id: string;
  sessionID: string;
  action: string;
  resources: string[];
  save?: string[];
  tool?: { messageID: string; callID: string };
  version: 1 | 2;
  /** Local-only: when Halyard first learned about it, for stable ordering. */
  askedAt: number;
}

// --- Forms (v2 replaces v1 `question`) ------------------------------------

export namespace Form {
  export interface Option {
    value: string;
    label: string;
    description?: string;
  }

  export interface When {
    key: string;
    op: "eq" | "neq";
    value: string | number | boolean;
  }

  interface FieldBase {
    key: string;
    title?: string;
    description?: string;
    required?: boolean;
    hidden?: boolean;
    when?: When;
  }

  export interface StringField extends FieldBase {
    type: "string";
    format?: "email" | "uri" | "date" | "date-time";
    minLength?: number;
    maxLength?: number;
    pattern?: string;
    placeholder?: string;
    default?: string;
    options?: Option[];
    custom?: boolean;
  }

  export interface NumberField extends FieldBase {
    type: "number";
    minimum?: number;
    maximum?: number;
    default?: number;
  }

  export interface IntegerField extends FieldBase {
    type: "integer";
    minimum?: number;
    maximum?: number;
    default?: number;
  }

  export interface BooleanField extends FieldBase {
    type: "boolean";
    default?: boolean;
  }

  export interface EnumField extends FieldBase {
    type: "enum";
    options: Option[];
    default?: string;
    custom?: boolean;
  }

  export interface MultiselectField extends FieldBase {
    type: "multiselect";
    options: Option[];
    minItems?: number;
    maxItems?: number;
    custom?: boolean;
    default?: string[];
  }

  export interface ExternalField extends FieldBase {
    type: "external";
    url: string;
    title?: string;
    description?: string;
  }

  export type Field =
    | StringField
    | NumberField
    | IntegerField
    | BooleanField
    | EnumField
    | MultiselectField
    | ExternalField;

  export type Value = string | number | boolean | "Infinity" | "-Infinity" | "NaN" | string[];

  export type Answer = Record<string, Value>;

  export interface Info {
    id: string;
    sessionID: string;
    title: string;
    fields: Field[];
    metadata?: Record<string, unknown>;
  }
}

export type FormValue = Form.Value;

// --- Catalogue / system info ----------------------------------------------

export interface ProviderInfo {
  id: string;
  name: string;
  /** v2 lists no models here; they arrive from `GET /api/model`. */
  models?: Record<string, unknown>;
  /**
   * `enabled` and `auto` are usable; `disabled` is the user turning it off.
   * `auto` means the server has everything it needs and enables it by itself.
   */
  activation?: "auto" | "enabled" | "disabled";
  integrationID?: string;
  canonical?: string;
  package?: string;
  settings?: Record<string, unknown>;
  headers?: Record<string, string>;
  [key: string]: unknown;
}

export interface ModelInfo {
  id: string;
  modelID: string;
  providerID: string;
  name: string;
  type?: string;
  family?: string;
  status?: string;
  release_date?: string;
  /** v2 sends an array of price tiers; the untiered entry is the base price. */
  cost?: ModelCostV2 | ModelCostV2[];
  limit?: ModelLimitV2;
  capabilities?: ModelCapabilitiesV2;
  enabled?: boolean;
  options?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface ModelCostV2 {
  tier?: { type: "context"; size: number };
  input?: number;
  output?: number;
  cache?: { read?: number; write?: number };
  [key: string]: unknown;
}

export interface ModelLimitV2 {
  context?: number;
  output?: number;
  [key: string]: unknown;
}

export interface ModelCapabilitiesV2 {
  reasoning?: boolean;
  attachment?: boolean;
  toolcall?: boolean;
  tools?: boolean;
  temperature?: boolean;
  /** v2 sends media types as `["text", "image", ...]`; older builds used flags. */
  input?:
    | string[]
    | { text?: boolean; image?: boolean; audio?: boolean; video?: boolean; pdf?: boolean };
  output?:
    | string[]
    | { text?: boolean; image?: boolean; audio?: boolean; video?: boolean; pdf?: boolean };
  [key: string]: unknown;
}

export interface AgentInfoV2 {
  name: string;
  description?: string;
  mode?: string;
  model?: ModelRefV2;
  prompt?: string;
  tools?: Record<string, boolean>;
  [key: string]: unknown;
}

export interface SkillInfo {
  id?: string;
  name: string;
  description?: string;
  location?: string;
  [key: string]: unknown;
}

export interface IntegrationMethod {
  type: string;
  id: string;
  label?: string;
  form?: Form.Field[];
  [key: string]: unknown;
}

export interface IntegrationInfo {
  id: string;
  name: string;
  methods: IntegrationMethod[];
  connections: unknown[];
  [key: string]: unknown;
}

export interface IntegrationAttemptEncoded {
  attemptID: string;
  url: string;
  instructions?: string;
  mode: "auto" | "code" | string;
  time: { created: number; expires: number };
  paste?: boolean;
}

export interface IntegrationAttemptStatus {
  status: string;
  error?: string;
  [key: string]: unknown;
}

export type CredentialValue =
  | { type: "api"; key: string; label?: string }
  | { type: "oauth"; access: string; refresh: string; expires: number; label?: string };

export interface CredentialEntry {
  id: string;
  integrationID: string;
  value: CredentialValue;
  active: boolean;
  time: { created: number; updated?: number };
  [key: string]: unknown;
}

export interface McpServer {
  name: string;
  status?: string;
  enabled?: boolean;
  [key: string]: unknown;
}

/**
 * One config source returned by `GET /api/config`.
 *
 * The endpoint returns a bare array of these (not a `{data}` envelope); each
 * entry is either an on-disk document with its decoded contents or a config
 * directory contributing defaults.
 */
export type ConfigEntry =
  | { type: "document"; path?: string | null; info: Record<string, unknown> }
  | { type: "directory"; path: string };

export interface InboxUser {
  id: string;
  sessionID: string;
  time: { created: number };
  type: "user";
  payload: { text: string; files?: PromptFileAttachment[]; agents?: PromptAgentAttachment[] };
  delivery?: string;
}

export interface InboxCompaction {
  id: string;
  sessionID: string;
  time: { created: number };
  type: "compaction";
  payload?: Record<string, unknown>;
  delivery?: string;
}

// --- Adapters: wire -> view ----------------------------------------------

function normaliseTokens(tokens: TokenUsageV2 | TokenUsage | undefined): TokenUsage {
  return {
    input: tokens?.input ?? 0,
    output: tokens?.output ?? 0,
    reasoning: tokens?.reasoning ?? 0,
    cache: tokens?.cache
      ? { read: tokens.cache.read ?? 0, write: tokens.cache.write ?? 0 }
      : undefined,
  };
}

export function toSessionView(info: SessionInfoV2): Session {
  return {
    id: info.id,
    title: info.title ?? "",
    directory: info.location?.directory ?? "",
    parentID: info.parentID,
    archived: info.archived,
    agent: info.agent,
    model: info.model,
    slug: info.slug,
    projectID: info.projectID,
    version: info.version,
    cost: info.cost,
    tokens: normaliseTokens(info.tokens),
    time: { created: info.time.created, updated: info.time.updated },
  };
}

/** Parse a streamed tool input without letting a partial JSON throw. */
export function parseToolInput(raw: string | undefined): Record<string, unknown> | undefined {
  if (!raw) return undefined;
  try {
    const parsed: unknown = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : undefined;
  } catch {
    return undefined;
  }
}

function joinToolContent(content: ToolContent[] | undefined): string {
  if (!content) return "";
  return content
    .filter((entry) => entry.type === "text" && typeof entry.text === "string")
    .map((entry) => entry.text as string)
    .join("\n");
}

function asMetadata(metadata: Record<string, unknown> | undefined): ToolMetadata | undefined {
  return metadata as ToolMetadata | undefined;
}

function toolStateOf(state: ToolStateV2, created: number): ToolState {
  switch (state.status) {
    case "streaming":
      return { status: "pending", input: parseToolInput(state.input) };
    case "running":
      return { status: "running", input: state.input, metadata: asMetadata(state.metadata) };
    case "completed":
      return {
        status: "completed",
        input: state.input,
        output: joinToolContent(state.content),
        title: "",
        metadata: asMetadata(state.metadata),
        time: { created },
      };
    case "error":
      return {
        status: "error",
        input: state.input,
        error: state.error?.message ?? "tool failed",
      };
  }
}

function assistantParts(message: AssistantMessageV2): Part[] {
  const parts: Part[] = [];
  message.content.forEach((item, ordinal) => {
    if (item.type === "text") {
      parts.push({
        id: `${message.id}:${ordinal}`,
        sessionID: "",
        messageID: message.id,
        type: "text",
        text: item.text,
      });
    } else if (item.type === "reasoning") {
      parts.push({
        id: `${message.id}:${ordinal}`,
        sessionID: "",
        messageID: message.id,
        type: "reasoning",
        text: item.text,
        time: {
          created: item.time?.created ?? message.time.created,
          completed: item.time?.completed,
        },
      });
    } else {
      parts.push({
        id: item.id,
        sessionID: "",
        messageID: message.id,
        type: "tool",
        callID: item.id,
        tool: item.name,
        state: toolStateOf(item.state, item.time?.created ?? message.time.created),
      });
    }
  });
  return parts;
}

function toMessageEntry(message: MessageV2): { info: MessageInfo; parts: Part[] } | null {
  if (message.type === "user") {
    const info: UserMessage = {
      id: message.id,
      role: "user",
      time: { created: message.time.created },
      text: message.text,
    };
    return {
      info,
      parts: [
        {
          id: `${message.id}:0`,
          sessionID: "",
          messageID: message.id,
          type: "text",
          text: message.text,
        },
      ],
    };
  }

  if (message.type === "assistant") {
    const info: AssistantMessage = {
      id: message.id,
      role: "assistant",
      agent: message.agent,
      providerID: message.model?.providerID,
      modelID: message.model?.id,
      cost: message.cost ?? 0,
      tokens: normaliseTokens(message.tokens),
      time: { created: message.time.created, completed: message.time.completed },
      finish: message.finish,
      error: message.error
        ? { name: message.error.type, data: { message: message.error.message } }
        : undefined,
    };
    return { info, parts: assistantParts(message) };
  }

  // Everything else (switchers, idle markers, shell/system/skill notices,
  // compaction records) carries no transcript to render. Events drive the
  // thread's status; history only needs the two conversational message kinds.
  return null;
}

/**
 * Adapt a v2 history array into the view's `{info, parts}` entries, dropping
 * messages that exist purely to move server-side state.
 */
export function toMessageEntries(messages: MessageV2[]): Array<{ info: MessageInfo; parts: Part[] }> {
  const entries: Array<{ info: MessageInfo; parts: Part[] }> = [];
  for (const message of messages) {
    const entry = toMessageEntry(message);
    if (entry) entries.push(entry);
  }
  return entries;
}

/** Adapt a v2 permission request into the UI's single shape. */
export function toPendingPermission(request: Permission.Request): PendingPermission {
  return {
    id: request.id,
    sessionID: request.sessionID,
    action: request.action,
    resources: Array.isArray(request.resources) ? request.resources : [],
    save: Array.isArray(request.save) ? request.save : undefined,
    tool: request.source
      ? { messageID: request.source.messageID, callID: request.source.id }
      : undefined,
    version: 2,
    askedAt: Date.now(),
  };
}
