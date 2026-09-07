/**
 * Skins — the carryover fold, and the ranking over what it pays out.
 *
 * Pure + client-safe (CLAUDE.md #8): the entry screen, the board and the
 * persisted final all run these same functions, so they cannot diverge.
 *
 * ── The mechanic ───────────────────────────────────────────────────────────
 *
 * A hole is won outright by one player, or it is tied. A hole's OWN VALUE comes
 * from `holeWeight` — 1 normally, 2 on a Glorious Finishing Hole. When a hole is
 * tied its whole pot carries into the next one, so with GFH = 3:
 *
 *     15 tied  ->  16 holds 1 + 2 = 3
 *     16 tied  ->  17 holds 2 + 2 = 4
 *     17 tied  ->  18 holds 2 + 4 = 6
 *
 * The pot carries WHOLE. That is the sentence the arithmetic hangs off, and it
 * is the one an implementation gets wrong: carrying a flat 1 per tied hole gives
 * 3 and 4 for the second and third lines above, which is self-consistent,
 * plausible, and not this game.
 *
 * ── THE ENGINE THAT LOOKS REUSABLE AND IS NOT ─────────────────────────────
 *
 * `src/lib/sideBets.ts` has a `skins` bet kind, with carryover, N-way
 * winner-or-tie resolution, and a per-hole pot. None of it fits, and it is worth
 * saying why here rather than leaving the next reader to rediscover it:
 *
 *   · its carry is a COUNT of tied holes — `pot = amount * (1 + carried)` — so
 *     every hole is worth the same base and a weighted hole cannot enter the
 *     expression at all. Correct for a uniform-stake money bet; wrong here.
 *   · `resolveHole` / `sideValueAt` DERIVE a winner from net strokes (or from a
 *     two-sided match outcome). This format RECORDS one, because players pick up
 *     and there is frequently no score to derive from.
 *
 * The N-way tie/winner SHAPE is proven over there, which is a real de-risk. The
 * code is not reusable.
 *
 * ── Not match play ────────────────────────────────────────────────────────
 *
 * Structurally similar — an outcome per hole, a tie carrying instead of halving
 * — and deliberately sharing no vocabulary with it. `matchState` is a two-sided
 * A/B engine with a close-out; skins is up to four players plus Tied and plays
 * every hole, because every hole pays.
 */
import {
  holeWeight,
  NO_GLORIOUS,
  type GloriousConfig,
} from "./gloriousHoles";
import { isSkinsFormat } from "./gameRoutes";
import { isModifierEnabled, gloriousHolesCount, type ModifiersMap } from "./modifiers";
import { ranking } from "./strokePlay";

/**
 * Read the LIVE glorious config off a skins game.
 *
 * A SECOND reader rather than a widening of `gloriousConfig`, which returns
 * `NO_GLORIOUS` for anything outside match singles/doubles. Widening that guard
 * would opt skins into a function whose OTHER guard — "glorious is valid only
 * with outcome entry" — is expressed in terms of `games.entry_mode`, a column
 * skins does not have and does not need: this format records who won each hole
 * and has no second mode to be invalid in.
 *
 * `gloriousHoles.ts` says twice that skins reuses `holeWeight` unchanged, and it
 * does. It is the READER in front of it that had to be separate.
 */
export function skinsGloriousConfig(
  gameTypeId: string | null | undefined,
  modifiers: ModifiersMap | null | undefined
): GloriousConfig {
  if (!isSkinsFormat(gameTypeId ?? null)) return NO_GLORIOUS;
  const m = modifiers ?? {};
  if (!isModifierEnabled(m, "glorious_holes")) return NO_GLORIOUS;
  return { enabled: true, n: gloriousHolesCount(m) };
}

/**
 * One hole's recorded outcome, in one grouping — the storage shape of
 * `skins_hole_outcomes`.
 *
 * `result` and `winnerId` are a pair, not a redundancy. A hole with NO row has
 * not been played; a `tied` row is a hole that WAS played and carried. Those are
 * different facts that the fold acts on differently, and a lone nullable winner
 * would render them identically — which is why the table pairs them under a
 * CHECK rather than trusting callers (migration 184).
 */
export interface SkinsOutcomeRow {
  hole: number;
  result: "won" | "tied";
  winnerId: string | null;
}

/** What one hole of one grouping is worth, and what happened on it. */
export interface SkinsHoleLine {
  hole: number;
  /** This hole's OWN value — `holeWeight`, before anything carried in. */
  ownValue: number;
  /** Rolled in from earlier ties. 0 = this hole is worth its own value alone. */
  carriedIn: number;
  /** `ownValue + carriedIn` — what the hole is worth. Populated for an UNPLAYED
   *  hole too, because "what is this hole worth before it is played" is the
   *  question carryover makes interesting, and it is the number the entry screen
   *  has to show before anyone taps. */
  pot: number;
  status: "unplayed" | "tied" | "won";
  /** The player who took it; null on every other status. */
  winnerId: string | null;
}

export interface SkinsGroupingTally {
  groupingId: string;
  lines: SkinsHoleLine[];
  /** playerId -> skins won. Only players who have won a hole appear. */
  skinsBy: Record<string, number>;
  /** Total awarded so far — Σ `skinsBy`. */
  awarded: number;
  /**
   * The pot sitting on the table after the last hole in the round.
   *
   * The SAME number means two different things and nothing about it says which,
   * so read `potIsDead` beside it: mid-round this is what the next tied-into
   * hole inherits, and after a tied final hole it is skins that will never be
   * paid to anybody.
   */
  carried: number;
  /**
   * The final hole was played and tied, so `carried` is destroyed rather than
   * pending. A tied last hole does not split and does not roll anywhere.
   */
  potIsDead: boolean;
}

/**
 * Walk one grouping's holes in order and settle each.
 *
 * Gap-tolerant, and the gap rule is a decision rather than an accident: an
 * UNPLAYED hole does not add its value to the carry, because it has not
 * happened. Only a TIE carries. A mid-round hole entered late simply re-runs
 * this fold and the later pots grow — nothing is snapshotted, so there is
 * nothing to migrate.
 *
 * `weighting` is a `GloriousConfig` rather than the `#1311` `UnitWeight` seam,
 * deliberately. That seam exists so `matchState` can take a non-positional
 * weighting, and skins does not use `matchState`; `remainingSwing` is likewise a
 * close-out input — Σ weight over UNPLAYED holes — which is a different quantity
 * from a carried pot and must not be mistaken for one.
 */
export function tallyGrouping(
  groupingId: string,
  rows: SkinsOutcomeRow[],
  holeCount: number,
  weighting: GloriousConfig = NO_GLORIOUS
): SkinsGroupingTally {
  const byHole = new Map<number, SkinsOutcomeRow>();
  for (const r of rows) byHole.set(r.hole, r);

  const lines: SkinsHoleLine[] = [];
  const skinsBy: Record<string, number> = {};
  let carried = 0;
  let potIsDead = false;

  for (let hole = 1; hole <= holeCount; hole++) {
    const ownValue = holeWeight(hole, weighting);
    const carriedIn = carried;
    const pot = ownValue + carriedIn;
    const row = byHole.get(hole);

    if (!row) {
      lines.push({ hole, ownValue, carriedIn, pot, status: "unplayed", winnerId: null });
      continue;
    }
    if (row.result === "tied") {
      lines.push({ hole, ownValue, carriedIn, pot, status: "tied", winnerId: null });
      carried = pot;
      // A tie on the LAST hole is where the pot dies. Recorded as its own flag
      // rather than left for a reader to infer from `hole === holeCount`,
      // because the consequence — nobody is paid — is not visible in `carried`.
      potIsDead = hole === holeCount;
      continue;
    }
    // Won. `winnerId` is non-null by the table's CHECK, but this module is also
    // fed by tests and by drafts, so a malformed row is treated as unplayed
    // rather than silently awarding the pot to `null`.
    if (row.winnerId == null) {
      lines.push({ hole, ownValue, carriedIn, pot, status: "unplayed", winnerId: null });
      continue;
    }
    skinsBy[row.winnerId] = (skinsBy[row.winnerId] ?? 0) + pot;
    lines.push({ hole, ownValue, carriedIn, pot, status: "won", winnerId: row.winnerId });
    carried = 0;
    potIsDead = false;
  }

  let awarded = 0;
  for (const n of Object.values(skinsBy)) awarded += n;
  return { groupingId, lines, skinsBy, awarded, carried, potIsDead };
}

/**
 * Every grouping's tally, each folded independently.
 *
 * The independence is STRUCTURAL — one accumulator per call to `tallyGrouping` —
 * rather than a rule this function has to remember. A build with one shared
 * carryover state passes every single-grouping fixture and is wrong the moment
 * the format is used as intended, which is why the shape matters more than any
 * assertion about it.
 */
export function tallySkins(
  groupingIds: string[],
  rowsByGrouping: Record<string, SkinsOutcomeRow[]>,
  holeCount: number,
  weighting: GloriousConfig = NO_GLORIOUS
): Record<string, SkinsGroupingTally> {
  const out: Record<string, SkinsGroupingTally> = {};
  for (const id of groupingIds) {
    out[id] = tallyGrouping(id, rowsByGrouping[id] ?? [], holeCount, weighting);
  }
  return out;
}

/**
 * The total each grouping plays for when nothing carries past the last hole —
 * Σ `holeWeight`, which is `holeCount + <glorious hole count>`.
 *
 * Every grouping plays for the same total, which is what makes a field-wide
 * ordering of individuals meaningful even though the contests are independent.
 */
export function skinsPerGrouping(holeCount: number, weighting: GloriousConfig = NO_GLORIOUS): number {
  let total = 0;
  for (let hole = 1; hole <= holeCount; hole++) total += holeWeight(hole, weighting);
  return total;
}

/** One player's row on the board. */
export interface SkinsStanding {
  entityId: string;
  /** Skins won. THE ranked measure — more is better. */
  skins: number;
  /** Which grouping they were competing in. A reader has to know: the row above
   *  them may have been playing a different contest entirely. */
  groupingId: string;
  /** 1-based, ties share (standard competition ranking 1, 2, 2, 4). */
  position: number;
  /** Has this player's GROUPING recorded anything? A player on 0 in a grouping
   *  that has played nine holes has genuinely won nothing; one in a grouping
   *  that has not teed off has not started. Same number, different facts. */
  started: boolean;
}

/**
 * Rank the whole field by skins won, best first.
 *
 * Direction comes from the ONE mapping (`ranking`), never from a literal here —
 * `strokeRankingDirection.guard.test.ts` scans for exactly that, and this file
 * is on its list.
 *
 * `participants` is passed in full rather than derived from the tallies, because
 * a player who has won nothing must still have a row. Deriving the field from
 * the winners would silently drop everybody having a bad day, which is the
 * larger half of a skins board.
 */
export function computeSkinsStandings(
  participants: { userId: string; groupingId: string }[],
  tallies: Record<string, SkinsGroupingTally>
): SkinsStanding[] {
  const { compare, beats } = ranking("skins");

  const rows = participants.map((p) => {
    const tally = tallies[p.groupingId];
    return {
      entityId: p.userId,
      groupingId: p.groupingId,
      skins: tally?.skinsBy[p.userId] ?? 0,
      // A grouping that has recorded ANY hole has started, whether or not this
      // player has won one.
      started: !!tally?.lines.some((l) => l.status !== "unplayed"),
    };
  });

  rows.sort((a, b) => compare(a.skins, b.skins) || a.entityId.localeCompare(b.entityId));

  // Standard competition ranking (1, 2, 2, 4) — position counts how many rows
  // strictly beat you, using the SAME predicate the sort used, so the order and
  // the number can't disagree.
  return rows.map((r) => ({
    ...r,
    position: rows.filter((o) => beats(o.skins, r.skins)).length + 1,
  }));
}
