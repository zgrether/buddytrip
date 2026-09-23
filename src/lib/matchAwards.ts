/**
 * The per-match TEAM AWARD — the half of match-play scoring that knows nothing
 * about holes. Client-safe (CLAUDE.md pattern #8): the ONE implementation of
 * the award rule, used by the game-page live projection (client), the board's
 * live projection (`liveProjection.ts`, server), and the persisted write
 * (`src/server/lib/matchAwards.ts`'s `writeTeamMatchPoints`) — same split as
 * `src/lib/matchPlay.ts` / `src/server/lib/matchPlay.ts`.
 *
 * ── Why this is its own module ─────────────────────────────────────────────
 *
 * It lived inside `matchPlay.ts`, which is correct for golf and wrong the moment
 * a second format needs it. Non-golf **Matches** (`competition_format = 'matches'`)
 * declares each match's result outright — there is no hole sequence to derive one
 * from — so it skips the entire first half of that file and reuses only this.
 *
 * Left where it was, every non-golf finalize would `import … from "./matchPlay"`,
 * and the next reader would reasonably conclude that Matches IS match play. It
 * is not: they share an AWARD RULE (win takes the match's value, a draw splits
 * it) and share nothing else. A shared rule belongs in a module named for the
 * rule.
 */

import { awardMatches, type MatchAwardResult } from "./gameAward";

/** A `game_matches.side_a`/`side_b` JSONB ref. A 1v1 side is a user; a 2v2 side
 *  is a minted `play_group` (CLAUDE.md #27 — a side is not a person). */
export interface SideRef {
  type: string;
  id: string;
}

/**
 * Pure: the award rule ITSELF, with no DB in it — win takes the match's value,
 * a draw splits it. `sideTeam` is injected rather than resolved in here
 * because every caller builds it from a different read (a server DB query, a
 * bulk-fetched projection roster, or a client-loaded competition roster) — the
 * resolution differs, the arithmetic must not.
 */
export function tallyMatchAwards(
  matches: { side_a: unknown; side_b: unknown; result?: unknown; point_value?: unknown }[],
  sideTeam: (s: SideRef) => string | undefined,
  evenShareFallback: number
): Record<string, number> {
  return tallyMatchAwardsDetailed(matches, sideTeam, evenShareFallback).byTeam;
}

/**
 * The same tally, keeping the count of matches that paid NOBODY.
 *
 * `tallyMatchAwards` above returns only the per-team map, because that is what
 * its callers write to `game_results` and nothing about a result row can
 * express "this match was unpayable". A surface that has to say why a game's
 * points are not all in play needs the other half, so it calls this.
 */
export function tallyMatchAwardsDetailed(
  matches: { side_a: unknown; side_b: unknown; result?: unknown; point_value?: unknown }[],
  sideTeam: (s: SideRef) => string | undefined,
  evenShareFallback: number
): MatchAwardResult {
  return awardMatches(
    matches.map((m) => {
      const a = m.side_a as SideRef | null;
      const b = m.side_b as SideRef | null;
      const result = m.result as "a_win" | "b_win" | "halve" | null;
      // An UNPAIRED slot is not a match at all — it never scores and it is not a
      // forfeit either, so it is mapped to "nothing decided" rather than to a
      // match with a missing team. That distinction is the reason the outcome
      // and the team ids are separate inputs: one says whether there is anything
      // to pay, the other says whether it can be paid.
      const paired = !!a?.id && !!b?.id;
      return {
        aTeamId: paired ? sideTeam(a!) ?? null : null,
        bTeamId: paired ? sideTeam(b!) ?? null : null,
        // A2b award rule: this match's own override, else the even share.
        value: (m.point_value as number | null) ?? evenShareFallback,
        outcome: !paired || !result ? null : result === "a_win" ? "a" : result === "b_win" ? "b" : "split",
      };
    })
  );
}
