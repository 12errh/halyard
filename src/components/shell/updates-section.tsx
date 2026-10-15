import { useCallback, useEffect, useState } from "react";
import { Download, RefreshCw, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Group } from "@/components/shell/settings-groups";
import {
  checkForUpdate,
  installUpdate,
  onUpdateProgress,
  updateSupport,
  type UpdateSummary,
  type UpdateSupport,
} from "@/lib/tauri";

/**
 * Updates.
 *
 * The awkward part of shipping a desktop app is that "update" means something
 * different on each platform, and pretending otherwise produces a button that
 * either fails outright or asks for administrator rights from a GUI the user
 * was not expecting.
 *
 * - **AppImage** and **NSIS** replace themselves, then relaunch.
 * - **`.deb`** and **`.rpm`** cannot. Writing to `/usr` needs root, so those
 *   installs update through the package manager, which already asks for a
 *   password the way the user expects. This panel says so rather than offering
 *   a button that cannot work.
 *
 * Windows installs per-user (`installMode: currentUser`), so an NSIS update
 * never prompts for elevation either.
 */
type Phase =
  | { kind: "checking" }
  | { kind: "current" }
  | { kind: "available"; update: UpdateSummary }
  | { kind: "downloading"; update: UpdateSummary; downloaded: number; total: number | null }
  | { kind: "error"; message: string };

export function UpdatesSection() {
  const [support, setSupport] = useState<UpdateSupport | null>(null);
  const [phase, setPhase] = useState<Phase | null>(null);

  useEffect(() => {
    let cancelled = false;
    updateSupport()
      .then((value) => {
        if (!cancelled) setSupport(value);
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setPhase({
          kind: "error",
          message: `Could not read the update settings: ${describe(error)}`,
        });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Progress arrives many times a second while a download runs.
  useEffect(() => {
    if (phase?.kind !== "downloading") return;
    let disposed = false;
    let unlisten: (() => void) | null = null;
    void onUpdateProgress(({ downloaded, total }) => {
      if (disposed) return;
      setPhase((current) =>
        current?.kind === "downloading" ? { ...current, downloaded, total } : current,
      );
    }).then((off) => {
      if (disposed) off();
      else unlisten = off;
    });
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [phase?.kind]);

  const check = useCallback(async () => {
    setPhase({ kind: "checking" });
    try {
      const found = await checkForUpdate();
      setPhase(found ? { kind: "available", update: found } : { kind: "current" });
    } catch (error) {
      setPhase({ kind: "error", message: describe(error) });
    }
  }, []);

  const install = useCallback(async () => {
    // Read `phase` from the closure rather than from inside a state updater:
    // React is free to defer the updater, so anything assigned there may still
    // be unset when the next line runs, and the install would silently never
    // start.
    if (phase?.kind !== "available") return;
    const target = phase.update;
    setPhase({ kind: "downloading", update: target, downloaded: 0, total: null });
    try {
      // Relaunches on success, so nothing after this runs in this process.
      await installUpdate();
    } catch (error) {
      setPhase({ kind: "error", message: describe(error) });
    }
  }, [phase]);

  const busy = phase?.kind === "checking" || phase?.kind === "downloading";
  // A `.deb` has no self-update path, so "nothing found" and "cannot update"
  // both come back null. The support record is what tells them apart.
  const hint =
    support && !support.canSelfUpdate
      ? (support.reason ?? undefined)
      : "Signed builds, checked against a key compiled into the app.";

  return (
    <Group label="Updates" hint={hint}>
      <div className="space-y-2.5">
        {support && (
          <p className="text-[0.78rem] text-ink-muted">Halyard {support.currentVersion}</p>
        )}

        {phase?.kind === "error" && (
          <p className="flex items-start gap-1.5 text-[0.78rem] text-danger">
            <TriangleAlert size={12} className="mt-px shrink-0" />
            <span>{phase.message}</span>
          </p>
        )}

        {phase?.kind === "current" && (
          <p className="text-[0.8rem] text-ink-muted">No update available.</p>
        )}

        {phase?.kind === "available" && (
          <div className="space-y-2">
            <p className="text-[0.8rem] text-ink">
              {phase.update.version} is available
              {support && (
                <span className="text-ink-ghost"> · you have {support.currentVersion}</span>
              )}
            </p>
            {phase.update.notes && (
              <p className="max-w-prose whitespace-pre-wrap text-[0.76rem] leading-relaxed text-ink-muted">
                {phase.update.notes}
              </p>
            )}
          </div>
        )}

        {phase?.kind === "downloading" && (
          <Progress downloaded={phase.downloaded} total={phase.total} />
        )}

        {/* The check is offered even where the install cannot self-update:
            knowing a release exists is still useful, and the hint above
            already says where the update actually comes from. */}
        <div className="flex items-center gap-2 pt-0.5">
          <Button
            size="sm"
            variant="secondary"
            onClick={() => void check()}
            disabled={busy}
          >
            <RefreshCw size={12} className={phase?.kind === "checking" ? "animate-spin" : undefined} />
            Check for updates
          </Button>

          {phase?.kind === "available" && (
            <Button size="sm" variant="primary" onClick={() => void install()}>
              <Download size={12} />
              Install {phase.update.version}
            </Button>
          )}
        </div>
      </div>
    </Group>
  );
}

function Progress({ downloaded, total }: { downloaded: number; total: number | null }) {
  const percent = total && total > 0 ? Math.min(100, (downloaded / total) * 100) : null;
  return (
    <div className="space-y-1.5">
      <div className="h-1 overflow-hidden rounded-full bg-raised">
        {/* Without a known total the bar has no width to grow, so it sweeps
            instead: a bar frozen at zero reads as a hung download. */}
        {percent === null ? (
          <div className="h-full w-1/3 animate-pulse rounded-full bg-accent" />
        ) : (
          <div
            className="h-full rounded-full bg-accent transition-[width] duration-200"
            style={{ width: `${percent}%` }}
          />
        )}
      </div>
      <p className="tabular text-[0.72rem] text-ink-ghost">
        {total ? `${megabytes(downloaded)} of ${megabytes(total)}` : megabytes(downloaded)}
      </p>
    </div>
  );
}

function megabytes(bytes: number): string {
  return `${(bytes / 1_000_000).toFixed(1)} MB`;
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
