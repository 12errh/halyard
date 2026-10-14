/** Shared building blocks for the settings tabs. */

import type { ReactNode } from "react";
import { SectionLabel } from "@/components/ui/primitives";

export function Group({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <section className="mb-6 last:mb-0">
      <div className="mb-2 flex items-baseline gap-2">
        <SectionLabel>{label}</SectionLabel>
        {hint && <span className="text-[0.68rem] text-ink-ghost">{hint}</span>}
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
