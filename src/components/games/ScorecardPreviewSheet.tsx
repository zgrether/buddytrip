"use client";

import { useMemo } from "react";
import { trpc } from "@/lib/trpc-client";
import { STRUCTURE_QUERY } from "@/lib/queryConfig";
import { StandardGrid } from "@/components/games/StandardGrid";
import { ScorecardSheet } from "@/components/games/ScorecardSheet";
import { unitsFromSchema, teeFromSchema } from "@/lib/strokePlayConfig";
import { useScorecardTeeRows } from "@/hooks/useScorecardTeeRows";
import { gloriousConfig } from "@/lib/gloriousHoles";
import type { ModifiersMap } from "@/lib/modifiers";

/**
 * ScorecardPreviewSheet — the leaderboard's scorecard, as a Sheet overlay over the
 * board. It shows the game's PERSISTED course structure (par / yardage / stroke
 * index, front + back) with NO scores — the same empty course-setup preview the
 * standalone `/games/scorecard` route renders (Spec 5a), just floated over the
 * board instead of being a full page. Reads `games.getById` (the snapshotted
 * `scorecard_schema`, the source of truth); format-agnostic (only needs the
 * schema). Dismiss returns to the board.
 */
export function ScorecardPreviewSheet({
  tripId,
  gameId,
  onClose,
}: {
  tripId: string;
  gameId: string;
  onClose: () => void;
}) {
  const gameQ = trpc.games.getById.useQuery(
    { tripId, gameId },
    { ...STRUCTURE_QUERY },
  );

  const schema = gameQ.data?.scorecard_schema as Parameters<typeof unitsFromSchema>[0];
  const units = useMemo(() => unitsFromSchema(schema), [schema]);
  const tee = useMemo(
    () => teeFromSchema(schema as Parameters<typeof teeFromSchema>[0]),
    [schema],
  );
  const { rows: teeRows } = useScorecardTeeRows(tripId, gameQ.data);
  const name = (gameQ.data?.name as string | undefined) ?? undefined;
  const hasCourse = !!(gameQ.data as { course_id?: string | null } | undefined)?.course_id;
  // Glorious visibility keys off config + format ONLY — zero participants (this
  // preview never has any) is NOT a suppression condition (§1). A configured
  // glorious game shows the treatment here exactly as it does in-game.
  const glorious = gloriousConfig(
    (gameQ.data as { game_type_id?: string | null } | undefined)?.game_type_id,
    (gameQ.data as { modifiers?: ModifiersMap | null } | undefined)?.modifiers
  );

  return (
    <ScorecardSheet title="Scorecard" subtitle={name} onClose={onClose}>
      {gameQ.isLoading ? (
        <div className="flex items-center justify-center p-10">
          <div
            className="h-7 w-7 animate-spin rounded-full border-2"
            style={{ borderColor: "var(--color-bt-accent)", borderTopColor: "transparent" }}
          />
        </div>
      ) : hasCourse && units.length > 0 ? (
        <StandardGrid units={units} tee={tee} participants={[]} values={{}} direction="low_wins" teeRows={teeRows} glorious={glorious} />
      ) : (
        <p className="px-6 py-10 text-center text-sm" style={{ color: "var(--color-bt-text-dim)" }}>
          No course set for this game yet — apply a course in game settings to preview its scorecard.
        </p>
      )}
    </ScorecardSheet>
  );
}
