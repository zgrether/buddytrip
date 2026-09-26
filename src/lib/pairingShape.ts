/**
 * The two questions a match game's pairing UI asks about its cup (PR 5), which
 * were one `twoTeams` flag keyed on the team COUNT until PR 5 split them, keyed
 * on the cup TYPE:
 *
 * - `headToHead` — BINDING. In a Match Play cup side A is team 1's and side B is
 *   team 2's, and each picker offers only that team's roster. A points race binds
 *   nothing, even with exactly two teams: any rostered player may play either
 *   side, same-team opponents included (ruling 10). Keyed on the count, a
 *   two-team points race used to turn into a Match Play cup.
 * - `inCup` — IDENTITY. Team colours, a side's team for the projection, and the
 *   roster check apply in ANY competition; a standalone match stays the neutral
 *   per-player flow.
 *
 * `scoringModel` is undefined while the competition loads, which reads as "not
 * head to head" — pickers open only on a tap, after it has loaded.
 */
export function pairingShape(
  inCompetition: boolean,
  scoringModel: string | null | undefined,
  teamCount: number,
): { headToHead: boolean; inCup: boolean } {
  return {
    headToHead: inCompetition && scoringModel === "match_play" && teamCount === 2,
    inCup: inCompetition && teamCount > 0,
  };
}

/**
 * Who a side's picker offers in a competition game (PR 5). In a Match Play cup,
 * the slot's own team — side A team 1's roster, side B team 2's. In a points
 * race, everyone rostered on any team, in team order: nothing binds a side, so
 * team 3's players are as pickable as team 1's.
 *
 * The non-golf Matches builder used to take the first two teams in every cup, so
 * in a three-team race team 3 could never be paired.
 */
export function slotPool(
  headToHead: boolean,
  teamIdsInOrder: readonly string[],
  rosterByTeam: ReadonlyMap<string, readonly string[]>,
  slot: "a" | "b",
): string[] {
  if (headToHead) {
    const team = teamIdsInOrder[slot === "a" ? 0 : 1];
    return team ? [...(rosterByTeam.get(team) ?? [])] : [];
  }
  return teamIdsInOrder.flatMap((id) => rosterByTeam.get(id) ?? []);
}
