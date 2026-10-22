import { TEAM_SCORING, unevenTeamsConsequence } from "./recredit";
import { joinAnd } from "./vocabulary";
import type { ScoringType } from "./stableford";

/**
 * The cup-wide problems the board's Needs attention card lists (Zach's rulings,
 * 2026-10-21). A game's own problems are its setup reasons (`gameSetupReasons`)
 * and show on its row; these belong to no one game.
 *
 * Only a cup WITH teams has any: in a teamless tournament nobody can be off a
 * team, no team can be empty and none can be uneven. All three are advisory
 * (muted on the card); none blocks anything.
 *
 *  - Not on a team: people PLAYING in one of this cup's unfinished games who are
 *    on none of its teams (ruling 4: not everyone on the trip, and no dismiss
 *    state). Their results will count for no team.
 *  - Empty teams: a team with nobody on it.
 *  - Uneven teams: roster sizes differ AND the cup has an unfinished game whose
 *    team total adds up its players' scores (`TEAM_SCORING`), the only place a
 *    size difference changes a result (ruling 2). Not shown beside an empty team,
 *    which is the same fact said more strongly.
 *
 * Pure: the leaderboard reads the rows and passes them in. Ids stay on the
 * server; what leaves is names and counts.
 */

export interface NeedsAttentionInput {
  teams: ReadonlyArray<{ id: string; name: string; color: string }>;
  /** Players on each team's roster. */
  teamSizes: ReadonlyMap<string, number>;
  /** Everyone on any of the cup's teams. */
  teamed: ReadonlySet<string>;
  /** The cup's games, in board order, with who is playing in each. */
  games: ReadonlyArray<{ name: string; status: string; gameTypeId: string | null; config: unknown; playerIds: readonly string[] }>;
  /** The name the crew knows a person by. */
  nameOf: (userId: string) => string;
}

export interface NeedsAttention {
  /** People in an unfinished game on no team, and the games they are in. */
  offTeam: { names: string[]; games: string[] } | null;
  emptyTeams: { id: string; name: string; color: string }[];
  /** Each team's roster size, in team order, and the scoring types of the
   *  unfinished games where a difference counts. */
  uneven: { teams: { id: string; name: string; color: string; size: number }[]; scorings: ScoringType[] } | null;
}

export const NOTHING_NEEDS_ATTENTION: NeedsAttention = { offTeam: null, emptyTeams: [], uneven: null };

export function needsAttention(input: NeedsAttentionInput): NeedsAttention {
  if (input.teams.length === 0) return NOTHING_NEEDS_ATTENTION;
  const unfinished = input.games.filter((g) => g.status !== "complete");

  const offIds: string[] = [];
  const offGames: string[] = [];
  for (const g of unfinished) {
    const off = [...new Set(g.playerIds)].filter((id) => !input.teamed.has(id));
    if (off.length === 0) continue;
    offGames.push(g.name);
    for (const id of off) if (!offIds.includes(id)) offIds.push(id);
  }

  const emptyTeams = input.teams.filter((t) => (input.teamSizes.get(t.id) ?? 0) === 0).map((t) => ({ ...t }));

  const scorings = [
    ...new Set(
      unfinished.flatMap((g) => {
        const scoringOf = g.gameTypeId ? TEAM_SCORING[g.gameTypeId] : undefined;
        return scoringOf ? [scoringOf(g.config)] : [];
      })
    ),
  ];
  const sizes = input.teams.map((t) => ({ ...t, size: input.teamSizes.get(t.id) ?? 0 }));
  const uneven =
    emptyTeams.length === 0 && sizes.length >= 2 && scorings.length > 0 && sizes.some((t) => t.size !== sizes[0].size)
      ? { teams: sizes, scorings }
      : null;

  return {
    offTeam: offIds.length > 0 ? { names: offIds.map(input.nameOf), games: offGames } : null,
    emptyTeams,
    uneven,
  };
}

/** How many rows the card shows; zero hides it. */
export function needsAttentionCount(n: NeedsAttention): number {
  return (n.offTeam ? 1 : 0) + n.emptyTeams.length + (n.uneven ? 1 : 0);
}

/**
 * Why uneven teams matter here, from the games where it counts: "Stroke play
 * totals add up, so the bigger team is at a disadvantage." The direction is
 * `unevenTeamsConsequence`'s, the one place it is worded. When the cup's summed
 * games point opposite ways (stroke play against skins), one sentence cannot
 * say which team is hurt, so it says that size changes the result.
 */
export function unevenTeamsWhy(scorings: readonly ScoringType[]): string {
  const formats = [...new Set(scorings.map((s) => (s === "skins" ? "Skins" : s === "stableford" ? "Stableford" : "Stroke play")))];
  const consequences = [...new Set(scorings.map(unevenTeamsConsequence))];
  if (consequences.length !== 1) return "Team totals add up, so team size changes the result";
  const lead = joinAnd(formats);
  return `${lead} totals add up, so ${consequences[0]}`;
}
