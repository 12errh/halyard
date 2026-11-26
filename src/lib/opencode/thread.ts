/**
 * Thread state, derived purely from the server event stream.
 *
 * This is deliberately a pure function of (state, event) with no I/O, no
 * timers and no React. Streaming correctness is the hardest thing to get right
 * in this app, and keeping it here means it can be tested exhaustively.
 *
 * v2 streams text and tool state as flat events keyed by `(assistantMessageID,
 * ordinal)` and `content id`; there are no part objects on the wire and no
 * part ids for text, so we synthesise `${messageID}:${ordinal}` as the part id.
 */

import type {
  AssistantMessage,
  CompactionPart,
  FileDiff,
  MessageInfo,
  Part,
  SessionStatus,
  ToolContent,
  ToolPart,
  ToolState,
  ToolStateV2,
  V2Event,
} from "./types";

export interface MessageEntry {
  /**
   * Null only while a delta raced ahead of any message-level event; the
   * reducer creates an assistant placeholder as soon as it sees the stream.
   */
  info: MessageInfo | null;
  /** Parts keyed by id so out-of-order updates cannot reorder them. */
  parts: Record<string, Part>;
  /** Ids of every part in arrival order, known and provisional alike. */
  partOrder: string[];
}

export interface ThreadState {
  messages: Record<string, MessageEntry>;
  /** Message ids in server order. */
  order: string[];
  status: SessionStatus;
  error: string | null;
  /** Staged revert file changes for the session. */
  diffs: FileDiff[];
}

export function emptyThread(): ThreadState {
  return { messages: {}, order: [], status: { type: "idle" }, error: null, diffs: [] };
}

function withMessage(
  state: ThreadState,
  messageID: string,
  update: (entry: MessageEntry) => MessageEntry,
): ThreadState {
  if (!messageID) return state;

  const existing = state.messages[messageID];
  const entry = existing ? update(existing) : update({ info: null, parts: {}, partOrder: [] });

  return {
    ...state,
    messages: { ...state.messages, [messageID]: entry },
    order: state.order.includes(messageID) ? state.order : [...state.order, messageID],
  };
}

function notePart(entry: MessageEntry, partID: string): string[] {
  return entry.partOrder.includes(partID) ? entry.partOrder : [...entry.partOrder, partID];
}

function upsertPart(state: ThreadState, part: Part): ThreadState {
  return withMessage(state, part.messageID, (entry) => ({
    ...entry,
    parts: { ...entry.parts, [part.id]: part },
    partOrder: notePart(entry, part.id),
  }));
}

function insertOrder(state: ThreadState, messageID: string, index: number): string[] {
  if (state.order.includes(messageID)) return state.order;
  const order = [...state.order];
  order.splice(Math.max(0, Math.min(index, order.length)), 0, messageID);
  return order;
}

/** A placeholder assistant message, for events that arrive before history. */
function assistantPlaceholder(id: string, created: number): AssistantMessage {
  return {
    id,
    role: "assistant",
    cost: 0,
    tokens: { input: 0, output: 0, reasoning: 0 },
    time: { created },
  };
}

/** Ensure the assistant message exists, then update it. */
function withAssistant(
  state: ThreadState,
  messageID: string,
  created: number,
  update: (info: AssistantMessage) => AssistantMessage,
): ThreadState {
  return withMessage(state, messageID, (entry) => {
    const info =
      entry.info && entry.info.role === "assistant"
        ? entry.info
        : assistantPlaceholder(messageID, created);
    return { ...entry, info: update(info) };
  });
}

/**
 * Seed a thread from a `GET /session/:id/message` response.
 *
 * The server returns newest-last, but we cannot assume that forever; sorting
 * on the authoritative `time.created` keeps rendering order stable regardless.
 */
export function seedThread(
  state: ThreadState,
  entries: Array<{ info: MessageInfo; parts: Part[] }>,
): ThreadState {
  const sorted = [...entries].sort((a, b) => {
    const delta = (a.info.time?.created ?? 0) - (b.info.time?.created ?? 0);
    return delta !== 0 ? delta : a.info.id.localeCompare(b.info.id);
  });

  let next = state;
  sorted.forEach((entry, index) => {
    const parts: Record<string, Part> = {};
    for (const part of entry.parts) parts[part.id] = part;
    next = {
      ...next,
      messages: {
        ...next.messages,
        [entry.info.id]: {
          info: entry.info,
          parts,
          partOrder: entry.parts.map((part) => part.id),
        },
      },
      order: insertOrder(next, entry.info.id, index),
    };
  });

  return next;
}

/** Apply a single server event. Unknown event types are ignored by design. */
export function applyEvent(state: ThreadState, event: V2Event): ThreadState {
  const data = event.data as Record<string, unknown>;
  const created = event.created ?? Date.now();

  switch (event.type) {
    // --- Text and reasoning streams --------------------------------------

    case "session.text.started":
    case "session.reasoning.started": {
      const messageID = String(data.assistantMessageID ?? "");
      const ordinal = Number(data.ordinal ?? 0);
      const reasoning = event.type === "session.reasoning.started";
      const partID = `${messageID}:${ordinal}`;
      if (!messageID) return state;

      const next = withAssistant(state, messageID, created, (info) => info);
      if (next.messages[messageID]?.parts[partID]) return next;

      const sessionID = String(data.sessionID ?? "");
      return upsertPart(
        next,
        reasoning
          ? {
              id: partID,
              sessionID,
              messageID,
              type: "reasoning",
              text: "",
              time: { created },
              streaming: true,
            }
          : { id: partID, sessionID, messageID, type: "text", text: "", streaming: true },
      );
    }

    case "session.text.delta":
    case "session.reasoning.delta": {
      const messageID = String(data.assistantMessageID ?? "");
      const ordinal = Number(data.ordinal ?? 0);
      const delta = String(data.delta ?? "");
      if (!messageID) return state;
      const reasoning = event.type === "session.reasoning.delta";
      const partID = `${messageID}:${ordinal}`;

      let next = withAssistant(state, messageID, created, (info) => info);
      const existing = next.messages[messageID]?.parts[partID];

      if (existing && existing.type === (reasoning ? "reasoning" : "text")) {
        next = upsertPart(next, { ...existing, text: existing.text + delta } as Part);
      } else {
        next = upsertPart(
          next,
          reasoning
            ? {
                id: partID,
                sessionID: String(data.sessionID ?? ""),
                messageID,
                type: "reasoning",
                text: delta,
                time: { created },
                streaming: true,
              }
            : {
                id: partID,
                sessionID: String(data.sessionID ?? ""),
                messageID,
                type: "text",
                text: delta,
                streaming: true,
              },
        );
      }
      return next;
    }

    case "session.text.ended":
    case "session.reasoning.ended": {
      const messageID = String(data.assistantMessageID ?? "");
      const ordinal = Number(data.ordinal ?? 0);
      const text = String(data.text ?? "");
      if (!messageID) return state;
      const reasoning = event.type === "session.reasoning.ended";
      const partID = `${messageID}:${ordinal}`;

      return upsertPart(withAssistant(state, messageID, created, (info) => info), {
        id: partID,
        sessionID: String(data.sessionID ?? ""),
        messageID,
        type: reasoning ? "reasoning" : "text",
        text,
        ...(reasoning ? { time: { created, completed: created } } : {}),
      } as Part);
    }

    // --- Tools ------------------------------------------------------------

    case "session.tool.input.started": {
      const messageID = String(data.assistantMessageID ?? "");
      const partID = String(data.id ?? "");
      if (!messageID || !partID) return state;
      const raw = "";
      return upsertPart(withAssistant(state, messageID, created, (info) => info), {
        id: partID,
        sessionID: String(data.sessionID ?? ""),
        messageID,
        type: "tool",
        callID: partID,
        tool: String(data.name ?? "tool"),
        state: { status: "pending", input: parseToolInput(raw) },
        inputRaw: raw,
      });
    }

    case "session.tool.input.delta": {
      return updateTool(state, data, created, (part, raw) => {
        const nextRaw = raw + String(data.delta ?? "");
        return {
          ...part,
          inputRaw: nextRaw,
          state: { status: "pending", input: parseToolInput(nextRaw) },
        };
      });
    }

    case "session.tool.input.ended": {
      return updateTool(state, data, created, (part) => {
        const raw = String(data.text ?? "");
        return {
          ...part,
          inputRaw: raw,
          state: { status: "pending", input: parseToolInput(raw) },
        };
      });
    }

    case "session.tool.called": {
      return updateTool(state, data, created, (part) => ({
        ...part,
        state: toolStateFromV2({
          status: "running",
          input: objectOrEmpty(data.input) ?? {},
          metadata: objectOrEmpty(data.metadata) ?? {},
        }),
      }));
    }

    case "session.tool.progress": {
      return updateTool(state, data, created, (part) => ({
        ...part,
        state: {
          status: "running",
          input: part.state.input,
          metadata: objectOrEmpty(data.metadata),
        },
      }));
    }

    case "session.tool.success": {
      return updateTool(state, data, created, (part) => ({
        ...part,
        state: toolStateFromV2({
          status: "completed",
          input: part.state.input ?? {},
          content: contentList(data.content),
          metadata: objectOrEmpty(data.metadata),
        }),
      }));
    }

    case "session.tool.failed": {
      return updateTool(state, data, created, (part) => ({
        ...part,
        state: {
          status: "error",
          input: part.state.input,
          error: structuredMessage(data.error) ?? "tool failed",
        },
      }));
    }

    // --- Steps and turn boundaries ---------------------------------------

    case "session.step.ended": {
      const messageID = String(data.assistantMessageID ?? "");
      if (!messageID) return state;
      return withAssistant(state, messageID, created, (info) => ({
        ...info,
        cost: typeof data.cost === "number" ? data.cost : info.cost,
        tokens: data.tokens ? { ...info.tokens, ...(data.tokens as object) } : info.tokens,
        finish: typeof data.finish === "string" ? data.finish : info.finish,
      }));
    }

    case "session.step.failed": {
      const messageID = String(data.assistantMessageID ?? "");
      if (!messageID) return state;
      return withAssistant(state, messageID, created, (info) => ({
        ...info,
        error: requestError(data.error),
        finish: typeof data.finish === "string" ? data.finish : info.finish,
      }));
    }

    case "session.execution.started":
      return { ...state, status: { type: "busy" } };

    case "session.execution.succeeded":
    case "session.execution.interrupted":
      return { ...state, status: { type: "idle" } };

    case "session.execution.failed":
      return {
        ...state,
        status: { type: "idle" },
        error: structuredMessage(data.error) ?? "Execution failed",
      };

    case "session.status":
      return { ...state, status: statusFromWire(data.status) };

    case "session.idle":
      return { ...state, status: { type: "idle" } };

    // --- Revert -----------------------------------------------------------

    case "session.revert.staged": {
      const revert = data.revert as { files?: FileDiff[] } | undefined;
      return { ...state, diffs: Array.isArray(revert?.files) ? revert.files : [] };
    }

    case "session.revert.cleared":
      return { ...state, diffs: [] };

    case "session.revert.committed": {
      const to = typeof data.to === "string" ? data.to : "";
      const index = state.order.indexOf(to);
      if (index === -1) return { ...state, diffs: [] };

      const keep = state.order.slice(0, index + 1);
      const messages: Record<string, MessageEntry> = {};
      for (const id of keep) {
        const entry = state.messages[id];
        if (entry) messages[id] = entry;
      }
      return { ...state, messages, order: keep, diffs: [] };
    }

    // --- Compaction -------------------------------------------------------

    case "session.compaction.started":
    case "session.compaction.ended":
    case "session.compaction.failed": {
      const text = typeof data.text === "string" ? data.text : "";
      if (!text) return state;
      const sessionID = String(data.sessionID ?? "");
      // Compaction has no message id of its own; hang it off a stable
      // per-session synthetic message so repeated compactions append parts.
      return upsertPart(state, {
        id: event.id,
        sessionID,
        messageID: `compaction:${sessionID}`,
        type: "compaction",
        auto: data.reason === "auto",
        text,
      } satisfies CompactionPart);
    }

    default:
      return state;
  }
}

/** Shared plumbing for the tool events, all keyed by `data.id`. */
function updateTool(
  state: ThreadState,
  data: Record<string, unknown>,
  created: number,
  update: (part: ToolPart, raw: string) => ToolPart,
): ThreadState {
  const messageID = String(data.assistantMessageID ?? "");
  const partID = String(data.id ?? "");
  if (!messageID || !partID) return state;

  const next = withAssistant(state, messageID, created, (info) => info);
  const existing = next.messages[messageID]?.parts[partID];

  if (existing && existing.type === "tool") {
    return upsertPart(next, update(existing, existing.inputRaw ?? ""));
  }

  const placeholder: ToolPart = {
    id: partID,
    sessionID: String(data.sessionID ?? ""),
    messageID,
    type: "tool",
    callID: partID,
    tool: String(data.name ?? "tool"),
    state: { status: "pending" },
    inputRaw: "",
  };
  return upsertPart(next, update(placeholder, ""));
}

function objectOrEmpty(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function contentList(value: unknown): ToolContent[] {
  return Array.isArray(value) ? (value as ToolContent[]) : [];
}

/**
 * Best-effort decode of a partially-streamed tool input, so a pending call can
 * show what the model has asked for so far instead of an empty card.
 */
function parseToolInput(raw: string): Record<string, unknown> | undefined {
  const text = raw.trim();
  if (!text) return undefined;
  try {
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : undefined;
  } catch {
    return undefined;
  }
}

function structuredMessage(error: unknown): string | null {
  if (!error || typeof error !== "object") return null;
  const record = error as { message?: unknown };
  return typeof record.message === "string" ? record.message : null;
}

function requestError(error: unknown): AssistantMessage["error"] {
  const message = structuredMessage(error);
  if (!message) return { name: "Error", data: { message: "Step failed" } };
  return { name: "Error", data: { message } };
}

/** Map a v2 tool state onto the view's state, joining text output. */
function toolStateFromV2(state: ToolStateV2, created = Date.now()): ToolState {
  switch (state.status) {
    case "streaming":
      return { status: "pending", input: parseToolInput(state.input) };
    case "running":
      return { status: "running", input: state.input, metadata: state.metadata };
    case "completed":
      return {
        status: "completed",
        input: state.input,
        output: state.content
          .filter((entry) => entry.type === "text" && typeof entry.text === "string")
          .map((entry) => entry.text)
          .join("\n"),
        title: "",
        metadata: state.metadata,
        time: { created },
      };
    case "error":
      return { status: "error", input: state.input, error: state.error.message };
  }
}

function statusFromWire(status: unknown): SessionStatus {
  if (!status || typeof status !== "object") return { type: "idle" };
  const record = status as {
    type?: string;
    attempt?: number;
    message?: string;
    next?: number;
  };
  if (record.type === "busy") return { type: "busy" };
  if (record.type === "retry") {
    return {
      type: "retry",
      attempt: record.attempt ?? 0,
      message: record.message ?? "Retrying",
      next: record.next ?? Date.now(),
    };
  }
  return { type: "idle" };
}

// --- Selectors ------------------------------------------------------------

export function partsOf(entry: MessageEntry | undefined): Part[] {
  if (!entry) return [];
  return Object.values(entry.parts);
}

/**
 * Parts in arrival order.
 *
 * Order follows `partOrder` rather than the map's own key order, so a
 * streamed text part stays above the tool call that ran after it.
 */
export function orderedParts(entry: MessageEntry | undefined): Part[] {
  if (!entry) return [];
  const result: Part[] = [];
  for (const id of entry.partOrder) {
    const part = entry.parts[id];
    if (part) result.push(part);
  }
  return result;
}

/** True while any text or reasoning part is still being streamed. */
export function isStreaming(entry: MessageEntry | undefined): boolean {
  if (!entry) return false;
  return Object.values(entry.parts).some(
    (part) =>
      (part.type === "text" || part.type === "reasoning") && part.streaming === true,
  );
}

export function toolIsActive(state: ToolState): boolean {
  return state.status === "pending" || state.status === "running";
}

/** Sum cost and tokens across a thread, for the session header. */
export function threadTotals(state: ThreadState): { cost: number; tokens: number } {
  let cost = 0;
  let tokens = 0;
  for (const id of state.order) {
    const info = state.messages[id]?.info;
    if (!info || info.role !== "assistant") continue;
    cost += info.cost ?? 0;
    const usage = info.tokens;
    if (usage) {
      tokens +=
        (usage.input ?? 0) +
        (usage.output ?? 0) +
        (usage.reasoning ?? 0) +
        (usage.cache?.read ?? 0) +
        (usage.cache?.write ?? 0);
    }
  }
  return { cost, tokens };
}
