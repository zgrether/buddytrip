"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Flag, Hash, ClipboardList, ChevronRight } from "lucide-react";
import { trpc } from "@/lib/trpc-client";
import { gameHref, isGolfFormat } from "@/lib/gameRoutes";
import { GAME_TYPES } from "@/lib/gameTypes";
import { Stepper } from "@/components/games/Stepper";
import { pointsReady } from "@/lib/matchDraft";
import { composedCourseTitle } from "@/lib/courseProvenance";
import { CourseRowContent } from "@/components/games/course/CourseRowContent";
import { ChecklistRow } from "@/components/games/ChecklistRow";
import { type GameRow } from "@/components/competition/CompetitionGamesPanel";
import { FormatPointsPanel } from "@/components/games/FormatPointsPanel";
import type { PointsDistribution } from "@/lib/pointsDistribution";

/**
 * §B setup-shell drill-down rows: the **course pre-step** then **Format · Points**.
 * Course opens the CoursePicker overlay (deferred-split, unchanged); Format·Points
 * is an **in-place accordion panel** (W-EDITMODAL-01 — the old two-tab Edit-Game
 * modal is retired for this row). The game's NAME + assignment moved to the Zone-1
 * identity header and its RULES to the Zone-3 note (both page-level), so this row
 * is just competition-format + points now.
 *
 * Open-state is **optionally controlled by the page** (`courseOpen`/`configOpen`
 * + the open/close callbacks). When the match-setup checklist drives it, the
 * one-panel-at-a-time rule spans EVERY row. Every OTHER consumer (stroke/rack/new/
 * config-view) omits the props and self-manages (the accordion opens/closes
 * locally) — so the conversion fixes the modal leak on all of them without a
 * ripple. `onChanged` refetches the game so the Course row summary updates; the
 * Format·Points panel persists + invalidates itself.
 */
export function GameSetupRows({
  tripId,
  competitionId,
  game,
  canEdit,
  onChanged,
  slot = "both",
  matchCount,
  configLocked = false,
  locked = false,
  courseOpen: courseOpenProp,
  configOpen: configOpenProp,
  onOpenCourse,
  onOpenConfig,
  onCloseEditor,
}: {
  tripId: string;
  /** Null for a standalone game — the Name·Format·Points editor is competition-
   *  scoped, so that row is hidden there (name/format are fixed at creation). */
  competitionId: string | null;
  game: GameRow;
  canEdit: boolean;
  onChanged: () => void;
  /** Which rows to render (W-9HOLE-01 reorder): "course" or "config" lets the
   *  match page place Course BEFORE Handicaps and Format·Points after. Default
   *  "both" — the other surfaces render them together as one block. */
  slot?: "course" | "config" | "both";
  /** Valid (fully-paired) match count, for the per-match "Total points" readout
   *  (W-GAMEPAGE-01 §6.2). Derived live by the page — omit on surfaces that don't
   *  build matches (no Total shown). */
  matchCount?: number;
  /** Lock the Points (config) row until ≥1 valid match exists (readiness rework P3
   *  — points mean nothing before a match). Locked = read-only, no chevron, same as
   *  a gated Handicaps row. Default false (unlocked). */
  configLocked?: boolean;
  /** #512 Option B: the live-scoring lock — render these rows dimmed + lock-icon
   *  (read-only because the game is live). Distinct from `configLocked` (the readiness
   *  gate that holds Points until a match exists). Default false. */
  locked?: boolean;
  /** Page-owned one-open state (controlled). Omit → self-managed (uncontrolled). */
  courseOpen?: boolean;
  configOpen?: boolean;
  /** Tapping a row asks the page to open it (which collapses any other row). */
  onOpenCourse?: () => void;
  onOpenConfig?: () => void;
  /** The editor dismissed itself → clear the page's openRow. */
  onCloseEditor?: () => void;
}) {
  // Controlled when the page supplies open-state; else self-manage (the original
  // behavior, kept for every non-checklist consumer).
  const controlled = courseOpenProp !== undefined || configOpenProp !== undefined;
  const [courseOpenLocal, setCourseOpenLocal] = useState(false);
  const [configOpenLocal, setConfigOpenLocal] = useState(false);
  const courseOpen = controlled ? !!courseOpenProp : courseOpenLocal;
  const configOpen = controlled ? !!configOpenProp : configOpenLocal;
  const openCourse = onOpenCourse ?? (() => setCourseOpenLocal(true));
  const openConfig = onOpenConfig ?? (() => setConfigOpenLocal(true));
  const closeEditor = onCloseEditor ?? (() => { setCourseOpenLocal(false); setConfigOpenLocal(false); });

  // Course resolved = a complete 18 (W-9HOLE-01): a real 18-hole course, or a
  // 9-hole front with a back nine composed in. A lone 9-hole front (schema count
  // 9) is NOT resolved — it "needs a back nine", which keeps Handicaps gated.
  const frontId = game.course_id ?? null;
  const backId = (game.back_course_id as string | null) ?? null;
  const count = ((game.scorecard_schema as { units?: { count?: number } } | null)?.units?.count) ?? 0;
  const courseResolved = !!frontId && count === 18;
  // Preview-scorecard validator (Spec 5a): reachable whenever a course is APPLIED
  // — including a lone 9-hole front (count 9), so the preview can reveal a missing
  // back nine. Distinct from `courseResolved` (the stricter 18-hole handicaps gate).
  const router = useRouter();
  const courseApplied = !!frontId;
  const scorecardHref = gameHref(tripId, game.game_type_id, game.id, { scorecard: true });
  // §5a (P-F0c): the RESOLVED Course title is the course NAME (the subtitle stays the
  // handicaps gate). Lift the two-ID name fetch (front + back) to the collapsed row —
  // CourseRowContent fetches the same names in its expanded body. Gated on
  // slot/resolved so the config-slot instance and no-course games don't fetch.
  // `composedCourseTitle` derives the shared leading base (or the §5a fallback).
  const wantNames = slot !== "config" && courseResolved;
  const frontNameQ = trpc.courses.getById.useQuery({ courseId: frontId ?? "" }, { enabled: wantNames && !!frontId });
  const backNameQ = trpc.courses.getById.useQuery({ courseId: backId ?? "" }, { enabled: wantNames && !!backId });
  const frontName = frontNameQ.data?.name as string | undefined;
  const backName = backNameQ.data?.name as string | undefined;
  const namesReady = !!frontName && (!backId || !!backName);
  const courseTitle = !courseResolved
    ? "No Golf Course"
    : namesReady
      ? composedCourseTitle(backId ? [frontName, backName] : [frontName])
      : "Golf Course Selected"; // pre-load: keep the old title until names arrive
  // Points (§5): the row subtitle is the live "Total Points Available: N" (N teal),
  // derived from per-match × the valid match count. Per-match drives resolved/empty.
  const perMatch = game.points_distribution?.type === "per_match" ? game.points_distribution.value : 0;
  const pointsTotal = (matchCount ?? 0) * perMatch;
  // Match-format games (1v1/2v2/rack) carry the points INLINE (Phase C §7 — a
  // right-justified stepper, no expansion). Placement (stroke/non-golf) keeps the
  // expandable editor (its split needs a body).
  const ptype = GAME_TYPES.find((t) => t.id === game.game_type_id)?.resultStrategy;
  const isMatchPlay = ptype === "match_play" || ptype === "rack_n_stack";

  return (
    <>
      {slot !== "config" && (
        <ChecklistRow
          icon={Flag}
          // §5a Course: the resolved title is the course NAME (single) / shared base
          // (composed) / tap-nudge fallback. The subtitle stays the HANDICAPS GATE —
          // never the course name.
          title={courseTitle}
          subtitle={courseResolved ? "Handicaps enabled" : "Handicaps disabled"}
          state={courseResolved ? "resolved" : "empty"}
          disabled={!canEdit}
          locked={locked}
          expanded={courseOpen}
          onToggle={courseOpen ? closeEditor : openCourse}
          testId="row-course"
        >
          {/* W-9HOLE-01: front picker → a 9-hole course "needs a back nine" → the
              back picker composes a retained two-nines 18, swappable day-of. */}
          <CourseRowContent tripId={tripId} game={game} canEdit={canEdit} onChanged={onChanged} />
        </ChecklistRow>
      )}

      {/* Preview scorecard (Spec 5a) — a course-setup VALIDATOR right under the
          course row: opens the EMPTY scorecard (par/yardage/stroke index, front +
          back) read from PERSISTED state, so the owner can confirm the course is
          set up right. Golf-only; visibly disabled (dimmed, Danger-Zone pattern)
          until a course is applied, consistent with the handicaps-disabled row. */}
      {slot !== "config" && isGolfFormat(game.game_type_id) && scorecardHref && (
        <button
          type="button"
          data-testid="row-preview-scorecard"
          disabled={!courseApplied}
          onClick={() => router.push(scorecardHref)}
          className="flex w-full items-center gap-3 rounded-xl px-3.5 py-3 text-left"
          style={{
            background: "var(--color-bt-card)",
            border: "1px solid var(--color-bt-border)",
            opacity: courseApplied ? undefined : 0.55,
            cursor: courseApplied ? "pointer" : "not-allowed",
          }}
        >
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg" style={{ background: "var(--color-bt-card-raised)" }}>
            <ClipboardList size={16} style={{ color: "var(--color-bt-text)" }} />
          </span>
          <span className="flex min-w-0 flex-col">
            <span style={{ fontSize: 15, color: "var(--color-bt-text)" }}>Preview scorecard</span>
            <span className="truncate" style={{ fontSize: 12, color: "var(--color-bt-text-dim)" }}>
              {courseApplied ? "Check the course setup — par, yardage, stroke index" : "Set a course to preview"}
            </span>
          </span>
          {courseApplied && <ChevronRight size={16} style={{ color: "var(--color-bt-text-dim)", marginLeft: "auto" }} />}
        </button>
      )}
      {slot !== "course" && competitionId && (
        isMatchPlay ? (
          // Points row INLINE (Phase C §7): the row carries a right-justified
          // <Stepper inline> and never opens — exempt from the single-open accordion.
          // The competition-format picker is gone (removed, not re-homed — the Add/Edit
          // modal still sets competition_format). Dashed/empty at 0 (reachable since
          // C1's default-0); resolved + teal check + teal total at >0. The stepper
          // stays live so `+` lifts it out of empty; `−` disabled at 0 (Stepper floor).
          <ChecklistRow
            icon={Hash}
            title="Points Per Match"
            subtitle={
              <>
                Total Points Available:{" "}
                <span style={{ color: pointsReady(perMatch) ? "var(--color-bt-accent)" : "var(--color-bt-text-dim)", fontWeight: 600 }}>{pointsTotal}</span>
              </>
            }
            // Same `pointsReady` truth as the C3 Enable gate — row-resolved ⟺ gate's
            // points term satisfied (they can't disagree).
            state={pointsReady(perMatch) ? "resolved" : "empty"}
            disabled={!canEdit}
            locked={locked}
            testId="row-format-points"
            control={
              <PointsPerMatchControl
                tripId={tripId}
                game={game}
                perMatch={perMatch}
                // P3: locked until ≥1 valid match exists (points mean nothing before
                // a match). Locked → the stepper is disabled (read-only), matching the
                // gated rows. Otherwise live.
                disabled={configLocked || !canEdit}
              />
            }
          />
        ) : (
          // Placement (stroke/non-golf): keep the expandable editor (the split needs
          // a body). Format picker removed from FormatPointsPanel.
          <ChecklistRow
            icon={Hash}
            title="Points"
            subtitle={
              <>
                Total Points Available:{" "}
                <span style={{ color: perMatch > 0 ? "var(--color-bt-accent)" : "var(--color-bt-text-dim)", fontWeight: 600 }}>{pointsTotal}</span>
              </>
            }
            state={perMatch > 0 ? "resolved" : "empty"}
            disabled={!canEdit}
            locked={locked}
            expanded={configOpen}
            onToggle={configLocked ? undefined : configOpen ? closeEditor : openConfig}
            testId="row-format-points"
          >
            <FormatPointsPanel tripId={tripId} game={game} canEdit={canEdit} matchCount={matchCount} />
          </ChecklistRow>
        )
      )}
    </>
  );
}

/**
 * The inline per-match points control (Phase C §7) — a canonical `<Stepper inline>`
 * that persists on each change. Floor is 0 (reachable since Add defaults new games
 * to 0); `−` disable-styles at 0. Writes the total+distribution PAIR atomically
 * (total null for match games — the total is derived = value × matchCount), optimistic
 * on the `getById` cache so the row's subtitle/check/total land instantly, then marks
 * the competition board stale (CLAUDE.md #10 — faceBootstrap refreshes the Live face).
 */
function PointsPerMatchControl({
  tripId, game, perMatch, disabled,
}: {
  tripId: string;
  game: GameRow;
  perMatch: number;
  disabled?: boolean;
}) {
  const gameId = game.id;
  const utils = trpc.useUtils();
  const setTotalM = trpc.games.setPointsTotal.useMutation();
  const setDistM = trpc.games.setPointsDistribution.useMutation();
  // Local value for snappy stepping; re-sync if the persisted value changes elsewhere.
  const [value, setValue] = useState(perMatch);
  useEffect(() => { setValue(perMatch); }, [perMatch]);

  function onChange(v: number) {
    setValue(v);
    const next: PointsDistribution = { type: "per_match", value: v };
    const cur = utils.games.getById.getData({ tripId, gameId });
    if (cur) utils.games.getById.setData({ tripId, gameId }, { ...cur, points_total: null, points_distribution: next } as typeof cur);
    void (async () => {
      try {
        await setTotalM.mutateAsync({ tripId, gameId, total: null });
        await setDistM.mutateAsync({ tripId, gameId, distribution: next });
        utils.games.listByTrip.invalidate({ tripId });
        if (game.competition_id) utils.competitions.faceBootstrap.invalidate({ tripId });
      } catch {
        utils.games.getById.invalidate({ tripId, gameId });
      }
    })();
  }

  return (
    <Stepper
      size="inline"
      value={value}
      min={0}
      onChange={disabled ? () => {} : onChange}
      disabled={disabled}
      testId="points-stepper"
    />
  );
}

