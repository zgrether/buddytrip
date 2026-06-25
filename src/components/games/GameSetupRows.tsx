"use client";

import { useState } from "react";
import { trpc } from "@/lib/trpc-client";
import { CoursePicker } from "@/components/games/course/CoursePicker";
import { ChecklistRow } from "@/components/games/ChecklistRow";
import { GameSheet, type GameRow } from "@/components/competition/CompetitionGamesPanel";
import { GAME_TYPES } from "@/lib/gameTypes";

/**
 * §B setup-shell drill-down rows (Phase 2B.2). The standardized top of every
 * format's setup phase: the **course pre-step** then **Name · Format · Points**,
 * each opening its ALREADY-BUILT editor (CoursePicker / the GameSheet add-edit
 * modal — reuse, never rebuild). The format's own who's-playing + handicaps body
 * renders BELOW this, and "Enable scoring" is the bottom CTA — this component is
 * just the shared hull header. Course is optional and never gates readiness.
 *
 * No checklist, no top-level Save: edits are live (CoursePicker applies on pick;
 * GameSheet persists on its own Save), and `onChanged` refetches the game so the
 * row summaries and the body update in place.
 */
export function GameSetupRows({
  tripId,
  competitionId,
  game,
  canEdit,
  onChanged,
}: {
  tripId: string;
  /** Null for a standalone game — the Name·Format·Points editor is competition-
   *  scoped, so that row is hidden there (name/format are fixed at creation). */
  competitionId: string | null;
  game: GameRow;
  canEdit: boolean;
  onChanged: () => void;
}) {
  const [coursePickerOpen, setCoursePickerOpen] = useState(false);
  const [configOpen, setConfigOpen] = useState(false);

  // Format definitions live in code (W-PERF-01) — no fetch, always available.
  const types = GAME_TYPES;
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
        onClick={() => setCoursePickerOpen(true)}
      />
      {competitionId && (
        <ChecklistRow
          label="Name · Format · Points"
          value={`${game.name ?? "Untitled"}${pointsSummary(game) ? ` · ${pointsSummary(game)}` : ""}`}
          state="resolved"
          disabled={!canEdit}
          onClick={() => setConfigOpen(true)}
        />
      )}

      {coursePickerOpen && (
        <CoursePicker
          onClose={() => setCoursePickerOpen(false)}
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
            setCoursePickerOpen(false);
          }}
        />
      )}

      {configOpen && competitionId && (
        <GameSheet
          tripId={tripId}
          competitionId={competitionId}
          game={game}
          types={types}
          canEdit={canEdit}
          onClose={() => {
            setConfigOpen(false);
            onChanged();
          }}
        />
      )}
    </>
  );
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

