"use client";

import { useEffect, useState } from "react";
import { Flag, Hash } from "lucide-react";
import { trpc } from "@/lib/trpc-client";
import { GAME_TYPES } from "@/lib/gameTypes";
import { Stepper } from "@/components/games/Stepper";
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
  // §5 Course subtitle reports the handicaps GATE, not the course name (the name
  // lives in the expanded CourseRowContent), so we no longer fetch front/back names
  // here — only whether the course resolves to a complete 18.
  const frontId = game.course_id ?? null;
  const count = ((game.scorecard_schema as { units?: { count?: number } } | null)?.units?.count) ?? 0;
  const courseResolved = !!frontId && count === 18;
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
          // §5 Course: the title flips on confirm; the subtitle reports the
          // HANDICAPS GATE (course gates handicaps), not the course name — the name
          // lives in the expanded editor (CourseRowContent).
          title={courseResolved ? "Golf Course Selected" : "No Golf Course"}
          subtitle={courseResolved ? "Handicaps enabled" : "Handicaps disabled"}
          state={courseResolved ? "resolved" : "empty"}
          disabled={!canEdit}
          expanded={courseOpen}
          onToggle={courseOpen ? closeEditor : openCourse}
          testId="row-course"
        >
          {/* W-9HOLE-01: front picker → a 9-hole course "needs a back nine" → the
              back picker composes a retained two-nines 18, swappable day-of. */}
          <CourseRowContent tripId={tripId} game={game} canEdit={canEdit} onChanged={onChanged} />
        </ChecklistRow>
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
                <span style={{ color: perMatch > 0 ? "var(--color-bt-accent)" : "var(--color-bt-text-dim)", fontWeight: 600 }}>{pointsTotal}</span>
              </>
            }
            state={perMatch > 0 ? "resolved" : "empty"}
            disabled={!canEdit}
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

