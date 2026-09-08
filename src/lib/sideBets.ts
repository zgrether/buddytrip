/**
 * Side bets — the pure rules module for Quick Play's money games.
 *
 * No React, no DB, no local storage. Takes the round's holes, the RECORDED list
 * of bets, and the round's scoring, and returns every derived figure the UI
 * shows: hole winners, carryovers, what a hole was worth, which automatic
 * presses should have fired, per-hole exposure, running totals, settlement.
 *
 * **Why a module and not component state** (handoff §4, and the reason
 * `reorderList.ts` exists): the test environment is `node`, so a component can
 * be rendered but never clicked. Rules living inside the tracker component
 * could only ever be asserted as "a number is displayed" — which is true of the
 * wrong number. So the component renders and this decides.
 *
 * Note on what this module deliberately does NOT add: `playedThrough` is a
 * "how far has the round got" figure, used only to decide which bets have
 * started and what the next hole is. It is not a fifth "has this round started"
 * predicate — that question already has one answer (`hasAnyScore`), and this
 * one cannot be derived from it.
 *
 * **Nothing here is stored except the bets themselves** (handoff §4/§9). That
 * is what makes fixing a wrong score on the 9th recompute the whole tally,
 * including whether a press should have triggered, with nothing to reconcile —
 * the same "derived, never snapshotted" discipline CLAUDE.md #11 sets for
 * Glorious Finishing Holes. Automatic presses in particular are DERIVED here,
 * never written down: a press that had been recorded at creation time would
 * survive a correction that un-fires it.
 */

/** A side of a bet. One or more players — a side is a slot, not a person
 *  (the glossary's team/side split, at Quick Play scale). `id` is minted once
 *  at creation and copied by presses, so a press's tally lines up with its
 *  parent's without re-deriving who is who. */
export interface BetSide {
  id: string;
  playerIds: string[];
}

/**
 * What KIND of bet this is — the choice that used to be a carryover toggle.
 *
 * `head_to_head` — two sides, a winner and a loser exchanging. Presses live
 * here: a press is the losing side buying back in against a specific opponent.
 * No carryover; a carried hole in a two-way is just a bigger hole, and nobody
 * asks for it by name.
 *
 * `skins` — a pot. Low net takes the whole thing and a tie carries it to the
 * next hole; carryover is not a setting here, it is the entire point. Presses
 * are meaningless: in a pot there is no "down two to someone", there are three
 * other people and a running total.
 *
 * **The two kinds read `amount` differently, and `sideStake` is the one place
 * that knows it.** Head-to-head's `amount` is the per-side stake; skins'
 * `amount` is the SKIN — what the hole is worth — which everyone in splits.
 * Four at "$10/skin" are $2.50 each and the winner takes $7.50. What else
 * differs is what is OFFERED (presses, carryover) and what is DISPLAYED
 * (`holeValue`). At two sides the shapes converge but the numbers do not: a
 * $10 skin is $5 each, a $10 head-to-head is $10 each.
 */
export type BetKind = "head_to_head" | "skins";

/** What created a bet. Manual / Nassau / last-hole double are RECORDED
 *  decisions; `press` is only ever minted by `computeSideBets` (automatic
 *  presses derive — see the module doc). */
export type BetOrigin =
  | { kind: "manual" }
  | { kind: "nassau"; leg: "front" | "back" | "overall" }
  | { kind: "press"; parentId: string; level: number }
  | { kind: "double"; parentId: string };

/**
 * A bet: sides, stakes, rules, and a starting point (handoff §2).
 *
 * `endHole` is `null` for everything a person creates by hand — a bet runs to
 * the end of the round, and there is no end-hole question in the create form.
 * It exists because **Nassau needs it**: the front nine is holes 1–9 (§5.1), so
 * the object has to be able to express a bet that stops early. A press always
 * gets `null`, which is §3.3's rule ("a press runs to the end of the round, not
 * to where the original ends") stated in the data rather than in prose.
 */
export interface SideBet {
  id: string;
  kind: BetKind;
  sides: BetSide[];
  /** The stakes, in whole currency units. Head-to-head: what each SIDE has on
   *  the hole. Skins: what the SKIN is worth, which the sides split — read it
   *  through `sideStake`, never directly, or a pot is priced per person. */
  amount: number;
  /** Where it begins. 1 for a bet made on the first tee — not a special case. */
  startHole: number;
  /** Last hole INCLUSIVE, or null for "to the end of the round". */
  endHole: number | null;
  /** A halved hole rolls its value into the next one (skins). */
  carryover: boolean;
  /** Fire an automatic press when a side goes this many down. null = off. */
  autoPressAt: number | null;
  /** ☠️ A press may fire its own press. Only meaningful with `autoPressAt` set;
   *  `pressRules` refuses it otherwise so an off switch can't be bypassed. */
  pressOnPress: boolean;
  origin: BetOrigin;
}

/**
 * How a hole is decided for a bet. Two shapes because a score has two storage
 * shapes (CLAUDE.md #27) and this module must not be blind to either:
 *
 * - `net` — per-player net strokes. Stroke and rack rounds. A side's hole score
 *   is the BEST net among its players (best ball), and the side is scored only
 *   once every one of its players has a score for that hole, so a half-entered
 *   hole never crowns a provisional winner that the next tap overturns.
 * - `outcome` — the hole's winner, with no strokes behind it. Match rounds use
 *   this in BOTH entry modes: outcome mode records the winner directly, and
 *   score mode has one ball per side, so per-player nets do not exist there
 *   either. The caller resolves score mode through the shared
 *   `quickMatchDecided`, which is what stops the money and the match board from
 *   disagreeing about who won a hole (CLAUDE.md #8).
 */
export type BetScoring =
  | { mode: "net"; net: Record<string, Record<number, number>> }
  | {
      mode: "outcome";
      sideA: string[];
      sideB: string[];
      outcomes: Record<number, "side_a" | "side_b" | "halved">;
    };

export interface SideBetsInput {
  /** Hole numbers in play order — the round's real length, never a literal 18. */
  holes: number[];
  /** The RECORDED bets. Derived presses are added by `computeSideBets`. */
  bets: SideBet[];
  scoring: BetScoring;
}

/** One bet's line for one hole. `pot` is what the hole is worth in THIS bet —
 *  the stake plus anything carried into it — and is populated for an undecided
 *  hole too, because "what is this hole worth before it's played" is the
 *  question carryovers make interesting (handoff §6). */
export interface BetHoleLine {
  hole: number;
  pot: number;
  status: "undecided" | "halved" | "won";
  winnerSideId: string | null;
  /** Holes rolled into this one (0 = just the stake). */
  carriedIn: number;
  /** Money moved on this hole, per side id. Sums to zero. */
  delta: Record<string, number>;
}

export interface BetTally {
  bet: SideBet;
  /** The round has reached this bet's start hole. A bet created at hole 10 is
   *  false until then, which is what keeps it out of the tracker (§6). */
  started: boolean;
  /** Still in play on the next hole — what per-hole exposure counts. */
  live: boolean;
  lines: BetHoleLine[];
  /** Net money per side id, summed over decided holes. Sums to zero. */
  totals: Record<string, number>;
  /** The hole after which an automatic press should have fired, if one should
   *  have. Null when the rule is off or the threshold was never reached. */
  pressTriggerHole: number | null;
}

/** An automatic press that fired. Carries the exposure it created, because a
 *  press that announces itself without saying what a hole now costs is the
 *  number that would have prevented someone going home without their shirt
 *  (handoff §6). */
export interface PressEvent {
  betId: string;
  parentId: string;
  level: number;
  /** The hole whose result triggered it. */
  triggerHole: number;
  /** Where the press itself begins — the hole AFTER the trigger. A press
   *  starting on the hole that triggered it would re-price a hole already
   *  played, changing a settled result (§3.1's worked example: down 2 after 6,
   *  press starts at 7). */
  startHole: number;
  amount: number;
  /** Total per-hole stake across every bet live on `startHole`, this one
   *  included. The "now $40/hole" half of the announcement. */
  exposureAfter: number;
}

/** One hole's money line, across every bet — the per-hole view (§6). Derived,
 *  never cached: fixing an earlier score rewrites this hole and every hole
 *  after it. */
export interface HoleMoneyLine {
  hole: number;
  /** What each side has AT RISK on this hole, carryovers included — the
   *  head-to-head figure, and what exposure is about. */
  atStake: number;
  /**
   * What the hole is WORTH to whoever takes it: the pot (§11's second name).
   *
   * Equal to `atStake` in a head-to-head — the stake is what changes hands —
   * and `stake × players` in skins, so four at $10 reads "$40" and three
   * carries reads "$160". The tracker shows THIS; the setup asks for the
   * stake. Two numbers, two names, and neither is stored.
   */
  pot: number;
  /** Every bet live on this hole has a result. */
  decided: boolean;
  perBet: {
    betId: string;
    pot: number;
    status: BetHoleLine["status"];
    winnerSideId: string | null;
    carriedIn: number;
  }[];
  /** Money moved on this hole, per PLAYER. Sums to zero. */
  delta: Record<string, number>;
  /** Presses TRIGGERED by this hole's result (they begin on the next one). */
  presses: PressEvent[];
}

export interface ExposureState {
  /** The standing rate: the sum of `sideStake` over every live bet — what one
   *  side is in for per hole, never the skin. */
  perHole: number;
  liveBetCount: number;
  /** The same sum over live bets that are NOT presses — the opening stake the
   *  warning threshold is a multiple of. */
  baseStake: number;
  /** Exposure has reached `EXPOSURE_WARN_MULTIPLE` × the opening stake. */
  warn: boolean;
}

export interface Settlement {
  fromPlayerId: string;
  toPlayerId: string;
  amount: number;
}

export interface SideBetsResult {
  /** Every bet, RECORDED and derived-press alike, in start-hole order. */
  bets: BetTally[];
  presses: PressEvent[];
  /** One entry per hole of the round, always — a hole with nothing riding on
   *  it has `atStake: 0` rather than being absent, so the caller indexes by
   *  hole instead of searching. */
  holeLines: HoleMoneyLine[];
  /** The furthest hole the round has reached. */
  playedThrough: number;
  exposure: ExposureState;
  /** Net money per player. A side's money is SPLIT EQUALLY among its players
   *  (see `splitToPlayers`). Sums to zero. */
  totalsByPlayer: Record<string, number>;
  /** Who owes whom — the end-of-round line (§6). */
  settlement: Settlement[];
}

/** Exposure past this multiple of the opening stake gets the warning treatment
 *  (handoff §5). Four live $10 bets on a $10 opening stake is the case: the
 *  round everyone is still calling a ten dollar bet while it is forty a hole. */
export const EXPOSURE_WARN_MULTIPLE = 4;

// ── Bet construction helpers ────────────────────────────────────────────────

/** A press's id — DERIVED from its parent's, so the same round recomputed
 *  produces the same ids and React keys are stable across a re-tally. A random
 *  id would remount the row every time a score changed. */
export function pressBetId(parentId: string, level: number): string {
  return `${parentId}#press${level}`;
}

/**
 * The press a bet's automatic rule creates: same sides, same stakes, starting
 * the hole after the trigger, running to the end of the round.
 *
 * `autoPressAt` is carried forward ONLY when `pressOnPress` is on — that is the
 * whole of the ☠️ option, expressed once here rather than as a condition at
 * every level of the chain.
 */
export function makePressBet(parent: SideBet, triggerHole: number): SideBet {
  const level = parent.origin.kind === "press" ? parent.origin.level + 1 : 1;
  return {
    id: pressBetId(parent.id, level),
    // A press is always head-to-head — it is only ever minted from one, since
    // `rulesForKind` refuses skins an `autoPressAt` to fire from.
    kind: "head_to_head",
    sides: parent.sides,
    // `sideStake`, not `parent.amount`: the press is head-to-head, so its
    // `amount` IS the per-side stake, and copying a skins parent's figure
    // across the kind boundary would silently size the press at the whole pot.
    // Unreachable today (`rulesForKind` refuses skins a press) and written this
    // way so it stays true if that ever changes — the same reason
    // `buildManualPress` does it.
    amount: sideStake(parent),
    startHole: triggerHole + 1,
    endHole: null, // §3.3 — to the end of the round, not to where the original ends
    carryover: parent.carryover,
    autoPressAt: parent.pressOnPress ? parent.autoPressAt : null,
    pressOnPress: parent.pressOnPress,
    origin: { kind: "press", parentId: parent.id, level },
  };
}

/**
 * A press someone AGREED to, rather than one a rule fired.
 *
 * The two are not the same object and must not share a code path. An automatic
 * press is DERIVED — `computeSideBets` re-mints it on every read from the
 * parent's `autoPressAt`, which is why it has no delete button and why its id
 * comes from `pressBetId` (recompute has to land on the same id). A manual
 * press has no rule to re-derive it from, so it is RECORDED like any other bet:
 * its own `mkId()` id, in `bets.bets`, deletable.
 *
 * That difference is also why the id must NOT be `pressBetId`: turn the
 * parent's automatic press on afterwards and the derived press would claim
 * exactly that id, and two bets would answer to one key.
 *
 * `fromHole` is the first hole it covers, not the trigger hole — a manual press
 * is agreed on the tee, so it starts on the hole you are about to play rather
 * than the one after. (`makePressBet` takes a trigger and adds one, because the
 * rule fires on a hole that is already decided.)
 */
export function buildManualPress(args: {
  mkId: () => string;
  parent: SideBet;
  fromHole: number;
}): SideBet {
  const level = args.parent.origin.kind === "press" ? args.parent.origin.level + 1 : 1;
  return {
    id: args.mkId(),
    // Always head-to-head: `rulesForKind` refuses skins a press at all, and a
    // press of a press is still two sides.
    kind: "head_to_head",
    sides: args.parent.sides,
    // Presses stay the same size as what they press — one more STAKE per press,
    // not a doubling, and `sideStake` is what "the same size" means once a
    // skins parent prices its `amount` as the pot rather than per side.
    amount: sideStake(args.parent),
    startHole: Math.max(1, Math.round(args.fromHole)),
    endHole: null,
    // A manual press does not itself auto-press — you agreed to ONE bet, and
    // the next one is another conversation.
    ...rulesForKind("head_to_head"),
    origin: { kind: "press", parentId: args.parent.id, level },
  };
}

/**
 * May this bet be pressed BY HAND right now?
 *
 * Four conditions, each for its own reason:
 *  - `live` — you cannot press a bet that has not started or is already over.
 *  - head-to-head — `rulesForKind` refuses skins a press at all, so offering
 *    one would be a button that cannot do anything.
 *  - no `autoPressAt` — the bet already presses itself on a rule, and a manual
 *    press beside it would stack a second one nobody agreed to. This is the
 *    "only when automatic is off" condition, in one place rather than as a
 *    condition remembered at the button.
 *  - a hole left to cover — a press starting past the last hole is not a press.
 *
 * A DERIVED press is pressable when its own `pressOnPress` is off, which is
 * correct: pressing a press by agreement is a real thing, and the manual child
 * simply records it.
 */
export function canManuallyPress(
  tally: BetTally,
  opts: { fromHole: number; holeCount: number }
): boolean {
  if (!tally.live) return false;
  if (tally.bet.kind !== "head_to_head") return false;
  if (tally.bet.autoPressAt != null) return false;
  return opts.fromHole <= opts.holeCount;
}

/**
 * What one unit of this bet costs, as the strip says it: `$5/hole`, or
 * `$5/skin` where a skin is the unit.
 *
 * The strip used to print the bet's KIND ("Head to Head") beside a bare `$5`,
 * which named the wrong thing twice: everything in that list is a bet, and the
 * figure did not say what it bought. The rate is the number you act on.
 */
export function betRate(bet: SideBet): string {
  return `${formatMoney(bet.amount)}/${bet.kind === "skins" ? "skin" : "hole"}`;
}

/**
 * The part of a bet's name the RATE does not already carry — the Nassau leg,
 * the press level — or null when the rate says everything.
 *
 * Three `$5/hole` rows for a Nassau would be indistinguishable, so the leg has
 * to survive; "Head to Head" adds nothing next to `$5/hole` and does not.
 */
export function betQualifier(bet: SideBet): string | null {
  switch (bet.origin.kind) {
    case "nassau":
      return bet.origin.leg === "front" ? "Front 9" : bet.origin.leg === "back" ? "Back 9" : "Overall";
    case "press":
      return `Press ${bet.origin.level}`;
    case "double":
      return "Last hole";
    default:
      return null;
  }
}

/**
 * The rules a bet of this KIND is allowed to carry (§12/§13).
 *
 * One place, so "skins has no presses" and "head-to-head has no carryover" are
 * properties of the data rather than conditions remembered at each render. A
 * form that draws the wrong control, or a stored payload from before the kinds
 * existed, still cannot produce a bet that behaves as the other one.
 */
export function rulesForKind(
  kind: BetKind,
  opts: { autoPressAt?: number | null; pressOnPress?: boolean } = {}
): { carryover: boolean; autoPressAt: number | null; pressOnPress: boolean } {
  if (kind === "skins") {
    // Carryover is inherent, presses are incoherent. Neither is a choice.
    return { carryover: true, autoPressAt: null, pressOnPress: false };
  }
  return { carryover: false, ...pressRules(opts.autoPressAt ?? null, opts.pressOnPress ?? false) };
}

/**
 * What one SIDE puts in per hole — the only number the money is ever built
 * from, and the one place the two kinds read `amount` differently.
 *
 * Head-to-head: `amount` is the stake, because that is what changes hands.
 * Skins: `amount` is the SKIN — what the hole is worth to whoever takes it —
 * so each side puts in a share of it, `amount / sides`. A $10 skin between
 * four is $2.50 each; the winner collects $7.50 and the hole was worth $10,
 * which is what the form asked for.
 *
 * ── THIS REVERSES WHAT SKINS USED TO MEAN, and the reversal is the fix ──────
 *
 * `amount` was the per-side stake in BOTH kinds, and `holeValue` multiplied it
 * up: four people at "$10/skin" were each in for $10 and the hole was worth
 * $40. Every figure was self-consistent and every one of them was four times
 * what the person setting it up had asked for, because the form's own label
 * has always read **Stakes (per skin)** and the strip has always printed
 * `$10/skin` — the rate names the SKIN, and the arithmetic behind it named the
 * stake. Same shape as the naming entries in CLAUDE.md: not a wrong number,
 * a number answering a different question than its label.
 *
 * The head-to-head reading is untouched, which is why presses and the last-hole
 * double (both head-to-head only, by `rulesForKind`) need no thought here.
 */
export function sideStake(bet: SideBet): number {
  if (bet.kind !== "skins") return bet.amount;
  // `sides.length` is >= 2 for anything `migrateBet` will admit, so there is no
  // divide-by-zero to guard; the max is belt-and-braces for a hand-built bet.
  return bet.amount / Math.max(1, bet.sides.length);
}

/**
 * What a hole is WORTH, as the tracker says it — distinct from `pot`, which is
 * what each side has at risk (§11's "two numbers, two names").
 *
 * Head-to-head: the stake, because that is what changes hands.
 * Skins: the pot times everyone in, which puts the skin back together — four
 * sides at $2.50 each is the $10 skin the form asked for, and three carries
 * makes it $40.
 *
 * Derived, never set: the setup asks what the skin is worth, `sideStake` turns
 * that into what each person puts in, and this turns it back.
 */
export function holeValue(bet: SideBet, pot: number): number {
  return bet.kind === "skins" ? pot * bet.sides.length : pot;
}

/**
 * Normalize a bet's press rules. The ☠️ option is not merely hidden when
 * automatic press is off — it is REFUSED here, so a stored payload from an
 * older build (or a hand-edited one) can't smuggle compounding exposure into a
 * bet with no press rule at all (handoff §9).
 */
export function pressRules(autoPressAt: number | null, pressOnPress: boolean): {
  autoPressAt: number | null;
  pressOnPress: boolean;
} {
  if (autoPressAt == null || autoPressAt < 1) return { autoPressAt: null, pressOnPress: false };
  return { autoPressAt: Math.round(autoPressAt), pressOnPress };
}

/** A bet's display name. One place, so the strip, the breakdown and the hole
 *  line can't name the same bet three ways. */
export function betLabel(bet: SideBet): string {
  switch (bet.origin.kind) {
    // Named for the KIND of bet, not just the leg: three rows reading "Front
    // 9 / Back 9 / Overall" describe segments of a round and never say what
    // they are, which is the one thing a list of bets has to tell you.
    case "nassau":
      return bet.origin.leg === "front"
        ? "Nassau Front 9"
        : bet.origin.leg === "back"
          ? "Nassau Back 9"
          : "Nassau Overall";
    case "press":
      return `Press ${bet.origin.level}`;
    case "double":
      return "Last hole";
    default:
      // "Bet" was the same non-answer: every row here is a bet.
      return bet.kind === "skins" ? "Skins" : "Head to Head";
  }
}

/** One player's column on the live strip. */
export interface PlayerBetLine {
  playerId: string;
  /** The round's net for this player. Not a function of the hole being viewed. */
  total: number;
  /** What THIS player has riding on the next hole — the sum of `sideStake`
   *  over the bets they are actually in, which is the number they can act on.
   *  The round's aggregate exposure is not: with separate bets between separate
   *  people, "$35/hole across 4 bets" is nobody's risk. */
  perHole: number;
  /** Their live bets, in the order `result.bets` already sorted them. */
  bets: { betId: string; rate: string; qualifier: string | null; amount: number }[];
}

/**
 * The strip's per-player columns.
 *
 * Replaces a single perspective player's total plus a round-wide exposure
 * figure. Both were misleading the moment the round holds more than one bet
 * between different people: the total named one player and the exposure named
 * nobody, so the one number everybody wanted — what am I in, and for how much —
 * was the one number not shown.
 *
 * Pure, and here rather than in the component, so the strip stays a renderer of
 * already-derived figures (CLAUDE.md #8). A number computed inside a component
 * can only ever be tested as "a number was displayed".
 */
export function playerBetLines(result: SideBetsResult, playerIds: string[]): PlayerBetLine[] {
  return playerIds.map((playerId) => {
    const mine = result.bets.filter(
      (t) => t.live && t.bet.sides.some((side) => side.playerIds.includes(playerId))
    );
    return {
      playerId,
      total: playerTotal(result, playerId),
      perHole: round2(mine.reduce((sum, t) => sum + sideStake(t.bet), 0)),
      // `rate` is the primary text on the strip and `qualifier` the aside —
      // see `betRate`. `amount` is what THIS player is in for per hole
      // (`sideStake`), not the recorded figure: on a skins bet those differ,
      // and the column is headed by a person.
      bets: mine.map((t) => ({
        betId: t.bet.id,
        rate: betRate(t.bet),
        qualifier: betQualifier(t.bet),
        amount: sideStake(t.bet),
      })),
    };
  });
}

/**
 * The RECORDED bets this player is a side of.
 *
 * Removing a player from the roster has to take their bets with them — a bet
 * with a side that no longer exists is not a smaller bet, it is an unreadable
 * one. Recorded only: a derived press has no independent existence and simply
 * stops being derived once its parent goes.
 */
export function betsInvolvingPlayer(bets: SideBet[], playerId: string): SideBet[] {
  return bets.filter((b) => b.sides.some((side) => side.playerIds.includes(playerId)));
}

// ── Hole resolution ─────────────────────────────────────────────────────────

/** Which of a bet's sides won a hole — or that it was halved, or that it isn't
 *  decided yet. Lower is better in both scoring shapes, so the two modes meet
 *  here and nothing downstream branches on which one produced the answer. */
function resolveHole(
  bet: SideBet,
  hole: number,
  scoring: BetScoring
): { decided: boolean; winnerSideId: string | null } {
  const values: { sideId: string; value: number }[] = [];
  for (const side of bet.sides) {
    const v = sideValueAt(side, hole, scoring);
    if (v == null) return { decided: false, winnerSideId: null };
    values.push({ sideId: side.id, value: v });
  }
  if (values.length < 2) return { decided: false, winnerSideId: null };
  let best = values[0].value;
  for (const v of values) if (v.value < best) best = v.value;
  const winners = values.filter((v) => v.value === best);
  return { decided: true, winnerSideId: winners.length === 1 ? winners[0].sideId : null };
}

/** A side's score on a hole, in a "lower wins" space shared by both scoring
 *  shapes. Outcome mode collapses to 0 (won/halved) vs 1 (lost), which is the
 *  same comparison the net path makes — one ranking rule, two inputs. */
function sideValueAt(side: BetSide, hole: number, scoring: BetScoring): number | null {
  if (scoring.mode === "outcome") {
    const result = scoring.outcomes[hole];
    if (result == null) return null;
    const which = matchSideOf(side, scoring.sideA, scoring.sideB);
    // A bet whose sides are not the match's sides cannot be resolved from an
    // outcome: there is no per-player stroke to fall back on. It stays
    // undecided rather than being resolved against the wrong pairing.
    if (which == null) return null;
    if (result === "halved") return 0;
    return (result === "side_a") === (which === "a") ? 0 : 1;
  }
  // Best ball, and only once EVERY member of the side has a score for the hole
  // — a partially-entered hole must not name a winner the next tap overturns.
  let best: number | null = null;
  for (const pid of side.playerIds) {
    const v = scoring.net[pid]?.[hole];
    if (v == null) return null;
    best = best == null || v < best ? v : best;
  }
  return best;
}

/** Whether a bet side IS one of the match's two sides, by player-set equality. */
function matchSideOf(side: BetSide, sideA: string[], sideB: string[]): "a" | "b" | null {
  if (sameSet(side.playerIds, sideA)) return "a";
  if (sameSet(side.playerIds, sideB)) return "b";
  return null;
}

function sameSet(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const s = new Set(a);
  return b.every((x) => s.has(x));
}

// ── The tally ───────────────────────────────────────────────────────────────

/**
 * Walk one bet's holes. Returns its per-hole lines, its running totals, and the
 * hole after which an automatic press should have fired.
 *
 * Carryover survives an UNDECIDED hole rather than resetting on it: a hole left
 * unscored is not a halved hole, it is a hole that hasn't happened, so the pot
 * rolls on to the next hole that does get decided.
 */
function tallyBet(bet: SideBet, input: SideBetsInput, lastHole: number): BetTally {
  const end = Math.min(bet.endHole ?? lastHole, lastHole);
  const totals: Record<string, number> = {};
  /** Holes won, weighted by what the hole was worth in stakes (a carried $20
   *  hole is two). This — not the money spread — is what "down N" counts:
   *  every hole moves BOTH sides' money, so a one-hole lead is a two-stake
   *  money gap, and thresholding on the money would fire every press a hole
   *  early. */
  const unitsWon: Record<string, number> = {};
  for (const s of bet.sides) {
    totals[s.id] = 0;
    unitsWon[s.id] = 0;
  }
  const lines: BetHoleLine[] = [];
  let carried = 0;
  let pressTriggerHole: number | null = null;

  for (const hole of input.holes) {
    if (hole < bet.startHole || hole > end) continue;
    // `sideStake`, not `bet.amount`: in skins the recorded figure is the SKIN
    // and each side is in for a share of it (see `sideStake`). Carryover then
    // multiplies the whole thing, so a tied hole rolls the pot WHOLE — the same
    // sentence `src/lib/skins.ts` hangs its arithmetic off.
    const pot = sideStake(bet) * (1 + carried);
    const { decided, winnerSideId } = resolveHole(bet, hole, input.scoring);
    const delta: Record<string, number> = {};

    if (!decided) {
      lines.push({ hole, pot, status: "undecided", winnerSideId: null, carriedIn: carried, delta });
      continue;
    }
    if (winnerSideId == null) {
      // Halved. With carryover the pot rolls; without it, the hole is simply
      // worth nothing and the next hole is back to the stake.
      lines.push({ hole, pot, status: "halved", winnerSideId: null, carriedIn: carried, delta });
      carried = bet.carryover ? carried + 1 : 0;
    } else {
      const losers = bet.sides.length - 1;
      delta[winnerSideId] = pot * losers;
      for (const s of bet.sides) if (s.id !== winnerSideId) delta[s.id] = -pot;
      for (const [sid, amt] of Object.entries(delta)) totals[sid] = (totals[sid] ?? 0) + amt;
      unitsWon[winnerSideId] = (unitsWon[winnerSideId] ?? 0) + 1 + carried;
      lines.push({ hole, pot, status: "won", winnerSideId, carriedIn: carried, delta });
      carried = 0;
    }

    // Press check, after the hole is settled. Measured in holes-won (see
    // `unitsWon`): "down 2 after the 6th" is the trailing side being two holes
    // behind, and a carried hole counts for what it was worth.
    if (pressTriggerHole == null && bet.autoPressAt != null && bet.sides.length >= 2) {
      const vals = bet.sides.map((s) => unitsWon[s.id] ?? 0);
      if (Math.max(...vals) - Math.min(...vals) >= bet.autoPressAt) pressTriggerHole = hole;
    }
  }

  return { bet, started: false, live: false, lines, totals, pressTriggerHole };
}

/** The furthest hole the round has reached — a visibility figure only (which
 *  bets have started, what "next hole" means), never an input to the money.
 *  Derived from the SCORING, not from the bets, so it can't move when a bet is
 *  created or deleted. */
export function playedThrough(input: SideBetsInput): number {
  let max = 0;
  if (input.scoring.mode === "outcome") {
    for (const k of Object.keys(input.scoring.outcomes)) {
      const h = Number(k);
      if (Number.isFinite(h) && h > max) max = h;
    }
    return max;
  }
  for (const byHole of Object.values(input.scoring.net)) {
    for (const k of Object.keys(byHole)) {
      const h = Number(k);
      if (Number.isFinite(h) && h > max) max = h;
    }
  }
  return max;
}

/** Is this bet in play on `hole`? */
function liveOn(bet: SideBet, hole: number, lastHole: number): boolean {
  const end = Math.min(bet.endHole ?? lastHole, lastHole);
  return bet.startHole <= hole && hole <= end;
}

/**
 * The whole tally. Automatic presses are generated here, in a worklist: a bet
 * that triggers one enqueues its press, which is tallied in turn and may
 * trigger its own when `pressOnPress` is on. Each level's tally is independent
 * (its own holes, its own totals), so the order they come off the queue can't
 * change the result.
 */
export function computeSideBets(input: SideBetsInput): SideBetsResult {
  const holes = [...input.holes].sort((a, b) => a - b);
  const lastHole = holes.length > 0 ? holes[holes.length - 1] : 0;
  const through = playedThrough(input);
  const nextHole = through + 1;

  const tallies: BetTally[] = [];
  const presses: PressEvent[] = [];
  const queue: SideBet[] = [...input.bets].sort((a, b) => a.startHole - b.startHole);
  // Backstop against a pathological chain (a stake of 0, a threshold of 0 that
  // `pressRules` should already have refused). One press per hole per root bet
  // is the real ceiling; this is an order of magnitude above it.
  const MAX_BETS = 200;

  while (queue.length > 0 && tallies.length < MAX_BETS) {
    const bet = queue.shift()!;
    const tally = tallyBet(bet, { ...input, holes }, lastHole);
    tallies.push(tally);
    if (tally.pressTriggerHole != null && bet.autoPressAt != null) {
      const press = makePressBet(bet, tally.pressTriggerHole);
      // A press with no holes left to play is not a press. Nothing announces
      // it and nothing is at stake on it.
      if (press.startHole <= lastHole) queue.push(press);
    }
  }

  // Exposure per hole, now that every bet (derived presses included) is known.
  const stakeOn = (hole: number) =>
    tallies.reduce((sum, t) => sum + (liveOn(t.bet, hole, lastHole) ? sideStake(t.bet) : 0), 0);

  for (const t of tallies) {
    if (t.pressTriggerHole == null || t.bet.autoPressAt == null) continue;
    const child = makePressBet(t.bet, t.pressTriggerHole);
    if (child.startHole > lastHole) continue;
    presses.push({
      betId: child.id,
      parentId: t.bet.id,
      level: child.origin.kind === "press" ? child.origin.level : 1,
      triggerHole: t.pressTriggerHole,
      startHole: child.startHole,
      amount: child.amount,
      exposureAfter: stakeOn(child.startHole),
    });
  }
  presses.sort((a, b) => a.startHole - b.startHole || a.level - b.level);

  // Started / live, and the ordering the UI renders in.
  for (const t of tallies) {
    t.started = t.bet.startHole <= nextHole;
    t.live = t.started && liveOn(t.bet, nextHole, lastHole);
  }
  tallies.sort((a, b) => a.bet.startHole - b.bet.startHole || a.bet.id.localeCompare(b.bet.id));

  // ── Per-hole lines ───────────────────────────────────────────────────────
  const pressesByTrigger = new Map<number, PressEvent[]>();
  for (const p of presses) {
    const arr = pressesByTrigger.get(p.triggerHole) ?? [];
    arr.push(p);
    pressesByTrigger.set(p.triggerHole, arr);
  }
  const holeLines: HoleMoneyLine[] = holes.map((hole) => {
    const perBet: HoleMoneyLine["perBet"] = [];
    const delta: Record<string, number> = {};
    let atStake = 0;
    let pot = 0;
    let decided = true;
    let any = false;
    for (const t of tallies) {
      const line = t.lines.find((l) => l.hole === hole);
      if (!line) continue;
      any = true;
      atStake += line.pot;
      pot += holeValue(t.bet, line.pot);
      if (line.status === "undecided") decided = false;
      perBet.push({
        betId: t.bet.id,
        pot: line.pot,
        status: line.status,
        winnerSideId: line.winnerSideId,
        carriedIn: line.carriedIn,
      });
      for (const [sideId, amt] of Object.entries(line.delta)) {
        const side = t.bet.sides.find((s) => s.id === sideId);
        if (!side) continue;
        for (const [pid, share] of Object.entries(splitToPlayers(side, amt))) {
          delta[pid] = (delta[pid] ?? 0) + share;
        }
      }
    }
    return {
      hole,
      atStake,
      pot,
      decided: any && decided,
      perBet,
      delta,
      presses: pressesByTrigger.get(hole) ?? [],
    };
  });

  // ── Totals + settlement ──────────────────────────────────────────────────
  const totalsByPlayer: Record<string, number> = {};
  for (const t of tallies) {
    for (const side of t.bet.sides) {
      for (const [pid, share] of Object.entries(splitToPlayers(side, t.totals[side.id] ?? 0))) {
        totalsByPlayer[pid] = round2((totalsByPlayer[pid] ?? 0) + share);
      }
    }
  }

  // Exposure is what a person is IN for, so it counts `sideStake` — the pot's
  // per-side share, not the skin. A four-way $10 skin is $2.50 of anybody's
  // exposure, and counting the skin here would read as four times the risk.
  const liveBets = tallies.filter((t) => t.live);
  const perHole = round2(liveBets.reduce((s, t) => s + sideStake(t.bet), 0));
  const baseStake = round2(
    liveBets.filter((t) => t.bet.origin.kind !== "press").reduce((s, t) => s + sideStake(t.bet), 0)
  );

  return {
    bets: tallies,
    presses,
    holeLines,
    playedThrough: through,
    exposure: {
      perHole,
      liveBetCount: liveBets.length,
      baseStake,
      warn: baseStake > 0 && perHole >= EXPOSURE_WARN_MULTIPLE * baseStake,
    },
    totalsByPlayer,
    settlement: settle(totalsByPlayer),
  };
}

/**
 * A side's money, per player.
 *
 * **A side splits equally.** A $10/hole bet between two pairs means the SIDE
 * wins $10 and the partners are $5 each — not $10 each. This is the only reading
 * under which a per-person figure exists at all, which the banner needs ("Zach
 * +$40", §6) and settlement needs (per-player nets that sum to zero). Every
 * one-player side — skins, singles, any 1v1 — is unaffected, since splitting by
 * one is the identity. Someone who wants $10 each sets the stake to $20.
 */
export function splitToPlayers(side: BetSide, amount: number): Record<string, number> {
  const out: Record<string, number> = {};
  if (side.playerIds.length === 0) return out;
  const share = amount / side.playerIds.length;
  for (const pid of side.playerIds) out[pid] = round2((out[pid] ?? 0) + share);
  return out;
}

/** Who owes whom. Greedy largest-debtor-to-largest-creditor, which for the
 *  two-to-four players a Quick round holds is always the minimum number of
 *  payments. */
export function settle(totalsByPlayer: Record<string, number>): Settlement[] {
  const debtors = Object.entries(totalsByPlayer)
    .filter(([, v]) => v < -0.004)
    .map(([id, v]) => ({ id, amount: -v }))
    .sort((a, b) => b.amount - a.amount || a.id.localeCompare(b.id));
  const creditors = Object.entries(totalsByPlayer)
    .filter(([, v]) => v > 0.004)
    .map(([id, v]) => ({ id, amount: v }))
    .sort((a, b) => b.amount - a.amount || a.id.localeCompare(b.id));

  const out: Settlement[] = [];
  let i = 0;
  let j = 0;
  while (i < debtors.length && j < creditors.length) {
    const pay = Math.min(debtors[i].amount, creditors[j].amount);
    if (pay > 0.004) {
      out.push({ fromPlayerId: debtors[i].id, toPlayerId: creditors[j].id, amount: round2(pay) });
    }
    debtors[i].amount -= pay;
    creditors[j].amount -= pay;
    if (debtors[i].amount <= 0.004) i++;
    if (creditors[j].amount <= 0.004) j++;
  }
  return out;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Money, the one way. Whole amounts lose the ".00"; a split that lands on a
 *  half keeps its cents rather than rounding into a number nobody can pay. */
export function formatMoney(n: number): string {
  const abs = Math.abs(round2(n));
  const body = Number.isInteger(abs) ? String(abs) : abs.toFixed(2);
  return `${n < -0.004 ? "−" : ""}$${body}`;
}

/** Signed money for a running total — "+$40" / "−$40" / "even". */
export function formatSignedMoney(n: number): string {
  if (Math.abs(n) < 0.005) return "even";
  return `${n > 0 ? "+" : ""}${formatMoney(n)}`.replace("+−", "−");
}

// ── Nassau (§5.1) ───────────────────────────────────────────────────────────

/** Nassau needs a front nine and a back nine to be about. On a 9-hole round it
 *  is HIDDEN rather than offered-and-broken — the same call
 *  `quickMatchGloriousAvailable` makes for a modifier that can't apply. */
export function nassauAvailable(holeCount: number): boolean {
  return holeCount >= 18;
}

/**
 * Nassau in ONE action: front, back, and overall (§5.1/§9). Three bets, each
 * an ordinary bet afterwards — presses apply, the tracker shows three lines,
 * the totals sum. Making someone build three by hand to get the most common bet
 * in golf is the wrong trade.
 *
 * `startHole` clamps every leg, so setting one up on the 5th tee gives a front
 * of 5–9 rather than retroactively pricing four holes already played. A leg
 * with no holes left in it is dropped, which is why this returns a list rather
 * than a fixed triple.
 */
export function buildNassauBets(args: {
  mkId: () => string;
  sides: BetSide[];
  amount: number;
  startHole: number;
  holeCount: number;
  autoPressAt: number | null;
  pressOnPress: boolean;
}): SideBet[] {
  // Nassau is three head-to-heads. A "skins Nassau" is not a thing anyone
  // plays, and the front/back/overall split is about a match, not a pot.
  const rules = rulesForKind("head_to_head", args);
  const start = Math.max(1, args.startHole);
  const legs: { leg: "front" | "back" | "overall"; from: number; to: number }[] = [
    { leg: "front", from: start, to: 9 },
    { leg: "back", from: Math.max(start, 10), to: args.holeCount },
    { leg: "overall", from: start, to: args.holeCount },
  ];
  return legs
    .filter((l) => l.from <= l.to)
    .map((l) => ({
      id: args.mkId(),
      sides: args.sides,
      amount: args.amount,
      kind: "head_to_head" as const,
      startHole: l.from,
      // A leg that reaches the end of the round carries no end hole, exactly
      // like an ordinary bet — only the front nine, which genuinely stops
      // early, is the reason `endHole` exists at all.
      endHole: l.to >= args.holeCount ? null : l.to,
      ...rules,
      origin: { kind: "nassau" as const, leg: l.leg },
    }));
}

// ── The last-hole double (§3.2) ─────────────────────────────────────────────

/** A bet that can be doubled on the last hole, and who is down in it. */
export interface DoubleOffer {
  bet: SideBet;
  /** The side that is down — the one the prompt is offered to. */
  trailingSideId: string;
  leadingSideId: string;
  /** Stakes of the double: twice what a side is in for per hole, for one hole. */
  amount: number;
  /**
   * What the PARENT is running at per side per hole — `sideStake`, not
   * `bet.amount`.
   *
   * Carried on the offer rather than re-derived at the prompt because the
   * prompt's sentence compares the two ("twice the $5 the original is running
   * at") and a component reading `bet.amount` off a two-sided SKINS bet would
   * print the skin against the doubled stake: $10 described as twice $10.
   */
  parentStake: number;
}

/**
 * Whether to prompt for a last-hole double, and on which bets.
 *
 * Offered once the second-to-last hole is COMPLETE and the last one has not
 * started — "after the 17th is in" on a full round, and after the 8th on a nine
 * (§8), which falls out of counting from the round's real length rather than
 * from 18.
 *
 * ── "IS IN" MEANS SETTLED, NOT TOUCHED, and that is the fix ────────────────
 *
 * The gate was `playedThrough === penultimate` alone. `playedThrough` is the
 * furthest hole ANY score has reached, so it moves on the FIRST player's entry
 * — the prompt arrived over the scorecard the moment one person's 17 was typed,
 * interrupting the hole it needs the answer to and offering a double against a
 * tally that was still one, two or three scores short of the landscape.
 * `playedThrough` is exactly right for what it is for (which bets have started,
 * what the next hole is) and was the wrong question here: this one is "is the
 * penultimate hole SETTLED", and the module already answers that per hole.
 *
 * `holeLines[penultimate].decided` is that answer — every bet with a line on
 * that hole has a result, which in `net` mode means every player of every side
 * of every live bet has a score on it (`sideValueAt` refuses a half-entered
 * side). Same family as CLAUDE.md's "empty is not unknown": a hole one score
 * into being played rendered identically to a hole that was over.
 *
 * A PROMPT, never automatic (§9): it is a decision, and the app doing it to you
 * is exactly the thing that makes a bet feel like it got away from someone.
 * Only two-sided bets with someone actually behind are offered — there is no
 * "down" to offer a double to in a tied bet or a four-way skin.
 */
export function lastHoleDoubleOffers(
  result: SideBetsResult,
  holes: number[],
  answeredParentIds: string[] = []
): DoubleOffer[] {
  const sorted = [...holes].sort((a, b) => a - b);
  const lastHole = sorted[sorted.length - 1];
  if (lastHole == null || sorted.length < 2) return [];
  const penultimate = sorted[sorted.length - 2];
  // The last hole has not been started. Kept as its own condition rather than
  // folded into the line check: a decided penultimate hole says nothing about
  // whether the round has already moved past it.
  if (result.playedThrough !== penultimate) return [];
  // ...and the penultimate hole is finished, not merely begun.
  if (!result.holeLines.find((l) => l.hole === penultimate)?.decided) return [];
  const answered = new Set(answeredParentIds);

  const offers: DoubleOffer[] = [];
  for (const t of result.bets) {
    if (answered.has(t.bet.id)) continue;
    if (t.bet.origin.kind === "double") continue;
    if (t.bet.sides.length !== 2) continue;
    if (!t.live) continue;
    const [a, b] = t.bet.sides;
    const va = t.totals[a.id] ?? 0;
    const vb = t.totals[b.id] ?? 0;
    if (va === vb) continue;
    const stake = sideStake(t.bet);
    offers.push({
      bet: t.bet,
      trailingSideId: va < vb ? a.id : b.id,
      leadingSideId: va < vb ? b.id : a.id,
      // Twice what a SIDE is in for, not twice the recorded figure: on a
      // two-sided skins bet those differ by half, and `buildDoubleBet` records
      // a head-to-head, whose `amount` IS the per-side stake.
      amount: stake * 2,
      parentStake: stake,
    });
  }
  return offers;
}

/**
 * Answer the last-hole prompt for EVERY offer it put on the table, in ONE
 * transition.
 *
 * ── Why one function and not two state writes ─────────────────────────────
 *
 * The page used to accept by calling `addBets(...)` and then `declineDouble(...)`
 * — two updates for one decision, where only the second is what closes the
 * prompt. Nothing between them can be allowed to fail, and nothing has to be:
 * they are one fact ("this was answered, and here is what it created"), so they
 * are one write. There is no longer an ordering, and no longer a state where a
 * double exists and the prompt still offers to create it.
 *
 * ── Why it answers the whole set ──────────────────────────────────────────
 *
 * The prompt is one question asked at one moment — you are standing on the 18th
 * tee — so every bet it offered is answered by the tap, whether or not it was
 * ticked. Answering them one at a time is what made the prompt look STUCK: a
 * Nassau reaches the 17th with two live legs, so dismissing the back nine
 * immediately re-rendered an identical sheet for the overall, and the button
 * read as doing nothing. Same shape as CLAUDE.md's composition-bug entry — each
 * prompt was correct on its own and the sequence was the defect.
 *
 * Unticked is a real answer and is recorded as one; `answeredDoubles` carries
 * both, which is why it is no longer called `declinedDoubles`.
 */
export function answerLastHoleDoubles(
  state: SideBetsState,
  args: {
    /** Every offer the prompt showed — the ones taken and the ones not. */
    offers: DoubleOffer[];
    /** Parent bet ids the person ticked. Empty = "No thanks" to all of them. */
    acceptedBetIds: string[];
    lastHole: number;
    mkId: () => string;
  }
): SideBetsState {
  const accepted = new Set(args.acceptedBetIds);
  const taken = args.offers.filter((o) => accepted.has(o.bet.id));
  return {
    ...state,
    bets: [
      ...state.bets,
      ...taken.map((offer) => buildDoubleBet({ mkId: args.mkId, offer, lastHole: args.lastHole })),
    ],
    answeredDoubles: [
      ...state.answeredDoubles,
      // Every offer, not just the taken ones — the question was asked of all of
      // them and a re-ask is the bug this replaces.
      ...args.offers.map((o) => o.bet.id).filter((id) => !state.answeredDoubles.includes(id)),
    ],
  };
}

/** The bet a taken double records: the same sides, twice the stake, the last
 *  hole only. It carries no press rule — there is nothing left to press into. */
export function buildDoubleBet(args: { mkId: () => string; offer: DoubleOffer; lastHole: number }): SideBet {
  return {
    id: args.mkId(),
    kind: "head_to_head",
    sides: args.offer.bet.sides,
    amount: args.offer.amount,
    startHole: args.lastHole,
    endHole: args.lastHole,
    ...rulesForKind("head_to_head"),
    origin: { kind: "double", parentId: args.offer.bet.id },
  };
}

// ── Reading the result ──────────────────────────────────────────────────────

/** The live banner's number for one player — always the round's total, never
 *  the hole being viewed (§6/§9: the banner must not follow navigation). */
export function playerTotal(result: SideBetsResult, playerId: string | null): number {
  if (!playerId) return 0;
  return result.totalsByPlayer[playerId] ?? 0;
}

/** One bet's net for one player — the per-bet line in the breakdown. Splits a
 *  side's money the same way the round total does (`splitToPlayers`), so the
 *  lines in the breakdown add up to the number on the strip. */
export function betTotalForPlayer(tally: BetTally, playerId: string | null): number {
  if (!playerId) return 0;
  let sum = 0;
  for (const side of tally.bet.sides) {
    if (!side.playerIds.includes(playerId)) continue;
    sum += splitToPlayers(side, tally.totals[side.id] ?? 0)[playerId] ?? 0;
  }
  return round2(sum);
}


// ── The recorded half ───────────────────────────────────────────────────────

/**
 * Everything about side bets that is WRITTEN DOWN: the bets themselves, plus
 * the tracker's two preferences. Nothing derived is stored (§4/§9) — no totals,
 * no press list, no hole values.
 *
 * `perspectivePlayerId` is whose number the live banner reads ("Zach +$40",
 * §6). Quick Play has no signed-in identity to infer it from — the players are
 * typed names — so it defaults to the first name entered (whoever is holding
 * the phone typed themselves first) and is changeable from the breakdown.
 */
export interface SideBetsState {
  bets: SideBet[];
  perspectivePlayerId: string | null;
  /**
   * Bet ids whose last-hole double has been ANSWERED, so the prompt asks once.
   *
   * Both answers land here, which is why it is no longer called
   * `declinedDoubles`: accepting recorded the id under that name too (the page
   * called `declineDouble` right after adding the bet, with a comment
   * explaining that it had to), so the field has always meant "asked and
   * answered" and only the name said otherwise. `migrateSideBetsState` reads
   * the old key, so a round saved mid-answer resumes with its answers intact.
   */
  answeredDoubles: string[];
}

export const EMPTY_SIDE_BETS: SideBetsState = {
  bets: [],
  perspectivePlayerId: null,
  answeredDoubles: [],
};

/** A bet made by hand — the general case §2 describes, of which a press is the
 *  same object created a different way. Never carries an end hole: "runs to the
 *  end of the round" is the only answer the create form has to that question. */
export function buildManualBet(args: {
  mkId: () => string;
  kind: BetKind;
  sides: BetSide[];
  amount: number;
  startHole: number;
  autoPressAt?: number | null;
  pressOnPress?: boolean;
}): SideBet {
  return {
    id: args.mkId(),
    kind: args.kind,
    sides: args.sides,
    amount: args.amount,
    startHole: Math.max(1, Math.round(args.startHole)),
    endHole: null,
    ...rulesForKind(args.kind, args),
    origin: { kind: "manual" },
  };
}

/**
 * Normalize a stored payload into a `SideBetsState`. Local storage is the only
 * home these have, so a shape from an older build — or none at all, which is
 * every round saved before this feature — has to load as a playable round
 * rather than throw.
 *
 * A bet that isn't recognizably a bet is DROPPED rather than repaired: a bet
 * with no sides or no stake would silently price holes at zero, and a tracker
 * quietly showing $0 is worse than one bet fewer.
 */
export function migrateSideBetsState(raw: unknown): SideBetsState {
  if (!raw || typeof raw !== "object") return { ...EMPTY_SIDE_BETS };
  const r = raw as Record<string, unknown>;
  const bets = Array.isArray(r.bets) ? r.bets.map(migrateBet).filter((b): b is SideBet => b != null) : [];
  return {
    bets,
    perspectivePlayerId: typeof r.perspectivePlayerId === "string" ? r.perspectivePlayerId : null,
    // `declinedDoubles` is the pre-rename key; a round saved under it keeps its
    // answers rather than being asked every question again on resume.
    answeredDoubles: strings(r.answeredDoubles ?? r.declinedDoubles),
  };
}

/** The string members of a value that ought to be a string array. */
function strings(raw: unknown): string[] {
  return Array.isArray(raw) ? raw.filter((x): x is string => typeof x === "string") : [];
}

function migrateBet(raw: unknown): SideBet | null {
  if (!raw || typeof raw !== "object") return null;
  const b = raw as Record<string, unknown>;
  if (typeof b.id !== "string" || !Array.isArray(b.sides)) return null;
  const sides: BetSide[] = [];
  for (const s of b.sides) {
    if (!s || typeof s !== "object") return null;
    const side = s as Record<string, unknown>;
    if (typeof side.id !== "string" || !Array.isArray(side.playerIds)) return null;
    const playerIds = side.playerIds.filter((p): p is string => typeof p === "string");
    if (playerIds.length === 0) return null;
    sides.push({ id: side.id, playerIds });
  }
  if (sides.length < 2) return null;
  if (typeof b.amount !== "number" || !(b.amount > 0)) return null;
  const origin = migrateOrigin(b.origin);
  const startHole = typeof b.startHole === "number" && b.startHole >= 1 ? Math.round(b.startHole) : 1;
  const endHole = typeof b.endHole === "number" && b.endHole >= startHole ? Math.round(b.endHole) : null;
  /**
   * A bet saved before `kind` existed carries `sides` and a `carryover` flag,
   * and the pair says which kind it always was: more than two sides is a pot,
   * and carryover ON in a two-way is the setting that "was quietly turning one
   * game into another" (§12) — so it becomes the game it was already being.
   *
   * Read, not guessed: both readings preserve the tally exactly. A carried
   * two-side bet reopens as skins, which keeps carrying, and at two players
   * skins and head-to-head are arithmetically identical anyway.
   */
  const kind: BetKind =
    b.kind === "skins" || b.kind === "head_to_head"
      ? b.kind
      : sides.length > 2 || b.carryover === true
        ? "skins"
        : "head_to_head";
  return {
    id: b.id,
    kind,
    sides,
    amount: b.amount,
    startHole,
    endHole,
    ...rulesForKind(kind, {
      autoPressAt: typeof b.autoPressAt === "number" ? b.autoPressAt : null,
      pressOnPress: b.pressOnPress === true,
    }),
    origin,
  };
}

function migrateOrigin(raw: unknown): BetOrigin {
  if (!raw || typeof raw !== "object") return { kind: "manual" };
  const o = raw as Record<string, unknown>;
  if (o.kind === "nassau" && (o.leg === "front" || o.leg === "back" || o.leg === "overall")) {
    return { kind: "nassau", leg: o.leg };
  }
  if (o.kind === "double" && typeof o.parentId === "string") {
    return { kind: "double", parentId: o.parentId };
  }
  // A stored `press` is not honoured. Automatic presses DERIVE (see the module
  // doc): one written down by an older build would survive a correction that
  // un-fires it, which is the exact bug the derived design exists to prevent.
  return { kind: "manual" };
}
