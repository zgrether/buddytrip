import type { BracketConfig } from "@/lib/configDraft";

export type { BracketConfig };

/**
 * What a bracket IS before anyone configures it.
 *
 * `bracket_config` is `NOT NULL DEFAULT '{}'` (migration 112) and `{}` decodes
 * to null (`toBracketConfig`), so a game switched to Bracket has NO config at
 * all until something supplies one. The settings rows need a whole config to
 * render, and the payload only emits `bracketConfig` when the draft carries one
 * — so this is what a format switch stages, not a set of fallbacks spread
 * across the rows. One object, so the rows and the payload cannot disagree
 * about what an unconfigured bracket means.
 *
 * Singles / single-elimination / manual seeding / no consolation is the
 * smallest real bracket: every one of them is the option that assumes least
 * about a field nobody has built yet.
 */
export const DEFAULT_BRACKET_CONFIG: BracketConfig = {
  elimination: "single",
  entrants: "singles",
  seeding: "manual",
  consolation: false,
};

/**
 * The smallest field with a game in it.
 *
 * One entrant has nobody to play: `buildDraw(1)` produces no match, so a
 * one-entrant bracket switched to Scoring would show the crew an empty draw.
 *
 * ── This number lives in three places, and that is not an accident ─────────
 * Here (the go-live gate), in `save_game_config`'s readiness check (migration
 * 117), and inside `bracketPlaceCapacity`, which returns a null ceiling below
 * two entrants because there is no draw to rank yet. The SQL copy cannot import
 * this constant, so the duplication is real and permanent — what a named export
 * buys is that the two TypeScript readers agree and that the SQL has something
 * greppable to point at, rather than a bare `2` in three unrelated files.
 *
 * The client gate is deliberately the SECOND opinion, never the only one: the
 * RPC re-asserts readiness inside the transaction, so a client that is wrong,
 * stale, or bypassed cannot enable scoring on an empty draw.
 */
export const MIN_BRACKET_FIELD = 2;

/**
 * Is this game's field big enough to go live?
 *
 * Answers for EVERY non-golf format, not just brackets — a game that isn't a
 * bracket has no field to be short of, so it is always ready on this axis. That
 * shape keeps the call site a single `&&` rather than a conditional, which is
 * what stops the check being accidentally skipped for the formats it doesn't
 * constrain.
 *
 * `entrants` is the DRAFT pool, so the answer moves as the field is built,
 * matching the server's read of the pool this same Save is about to write.
 */
export function bracketFieldReady(isBracket: boolean, entrants: string[][]): boolean {
  if (!isBracket) return true;
  return entrants.filter((e) => e.length > 0).length >= MIN_BRACKET_FIELD;
}

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
