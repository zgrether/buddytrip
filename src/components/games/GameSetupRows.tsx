"use client";

import { useState } from "react";
import { trpc } from "@/lib/trpc-client";
import { CourseRowContent } from "@/components/games/course/CourseRowContent";
import { ChecklistRow } from "@/components/games/ChecklistRow";
import { formatLabel, type GameRow } from "@/components/competition/CompetitionGamesPanel";
import { FormatPointsPanel } from "@/components/games/FormatPointsPanel";

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
  const frontQ = trpc.courses.getById.useQuery({ courseId: frontId ?? "" }, { enabled: !!frontId });
  const backQ = trpc.courses.getById.useQuery({ courseId: backId ?? "" }, { enabled: !!backId });
  const frontName = (frontQ.data?.name as string | undefined) ?? null;
  const backName = (backQ.data?.name as string | undefined) ?? null;
  const courseValue =
    !frontId ? "Add a course"
    : count === 9 ? `${frontName ?? "Front nine"} · needs a back nine`
    : backId ? `${frontName ?? "Front"} + ${backName ?? "Back"}`
    : (frontName ?? "Course");

  return (
    <>
      {slot !== "config" && (
        <ChecklistRow
          label="Course / tee"
          optional
          value={courseValue}
          state={courseResolved ? "resolved" : "unresolved"}
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
        <ChecklistRow
          label="Format · Points"
          value={formatPointsSummary(game)}
          state="resolved"
          disabled={!canEdit}
          expanded={configOpen}
          onToggle={configOpen ? closeEditor : openConfig}
          testId="row-format-points"
        >
          <FormatPointsPanel tripId={tripId} game={game} canEdit={canEdit} />
        </ChecklistRow>
      )}
    </>
  );
}

/** "Head to head · 2/match" — the Format·Points row's loud summary. */
function formatPointsSummary(game: GameRow): string {
  const parts = [formatLabel(game.competition_format ?? null), pointsSummary(game)].filter(Boolean);
  return parts.length > 0 ? parts.join(" · ") : "Set format & points";
}

/** A compact points summary for the config row: "2/match" · "8 pts". */
function pointsSummary(game: GameRow): string | null {
  const d = game.points_distribution;
  if (d?.type === "per_match") return `${d.value}/match`;
  if (d?.type === "placement") {
    const total = game.points_total ?? d.values.reduce((a, b) => a + b, 0);
    return `${total} pts`;
  }
  if (game.points_total != null) return `${game.points_total} pts`;
  return null;
}

