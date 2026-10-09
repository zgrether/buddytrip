import type { SupabaseClient } from "@supabase/supabase-js";
import { rowsOrThrow } from "./rowOrThrow";

/**
 * What a person is called ON A TRIP: their trip nickname, else their account
 * name, else "Someone". The same resolution `tripMembers.list` gives every other
 * name on the board.
 *
 * ONE derivation, shared by every server surface that names a PERSON as a
 * competitor: the side-game winner line and push (`readSideGameWinners`) and,
 * since PR 7, a teamless race's units on the leaderboard. A person must not be
 * called one thing on the standings and another on the winner line beside it.
 *
 * Someone who has LEFT the trip (PR 8d) is named by their departure record —
 * the name the crew saw, snapshotted when they left (`trip_departures`,
 * migration 205). Their membership row, and with it their nickname, is gone,
 * and their account name is no longer readable to the crew through RLS once
 * they share no trip (`users_select`). Without this they read "Someone" on a
 * result they earned. A CURRENT member always wins: someone who left and came
 * back is called what their membership says now.
 *
 * Reads through the `rowOrThrow` family: a failed read throws rather than
 * naming everybody "Someone".
 */
export async function tripDisplayNames(
  supabase: SupabaseClient,
  tripId: string,
  userIds: readonly string[],
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (userIds.length === 0) return out;
  const ids = [...new Set(userIds)];
  const [users, members, departed] = await Promise.all([
    supabase.from("users").select("id, name").in("id", ids),
    supabase.from("trip_members").select("user_id, nickname").eq("trip_id", tripId).in("user_id", ids),
    supabase.from("trip_departures").select("user_id, display_name").eq("trip_id", tripId).in("user_id", ids),
  ]).then(([u, m, d]) => [
    rowsOrThrow(u, "players' names") as { id: string; name: string | null }[],
    rowsOrThrow(m, "players' trip names") as { user_id: string; nickname: string | null }[],
    rowsOrThrow(d, "departed players' names") as { user_id: string; display_name: string }[],
  ] as const);
  const memberIds = new Set(members.map((m) => m.user_id));
  const nickOf = new Map(members.map((m) => [m.user_id, m.nickname]));
  const leftAs = new Map(departed.map((d) => [d.user_id, d.display_name]));
  const accountName = new Map(users.map((u) => [u.id, u.name]));
  for (const id of ids) {
    const name = memberIds.has(id)
      ? nickOf.get(id) ?? accountName.get(id)
      : leftAs.get(id) ?? accountName.get(id);
    out.set(id, name ?? "Someone");
  }
  return out;
}
