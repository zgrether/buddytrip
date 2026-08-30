import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * The games the CURRENT user is an EXPLICIT delegate of — the ONE derivation
 * behind the leaderboard's "you're running this" marker (§10, `GameRow`'s
 * `showDelegate`).
 *
 * Deliberately does NOT fold in the Owner's implicit games (any game with no
 * `game_delegates` row at all). An earlier version of this file did — read
 * DelegatePicker's "Null = the owner" as license to self-mark the Owner on
 * every game they hadn't explicitly handed off. Wrong: the marker means "I
 * personally am running this, distinct from the default," and the Owner
 * running a game by default isn't that — it's the ordinary case, and marking
 * it turned "you're running this" into "here's every game," which is the
 * self-only design's opposite. Confirmed with the product owner (see the PR
 * this reverted).
 *
 * The Owner DOES care about games they've handed to someone else — that's a
 * separate, one-directional concern (`games.delegatesByTrip` + the board's
 * "assigned to" chip), not this self-marker.
 *
 * `faceBootstrap` (competitions.ts) and `games.myDelegateGameIds` both need
 * this EXACT computation — the client seeds one query's cache from the
 * other's payload (LiveFaceClient.tsx), so a second, drifting implementation
 * would desync them.
 */
export async function myDelegateGameIds(
  supabase: SupabaseClient,
  userId: string
): Promise<string[]> {
  const { data } = await supabase
    .from("game_delegates")
    .select("game_id")
    .eq("user_id", userId);
  return (data ?? []).map((r) => r.game_id as string);
}
