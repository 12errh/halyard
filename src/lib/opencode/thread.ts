/**
 * Thread state, derived purely from the server event stream.
 *
 * This is deliberately a pure function of (state, event) with no I/O, no
 * timers and no React. Streaming correctness is the hardest thing to get right
 * in this app, and keeping it here means it can be tested exhaustively.
 */

import type {
  FileDiff,
  MessageInfo,
  Part,
  ServerEvent,
  SessionStatus,
  TextPart,
  ToolState,
} from "./types";

export interface MessageEntry {
  /**
   * Null until the server sends `message.updated`. Deltas can legitimately
   * arrive first, so parts may be buffered against an entry with no info yet.
   */
  info: MessageInfo | null;
  /** Parts keyed by id so out-of-order updates cannot reorder them. */
  parts: Record<string, Part>;
  /**
   * Parts reconstructed from deltas before the server sent the real part. Kept
   * separate so `message.part.updated` can replace our guess outright instead
   * of merging into it.
   */
  pending: Record<string, TextPart>;
  /**
   * Ids of every part in arrival order, known and provisional alike. Without
   * this a streamed text part would render *after* a tool that ran later,
   * because the two live in separate maps.
   */
  partOrder: string[];
}

export interface ThreadState {
  messages: Record<string, MessageEntry>;
  /** Message ids in server order. */
  order: string[];
  status: SessionStatus;
  error: string | null;
  /** Latest file changes for the session, refreshed by `session.diff`. */
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
  const entry = existing
    ? update(existing)
    : update({ info: null, parts: {}, pending: {}, partOrder: [] });

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
    // The authoritative part has arrived, so drop our streamed approximation.
    pending: omit(entry.pending, part.id),
  }));
}

function omit<T>(record: Record<string, T>, key: string): Record<string, T> {
  if (!(key in record)) return record;
  const next = { ...record };
  delete next[key];
  return next;
}

function insertOrder(state: ThreadState, messageID: string, index: number): string[] {
  if (state.order.includes(messageID)) return state.order;
  const order = [...state.order];
  order.splice(Math.max(0, Math.min(index, order.length)), 0, messageID);
  return order;
}

/**
 * Seed a thread from a `GET /session/:id/message` response.
 *
 * The server returns newest-last, but we cannot assume that forever; sorting on
 * the authoritative `time.created` keeps rendering order stable regardless.
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
          pending: {},
          partOrder: entry.parts.map((part) => part.id),
        },
      },
      order: insertOrder(next, entry.info.id, index),
    };
  });

  return next;
}

/** Apply a single server event. Unknown event types are ignored by design. */
export function applyEvent(state: ThreadState, event: ServerEvent): ThreadState {
  const props = event.properties as Record<string, never>;

  switch (event.type) {
    case "message.updated": {
      const info = (props as unknown as { info: MessageInfo }).info;
      return withMessage(state, info.id, (entry) => ({ ...entry, info }));
    }

    case "message.part.updated":
      return upsertPart(state, (props as unknown as { part: Part }).part);

    case "message.part.delta":
      return applyDelta(state, props as unknown as {
        sessionID: string;
        messageID: string;
        partID: string;
        field: string;
        delta: string;
      });

    case "message.removed": {
      const messageID = String(props.messageID ?? "");
      const messages = { ...state.messages };
      delete messages[messageID];
      return {
        ...state,
        messages,
        order: state.order.filter((id) => id !== messageID),
      };
    }

    case "session.status":
      return { ...state, status: (props as unknown as { status: SessionStatus }).status };

    case "session.idle":
      return { ...state, status: { type: "idle" } };

    case "session.diff": {
      const diff = (props as unknown as { diff: FileDiff[] }).diff;
      // The server sends the full set, not an incremental patch.
      return { ...state, diffs: Array.isArray(diff) ? diff : state.diffs };
    }

    case "session.error": {
      const error = (props as unknown as { error: { name: string; data?: { message?: string } } }).error;
      return { ...state, error: error?.data?.message ?? error?.name ?? "Unknown error" };
    }

    default:
      return state;
  }
}

function applyDelta(
  state: ThreadState,
  delta: {
    sessionID: string;
    messageID: string;
    partID: string;
    field: string;
    delta: string;
  },
): ThreadState {
  return withMessage(state, delta.messageID, (entry) => {
    const known = entry.parts[delta.partID];

    // Known part: append straight onto the real thing.
    if (known && "text" in known && typeof known.text === "string") {
      return {
        ...entry,
        parts: {
          ...entry.parts,
          [delta.partID]: { ...known, text: known.text + delta.delta } as Part,
        },
        partOrder: notePart(entry, delta.partID),
      };
    }

    // Unknown part: buffer it. We do not know the real type yet, and guessing
    // wrong would render reasoning as prose. `message.part.updated` resolves it.
    const previous = entry.pending[delta.partID];
    return {
      ...entry,
      pending: {
        ...entry.pending,
        [delta.partID]: {
          id: delta.partID,
          sessionID: delta.sessionID,
          messageID: delta.messageID,
          type: "text",
          text: (previous?.text ?? "") + delta.delta,
          streaming: true,
        },
      },
      partOrder: notePart(entry, delta.partID),
    };
  });
}

// --- Selectors ------------------------------------------------------------

export function partsOf(entry: MessageEntry | undefined): Part[] {
  if (!entry) return [];
  return Object.values(entry.parts);
}

/**
 * Parts in display order: server parts first, then anything still streaming.
 * Stable by id so React does not thrash on each token.
 */
/**
 * Parts in arrival order, interleaving authoritative and provisional entries.
 *
 * Order follows `partOrder` rather than either map's own key order, so a
 * streamed text part stays above the tool call that ran after it.
 */
export function orderedParts(entry: MessageEntry | undefined): Part[] {
  if (!entry) return [];
  const result: Part[] = [];
  for (const id of entry.partOrder) {
    const known = entry.parts[id];
    if (known) {
      result.push(known);
      continue;
    }
    const provisional = entry.pending[id];
    if (provisional) result.push(provisional);
  }
  return result;
}

export function isStreaming(entry: MessageEntry | undefined): boolean {
  if (!entry) return false;
  return Object.keys(entry.pending).length > 0;
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
