/**
 * Questions the agent asks back.
 *
 * opencode can pause a turn and ask the user something (`question.asked` /
 * `question.v2.asked`). Nothing in the UI used to render those, so the agent
 * would wait forever with no visible cause — the same failure mode permissions
 * had before they were surfaced.
 *
 * Two generations exist; both are normalised into one shape.
 */

import { create } from "zustand";
import type { ServerEvent } from "@/lib/opencode/types";

export interface QuestionOption {
  label: string;
  description?: string;
}

export interface Question {
  question: string;
  header: string;
  options: QuestionOption[];
  /** More than one option may be chosen. */
  multiple?: boolean;
  /** The user may type an answer instead of choosing. */
  custom?: boolean;
}

export interface PendingQuestion {
  id: string;
  sessionID: string;
  questions: Question[];
  version: 1 | 2;
  askedAt: number;
}

export interface QuestionsState {
  bySession: Record<string, Record<string, PendingQuestion>>;
}

export function emptyQuestions(): QuestionsState {
  return { bySession: {} };
}

function normaliseOptions(raw: unknown): QuestionOption[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((option) => {
      if (typeof option === "string") return { label: option };
      if (option && typeof option === "object") {
        const record = option as Record<string, unknown>;
        const label = typeof record.label === "string" ? record.label : "";
        if (!label) return null;
        return {
          label,
          description: typeof record.description === "string" ? record.description : undefined,
        };
      }
      return null;
    })
    .filter((option): option is QuestionOption => option !== null);
}

export function normaliseQuestion(raw: unknown): Question | null {
  if (!raw || typeof raw !== "object") return null;
  const record = raw as Record<string, unknown>;
  const question = typeof record.question === "string" ? record.question : "";
  if (!question) return null;

  return {
    question,
    // The header is only a short label; fall back rather than render a blank.
    header:
      typeof record.header === "string" && record.header
        ? record.header.slice(0, 30)
        : question.slice(0, 30),
    options: normaliseOptions(record.options),
    multiple: record.multiple === true,
    custom: record.custom === true,
  };
}

function put(state: QuestionsState, pending: PendingQuestion): QuestionsState {
  const current = state.bySession[pending.sessionID] ?? {};
  // Re-broadcast on reconnect must not duplicate or reorder the card.
  if (current[pending.id]) return state;
  return {
    bySession: { ...state.bySession, [pending.sessionID]: { ...current, [pending.id]: pending } },
  };
}

function drop(state: QuestionsState, sessionID: string, id: string): QuestionsState {
  const current = state.bySession[sessionID];
  if (!current || !(id in current)) return state;
  const next = { ...current };
  delete next[id];
  return { bySession: { ...state.bySession, [sessionID]: next } };
}

export function applyQuestionEvent(
  state: QuestionsState,
  event: ServerEvent,
  now: number,
): QuestionsState {
  const props = event.properties as Record<string, unknown>;

  switch (event.type) {
    case "question.v2.asked":
    case "question.asked": {
      const id = typeof props.id === "string" ? props.id : null;
      const sessionID = typeof props.sessionID === "string" ? props.sessionID : null;
      if (!id || !sessionID) return state;
      const raw = Array.isArray(props.questions) ? props.questions : [];
      const questions = raw
        .map(normaliseQuestion)
        .filter((question): question is Question => question !== null);
      if (questions.length === 0) return state;
      return put(state, {
        id,
        sessionID,
        questions,
        version: event.type === "question.asked" ? 1 : 2,
        askedAt: now,
      });
    }

    case "question.replied":
    case "question.v2.replied":
    case "question.rejected":
    case "question.v2.rejected": {
      const sessionID = String(props.sessionID ?? "");
      const requestID = String(props.requestID ?? props.id ?? "");
      if (!sessionID || !requestID) return state;
      return drop(state, sessionID, requestID);
    }

    default:
      return state;
  }
}

export function mergeFetch(
  state: QuestionsState,
  incoming: PendingQuestion[],
): QuestionsState {
  if (incoming.length === 0) return state;
  let next = state;
  for (const pending of incoming) next = put(next, pending);
  return next;
}

export function pendingFor(state: QuestionsState, sessionID: string | null): PendingQuestion[] {
  if (!sessionID) return [];
  return Object.values(state.bySession[sessionID] ?? {}).sort((a, b) => a.askedAt - b.askedAt);
}

export function pendingCount(state: QuestionsState): number {
  return Object.values(state.bySession).reduce(
    (total, entries) => total + Object.keys(entries).length,
    0,
  );
}

interface QuestionStore extends QuestionsState {
  ingest(event: ServerEvent): void;
  sync(incoming: PendingQuestion[]): void;
  resolve: (sessionID: string, id: string) => void;
  clearSession: (sessionID: string) => void;
  reset(): void;
}

export const useQuestions = create<QuestionStore>((set, get) => ({
  bySession: {},

  ingest: (event) => {
    const next = applyQuestionEvent({ bySession: get().bySession }, event, Date.now());
    if (next.bySession !== get().bySession) set(next);
  },

  sync: (incoming) => {
    const next = mergeFetch({ bySession: get().bySession }, incoming);
    if (next.bySession !== get().bySession) set(next);
  },

  resolve: (sessionID, id) => {
    const next = drop({ bySession: get().bySession }, sessionID, id);
    if (next.bySession !== get().bySession) set(next);
  },

  clearSession: (sessionID) => {
    const current = get().bySession;
    if (!(sessionID in current)) return;
    const bySession = { ...current };
    delete bySession[sessionID];
    set({ bySession });
  },

  reset: () => set({ bySession: {} }),
}));