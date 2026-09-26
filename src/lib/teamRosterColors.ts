/**
 * userId → their competition team's COLOUR, from the roster.
 *
 * Team identity belongs to the PERSON, never to a slot: this is derived from
 * `team_assignments` (via the crew-grouped-by-team sections the settings picker
 * already builds), so moving someone between teams re-colours every avatar on
 * the page with no other write.
 *
 * ── Absence is a real answer, not a gap ─────────────────────────────────────
 *
 * A missing entry means "on no team", which is common and correct in two
 * different situations: a STANDALONE game has no competition and therefore no
 * teams at all, and a member of one that does can sit outside every team in the
 * `__unassigned` "Crew" bucket. Both must fall back to the neutral per-player
 * palette at the call site — a per-player colour is the RIGHT colour for a
 * non-team game, and blanking it would trade one wrong answer for another.
 *
 * The sentinel exclusion is the only rule in here and the only thing that can
 * be got wrong: `__unassigned` is a display bucket the picker mints, not a team,
 * and it carries `var(--color-bt-text-dim)` as its colour. Admitting it would
 * paint every teamless player the same dim grey and call it a team colour.
 *
 * ── Why this is not shared with match play ──────────────────────────────────
 *
 * `MatchGameView` keeps its own resolver. It used to be gated on
 * `teams.length === 2`, on the grounds that a match game could not occur in a
 * three-team competition — true until PR 5 let match play into points races.
 * Its colours now apply in any cup (`inCup`), the same rule as here; what is
 * still two-team there is the side BINDING, which is a Match Play cup's alone.
 * Collapsing the two resolvers is possible now and not done in PR 5.
 */
export interface RosterTeam {
  id: string;
  color: string;
  players: { id: string }[];
}

/** The picker's display bucket for everyone on no team. Not a team. */
export const UNASSIGNED_TEAM_ID = "__unassigned";

export function teamColorByUser(teams: readonly RosterTeam[]): Map<string, string> {
  const m = new Map<string, string>();
  for (const t of teams) {
    if (t.id === UNASSIGNED_TEAM_ID) continue;
    for (const p of t.players) m.set(p.id, t.color);
  }
  return m;
}
