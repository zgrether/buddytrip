import type { SupabaseClient } from "@supabase/supabase-js";
import { TRPCError } from "@trpc/server";
import { splitSideRefusal, sideUnit } from "@/lib/sideUnit";

/**
 * Refuse a match side that spans units, for both writers of pairings —
 * `games.saveConfig` (what the settings page uses) and `matches.setPairings`.
 * `setPairings` used to carry its own inline copy of this and `saveConfig` had
 * none, which is how a split pair could be saved from the app.
 *
 * TEMPORARY, and says so: a side must resolve to one unit until split payouts
 * exist (see `splitSideRefusal`). A standalone game has no units, so nothing to
 * refuse.
 */
export async function refuseSplitSides(
  supabase: SupabaseClient,
  competitionId: string | null,
  sides: readonly (readonly string[])[],
): Promise<void> {
  if (!competitionId) return;
  const pairs = sides.filter((s) => s.length >= 2);
  if (pairs.length === 0) return;

  const { data: assigns, error } = await supabase
    .from("team_assignments")
    .select("user_id, team_id")
    .eq("competition_id", competitionId);
  if (error) {
    throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: `Failed to read the rosters: ${error.message}` });
  }
  const teamOf = new Map<string, string>();
  for (const a of assigns ?? []) teamOf.set(a.user_id as string, a.team_id as string);
  const lookup = (id: string) => teamOf.get(id);
  if (pairs.every((s) => sideUnit(s, lookup) !== null)) return;

  // Only on a refusal: the names, so the sentence says who, not "a pair".
  const ids = [...new Set(pairs.flat())];
  const { data: people } = await supabase.from("users").select("id, name").in("id", ids);
  const nameById = new Map((people ?? []).map((u) => [u.id as string, (u.name as string | null) ?? "A player"]));
  const refusal = splitSideRefusal(pairs, lookup, (id) => nameById.get(id) ?? "A player");
  if (refusal) throw new TRPCError({ code: "BAD_REQUEST", message: refusal });
}
