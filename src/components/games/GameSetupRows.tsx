"use client";

import { useEffect, useRef, useState } from "react";
import { Flag, Hash } from "lucide-react";
import { trpc } from "@/lib/trpc-client";
import { GAME_TYPES } from "@/lib/gameTypes";
import { Stepper } from "@/components/games/Stepper";
import { pointsReady } from "@/lib/matchDraft";
import { composedCourseTitle } from "@/lib/courseProvenance";
import { CourseRowContent } from "@/components/games/course/CourseRowContent";
import { ChecklistRow } from "@/components/games/ChecklistRow";
import { type GameRow } from "@/components/competition/CompetitionGamesPanel";
import { FormatPointsPanel } from "@/components/games/FormatPointsPanel";
import { evenShare, type PointsDistribution } from "@/lib/pointsDistribution";

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
  defaultTotal,
  pointsTitle,
  configLocked = false,
  locked = false,
  courseOpen: courseOpenProp,
  configOpen: configOpenProp,
  onOpenCourse,
  onOpenConfig,
  onCloseEditor,
  onApplyFront,
  onApplyBack,
  onRemoveBackNine,
  onClearCourse,
  courseBusy,
  outcomeMode = false,
  rackPoints,
  placementPoints,
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
  /** Total-points migration: the first-setup default for the owner-set
   *  `points_total` (players per team) — written once via a reconcile effect when
   *  the row first sees a slot count > 0 and no total yet. Omit where the row
   *  doesn't offer Total Points (the placement/stroke branch ignores it). */
  defaultTotal?: number;
  /** The per-unit noun for the derived subtitle ("Points per Slot" for rack — a
   *  rack slot isn't obviously a "match"). The underlying `per_match` /
   *  `points_distribution.value` field is UNCHANGED — label only. Defaults to
   *  "Points per match". (This row's TITLE is now always "Total Points" — the
   *  owner sets the total, this label describes the DERIVED per-unit readout.) */
  pointsTitle?: string;
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
  /** Course ACTION controlled-mode (draft-then-save) — a DIFFERENT axis from the
   *  `courseOpen`/`configOpen` open-state control above. Passing `onApplyFront` flips
   *  `CourseRowContent` out of self-persisting mode: it then reports the action and
   *  the page decides what it means (staging it in the settings draft, pre-computing
   *  the snapshot with the shared `buildCourseSnapshot`). Omit them all and the body
   *  keeps its own applyCourse/setBackNine/clearCourse mutations, which is what every
   *  other consumer (stroke/rack/config-view) still wants.
   *
   *  Pass them TOGETHER or not at all: `onApplyFront` alone flips the mode and the
   *  remaining actions would silently no-op. */
  onApplyFront?: (courseId: string, teeName?: string) => void;
  onApplyBack?: (backCourseId: string, backTeeName?: string) => void;
  onRemoveBackNine?: () => void;
  onClearCourse?: () => void;
  /** Controlled mode: the page's course write is in flight (drives the tee chooser). */
  courseBusy?: boolean;
  /** §3.3: outcome-mode match play taps the winner per hole and NEVER reads a
   *  handicap — so the Course row's "Handicaps enabled" subtitle would be a lie. When
   *  true, the subtitle drops the handicaps claim. Default false (score modes gate on
   *  the course's stroke-index table, so the handicaps subtitle is honest there). */
  outcomeMode?: boolean;
  /** The rack Total-Points draft slice — present on the RACK path only; the stepper
   *  reports the total to the page's rack draft (never self-persists; #626). */
  rackPoints?: { value: number | null; onChange: (total: number) => void };
  /** The stroke PLACEMENT points draft slice — present on the STROKE path only; the
   *  FormatPointsPanel reports the total+distribution PAIR to the page's draft. */
  placementPoints?: {
    value: { total: number | null; distribution: PointsDistribution | null };
    onChange: (total: number | null, distribution: PointsDistribution | null) => void;
  };
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
  // Placement (stroke/non-golf) points — UNCHANGED: "Total Points Available" = a
  // directly-typed per-unit value × matchCount. The total-points inversion below is
  // rack-specific (match play moved to MatchPointsRow in A2b); placement never
  // inverts (its owner-set total is Stage-3 distribution-driven, a different model).
  const rawPerMatch = game.points_distribution?.type === "per_match" ? game.points_distribution.value : 0;
  const placementPointsTotal = (matchCount ?? 0) * rawPerMatch;
  const ptype = GAME_TYPES.find((t) => t.id === game.game_type_id)?.resultStrategy;
  // Rack is the ONLY remaining consumer of the inline Total-Points row — match play
  // was carved out to MatchPointsRow (A2b). Placement (stroke/non-golf) keeps the
  // expandable editor below (its split needs a body).
  const isRackLike = ptype === "rack_n_stack";

  // Total-points migration (rack) — reuses A2b's storage trio, minus overrides:
  // the owner sets a TOTAL (`points_total`); the per-slot value DERIVES = total ÷
  // slot count (`matchCount`, this game's added-participant count) via the shared
  // `evenShare` (empty overrides array → plain division) and persists to the
  // UNCHANGED `points_distribution.value` field every downstream reader (award,
  // live projection, the rack game page's own per-slot memo) already reads.
  const slotCount = matchCount ?? 0;
  const persistedTotal = (game.points_total as number | null) ?? null;
  const effectiveTotal = persistedTotal ?? defaultTotal ?? 0;
  const derivedPerSlot = evenShare(effectiveTotal, [], slotCount);

  return (
    <>
      {slot !== "config" && (
        <ChecklistRow
          icon={Flag}
          // §5a Course: the resolved title is the course NAME (single) / shared base
          // (composed) / tap-nudge fallback. The subtitle is the HANDICAPS GATE —
          // never the course name — EXCEPT in outcome mode (§3.3), where handicaps are
          // never read, so it describes the course state without the false claim.
          title={courseTitle}
          subtitle={
            outcomeMode
              ? courseResolved ? "Course set" : "No course"
              : courseResolved ? "Handicaps enabled" : "Handicaps disabled"
          }
          state={courseResolved ? "resolved" : "empty"}
          disabled={!canEdit}
          locked={locked}
          expanded={courseOpen}
          onToggle={courseOpen ? closeEditor : openCourse}
          testId="row-course"
        >
          {/* W-9HOLE-01: front picker → a 9-hole course "needs a back nine" → the
              back picker composes a retained two-nines 18, swappable day-of.
              The course-action props pass STRAIGHT through: undefined for every
              self-persisting consumer (so the body keeps its own mutations), and the
              full set for the draft-then-save settings page. */}
          <CourseRowContent
            tripId={tripId}
            game={game}
            canEdit={canEdit}
            onChanged={onChanged}
            onApplyFront={onApplyFront}
            onApplyBack={onApplyBack}
            onRemoveBackNine={onRemoveBackNine}
            onClearCourse={onClearCourse}
            busy={courseBusy}
          />
        </ChecklistRow>
      )}

      {slot !== "course" && competitionId && (
        isRackLike ? (
          // Total Points row (rack, A2b's inverted pattern): the row carries a
          // right-justified <Stepper inline> on the TOTAL and never opens — exempt
          // from the single-open accordion. No override panel (rack has no per-slot
          // overrides — DO-NOT list) — this stays a single inline row, unlike match
          // play's expandable MatchPointsRow.
          <ChecklistRow
            icon={Hash}
            title="Total Points"
            subtitle={
              slotCount > 0 ? (
                <>
                  {pointsTitle ?? "Points per match"}:{" "}
                  <span
                    style={{
                      color: pointsReady(derivedPerSlot) ? "var(--color-bt-accent)" : "var(--color-bt-text-dim)",
                      fontWeight: 600,
                    }}
                  >
                    {/* Never auto-rounded — a non-whole share is shown exactly (2 decimals),
                        same teal treatment as any other resolved value (no amber/warning:
                        the math downstream is exact; see evenShare's doc). */}
                    {Number.isInteger(derivedPerSlot) ? derivedPerSlot : derivedPerSlot.toFixed(2)}
                  </span>
                </>
              ) : (
                // Pre-match: nothing to distribute across yet (W3-Rack4).
                <span style={{ color: "var(--color-bt-text-dim)" }}>Add a group first — points split across the rack&rsquo;s slots.</span>
              )
            }
            // Same `pointsReady` truth as the C3 Enable gate — row-resolved ⟺ gate's
            // points term satisfied (they can't disagree). Never resolved before a slot.
            state={slotCount > 0 && pointsReady(derivedPerSlot) ? "resolved" : "empty"}
            disabled={!canEdit}
            locked={locked}
            testId="row-format-points"
            // The total-points control (dropdown/stepper) only renders once at least
            // one match/slot exists — there's nothing to distribute across otherwise
            // (W3-Rack4). Before that the row is a plain pre-match prompt.
            control={
              slotCount > 0 && rackPoints ? (
                <RackTotalPointsControl
                  slotCount={slotCount}
                  defaultTotal={defaultTotal ?? 0}
                  // P3: locked until ≥1 valid match exists (points mean nothing before
                  // a match). Locked → the stepper is disabled (read-only), matching the
                  // gated rows. Otherwise live.
                  disabled={configLocked || !canEdit}
                  controlled={rackPoints}
                />
              ) : undefined
            }
          />
        ) : (
          // Placement (stroke/non-golf): keep the expandable editor (the split needs
          // a body). Format picker removed from FormatPointsPanel.
          <ChecklistRow
            icon={Hash}
            title="Total Points"
            subtitle={
              <>
                Total Points Available:{" "}
                <span style={{ color: rawPerMatch > 0 ? "var(--color-bt-accent)" : "var(--color-bt-text-dim)", fontWeight: 600 }}>{placementPointsTotal}</span>
              </>
            }
            state={rawPerMatch > 0 ? "resolved" : "empty"}
            disabled={!canEdit}
            locked={locked}
            expanded={configOpen}
            onToggle={configLocked ? undefined : configOpen ? closeEditor : openConfig}
            testId="row-format-points"
          >
            {placementPoints && <FormatPointsPanel game={game} canEdit={canEdit} matchCount={matchCount} controlled={placementPoints} />}
          </ChecklistRow>
        )
      )}
    </>
  );
}

/**
 * RackTotalPointsControl — the total-points migration's inline stepper for rack
 * (the ONLY remaining consumer of this inline-row shape; match play moved to
 * `MatchPointsRow` in A2b). The owner steps the TOTAL; the per-slot value DERIVES =
 * total ÷ slot count (`evenShare` with no overrides), computed at Save time by
 * `rackDraftToPayload` and written to the UNCHANGED `points_distribution.value` so
 * every downstream reader (award, live projection, the rack game page's own per-slot
 * memo) is untouched. Draft-then-save only (#626): the stepper reports the total to
 * the page's rack draft and never self-persists; it seeds the first-setup default
 * (players per team) into the draft ONCE.
 */
function RackTotalPointsControl({
  slotCount, defaultTotal, disabled, controlled,
}: {
  slotCount: number;
  defaultTotal: number;
  disabled?: boolean;
  /** The rack total-points draft slice (#626 — the only mode now): reports the TOTAL
   *  via `onChange` (the per-slot share is derived at Save time in `rackDraftToPayload`).
   *  Seeds off `value`; the first-setup default (players ÷ teams) is folded into the
   *  draft ONCE. */
  controlled: { value: number | null; onChange: (total: number) => void };
}) {
  const effectiveTotal = controlled.value ?? defaultTotal;

  // Seed the first-setup default into the draft ONCE (when unset + slots exist).
  const didSeed = useRef(false);
  useEffect(() => {
    if (disabled || slotCount === 0) return;
    if (controlled.value == null && defaultTotal > 0 && !didSeed.current) {
      didSeed.current = true;
      controlled.onChange(defaultTotal);
    }
    // React to the DATA inputs; onChange is a stable-enough parent setter.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [controlled.value, defaultTotal, slotCount, disabled]);

  // Local total for snappy stepping; re-sync when the draft value changes underneath —
  // render-phase adjust-on-prop-change (no effect; avoids the cascading-render lint trip
  // a plain useEffect sync hit in A2b).
  const [value, setValue] = useState(effectiveTotal);
  const [lastEffectiveTotal, setLastEffectiveTotal] = useState(effectiveTotal);
  if (effectiveTotal !== lastEffectiveTotal) {
    setLastEffectiveTotal(effectiveTotal);
    setValue(effectiveTotal);
  }

  function onChange(v: number) {
    setValue(v);
    // Report the total up; Save derives + persists the per-slot share.
    controlled.onChange(v);
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

