import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * The games a person is running for a trip — the ONE derivation behind the
 * leaderboard's "you're running this" marker (§10, `GameRow`'s `showDelegate`).
 *
 * ── Why "explicit `game_delegates` rows" is not the whole answer ────────────
 *
 * `DelegatePicker` treats an EMPTY assignment as the trip Owner running the
 * game ("Null = the owner (absence = owner)") and deliberately filters the
 * Owner out of the assignable list — assigning is "hand it to someone ELSE",
 * so an explicit `game_delegates` row for the Owner can never exist. A lookup
 * that only reads `game_delegates` therefore answers "no" for the Owner on
 * every game they haven't explicitly handed off — the common case, since
 * delegation is opt-in per game — and the marker never lights up for them.
 *
 * Same shape as CLAUDE.md's "empty is not unknown": an absent row means
 * "the owner runs it", not "nobody runs it", and the two render identically
 * unless the Owner case is folded in explicitly.
 *
 * `faceBootstrap` (competitions.ts) and `games.myDelegateGameIds` both need
 * this EXACT computation — the client seeds one query's cache from the
 * other's payload (LiveFaceClient.tsx), so a second, drifting implementation
 * would desync them.
 */
export async function myDelegateGameIds(
  supabase: SupabaseClient,
  tripId: string,
  userId: string,
  isOwner: boolean
): Promise<string[]> {
  if (!isOwner) {
    const { data } = await supabase
      .from("game_delegates")
      .select("game_id")
      .eq("user_id", userId);
    return (data ?? []).map((r) => r.game_id as string);
  }

  // The Owner: explicit grants (kept for correctness even though the picker
  // never produces one today) PLUS every game in the trip with no delegate at
  // all — the implicit-owner case.
  const { data } = await supabase
    .from("games")
    .select("id, game_delegates(user_id)")
    .eq("trip_id", tripId);
  return (data ?? [])
    .filter((g) => {
      const delegates = (g.game_delegates as { user_id: string }[] | null) ?? [];
      return delegates.length === 0 || delegates.some((d) => d.user_id === userId);
    })
    .map((g) => g.id as string);
}
