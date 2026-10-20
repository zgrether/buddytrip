/**
 * The one letter a team's badge shows (Zach, 2026-10-20: teams are rounded
 * squares with their initial; people are circles).
 *
 * `short_name` first: it is the team's own chosen abbreviation (NOT NULL, at
 * most 4 characters), so "BRV" gives B. Where a caller has only the name, a
 * leading "Team " is dropped first, because seeded teams are named "Team A" /
 * "Team B" and every one of them would otherwise be "T".
 */
export function teamInitial(t: { name: string; shortName?: string | null }): string {
  const short = (t.shortName ?? "").trim();
  if (short) return short[0]!.toUpperCase();
  const name = t.name.trim().replace(/^team\s+/i, "");
  return (name[0] ?? "?").toUpperCase();
}
