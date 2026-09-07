import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * SCRAMBLE'S GROUPS ARE ITS TEAMS, and there is no setting for them.
 *
 * Every other roster format asks a runner to build playing groups by hand: a
 * stroke round's foursomes are a choice, and a rack game's carts are a choice.
 * Scramble has no such choice to make. The team IS the unit that plays and the
 * unit that scores, so a group builder there would be a control whose only
 * correct answer is the one the competition already knows.
 *
 * So the game arrives with them. This runs inside `games.create`, which is what
 * makes a scramble game READY the moment it exists — its go-live gate (migration
 * 182) is "at least one grouped participant", and without this a runner would
 * face "finish setting up this game" with no setting to finish.
 *
 * ── Deliberately silent, and deliberately not fatal ─────────────────────────
 *
 * A no-op in three cases, none of which is an error:
 *
 *  · not a scramble game — every other format keeps its manual builder;
 *  · no competition — a standalone scramble game has no teams to be, and the
 *    add-game filter does not offer the format outside a points cup anyway;
 *  · no team assignments yet — a cup whose games are added before its people
 *    are. The game is simply not ready until somebody is on a team, which is
 *    true and is what the readiness gate already says.
 *
 * And a failure here does NOT fail the create. A game that exists without its
 * groups is recoverable — the client re-derives them on the next settings save —
 * while a create that throws after the row is written leaves an orphan the
 * caller believes never happened. Same reasoning `broadcast_score_event` uses
 * for never rolling back a write on a notification failure.
 *
 * ── One group per team, named for it ───────────────────────────────────────
 *
 * A team with nobody assigned gets NO group, for the reason
 * `computeStrokeTeamStandings` gives about absent teams: an empty group is a
 * scoring unit that can post a card, and a team that is not playing must not be
 * able to. Teams are read in `created_at` order so the groups come out in the
 * same order the board and the hero show them.
 */
export async function seedScrambleTeamGroups(
  supabase: SupabaseClient,
  gameId: string,
  gameTypeId: string | null | undefined,
  competitionId: string | null
): Promise<void> {
  if (gameTypeId !== "gtt_scramble" || !competitionId) return;

  try {
    /**
     * IDEMPOTENT BY EMPTINESS, and that is what makes a second call site safe.
     *
     * This runs at create AND at go-live, because a cup whose games are added
     * before its people leaves the first call with nothing to do — and with the
     * groupings row hidden, a runner would have no way to fix it. Seeding again
     * when they press the button closes that without any repair path.
     *
     * It acts ONLY when the game has no groups at all: never adds to an existing
     * one, never renames, never deletes. That matters more than it looks.
     * `save_game_config` treats a changed group SET as structure and
     * clean-replaces it, minting fresh ids — which would orphan every
     * `score_entries` row keyed to the old play_group. A seed that only ever
     * fires on an empty game cannot reach that path.
     *
     * It is also why the groups are NOT re-derived from the roster on save: a
     * team roster edited after scoring began would rebuild the groups out from
     * under the scores. Tracking a later roster change is a separate decision
     * with a real hazard behind it, not an increment.
     */
    const { count } = await supabase
      .from("play_groups")
      .select("id", { count: "exact", head: true })
      .eq("game_id", gameId);
    if ((count ?? 0) > 0) return;

    const [teamsRes, assignsRes] = await Promise.all([
      supabase
        .from("teams")
        .select("id, name")
        .eq("competition_id", competitionId)
        .order("created_at", { ascending: true }),
      supabase.from("team_assignments").select("user_id, team_id").eq("competition_id", competitionId),
    ]);

    const teams = (teamsRes.data ?? []) as { id: string; name: string }[];
    const assigns = (assignsRes.data ?? []) as { user_id: string; team_id: string }[];
    if (teams.length === 0 || assigns.length === 0) return;

    const membersOf = new Map<string, string[]>();
    for (const a of assigns) {
      const list = membersOf.get(a.team_id) ?? [];
      // A person assigned twice would produce a duplicate participant row, which
      // `game_participants`' UNIQUE (game_id, user_id) refuses — and that refusal
      // would take the whole seed with it. De-duped here instead.
      if (!list.includes(a.user_id)) list.push(a.user_id);
      membersOf.set(a.team_id, list);
    }

    const groups: { id: string; game_id: string; display_name: string; tee_time: null }[] = [];
    const participants: { id: string; game_id: string; user_id: string; play_group_id: string; team_id: string }[] = [];

    for (const t of teams) {
      const members = membersOf.get(t.id) ?? [];
      if (members.length === 0) continue; // an absent team is not a scoring unit
      const groupId = crypto.randomUUID();
      groups.push({ id: groupId, game_id: gameId, display_name: t.name, tee_time: null });
      for (const userId of members) {
        participants.push({
          id: crypto.randomUUID(),
          game_id: gameId,
          user_id: userId,
          play_group_id: groupId,
          // Carried so the finalize's group → team resolution has it directly,
          // rather than re-deriving through `team_assignments` a second time.
          team_id: t.id,
        });
      }
    }
    if (groups.length === 0) return;

    // Groups BEFORE participants: `game_participants.play_group_id` is a real FK
    // (migration 035), so the parent has to exist first.
    const { error: groupErr } = await supabase.from("play_groups").insert(groups);
    if (groupErr) return;
    await supabase.from("game_participants").insert(participants);
  } catch {
    // See the header: a game without its groups is recoverable, a create that
    // throws after the row is written is not.
  }
}
