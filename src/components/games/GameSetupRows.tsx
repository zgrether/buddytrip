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
 * Open-state is **optionally controlled by the page** (`courseOpen`/`configOpen`
 * + the open/close callbacks). When the match-setup checklist drives it, the
 * one-panel-at-a-time rule spans EVERY row (tapping Course collapses any open
 * accordion row). Every OTHER consumer (stroke/rack/new/config-view) omits the
 * props and gets the original self-managed behavior — so this lift doesn't ripple
 * across them. These two editors stay OVERLAYS this pass (the CoursePicker split +
 * the Game-config modal-shed are tracked follow-ons).
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
        onClick={openCourse}
      />
      {competitionId && (
        <ChecklistRow
          label="Name · Format · Points"
          value={`${game.name ?? "Untitled"}${pointsSummary(game) ? ` · ${pointsSummary(game)}` : ""}`}
          state="resolved"
          disabled={!canEdit}
          onClick={openConfig}
        />
      )}

      {courseOpen && (
        <CoursePicker
          onClose={closeEditor}
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
      )}

      {configOpen && competitionId && (
        <GameSheet
          tripId={tripId}
          competitionId={competitionId}
          game={game}
          types={types}
          canEdit={canEdit}
          onClose={() => {
            closeEditor();
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

