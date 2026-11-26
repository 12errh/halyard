/**
 * Questions the agent asks back.
 *
 * v2 replaces the old `question.*` events with generic forms
 * (`form.created` / `form.replied` / `form.cancelled`). A form is a titled set
 * of fields; this store normalises the answerable fields into the single
 * question shape the card already renders, so the agent waiting on an answer
 * is still visible instead of hanging with no cause on screen.
 */

import { create } from "zustand";
import type { Form, V2Event } from "@/lib/opencode/types";

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

/** Turn a form into the shape the question card renders. */
export function toPendingQuestion(form: Form.Info, askedAt: number): PendingQuestion | null {
  if (!form?.id || !form.sessionID) return null;
  const questions: Question[] = [];
  for (const field of form.fields ?? []) {
    if (field.hidden) continue;
    if (
      field.type !== "string" &&
      field.type !== "enum" &&
      field.type !== "multiselect"
    ) {
      continue;
    }
    const options = field.options ?? [];
    if (options.length === 0 && field.type !== "string") continue;
    questions.push({
      header: field.title ?? field.key,
      question: field.description ?? field.title ?? field.key,
      options: options.map((option) => ({
        label: option.label,
        description: option.description,
      })),
      multiple: field.type === "multiselect",
      custom: field.custom === true || field.type === "string",
    });
  }
  if (questions.length === 0) return null;
  return {
    id: form.id,
    sessionID: form.sessionID,
    questions,
    version: 2,
    askedAt,
  };
}

export function applyQuestionEvent(
  state: QuestionsState,
  event: V2Event,
  now: number,
): QuestionsState {
  const data = (event.data ?? {}) as Record<string, unknown>;

  switch (event.type) {
    case "form.created": {
      const form = data.form as Form.Info | undefined;
      const pending = form ? toPendingQuestion(form, now) : null;
      return pending ? put(state, pending) : state;
    }

    case "form.replied":
    case "form.cancelled": {
      const form = data.form as Form.Info | undefined;
      if (!form?.id || !form.sessionID) return state;
      return drop(state, form.sessionID, form.id);
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
  ingest(event: V2Event): void;
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