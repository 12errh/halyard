/** Shared building blocks for the settings tabs. */

import type { ReactNode } from "react";
import { SectionLabel } from "@/components/ui/primitives";

export function Group({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <section className="mb-7 last:mb-0">
      {/* The hint goes under the label rather than beside it. Run together on
          one line they read as a single sentence — "FONT Applies everywhere" —
          which is not what either half means. */}
      <div className="mb-2.5">
        <SectionLabel>{label}</SectionLabel>
        {hint && <p className="mt-1 text-[0.7rem] leading-relaxed text-ink-faint">{hint}</p>}
      </div>
      {children}
    </section>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return (
    <p className="rounded-[var(--radius-card)] border border-dashed border-line bg-raised/30 px-3 py-5 text-center text-[0.8rem] text-ink-ghost">
      {children}
    </p>
  );
}
