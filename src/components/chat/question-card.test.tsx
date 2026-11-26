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
import type { Form, V2Event } from "@/lib/opencode/types";

const SESSION = "ses_1";

const DATABASE_FIELD: Form.Field = {
  key: "database",
  title: "Database",
  description: "Which database should I use?",
  type: "enum",
  options: [
    { value: "postgres", label: "Postgres", description: "Relational" },
    { value: "sqlite", label: "SQLite", description: "Embedded" },
  ],
};

const DATABASE_FORM: Form.Info = {
  id: "form_1",
  sessionID: SESSION,
  title: "Database",
  fields: [DATABASE_FIELD],
};

function formEvent(type: string, form: Form.Info = DATABASE_FORM): V2Event {
  return { id: "evt_1", type, data: { form } };
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
  it("adds a form", () => {
    const next = applyQuestionEvent(emptyQuestions(), formEvent("form.created"), 100);
    expect(pendingFor(next, SESSION)).toHaveLength(1);
    expect(pendingFor(next, SESSION)[0]!.id).toBe("form_1");
  });

  it("is idempotent for a re-broadcast", () => {
    let state = applyQuestionEvent(emptyQuestions(), formEvent("form.created"), 100);
    state = applyQuestionEvent(state, formEvent("form.created"), 9999);
    expect(pendingFor(state, SESSION)).toHaveLength(1);
    expect(pendingFor(state, SESSION)[0]!.askedAt).toBe(100);
  });

  it("removes on replied", () => {
    let state = applyQuestionEvent(emptyQuestions(), formEvent("form.created"), 100);
    state = applyQuestionEvent(
      state,
      { id: "e", type: "form.replied", data: { form: DATABASE_FORM, answer: { database: "postgres" } } },
      200,
    );
    expect(pendingFor(state, SESSION)).toHaveLength(0);
  });

  it("removes on cancelled", () => {
    let state = applyQuestionEvent(emptyQuestions(), formEvent("form.created"), 100);
    state = applyQuestionEvent(state, formEvent("form.cancelled"), 200);
    expect(pendingFor(state, SESSION)).toHaveLength(0);
  });

  it("ignores a form with no answerable fields", () => {
    const state = emptyQuestions();
    const booleanForm: Form.Info = {
      ...DATABASE_FORM,
      fields: [{ key: "force", title: "Force?", type: "boolean" }],
    };
    expect(applyQuestionEvent(state, formEvent("form.created", booleanForm), 100)).toBe(state);
  });

  it("keeps sessions isolated", () => {
    let state = applyQuestionEvent(emptyQuestions(), formEvent("form.created"), 100);
    state = applyQuestionEvent(
      state,
      formEvent("form.created", { ...DATABASE_FORM, id: "form_2", sessionID: "ses_2" }),
      200,
    );
    expect(pendingFor(state, "ses_2")).toHaveLength(1);
    expect(pendingFor(state, SESSION)).toHaveLength(1);
  });

  it("merges a fetch without resetting a card on screen", () => {
    const existing = applyQuestionEvent(emptyQuestions(), formEvent("form.created"), 100);
    const next = mergeFetch(existing, [
      { id: "form_1", sessionID: SESSION, questions: [], version: 2, askedAt: 9999 },
    ]);
    expect(pendingFor(next, SESSION)[0]!.askedAt).toBe(100);
  });
});

describe("question store", () => {
  beforeEach(() => useQuestions.getState().reset());

  it("ingests and resolves", () => {
    useQuestions.getState().ingest(formEvent("form.created"));
    expect(pendingFor({ bySession: useQuestions.getState().bySession }, SESSION)).toHaveLength(1);
    useQuestions.getState().resolve(SESSION, "form_1");
    expect(pendingFor({ bySession: useQuestions.getState().bySession }, SESSION)).toHaveLength(0);
  });
});

function pending(overrides: Partial<PendingQuestion> = {}): PendingQuestion {
  return {
    id: "form_1",
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
    render(
      <QuestionCard
        pending={pending()}
        fields={[DATABASE_FIELD]}
        onSubmit={vi.fn()}
        onReject={vi.fn()}
      />,
    );
    expect(screen.getByText("Which database should I use?")).toBeInTheDocument();
    expect(screen.getByText("Postgres")).toBeInTheDocument();
    expect(screen.getByText("Relational")).toBeInTheDocument();
  });

  it("cannot be answered until something is chosen", () => {
    render(
      <QuestionCard
        pending={pending()}
        fields={[DATABASE_FIELD]}
        onSubmit={vi.fn()}
        onReject={vi.fn()}
      />,
    );
    expect(screen.getByRole("button", { name: "Answer" })).toBeDisabled();
  });

  it("replies with the field key and option value", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(
      <QuestionCard
        pending={pending()}
        fields={[DATABASE_FIELD]}
        onSubmit={onSubmit}
        onReject={vi.fn()}
      />,
    );

    await user.click(screen.getByText("Postgres"));
    await user.click(screen.getByRole("button", { name: "Answer" }));

    expect(onSubmit).toHaveBeenCalledWith({ database: "postgres" });
  });

  it("omits a question that was left unanswered", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    const fields: Form.Field[] = [
      { key: "one", title: "One", type: "enum", options: [{ value: "a", label: "A" }] },
      { key: "two", title: "Two", type: "enum", options: [{ value: "b", label: "B" }] },
    ];
    render(
      <QuestionCard
        pending={pending({
          questions: [
            { header: "One", question: "First?", options: [{ label: "A" }] },
            { header: "Two", question: "Second?", options: [{ label: "B" }] },
          ],
        })}
        fields={fields}
        onSubmit={onSubmit}
        onReject={vi.fn()}
      />,
    );

    await user.click(screen.getByText("B"));
    await user.click(screen.getByRole("button", { name: "Answer" }));

    expect(onSubmit).toHaveBeenCalledWith({ two: "b" });
  });

  it("replaces the single choice when another is picked", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(
      <QuestionCard
        pending={pending()}
        fields={[DATABASE_FIELD]}
        onSubmit={onSubmit}
        onReject={vi.fn()}
      />,
    );

    await user.click(screen.getByText("Postgres"));
    await user.click(screen.getByText("SQLite"));
    await user.click(screen.getByRole("button", { name: "Answer" }));

    expect(onSubmit).toHaveBeenCalledWith({ database: "sqlite" });
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
        fields={[
          {
            key: "targets",
            title: "Targets",
            type: "multiselect",
            options: [
              { value: "web", label: "web" },
              { value: "api", label: "api" },
            ],
          },
        ]}
        onSubmit={onSubmit}
        onReject={vi.fn()}
      />,
    );

    await user.click(screen.getByText("web"));
    await user.click(screen.getByText("api"));
    await user.click(screen.getByRole("button", { name: "Answer" }));

    expect(onSubmit).toHaveBeenCalledWith({ targets: ["web", "api"] });
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
        fields={[
          {
            key: "name",
            title: "Name",
            description: "What should it be called?",
            type: "string",
            custom: true,
          },
        ]}
        onSubmit={onSubmit}
        onReject={vi.fn()}
      />,
    );

    const box = screen.getByPlaceholderText(/type your own answer/i);
    await user.type(box, "my-service");
    await user.click(screen.getByRole("button", { name: "Answer" }));

    expect(onSubmit).toHaveBeenCalledWith({ name: "my-service" });
  });

  it("surfaces a failure instead of silently closing", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn().mockRejectedValue(new Error("agent went away"));
    render(
      <QuestionCard
        pending={pending()}
        fields={[DATABASE_FIELD]}
        onSubmit={onSubmit}
        onReject={vi.fn()}
      />,
    );

    await user.click(screen.getByText("Postgres"));
    await user.click(screen.getByRole("button", { name: "Answer" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("agent went away");
  });

  it("can be skipped", async () => {
    const user = userEvent.setup();
    const onReject = vi.fn().mockResolvedValue(undefined);
    render(
      <QuestionCard
        pending={pending()}
        fields={[DATABASE_FIELD]}
        onSubmit={vi.fn()}
        onReject={onReject}
      />,
    );

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
        fields={[
          { key: "a", title: "A", type: "enum", options: [{ value: "x", label: "x" }] },
          { key: "b", title: "B", type: "enum", options: [{ value: "y", label: "y" }] },
        ]}
        onSubmit={vi.fn()}
        onReject={vi.fn()}
      />,
    );
    expect(screen.getByText("The agent has 2 questions")).toBeInTheDocument();
  });
});
