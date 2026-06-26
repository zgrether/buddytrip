"use client";

import { useState } from "react";
import { Check, RefreshCw, X } from "lucide-react";
import { trpc } from "@/lib/trpc-client";
import { CourseSearchPanel } from "./CourseSearchPanel";
import type { GameRow } from "@/components/competition/CompetitionGamesPanel";

/**
 * CourseRowContent (W-9HOLE-01) — the Course accordion body's state machine.
 *
 *  - No course → the front PICKER (CourseSearchPanel). Picking an 18-hole course
 *    resolves the row as today; a 9-hole course lands as the FRONT nine.
 *  - 9-hole front, no back → "needs a back nine": shows the front + a BACK picker
 *    (9-hole courses only). The row is NOT resolved until the back is composed.
 *  - Composed/18 → the resolved view: a real 18 shows the course; a two-nines 18
 *    shows Front + Back with a "Swap back nine" (clears the back, keeps the front)
 *    and "Change course" (clears all → re-pick).
 *
 * All course mutations live here (applyCourse = front, setBackNine = back/swap,
 * clearCourse). They're live — the accordion collapse just recedes.
 */
export function CourseRowContent({
  tripId, game, canEdit, onChanged,
}: {
  tripId: string;
  game: GameRow;
  canEdit: boolean;
  onChanged: () => void;
}) {
  const gameId = game.id;
  const utils = trpc.useUtils();
  const applyCourse = trpc.games.applyCourse.useMutation();
  const setBackNine = trpc.games.setBackNine.useMutation();
  const clearCourse = trpc.games.clearCourse.useMutation();

  const frontId = game.course_id ?? null;
  const backId = (game.back_course_id as string | null) ?? null;
  const count = ((game.scorecard_schema as { units?: { count?: number } } | null)?.units?.count) ?? 0;
  const needsBack = !!frontId && count === 9;

  const frontQ = trpc.courses.getById.useQuery({ courseId: frontId ?? "" }, { enabled: !!frontId });
  const backQ = trpc.courses.getById.useQuery({ courseId: backId ?? "" }, { enabled: !!backId });
  const frontName = (frontQ.data?.name as string | undefined) ?? "Front nine";
  const backName = (backQ.data?.name as string | undefined) ?? "Back nine";

  // Swap/change sub-views (only meaningful in the resolved state).
  const [view, setView] = useState<"default" | "swapBack">("default");

  function refresh(courseId?: string) {
    if (courseId) utils.courses.getById.invalidate({ courseId });
    onChanged();
  }
  const onPickFront = ({ id, teeName }: { id: string; teeName?: string }) =>
    applyCourse.mutate({ tripId, gameId, courseId: id, teeSetName: teeName }, { onSuccess: () => { setView("default"); refresh(id); } });
  const onPickBack = ({ id, teeName }: { id: string; teeName?: string }) =>
    setBackNine.mutate({ tripId, gameId, backCourseId: id, backTeeSetName: teeName }, { onSuccess: () => { setView("default"); refresh(id); } });

  // ── No course → front picker ──────────────────────────────────────────────
  if (!frontId) {
    return <CourseSearchPanel tripId={tripId} gameId={gameId} onApply={onPickFront} />;
  }

  // ── 9-hole front, no back → needs a back nine ─────────────────────────────
  if (needsBack) {
    return (
      <div className="flex flex-col gap-3" data-testid="course-needs-back">
        <NineSummary label="Front nine" name={frontName} onClear={canEdit ? () => clearCourse.mutate({ tripId, gameId }, { onSuccess: () => refresh() }) : undefined} />
        <div>
          <span className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: "var(--color-bt-accent)" }}>Add the back nine</span>
          <p className="mb-2 mt-0.5 text-[12px]" style={{ color: "var(--color-bt-text-dim)" }}>A 9-hole course needs a back nine to make a full 18.</p>
          <CourseSearchPanel tripId={tripId} gameId={gameId} mode="back" onApply={onPickBack} />
        </div>
      </div>
    );
  }

  // ── Resolved (18) — swap sub-view ─────────────────────────────────────────
  if (view === "swapBack") {
    return (
      <div className="flex flex-col gap-2" data-testid="course-swap-back">
        <button onClick={() => setView("default")} className="self-start text-[13px]" style={{ color: "var(--color-bt-accent)" }}>‹ Cancel</button>
        <p className="text-[12px]" style={{ color: "var(--color-bt-text-dim)" }}>Pick the new back nine. Front nine + its scores stay; back-nine scores are cleared.</p>
        <CourseSearchPanel tripId={tripId} gameId={gameId} mode="back" onApply={onPickBack} />
      </div>
    );
  }

  // ── Resolved (18) — default view ──────────────────────────────────────────
  const twoNines = !!backId;
  return (
    <div className="flex flex-col gap-3" data-testid="course-resolved">
      {twoNines ? (
        <div className="flex flex-col gap-2">
          <NineSummary label="Front nine" name={frontName} />
          <NineSummary label="Back nine" name={backName} />
        </div>
      ) : (
        <NineSummary label="Course" name={frontName} />
      )}
      {canEdit && (
        <div className="flex flex-wrap gap-2">
          {twoNines && (
            <button
              onClick={() => setView("swapBack")}
              data-testid="course-swap-back-btn"
              className="flex items-center gap-1.5 rounded-lg px-3 py-2 text-[13px] font-semibold"
              style={{ background: "var(--color-bt-card-raised)", color: "var(--color-bt-text)", border: "1px solid var(--color-bt-border)" }}
            >
              <RefreshCw size={13} style={{ color: "var(--color-bt-accent)" }} /> Swap back nine
            </button>
          )}
          <button
            onClick={() => clearCourse.mutate({ tripId, gameId }, { onSuccess: () => refresh() })}
            className="flex items-center gap-1.5 rounded-lg px-3 py-2 text-[13px] font-semibold"
            style={{ background: "transparent", color: "var(--color-bt-text-dim)", border: "1px solid var(--color-bt-border)" }}
          >
            <X size={13} /> Change course
          </button>
        </div>
      )}
    </div>
  );
}

function NineSummary({ label, name, onClear }: { label: string; name: string; onClear?: () => void }) {
  return (
    <div className="flex items-center justify-between gap-2 rounded-lg px-3 py-2.5" style={{ background: "var(--color-bt-card-raised)", border: "1px solid var(--color-bt-border)" }}>
      <span className="flex min-w-0 items-center gap-2">
        <Check size={14} style={{ color: "var(--color-bt-accent)", flexShrink: 0 }} />
        <span className="flex min-w-0 flex-col">
          <span className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: "var(--color-bt-text-dim)" }}>{label}</span>
          <span className="truncate text-sm" style={{ color: "var(--color-bt-text)" }}>{name}</span>
        </span>
      </span>
      {onClear && (
        <button onClick={onClear} aria-label={`Clear ${label}`} className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md" style={{ color: "var(--color-bt-text-dim)" }}>
          <X size={14} />
        </button>
      )}
    </div>
  );
}
