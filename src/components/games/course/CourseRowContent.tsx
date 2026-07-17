"use client";

import { Check, X, Table2, ChevronRight } from "lucide-react";
import { useRouter } from "next/navigation";
import { trpc } from "@/lib/trpc-client";
import { gameHref } from "@/lib/gameRoutes";
import { CourseSearchPanel } from "./CourseSearchPanel";
import type { GameRow } from "@/components/competition/CompetitionGamesPanel";

/**
 * CourseRowContent (W-9HOLE-01) — the Course accordion body's state machine.
 *
 *  - No course → the front PICKER (CourseSearchPanel). Picking an 18-hole course
 *    resolves the row as today; a 9-hole course lands as the FRONT nine.
 *  - 9-hole front, no back → "needs a back nine": shows the front + a BACK picker
 *    (9-hole courses only). The row is NOT resolved until the back is composed.
 *  - Composed/18 → the resolved view: ×-to-remove throughout (matching removable
 *    items elsewhere). A real 18 shows the course with one × (clears → re-pick); a
 *    two-nines 18 shows Front + Back, each with its own × — front × clears the
 *    course, back × drops just the back (→ "needs a back nine", re-pick from there).
 *
 * TWO MODES:
 *  - **Uncontrolled** (default): the course mutations live here (applyCourse =
 *    front / also used to drop the back by re-applying the front alone,
 *    setBackNine = back, clearCourse). They're live — the accordion collapse just
 *    recedes.
 *  - **Controlled** (pass the `on*` action callbacks — the draft-then-save settings
 *    page): this body reports the ACTION and the parent decides what it means.
 *    State still comes from the `game` prop, so a drafting parent passes a
 *    draft-shaped game and this renders the draft without knowing it. Under
 *    draft-then-save the parent updates its draft (pre-computing the scorecard
 *    snapshot via the shared buildCourseSnapshot) and the page's single Save
 *    persists it — nothing commits from here.
 * The uncontrolled mode stays until the remaining surfaces convert (P2).
 */
export function CourseRowContent({
  tripId, game, canEdit, onChanged,
  onApplyFront, onApplyBack, onRemoveBackNine, onClearCourse: onClearCourseProp, busy,
  frontScored = false, backScored = false,
}: {
  tripId: string;
  game: GameRow;
  canEdit: boolean;
  onChanged: () => void;
  /** Controlled mode: a front course (+ tee) was picked. */
  onApplyFront?: (courseId: string, teeName?: string) => void;
  /** Controlled mode: a back nine (+ tee) was picked. */
  onApplyBack?: (backCourseId: string, backTeeName?: string) => void;
  /** Controlled mode: drop just the back nine (→ "needs a back nine"). */
  onRemoveBackNine?: () => void;
  /** Controlled mode: clear the course entirely. */
  onClearCourse?: () => void;
  /** Controlled mode: the parent's write is in flight (drives the tee chooser). */
  busy?: boolean;
  /** Range-scoped lock (§2.1): the front's clear and the back's swap disable
   *  independently once their nine has scores — so a played front can still add a
   *  back, and only the still-empty nine stays editable. */
  frontScored?: boolean;
  backScored?: boolean;
}) {
  // Controlled when the parent supplies the front-apply action (the one every
  // state of this body can reach).
  const controlled = onApplyFront !== undefined;
  const gameId = game.id;
  const router = useRouter();
  // Scorecard preview (Spec 5a) — the empty par/yardage/stroke-index card, read from
  // persisted state, so the owner can confirm the course is set up right. A simple
  // button inside this panel, under the chosen course(s). Golf-only (null → hidden).
  const scorecardHref = gameHref(tripId, game.game_type_id, gameId, { scorecard: true });
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

  // Back-nine tee inheritance fallback (pin #3). The composed tee NAME is the
  // front's (setBackNine), but the back-9 yardages come from a same-named tee on
  // the back course — and when the back course has no tee by that name, its FIRST
  // tee was used instead. Surface that so the inherited name isn't silently
  // mismatched. Derived from the snapshot's tee name vs the back course's tees.
  const appliedTeeName = ((game.scorecard_schema as { units?: { metadata?: { tee?: { name?: string } } } } | null)
    ?.units?.metadata?.tee?.name ?? "").trim();
  const backTees = ((backQ.data?.tee_sets as { name?: string }[] | undefined) ?? []);
  const backTeeFallback =
    !!backId && !!appliedTeeName && backTees.length > 0 &&
    !backTees.some((t) => (t.name ?? "").trim() === appliedTeeName);

  // Apply mutations are in flight → drive the tee chooser's pending feedback. In
  // controlled mode the parent owns the write, so it reports the pending state.
  const applying = controlled ? !!busy : applyCourse.isPending || setBackNine.isPending;

  // Fast-path the course/tee-apply response (the reported "long delay"): the
  // mutation RETURNS the updated game row, so merge it straight into the getById
  // cache — the parent (gameQ) repaints the resolved course INSTANTLY instead of
  // waiting on the shared onSetupChanged cascade (gameQ.refetch + the board's
  // faceBootstrap/leaderboard/listByTrip refetches, heavy because the board stays
  // mounted under the panel). A course/tee change is pre-scoring (frozen once
  // scores exist), so the board can't have changed — skipping that cascade here
  // is safe. Merge (not overwrite): applyCourse returns SELECT * (no
  // `participants`), while getById caches game + participants, so spread over prev.
  const patchGameFromReturn = (row: unknown, courseId?: string) => {
    if (row && typeof row === "object") {
      utils.games.getById.setData(
        { tripId, gameId },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (prev: any) => (prev ? { ...prev, ...(row as Record<string, unknown>) } : prev)
      );
    }
    if (courseId) utils.courses.getById.invalidate({ courseId });
  };
  const onPickFront = ({ id, teeName }: { id: string; teeName?: string }) => {
    if (controlled) return void onApplyFront!(id, teeName);
    applyCourse.mutate({ tripId, gameId, courseId: id, teeSetName: teeName }, { onSuccess: (row) => patchGameFromReturn(row, id) });
  };
  const onPickBack = ({ id, teeName }: { id: string; teeName?: string }) => {
    if (controlled) return void onApplyBack?.(id, teeName);
    setBackNine.mutate({ tripId, gameId, backCourseId: id, backTeeSetName: teeName }, { onSuccess: (row) => patchGameFromReturn(row, id) });
  };
  // Remove the back nine (per-nine × — Task 2b): re-apply the FRONT alone, which
  // resets back_course_id and shrinks the schema back to 9 → the "needs a back
  // nine" state (re-pick from there). Reuses applyCourse — no new server machinery
  // (the composed tee name is the front's, so it round-trips the front's tee).
  const onRemoveBack = () => {
    if (controlled) return void onRemoveBackNine?.();
    applyCourse.mutate(
      { tripId, gameId, courseId: frontId!, teeSetName: appliedTeeName || undefined },
      { onSuccess: (row) => patchGameFromReturn(row, frontId!) }
    );
  };
  // Clearing the course fully is rare and not the hot tee-select path — keep the
  // broad refresh (onChanged) so every dependent surface re-derives from scratch.
  const onClearCourse = () => {
    if (controlled) return void onClearCourseProp?.();
    clearCourse.mutate({ tripId, gameId }, { onSuccess: () => { onChanged(); } });
  };

  // ── No course → front picker ──────────────────────────────────────────────
  if (!frontId) {
    return <CourseSearchPanel tripId={tripId} gameId={gameId} onApply={onPickFront} busy={applying} />;
  }

  // ── 9-hole front, no back → needs a back nine ─────────────────────────────
  if (needsBack) {
    return (
      <div className="flex flex-col gap-3" data-testid="course-needs-back">
        <NineSummary label="Front nine" name={frontName} onClear={canEdit && !frontScored ? onClearCourse : undefined} />
        {scorecardHref && <ScorecardPreviewButton onClick={() => router.push(scorecardHref)} />}
        <div>
          <span className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: "var(--color-bt-accent)" }}>Add the back nine</span>
          <p className="mb-2 mt-0.5 text-[12px]" style={{ color: "var(--color-bt-text-dim)" }}>A 9-hole course needs a back nine to make a full 18.</p>
          <CourseSearchPanel tripId={tripId} gameId={gameId} mode="back" onApply={onPickBack} busy={applying} />
        </div>
      </div>
    );
  }

  // ── Resolved (18) — default view ──────────────────────────────────────────
  // ×-to-remove throughout (Task 2a/2b), matching how removable items work
  // elsewhere: a single 18 gets ONE × (clears the course → re-pick); a two-nines
  // 18 gets a per-nine × (front × clears the course; back × drops just the back →
  // "needs a back nine"). The old "Swap back nine" / "Change course" buttons are
  // gone — the × on each item is the affordance.
  const twoNines = !!backId;
  return (
    <div className="flex flex-col gap-3" data-testid="course-resolved">
      {twoNines ? (
        <div className="flex flex-col gap-2">
          <NineSummary label="Front nine" name={frontName} onClear={canEdit && !frontScored ? onClearCourse : undefined} />
          <NineSummary label="Back nine" name={backName} onClear={canEdit && !backScored ? onRemoveBack : undefined} />
          {backTeeFallback && (
            <p className="px-1 text-[11px] leading-snug" style={{ color: "var(--color-bt-text-dim)" }} data-testid="back-tee-fallback">
              {backName} has no {appliedTeeName} tee — its first tee’s yardages are used for the back nine.
            </p>
          )}
        </div>
      ) : (
        <NineSummary label="Course" name={frontName} onClear={canEdit && !(frontScored || backScored) ? onClearCourse : undefined} />
      )}
      {scorecardHref && <ScorecardPreviewButton onClick={() => router.push(scorecardHref)} />}
    </div>
  );
}

/** A simple button under the chosen course(s) that opens the empty scorecard
 *  (par / yardage / stroke index) to verify the course setup. */
function ScorecardPreviewButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      data-testid="course-preview-scorecard"
      onClick={onClick}
      className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left"
      style={{ background: "var(--color-bt-card-raised)", border: "1px solid var(--color-bt-border)" }}
    >
      <Table2 size={16} style={{ color: "var(--color-bt-text-dim)", flexShrink: 0 }} />
      <span className="flex-1 text-sm" style={{ color: "var(--color-bt-text)" }}>Preview scorecard</span>
      <ChevronRight size={16} style={{ color: "var(--color-bt-text-dim)" }} />
    </button>
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
