"use client";

import { useMemo } from "react";
import { trpc } from "@/lib/trpc-client";
import { STRUCTURE_QUERY } from "@/lib/queryConfig";
import { buildTeeRows, type RawTee, type TeeRow } from "@/lib/teeRows";

/**
 * useScorecardTeeRows (Spec 5b) — assemble the scorecard's per-tee yardage rows
 * for a game, fetching the course record(s) that carry every tee's yardage.
 *
 * The scorecard grid stays presentational (pattern #7: no tRPC/DB inside it), so
 * the course fetch lives HERE and the built rows go in as a prop. Reads the
 * PERSISTED course library (`courses.getById` by the game's `course_id` /
 * `back_course_id`) — the game snapshot only kept the chosen tee. Returns [] until
 * the course loads or when the game has no course (→ the grid keeps its single
 * snapshot yardage row).
 */
type GameLike = {
  course_id?: string | null;
  back_course_id?: string | null;
  scorecard_schema?: {
    units?: { labels?: string[]; metadata?: { tee?: { name?: string } } };
  } | null;
} | null | undefined;

export function useScorecardTeeRows(tripId: string | undefined, game: GameLike): TeeRow[] {
  const courseId = game?.course_id ?? null;
  const backCourseId = game?.back_course_id ?? null;
  const chosenTeeName = game?.scorecard_schema?.units?.metadata?.tee?.name ?? null;
  const holeCount = game?.scorecard_schema?.units?.labels?.length ?? 18;

  const frontQ = trpc.courses.getById.useQuery(
    { courseId: courseId ?? "" },
    { ...STRUCTURE_QUERY, enabled: !!tripId && !!courseId }
  );
  const backQ = trpc.courses.getById.useQuery(
    { courseId: backCourseId ?? "" },
    { ...STRUCTURE_QUERY, enabled: !!tripId && !!backCourseId }
  );

  const frontTees = (frontQ.data?.tee_sets as RawTee[] | undefined) ?? null;
  const backTees = (backQ.data?.tee_sets as RawTee[] | undefined) ?? null;

  return useMemo(() => {
    if (!frontTees?.length) return [];
    return buildTeeRows({
      chosenTeeName,
      holeCount,
      frontTees,
      // Only a two-nines game has a back course; else undefined → single-course path.
      backTees: backCourseId ? backTees : null,
    });
  }, [frontTees, backTees, backCourseId, chosenTeeName, holeCount]);
}
