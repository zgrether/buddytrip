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
 * Is this the untouched default — the stub a format switch auto-stages, not
 * a choice the user made? Drives whether leaving Bracket clears the config
 * back to `null` (an auto-stage that was never edited) or keeps it (a real
 * config the user built, which must survive a round trip through another
 * format — see `applyFormat`'s "OUT of a bracket" comment).
 *
 * Pure and pulled out of the view for exactly one reason: this repo has no
 * component-test precedent for `NonGolfGameView.tsx`'s inline logic, and this
 * one predicate is what decided whether "Simple → Bracket → Simple leaves no
 * changes to save" actually holds (feedback) — worth a real test rather than
 * only a browser check.
 */
export function isDefaultBracketConfig(config: BracketConfig | null): boolean {
  return config != null && JSON.stringify(config) === JSON.stringify(DEFAULT_BRACKET_CONFIG);
}

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

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * THE FIELD, PARTNERS AND SEEDING ARE THREE SEPARATE QUESTIONS
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * The pool is still ONE `string[][]` in seed order — nothing about what a
 * bracket WRITES changes here. What changes is that the three questions each get
 * their own operation over it, instead of one group-builder trying to answer all
 * three at once:
 *
 *   1. `applyField`   — who is in. Selection only; no ordering, no pairing.
 *   2. `shufflePairs` — turn the field into pairs, within each cup team.
 *   3. `shufflePool`  — the ORDER (above). Seeding.
 *
 * Reusing the rack GROUP builder for question 1 was the original mistake. A
 * group is a container you fill, so the UI asked people to build matches when
 * they should have been picking who is in — which is why it announced "this
 * group is full (max 4)" after a single pick, and why Seeding then offered to
 * shuffle matches that should not have existed yet.
 *
 * `shufflePairs` and `shufflePool` are deliberately NOT the same function and
 * must not be merged. Pairing decides WHO PARTNERS WHOM inside a team; seeding
 * decides WHAT ORDER the resulting entrants play in. They take different inputs,
 * have different constraints (a partner must share a cup team; a seed order has
 * no such rule) and are run at different times.
 */

/** Everyone currently in the field, in pool order. Members, not entrants — the
 *  field is a set of PEOPLE, and how they are grouped is a later question. */
export function fieldMembers(pool: string[][]): string[] {
  return pool.flat();
}

/**
 * Set the field to exactly `selected`, preserving everything already decided.
 *
 * Removals are surgical: a dropped member leaves any pair they were in, and the
 * partner STAYS in the field as a solo entrant rather than being dropped with
 * them. An entrant emptied by the removal disappears, because an empty seed is
 * an entrant nobody can play.
 *
 * Additions append as solo entrants in `selected` order. They are not paired and
 * not sorted: pairing and ordering are questions 2 and 3, and answering them
 * here is exactly the conflation this module exists to undo.
 *
 * Existing order is preserved throughout, so building the field does not disturb
 * a seed order somebody has already arranged.
 */
export function applyField(pool: string[][], selected: readonly string[]): string[][] {
  const keep = new Set(selected);
  const trimmed = pool.map((e) => e.filter((id) => keep.has(id))).filter((e) => e.length > 0);
  const present = new Set(trimmed.flat());
  const added = selected.filter((id) => !present.has(id)).map((id) => [id]);
  return [...trimmed, ...added];
}

/**
 * Randomly pair each team's members among themselves — question 2.
 *
 * 8 on a team become 4 pairs, 6 become 3. An odd member out is left as a SOLO
 * entrant rather than being dropped or paired across teams: a bracket entrant
 * belongs to exactly one cup team (that is where its points land), so a
 * cross-team pair has no answer to "whose points are these?".
 *
 * This RE-PAIRS the whole field, including people already paired — it is a
 * one-shot action someone pressed, not a rule that preserves prior work. Press
 * it again for a different arrangement.
 *
 * Team-by-team output order, which seeding then rearranges. Deliberately not
 * interleaved here: making this produce a "good" order would be doing question
 * 3's job, and doing it invisibly.
 *
 * Randomness is injected so this stays pure and testable.
 */
export function shufflePairs(
  pool: string[][],
  teams: readonly TeamRoster[],
  { random = Math.random }: { random?: () => number } = {}
): string[][] {
  const members = fieldMembers(pool);
  const teamOfMember = (id: string) => teams.find((t) => t.players.some((p) => p.id === id))?.id ?? "";

  // Bucket by team, preserving field order within a bucket before the shuffle so
  // the result depends only on `random`, never on Map iteration accidents.
  const buckets = new Map<string, string[]>();
  for (const id of members) {
    const key = teamOfMember(id);
    const bucket = buckets.get(key);
    if (bucket) bucket.push(id);
    else buckets.set(key, [id]);
  }

  const out: string[][] = [];
  for (const bucket of buckets.values()) {
    const shuffled = shuffleIds(bucket, random);
    for (let i = 0; i < shuffled.length; i += 2) {
      // The trailing odd member pairs with nobody and stands alone.
      out.push(shuffled.slice(i, i + 2));
    }
  }
  return out;
}

/**
 * Pair two members by hand — the manual half of question 2.
 *
 * `a` keeps its position in the pool and `b`'s old entrant goes, so pairing two
 * people does not reshuffle the seed order around them. Whatever either was part
 * of before is dissolved first, which means pairing someone who is already
 * paired frees their old partner rather than silently making a trio.
 *
 * A no-op if the two are the same person or either is missing.
 */
export function pairMembers(pool: string[][], a: string, b: string): string[][] {
  if (a === b) return pool;
  const members = new Set(fieldMembers(pool));
  if (!members.has(a) || !members.has(b)) return pool;

  const out: string[][] = [];
  for (const entrant of pool) {
    const stripped = entrant.filter((id) => id !== a && id !== b);
    // `a`'s slot becomes the new pair; anyone freed by the strip stays, alone.
    if (entrant.includes(a)) {
      out.push([a, b]);
      for (const freed of stripped) out.push([freed]);
    } else if (entrant.includes(b)) {
      for (const freed of stripped) out.push([freed]);
    } else {
      out.push(entrant);
    }
  }
  return out.filter((e) => e.length > 0);
}

/** Split a pair back into two solo entrants, in place. Anything that isn't a
 *  pair is returned untouched — there is nothing to undo. */
export function unpairEntrant(pool: string[][], index: number): string[][] {
  const target = pool[index];
  if (!target || target.length < 2) return pool;
  return [...pool.slice(0, index), ...target.map((id) => [id]), ...pool.slice(index + 1)];
}

/** Fisher-Yates over ids. Separate from the entrant-level one below because they
 *  shuffle different things — members here, whole entrants there. */
function shuffleIds(items: readonly string[], random: () => number): string[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/**
 * One entrant on ONE line — "Brad & Zach", never stacked.
 *
 * The two-line form the board used came from match play, where it solves a real
 * score-entry constraint: fitting a side's players into a phone-width scoring
 * column. A bracket has no such column — the seed list is full width and the
 * board scrolls horizontally — so the constraint does not transfer and the
 * stacked form just costs a line of height and reads as two competitors.
 */
export function entrantLabel(entrant: readonly string[], nameById: ReadonlyMap<string, string>): string {
  const names = entrant.map((id) => nameById.get(id) ?? "Player");
  return names.length === 0 ? "Empty" : names.join(" & ");
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
