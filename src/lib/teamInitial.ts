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

/**
 * Two letters, for a team whose single letter another team in its competition
 * also shows: `short_name`'s first two (its own abbreviation), else the first
 * letters of the name's first two words ("Red Devils" -> RD), else the name's
 * first two letters ("Bravo" -> BR). The same "Team " prefix is dropped first.
 */
export function teamTwoLetters(t: { name: string; shortName?: string | null }): string {
  const short = (t.shortName ?? "").trim();
  if (short.length >= 2) return short.slice(0, 2).toUpperCase();
  const name = t.name.trim().replace(/^team\s+/i, "");
  const words = name.split(/\s+/).filter(Boolean);
  if (words.length >= 2) return (words[0]![0]! + words[1]![0]!).toUpperCase();
  return name.slice(0, 2).toUpperCase() || "?";
}

/**
 * Every team's badge label in ONE competition (Zach, 2026-10-20): its initial,
 * unless another team in the same competition would show the same letter, in
 * which case BOTH (all) of them show two letters. Decided across the whole
 * competition, so a board, a roster and a summary can never label the same team
 * differently because each happened to draw a different subset.
 */
export function teamBadgeLabels(teams: { id: string; name: string; shortName?: string | null }[]): Map<string, string> {
  const single = new Map(teams.map((t) => [t.id, teamInitial(t)]));
  const uses = new Map<string, number>();
  for (const letter of single.values()) uses.set(letter, (uses.get(letter) ?? 0) + 1);
  return new Map(
    teams.map((t) => {
      const letter = single.get(t.id)!;
      return [t.id, (uses.get(letter) ?? 0) > 1 ? teamTwoLetters(t) : letter];
    })
  );
}
