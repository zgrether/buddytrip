import type { SupabaseClient } from "@supabase/supabase-js";
import { asksSideGameAtGoLive } from "@/lib/sideGamePrompt";
import { anyGameStarted } from "./gameStarted";
import { countOrThrow, maybeRowOrThrow, rowsOrThrow } from "./rowOrThrow";

/**
 * Is "play it as a side game" an exit THIS caller can take on THIS game, now?
 *
 * The zero-points refusal offers it only then (Zach, the #1668 look). "Can
 * take" means both halves:
 *  - the app SHOWS the way: the go-live prompt appears, which is
 *    `asksSideGameAtGoLive` (a team competition, a side-capable format, nobody
 *    playing on a team) — the one rule the prompt itself reads, so the advice
 *    and the prompt cannot disagree;
 *  - the database ALLOWS it (migration 218): an Owner or Organizer, and no
 *    result yet.
 *
 * `draftPlayerIds` is who the refused save was trying to play (its groups), so
 * the answer is about the draft the person is looking at; null falls back to the
 * game's saved participants.
 *
 * ADVICE ONLY. This chooses a sentence for a refusal that has already happened
 * and writes nothing, so a failed read answers "no" — the plain advice — rather
 * than replacing the refusal with a 500 (CLAUDE.md: a failed read is never data
 * to anything that WRITES; this is the case where it may degrade).
 */
export async function sideGameExitOpen(
  supabase: SupabaseClient,
  p: { tripId: string; gameId: string; isOrganizer: boolean; draftPlayerIds: string[] | null }
): Promise<boolean> {
  if (!p.isOrganizer) return false;
  try {
    const game = maybeRowOrThrow(
      await supabase
        .from("games")
        .select("game_type_id, competition_id, scoring_enabled")
        .eq("id", p.gameId)
        .eq("trip_id", p.tripId)
        .maybeSingle(),
      "game"
    );
    const competitionId = (game?.competition_id as string | null | undefined) ?? null;
    if (!game || !competitionId) return false;
    const teamCount = countOrThrow(
      await supabase.from("teams").select("id", { count: "exact", head: true }).eq("competition_id", competitionId),
      "teams"
    );
    const assignments = rowsOrThrow(
      await supabase.from("team_assignments").select("user_id, team_id").eq("competition_id", competitionId),
      "team_assignments"
    );
    let playerIds = p.draftPlayerIds;
    if (!playerIds) {
      const parts = rowsOrThrow(
        await supabase.from("game_participants").select("user_id").eq("game_id", p.gameId),
        "game_participants"
      );
      playerIds = parts.flatMap((r) => (r.user_id ? [r.user_id as string] : []));
    }
    if (await anyGameStarted(supabase, [p.gameId])) return false;
    const teamOf = new Map(assignments.map((a) => [a.user_id as string, a.team_id as string]));
    return asksSideGameAtGoLive({
      wasLive: !!game.scoring_enabled,
      inCup: true,
      teamCount,
      gameTypeId: game.game_type_id as string | null,
      playerIds,
      teamOf: (id) => teamOf.get(id),
    });
  } catch {
    return false;
  }
}
