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
  const [users, members] = await Promise.all([
    supabase.from("users").select("id, name").in("id", ids),
    supabase.from("trip_members").select("user_id, nickname").eq("trip_id", tripId).in("user_id", ids),
  ]).then(([u, m]) => [
    rowsOrThrow(u, "players' names") as { id: string; name: string | null }[],
    rowsOrThrow(m, "players' trip names") as { user_id: string; nickname: string | null }[],
  ] as const);
  const nickOf = new Map(members.map((m) => [m.user_id, m.nickname]));
  for (const u of users) out.set(u.id, nickOf.get(u.id) ?? u.name ?? "Someone");
  for (const id of ids) if (!out.has(id)) out.set(id, nickOf.get(id) ?? "Someone");
  return out;
}
