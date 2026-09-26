/**
 * Which unit a match SIDE is paid as — the one answer, for the finalize, the
 * board's projection and both game pages (PR 5).
 *
 * A side is the thing that gets paid (ruling 7): win takes the match's value, a
 * halve splits it. So a side must resolve to exactly ONE unit. A 1v1 side is one
 * person, and resolves to their team. A 2v2 side resolves to its members' team
 * only when every member is on that same team.
 *
 * ── Why this replaced four copies ─────────────────────────────────────────
 *
 * The server finalize (`matchAwards.ts`), the board projection
 * (`liveProjection.ts`) and the two game pages each resolved a pair's team
 * their own way: the first participant row that had a team (rows unordered), or
 * the first member. In a Match Play cup that never mattered — the pickers bind
 * each side to one team, and migration 193 keeps everyone rostered. In a points
 * race (PR 5) a pair CAN span two teams, and those copies then paid an arbitrary
 * team, and could pay a different one from the one the game page showed.
 *
 * A side spanning units is now refused at write time (`splitSideRefusal`), so on
 * any data the app writes, every copy would agree. This resolver still answers
 * `null` for a split side rather than picking one, so a side that predates the
 * refusal is unpayable everywhere at once, not paid differently in two places.
 */
export function sideUnit(
  memberIds: readonly string[],
  teamOf: (userId: string) => string | null | undefined,
): string | null {
  if (memberIds.length === 0) return null;
  let unit: string | null = null;
  for (const id of memberIds) {
    const team = teamOf(id) ?? null;
    if (team === null) return null; // an unteamed member is its own unit — not this one
    if (unit === null) unit = team;
    else if (unit !== team) return null;
  }
  return unit;
}

/**
 * play_group → its unit, from participant rows (`user_id`, `play_group_id`) —
 * the shape the server reads and the game pages already hold.
 */
export function playGroupUnits(
  rows: Iterable<{ user_id: string; play_group_id: string | null }>,
  teamOf: (userId: string) => string | null | undefined,
): Map<string, string | null> {
  const members = new Map<string, string[]>();
  for (const r of rows) {
    if (!r.play_group_id) continue;
    const list = members.get(r.play_group_id) ?? [];
    list.push(r.user_id);
    members.set(r.play_group_id, list);
  }
  const out = new Map<string, string | null>();
  for (const [pg, ids] of members) out.set(pg, sideUnit(ids, teamOf));
  return out;
}

/**
 * The structural rule, and it is TEMPORARY: **a side must resolve to one unit
 * until split payouts exist.**
 *
 * A side spanning two units has nobody to pay under today's award rule, so it is
 * refused rather than saved to pay an arbitrary team. That covers a pair from two
 * teams and a pair with an unteamed member (who would be a unit of their own).
 *
 * What lifts it: SPLIT PAYOUTS — a side's winnings divided among the units it
 * contains. Two uses are waiting on that one mechanism (TRACKER.md, "Split
 * payouts"): a format where cross-team partners win and their teams split the
 * points, and a 2v2 in a teamless race (PR 7), where every person is their own
 * unit and so every pair spans two. When it lands, this refusal goes, and
 * `sideUnit` returns a split instead of null.
 *
 * NOT ruling 10. That rule is about who plays whom — same-team OPPONENTS are
 * allowed and pay that team. This is about the side that gets paid.
 *
 * Returns the refusal sentence for the first split side, or null. One-player
 * sides never refuse: a single player is always one unit, and whether an
 * unteamed player may play in a teamed race is picker policy, not structure.
 */
export function splitSideRefusal(
  sides: readonly (readonly string[])[],
  teamOf: (userId: string) => string | null | undefined,
  nameOf: (userId: string) => string,
): string | null {
  for (const members of sides) {
    if (members.length < 2) continue;
    if (sideUnit(members, teamOf) !== null) continue;
    const names = members.map(nameOf).join(" and ");
    return `${names} aren't on the same team. Until split payouts are supported, each side of a match has to be one team's players — pair teammates, or play them as singles.`;
  }
  return null;
}
