"use client";

import { useState } from "react";
import { trpc } from "@/lib/trpc-client";
import { CourseSearchPanel } from "@/components/games/course/CourseSearchPanel";
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

  const applyCourse = trpc.games.applyCourse.useMutation();
  const utils = trpc.useUtils();

  const courseQ = trpc.courses.getById.useQuery(
    { courseId: game.course_id ?? "" },
    { enabled: !!game.course_id }
  );
  const courseName = (courseQ.data?.name as string | undefined) ?? null;

  return (
    <>
      <ChecklistRow
        label="Course / tee"
        optional
        value={courseName ?? "Add a course"}
        state={courseName ? "resolved" : "unresolved"}
        disabled={!canEdit}
        expanded={courseOpen}
        onToggle={courseOpen ? closeEditor : openCourse}
        testId="row-course"
      >
        {/* The PICKER, inline (W-COURSESPLIT-01): search/select an existing course
            applies live; "Add course manually" + API results navigate to the heavy
            entry page (/courses/new) and return with the course applied. */}
        <CourseSearchPanel
          tripId={tripId}
          gameId={game.id}
          onApply={({ id, teeName }) => {
            applyCourse.mutate(
              { tripId, gameId: game.id, courseId: id, teeSetName: teeName },
              {
                onSuccess: () => {
                  utils.courses.getById.invalidate({ courseId: id });
                  onChanged();
                },
              }
            );
            closeEditor();
          }}
        />
      </ChecklistRow>
      {competitionId && (
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

