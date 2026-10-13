import { cn } from "@/lib/utils";

/**
 * Loading placeholder.
 *
 * A spinner says "wait". A skeleton says "this is what is coming", which makes
 * a tab switch feel immediate instead of broken. Shapes mirror the real layout
 * so nothing jumps when the data lands.
 */
export function Skeleton({ className }: { className?: string }) {
  return (
    <div
      aria-hidden
      className={cn("animate-pulse rounded-[5px] bg-raised", className)}
      style={{ animationDuration: "1.6s" }}
    />
  );
}

/** A skeleton in the shape of a settings row: label left, control right. */
export function SkeletonRow({ lines = 2 }: { lines?: number }) {
  return (
    <div className="flex flex-col gap-1.5 rounded-[var(--radius-card)] border border-line bg-raised/30 px-2.5 py-2">
      {Array.from({ length: lines }, (_, index) => (
        <div key={index} className="flex items-center gap-2">
          <Skeleton className="h-3 w-24" />
          <Skeleton className="ml-auto h-3 w-32" />
        </div>
      ))}
    </div>
  );
}

/** Placeholder for a provider or agent row. */
export function SkeletonCard() {
  return (
    <div className="flex items-center gap-2 rounded-[var(--radius-card)] border border-line bg-raised/30 px-2.5 py-2">
      <Skeleton className="h-4 w-4 rounded-full" />
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <Skeleton className="h-3 w-32" />
        <Skeleton className="h-2 w-20" />
      </div>
      <Skeleton className="h-5 w-14 rounded-full" />
    </div>
  );
}

export function SkeletonList({ count = 3, variant = "card" }: { count?: number; variant?: "card" | "row" }) {
  return (
    <div className="flex flex-col gap-1.5" role="status" aria-label="Loading">
      {Array.from({ length: count }, (_, index) =>
        variant === "card" ? <SkeletonCard key={index} /> : <SkeletonRow key={index} />,
      )}
    </div>
  );
}

export function SkeletonBlock({ lines = 3 }: { lines?: number }) {
  return (
    <div className="flex flex-col gap-1.5" role="status" aria-label="Loading">
      {Array.from({ length: lines }, (_, index) => (
        <Skeleton key={index} className={cn("h-3", index === lines - 1 ? "w-2/3" : "w-full")} />
      ))}
    </div>
  );
}