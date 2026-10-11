"use client";

import { playersByTeam, unevenTeams } from "@/lib/recredit";
import type { ScoringType } from "@/lib/stableford";

/**
 * The uneven-teams note in stroke and skins SETUP (#1562; Zach's ruling on
 * #1561: a stroke or skins team total stays a sum — the app warns, it never
 * blocks, because uneven teams are the organizer's call).
 *
 * ONE line: the tag and its consequence — "Uneven teams: Spartans 2,
 * Centurions 1 — the bigger team is at a disadvantage." (Zach's look on #1585).
 * The organizer chose these groups, so how totals add up is not news to them;
 * what the imbalance DOES is the half they can act on (CLAUDE.md, "Copy"). The
 * re-credit sheet and the trade preview keep the full explanation, for a reader
 * who did not set the round up. Both halves come from the same helper
 * (`unevenTeams`), whose direction comes from `rankingDirection` and is never
 * worded here.
 *
 * Counted over the players in the DRAFT groupings, so it moves as the
 * organizer builds the groups, before Save — a round being set up has no
 * finishers yet. Someone on no team counts for none, as the team total leaves
 * them out. Renders nothing for even teams, or for a game outside a cup.
 */
export function UnevenTeamsNote({
  scoring,
  playerIds,
  roster,
  teams,
}: {
  scoring: ScoringType;
  playerIds: Iterable<string>;
  /** user id → team id, the cup's current roster. */
  roster: Readonly<Record<string, string>>;
  teams: readonly { teamId: string; teamName: string }[];
}) {
  const uneven = unevenTeams({ scoring, counts: playersByTeam(playerIds, roster), teams });
  if (!uneven) return null;
  return (
    <p className="mb-3 text-[12px]" style={{ color: "var(--color-bt-warning)" }} data-testid="setup-uneven">
      {`${uneven.tag} — ${uneven.consequence}.`}
    </p>
  );
}
