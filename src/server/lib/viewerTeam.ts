import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * The viewer's team for a trip — the ONE derivation of "your team".
 *
 * ── Why this is shared and not re-derived ─────────────────────────────────
 *
 * Three surfaces now answer "which team is this person on for this trip": the
 * app-bar avatar colour (`competitions.myTeamColor`), the Cup tab, and team
 * chat — where the answer decides whether a TAB EXISTS and which room's history
 * a person can read. `myTeamColor`'s own comment already warned that an avatar
 * reading a different competition than the Cup tab "would be a silent
 * inconsistency nobody would think to check"; a third copy is how that warning
 * comes true. So the rule lives here and the callers share it.
 *
 * ── The rule, and the guard it rests on ───────────────────────────────────
 *
 * "The trip's competition" is the EARLIEST CREATED one. That is only
 * unambiguous because `competitions.create` refuses a second competition per
 * trip (`src/server/routers/competitions.ts`, the `CONFLICT` branch) — an
 * application guard, not a constraint. The schema allows N per trip and the
 * guard's own comment anticipates a future "seasonal series".
 *
 * TEAM CHAT DEPENDS ON THAT GUARD. With two competitions a person could hold
 * two team assignments in one trip, "your team" would name two rooms, and this
 * function would silently pick one of them — a Team tab showing one team's chat
 * while the Cup tab shows the other. Verified against prod when team chat was
 * built: 4 competitions across 4 distinct trips, 0 trips with two, and 0 people
 * holding assignments in two competitions of the SAME trip (3 hold them across
 * different trips, which is fine and expected).
 *
 * If that guard is ever relaxed, this function is one of the places that has to
 * change — and the Team tab is the surface where getting it wrong is visible to
 * a user rather than merely wrong in a colour.
 */
export interface ViewerTeam {
  teamId: string;
  teamName: string;
  color: string;
  colorDim: string;
  /**
   * When this person joined THIS team, or null for "sees all of its history".
   * The team chat history floor — see migration 172 for why it is not
   * `assigned_at`.
   */
  teamVisibleFrom: string | null;
}

export async function viewerTeamForTrip(
  supabase: SupabaseClient,
  tripId: string,
  userId: string
): Promise<ViewerTeam | null> {
  const { data: comp } = await supabase
    .from("competitions")
    .select("id")
    .eq("trip_id", tripId)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (!comp) return null;

  const { data: assignment } = await supabase
    .from("team_assignments")
    .select("team_id, team_visible_from")
    .eq("competition_id", comp.id as string)
    .eq("user_id", userId)
    .maybeSingle();
  if (!assignment?.team_id) return null;

  const { data: team } = await supabase
    .from("teams")
    .select("id, name, color, color_dim")
    .eq("id", assignment.team_id as string)
    .maybeSingle();
  if (!team) return null;

  return {
    teamId: team.id as string,
    teamName: team.name as string,
    color: team.color as string,
    colorDim: team.color_dim as string,
    teamVisibleFrom: (assignment.team_visible_from as string | null) ?? null,
  };
}
