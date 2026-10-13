import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  applyQuestionEvent,
  emptyQuestions,
  mergeFetch,
  normaliseQuestion,
  pendingFor,
  useQuestions,
  type PendingQuestion,
} from "@/state/questions";
import { QuestionCard } from "@/components/chat/question-card";
import type { ServerEvent } from "@/lib/opencode/types";

const SESSION = "ses_1";

function askedEvent(overrides: Record<string, unknown> = {}): ServerEvent {
  return {
    id: "evt_1",
    type: "question.v2.asked",
    properties: {
      id: "que_1",
      sessionID: SESSION,
      questions: [
        {
          header: "Database",
          question: "Which database should I use?",
          options: [
            { label: "Postgres", description: "Relational" },
            { label: "SQLite", description: "Embedded" },
          ],
        },
      ],
      ...overrides,
    },
  } as ServerEvent;
}

describe("normaliseQuestion", () => {
  it("maps the wire shape", () => {
    expect(
      normaliseQuestion({
        header: "Pick",
        question: "Which one?",
        options: [{ label: "A", description: "first" }],
        multiple: true,
        custom: true,
      }),
    ).toEqual({
      header: "Pick",
      question: "Which one?",
      options: [{ label: "A", description: "first" }],
      multiple: true,
      custom: true,
    });
  });

  it("accepts bare string options", () => {
    expect(normaliseQuestion({ question: "q", header: "h", options: ["a", "b"] })?.options).toEqual([
      { label: "a" },
      { label: "b" },
    ]);
  });

  it("falls back to the question when the header is missing", () => {
    expect(normaliseQuestion({ question: "Why?", options: [] })?.header).toBe("Why?");
  });

  it("caps an over-long header", () => {
    const long = "x".repeat(80);
    expect(normaliseQuestion({ question: "q", header: long, options: [] })!.header).toHaveLength(30);
  });

  it("rejects anything without a question", () => {
    expect(normaliseQuestion(null)).toBeNull();
    expect(normaliseQuestion({ header: "h", options: [] })).toBeNull();
  });

  it("defaults flags to false", () => {
    const q = normaliseQuestion({ question: "q", header: "h", options: [] })!;
    expect(q.multiple).toBe(false);
    expect(q.custom).toBe(false);
  });
});

describe("applyQuestionEvent", () => {
  it("adds a v2 question", () => {
    const next = applyQuestionEvent(emptyQuestions(), askedEvent(), 100);
    expect(pendingFor(next, SESSION)).toHaveLength(1);
  });

  it("adds a v1 question", () => {
    const next = applyQuestionEvent(
      emptyQuestions(),
      { id: "e", type: "question.asked", properties: askedEvent().properties } as ServerEvent,
      100,
    );
    expect(pendingFor(next, SESSION)[0]!.version).toBe(1);
  });

  it("is idempotent for a re-broadcast", () => {
    let state = applyQuestionEvent(emptyQuestions(), askedEvent(), 100);
    state = applyQuestionEvent(state, askedEvent(), 9999);
    expect(pendingFor(state, SESSION)).toHaveLength(1);
    expect(pendingFor(state, SESSION)[0]!.askedAt).toBe(100);
  });

  it("removes on replied", () => {
    let state = applyQuestionEvent(emptyQuestions(), askedEvent(), 100);
    state = applyQuestionEvent(state, {
      id: "e",
      type: "question.v2.replied",
      properties: { sessionID: SESSION, requestID: "que_1" },
    } as ServerEvent, 200);
    expect(pendingFor(state, SESSION)).toHaveLength(0);
  });

  it("removes on rejected", () => {
    let state = applyQuestionEvent(emptyQuestions(), askedEvent(), 100);
    state = applyQuestionEvent(state, {
      id: "e",
      type: "question.v2.rejected",
      properties: { sessionID: SESSION, requestID: "que_1" },
    } as ServerEvent, 200);
    expect(pendingFor(state, SESSION)).toHaveLength(0);
  });

  it("ignores an event with no usable questions", () => {
    const state = emptyQuestions();
    const next = applyQuestionEvent(state, askedEvent({ questions: [] }), 100);
    expect(next).toBe(state);
  });

  it("keeps sessions isolated", () => {
    let state = applyQuestionEvent(emptyQuestions(), askedEvent(), 100);
    state = applyQuestionEvent(state, askedEvent({ id: "que_2", sessionID: "ses_2" }), 200);
    expect(pendingFor(state, "ses_2")).toHaveLength(1);
    expect(pendingFor(state, SESSION)).toHaveLength(1);
  });

  it("merges a fetch without resetting a card on screen", () => {
    const existing = applyQuestionEvent(emptyQuestions(), askedEvent(), 100);
    const next = mergeFetch(existing, [
      { id: "que_1", sessionID: SESSION, questions: [], version: 2, askedAt: 9999 },
    ]);
    expect(pendingFor(next, SESSION)[0]!.askedAt).toBe(100);
  });
});

describe("question store", () => {
  beforeEach(() => useQuestions.getState().reset());

  it("ingests and resolves", () => {
    useQuestions.getState().ingest(askedEvent());
    expect(pendingFor({ bySession: useQuestions.getState().bySession }, SESSION)).toHaveLength(1);
    useQuestions.getState().resolve(SESSION, "que_1");
    expect(pendingFor({ bySession: useQuestions.getState().bySession }, SESSION)).toHaveLength(0);
  });
});

function pending(overrides: Partial<PendingQuestion> = {}): PendingQuestion {
  return {
    id: "que_1",
    sessionID: SESSION,
    version: 2,
    askedAt: 0,
    questions: [
      {
        header: "Database",
        question: "Which database should I use?",
        options: [
          { label: "Postgres", description: "Relational" },
          { label: "SQLite", description: "Embedded" },
        ],
      },
    ],
    ...overrides,
  };
}

describe("QuestionCard", () => {
  it("renders the question and its options with descriptions", () => {
    render(<QuestionCard pending={pending()} onSubmit={vi.fn()} onReject={vi.fn()} />);
    expect(screen.getByText("Which database should I use?")).toBeInTheDocument();
    expect(screen.getByText("Postgres")).toBeInTheDocument();
    expect(screen.getByText("Relational")).toBeInTheDocument();
  });

  it("cannot be answered until something is chosen", () => {
    render(<QuestionCard pending={pending()} onSubmit={vi.fn()} onReject={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Answer" })).toBeDisabled();
  });

  it("sends one answer per question, in order", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(<QuestionCard pending={pending()} onSubmit={onSubmit} onReject={vi.fn()} />);

    await user.click(screen.getByText("Postgres"));
    await user.click(screen.getByRole("button", { name: "Answer" }));

    expect(onSubmit).toHaveBeenCalledWith([["Postgres"]]);
  });

  it("sends an empty slot for a skipped question", async () => {
    // The server matches answers to questions positionally, so a two-question
    // card must always send two entries even when only one is answered.
    const user = userEvent.setup();
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(
      <QuestionCard
        pending={pending({
          questions: [
            { header: "One", question: "First?", options: [{ label: "A" }] },
            { header: "Two", question: "Second?", options: [{ label: "B" }] },
          ],
        })}
        onSubmit={onSubmit}
        onReject={vi.fn()}
      />,
    );

    await user.click(screen.getByText("B"));
    await user.click(screen.getByRole("button", { name: "Answer" }));

    expect(onSubmit).toHaveBeenCalledWith([[], ["B"]]);
  });

  it("replaces the single choice when another is picked", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(<QuestionCard pending={pending()} onSubmit={onSubmit} onReject={vi.fn()} />);

    await user.click(screen.getByText("Postgres"));
    await user.click(screen.getByText("SQLite"));
    await user.click(screen.getByRole("button", { name: "Answer" }));

    expect(onSubmit).toHaveBeenCalledWith([["SQLite"]]);
  });

  it("accumulates choices when multiple is allowed", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(
      <QuestionCard
        pending={pending({
          questions: [
            {
              header: "Targets",
              question: "Which targets?",
              multiple: true,
              options: [{ label: "web" }, { label: "api" }],
            },
          ],
        })}
        onSubmit={onSubmit}
        onReject={vi.fn()}
      />,
    );

    await user.click(screen.getByText("web"));
    await user.click(screen.getByText("api"));
    await user.click(screen.getByRole("button", { name: "Answer" }));

    expect(onSubmit).toHaveBeenCalledWith([["web", "api"]]);
  });

  it("accepts a typed answer when custom is allowed", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(
      <QuestionCard
        pending={pending({
          questions: [
            { header: "Name", question: "What should it be called?", options: [], custom: true },
          ],
        })}
        onSubmit={onSubmit}
        onReject={vi.fn()}
      />,
    );

    const box = screen.getByPlaceholderText(/type your own answer/i);
    await user.type(box, "my-service");
    await user.click(screen.getByRole("button", { name: "Answer" }));

    expect(onSubmit).toHaveBeenCalledWith([["my-service"]]);
  });

  it("surfaces a failure instead of silently closing", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn().mockRejectedValue(new Error("agent went away"));
    render(<QuestionCard pending={pending()} onSubmit={onSubmit} onReject={vi.fn()} />);

    await user.click(screen.getByText("Postgres"));
    await user.click(screen.getByRole("button", { name: "Answer" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("agent went away");
  });

  it("can be skipped", async () => {
    const user = userEvent.setup();
    const onReject = vi.fn().mockResolvedValue(undefined);
    render(<QuestionCard pending={pending()} onSubmit={vi.fn()} onReject={onReject} />);

    await user.click(screen.getByRole("button", { name: "Skip" }));
    expect(onReject).toHaveBeenCalledOnce();
  });

  it("counts multiple questions in its heading", () => {
    render(
      <QuestionCard
        pending={pending({
          questions: [
            { header: "A", question: "One?", options: [{ label: "x" }] },
            { header: "B", question: "Two?", options: [{ label: "y" }] },
          ],
        })}
        onSubmit={vi.fn()}
        onReject={vi.fn()}
      />,
    );
    expect(screen.getByText("The agent has 2 questions")).toBeInTheDocument();
  });
});