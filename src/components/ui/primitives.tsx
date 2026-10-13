import type { HTMLAttributes, ReactNode } from "react";
import { cn } from "@/lib/utils";

/** Small uppercase label used above settings groups. */
export function SectionLabel({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={cn(
        "text-[0.66rem] font-semibold uppercase tracking-[0.13em] text-ink-faint",
        className,
      )}
    >
      {children}
    </div>
  );
}

/** Keyboard hint, rendered as a physical key. */
export function Kbd({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <kbd
      className={cn(
        "inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-[4px]",
        "border border-line bg-raised px-1 font-mono text-[0.66rem] leading-none text-ink-faint",
        className,
      )}
    >
      {children}
    </kbd>
  );
}

export function Badge({
  children,
  tone = "neutral",
  className,
  title,
}: {
  children: ReactNode;
  tone?: "neutral" | "live" | "good" | "warn" | "danger" | "accent";
  className?: string;
  title?: string;
}) {
  const tones: Record<string, string> = {
    neutral: "bg-raised text-ink-muted border-line",
    live: "bg-live/12 text-live border-live/30",
    good: "bg-good/12 text-good border-good/30",
    warn: "bg-warn/12 text-warn border-warn/30",
    danger: "bg-danger/12 text-danger border-danger/30",
    accent: "bg-accent/12 text-accent border-accent/30",
  };
  return (
    <span
      title={title}
      className={cn(
        "inline-flex items-center gap-1 rounded-full border px-1.5 py-px text-[0.66rem] font-medium",
        tones[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

/** Breathing dot used for "working" states. */
export function Pulse({
  tone = "live",
  className,
}: {
  tone?: "live" | "good" | "danger" | "warn";
  className?: string;
}) {
  const tones: Record<string, string> = {
    live: "bg-live",
    good: "bg-good",
    danger: "bg-danger",
    warn: "bg-warn",
  };
  return (
    <span className={cn("relative flex h-1.5 w-1.5", className)}>
      <span className={cn("absolute inline-flex h-full w-full rounded-full opacity-70", tones[tone], "animate-ping")} />
      <span className={cn("relative inline-flex h-1.5 w-1.5 rounded-full", tones[tone])} />
    </span>
  );
}

export function Divider({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div role="separator" className={cn("h-px w-full bg-line", className)} {...props} />;
}

/** Horizontal rule with a centred label, used between turns. */
export function RuleLabel({ children }: { children: ReactNode }) {
  return (
    <div className="flex items-center gap-3 py-1 text-[0.68rem] text-ink-ghost">
      <span className="h-px flex-1 bg-line" />
      <span className="uppercase tracking-[0.12em]">{children}</span>
      <span className="h-px flex-1 bg-line" />
    </div>
  );
}

/**
 * A labelled on/off switch.
 *
 * Built from a real checkbox rather than a div so it is reachable by keyboard,
 * announced correctly, and toggles on space as well as click.
 */
export function Switch({
  checked,
  onChange,
  label,
  hint,
  disabled = false,
}: {
  checked: boolean;
  onChange(next: boolean): void;
  label: string;
  hint?: string;
  disabled?: boolean;
}) {
  const id = `switch-${label.replace(/\W+/g, "-").toLowerCase()}`;

  return (
    <div className={cn("flex items-start justify-between gap-4 py-2", disabled && "opacity-50")}>
      <div className="min-w-0">
        <label htmlFor={id} className="block cursor-pointer text-[0.82rem] text-ink">
          {label}
        </label>
        {hint && <p className="mt-0.5 text-[0.7rem] leading-relaxed text-ink-ghost">{hint}</p>}
      </div>

      <input
        id={id}
        type="checkbox"
        role="switch"
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
        className="mt-0.5 h-[18px] w-[32px] shrink-0 cursor-pointer appearance-none rounded-full border border-line-strong bg-raised transition-colors checked:border-accent checked:bg-accent disabled:cursor-not-allowed"
        style={{
          // The knob is drawn with a background image so the control needs no
          // wrapper element and keeps the native checkbox semantics.
          backgroundImage: checked
            ? "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 14 14'><circle cx='9' cy='7' r='5' fill='%23fffaf7'/></svg>\")"
            : "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 14 14'><circle cx='5' cy='7' r='5' fill='%23888078'/></svg>\")",
          backgroundRepeat: "no-repeat",
          backgroundPosition: checked ? "right 2px center" : "left 2px center",
          backgroundSize: "14px 14px",
        }}
      />
    </div>
  );
}
