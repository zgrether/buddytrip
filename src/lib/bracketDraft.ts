import type { BracketConfig } from "@/lib/configDraft";

export type { BracketConfig };

/** Members per entrant: 1 for individuals, 2 for pairs. Drives the picker's cap. */
export function entrantCap(config: BracketConfig): number {
  return config.entrants === "partners" ? 2 : 1;
}

/** A team roster, as the settings surface already has it. */
interface TeamRoster {
  id: string;
  players: { id: string }[];
}

/** Which team an entrant belongs to — read from its first member, the same rule
 *  the payload uses. Null when the member is on no team. */
function teamOf(entrant: string[], teams: readonly TeamRoster[]): string | null {
  const first = entrant[0];
  return teams.find((t) => t.players.some((p) => p.id === first))?.id ?? null;
}

/**
 * Reorder the pool — the whole of what "random seeding" means here.
 *
 * The draw is a pure function of pool ORDER (`buildDraw` reads the entrant count
 * and assigns seeds by index), so randomising the seeding IS reordering the
 * pool. That keeps the draw derivable from the pool alone, and it makes the
 * behaviour legible: press Shuffle, see the new order, press again if you don't
 * like it. A persisted seeding MODE would do neither — the draw would stop being
 * derivable, and nobody could tell when the rule re-ran.
 *
 * `bracket_config.seeding` therefore records how the order was last produced. It
 * is not a rule the app re-applies.
 *
 * ── avoidTeammates ─────────────────────────────────────────────────────────
 * Same-team entrants meeting in round 1 is the outcome worth avoiding: the cup
 * gets a guaranteed early exit for one of its own pairs, and the crew reads it as
 * the draw being unfair. Dealing ROUND-ROBIN across teams spaces them as far
 * apart as the field allows — consecutive seeds land in different teams wherever
 * the counts permit, and round-1 pairs consecutive seeds only at the ends of the
 * bracket order, so this reduces same-team meetings rather than eliminating them.
 * With an unbalanced field (five from one team, one from another) some are
 * unavoidable, and the function does not pretend otherwise.
 *
 * Empty entrant slots are dropped: an empty seed is an entrant nobody can play,
 * and keeping one would shift every seed below it.
 *
 * Randomness is injected so this stays pure and testable — the default is
 * `Math.random`, which is fine in a click handler but must never be called at
 * module scope or during render.
 */
export function shufflePool(
  pool: string[][],
  teams: readonly TeamRoster[],
  { avoidTeammates, random = Math.random }: { avoidTeammates: boolean; random?: () => number }
): string[][] {
  const entrants = pool.filter((e) => e.length > 0).map((e) => [...e]);
  if (entrants.length < 2) return entrants;

  const shuffled = fisherYates(entrants, random);
  if (!avoidTeammates) return shuffled;

  // Bucket by team, then deal round-robin from the largest remaining bucket, so
  // the team with the most entrants never stacks two in a row while another team
  // still has someone to place.
  const buckets = new Map<string, string[][]>();
  for (const e of shuffled) {
    const key = teamOf(e, teams) ?? "";
    const bucket = buckets.get(key);
    if (bucket) bucket.push(e);
    else buckets.set(key, [e]);
  }

  const out: string[][] = [];
  let lastKey: string | null = null;
  while (out.length < shuffled.length) {
    // Prefer the biggest bucket that isn't the one we just drew from; fall back to
    // the biggest overall when it's the only one left (an unavoidable repeat).
    const candidates = [...buckets.entries()].filter(([, v]) => v.length > 0);
    const pickable = candidates.filter(([k]) => k !== lastKey);
    const from = (pickable.length > 0 ? pickable : candidates).sort((a, b) => b[1].length - a[1].length)[0];
    out.push(from[1].shift()!);
    lastKey = from[0];
  }
  return out;
}

/** In-place-free Fisher-Yates. */
function fisherYates(items: string[][], random: () => number): string[][] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}
