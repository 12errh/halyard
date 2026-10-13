import { useEffect, useState } from "react";
import { motion } from "motion/react";
import { Check, HelpCircle, Loader2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/input";
import { Badge } from "@/components/ui/primitives";
import type { PendingQuestion, Question } from "@/state/questions";
import { cn } from "@/lib/utils";

/**
 * A question the agent asked back.
 *
 * Answers go back as one array of selected labels per question, in order —
 * that ordering is the contract with the server, so a card with three
 * questions must always send three entries even if one is skipped.
 */
export function QuestionCard({
  pending,
  onSubmit,
  onReject,
}: {
  pending: PendingQuestion;
  onSubmit(answers: string[][]): Promise<void>;
  onReject(): Promise<void>;
}) {
  const [selected, setSelected] = useState<string[][]>(() =>
    pending.questions.map(() => []),
  );
  const [custom, setCustom] = useState<string[]>(() => pending.questions.map(() => ""));
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // An empty answer array is valid for a question — the server matches
  // answers positionally and treats [] as a skip. Requiring every question
  // would trap the user on a multi-question card they only partly care about,
  // so only one real answer is required.
  const answered = pending.questions.some((_question, index) => {
    return selected[index]!.length > 0 || custom[index]!.trim().length > 0;
  });


  const toggle = (questionIndex: number, label: string, multiple: boolean) => {
    setSelected((prev) =>
      prev.map((current, index) => {
        if (index !== questionIndex) return current;
        if (!multiple) return current.includes(label) ? [] : [label];
        return current.includes(label)
          ? current.filter((value) => value !== label)
          : [...current, label];
      }),
    );
  };

  const submit = async () => {
    setSubmitting(true);
    setError(null);
    try {
      await onSubmit(
        pending.questions.map((_, index) =>
          custom[index]!.trim() ? [custom[index]!.trim()] : selected[index]!,
        ),
      );
    } catch (cause) {
      setSubmitting(false);
      setError((cause as Error).message || "could not send the answer");
    }
  };

  const reject = async () => {
    setSubmitting(true);
    setError(null);
    try {
      await onReject();
    } catch (cause) {
      setSubmitting(false);
      setError((cause as Error).message || "could not dismiss");
    }
  };

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 8, scale: 0.99 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, scale: 0.98 }}
      transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
      data-testid="question-card"
      className="my-2 overflow-hidden rounded-[var(--radius-panel)] border border-live/35 bg-live/[0.05]"
    >
      <div className="flex items-center gap-2 border-b border-live/20 px-3 py-2">
        <HelpCircle size={13} className="shrink-0 text-live" />
        <span className="text-[0.82rem] font-medium text-ink">
          {pending.questions.length === 1 ? "The agent has a question" : `The agent has ${pending.questions.length} questions`}
        </span>
        <Badge tone="live" className="ml-auto">
          waiting for you
        </Badge>
      </div>

      <div className="space-y-4 px-3 py-3">
        {pending.questions.map((question, index) => (
          <QuestionBlock
            key={index}
            question={question}
            selected={selected[index]!}
            custom={custom[index]!}
            disabled={submitting}
            onToggle={(label) => toggle(index, label, question.multiple === true)}
            onCustom={(value) =>
              setCustom((prev) => prev.map((current, i) => (i === index ? value : current)))
            }
          />
        ))}
      </div>

      {error && (
        <p className="px-3 pb-2 text-[0.74rem] text-danger" role="alert">
          {error}
        </p>
      )}

      <div className="flex items-center gap-2 border-t border-live/20 px-3 py-2">
        <Button size="sm" variant="primary" disabled={!answered || submitting} onClick={() => void submit()}>
          {submitting ? <Loader2 size={12} className="animate-spin" /> : null}
          Answer
        </Button>
        <Button size="sm" variant="ghost" disabled={submitting} onClick={() => void reject()}>
          <X size={12} />
          Skip
        </Button>
        {!answered && (
          <span className="ml-1 text-[0.7rem] text-ink-ghost">pick an option to continue</span>
        )}
      </div>
    </motion.div>
  );
}

function QuestionBlock({
  question,
  selected,
  custom,
  disabled,
  onToggle,
  onCustom,
}: {
  question: Question;
  selected: string[];
  custom: string;
  disabled: boolean;
  onToggle(label: string): void;
  onCustom(value: string): void;
}) {
  const [showCustom, setShowCustom] = useState(question.custom === true && question.options.length === 0);

  useEffect(() => {
    if (question.custom && question.options.length === 0) setShowCustom(true);
  }, [question.custom, question.options.length]);

  return (
    <div>
      <div className="flex items-baseline gap-2">
        <span className="shrink-0 rounded-[4px] border border-line bg-raised px-1.5 py-px font-mono text-[0.66rem] text-ink-faint">
          {question.header}
        </span>
        {question.multiple && <Badge tone="neutral">pick any</Badge>}
      </div>

      <p data-selectable className="mt-1 text-[0.85rem] leading-relaxed text-ink">
        {question.question}
      </p>

      {question.options.length > 0 && (
        <div className="mt-2 flex flex-col gap-1">
          {question.options.map((option) => {
            const isSelected = selected.includes(option.label);
            return (
              <button
                key={option.label}
                type="button"
                disabled={disabled}
                aria-pressed={isSelected}
                onClick={() => onToggle(option.label)}
                className={cn(
                  "flex items-start gap-2 rounded-[7px] border px-2.5 py-1.5 text-left transition-colors disabled:opacity-50",
                  isSelected
                    ? "border-accent/55 bg-accent/10"
                    : "border-line hover:border-line-strong hover:bg-raised",
                )}
              >
                <span className="mt-[3px] shrink-0">
                  {question.multiple ? (
                    <span
                      className={cn(
                        "flex h-3 w-3 items-center justify-center rounded-[3px] border",
                        isSelected ? "border-accent bg-accent text-accent-ink" : "border-line-strong",
                      )}
                    >
                      {isSelected && <Check size={9} />}
                    </span>
                  ) : (
                    <span
                      className={cn(
                        "block h-3 w-3 rounded-full border",
                        isSelected ? "border-accent bg-accent" : "border-line-strong",
                      )}
                    />
                  )}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[0.82rem] text-ink">{option.label}</span>
                  {option.description && (
                    <span data-selectable className="mt-0.5 block text-[0.73rem] leading-snug text-ink-faint">
                      {option.description}
                    </span>
                  )}
                </span>
              </button>
            );
          })}
        </div>
      )}

      {question.custom && (
        <div className="mt-2">
          {showCustom ? (
            <Textarea
              value={custom}
              disabled={disabled}
              onChange={(event) => onCustom(event.target.value)}
              placeholder="Type your own answer…"
              rows={2}
              className="text-[0.82rem]"
            />
          ) : (
            <Button size="sm" variant="ghost" onClick={() => setShowCustom(true)}>
              Write my own answer
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
