"use client";

import { playersByTeam, unevenTeams } from "@/lib/recredit";
import type { ScoringType } from "@/lib/stableford";

/**
 * The uneven-teams note in stroke and skins SETUP (#1562; Zach's ruling on
 * #1561: a stroke or skins team total stays a sum — the app warns, it never
 * blocks, because uneven teams are the organizer's call).
 *
 * The same two parts as the re-credit sheet and the trade preview, from the
 * same helper (`unevenTeams`): the tag ("Uneven teams: Spartans 3, Centurions
 * 2", biggest first) and the format's one-sentence explanation, whose
 * direction comes from how the format ranks (`rankingDirection`) and is never
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
    <div className="mt-3" data-testid="setup-uneven">
      <p className="text-[12px] font-semibold" style={{ color: "var(--color-bt-warning)" }} data-testid="setup-uneven-tag">
        {uneven.tag}
      </p>
      <p className="mt-1 text-[12px]" style={{ color: "var(--color-bt-warning)" }} data-testid="setup-uneven-explanation">
        {uneven.explanation}
      </p>
    </div>
  );
}
