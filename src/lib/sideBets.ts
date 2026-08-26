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
 * `skins` — a pot. Everyone in contributes the stake, low net takes the whole
 * thing, and a tie carries it to the next hole. Carryover is not a setting
 * here, it is the entire point. Presses are meaningless: in a pot there is no
 * "down two to someone", there are three other people and a running total.
 *
 * **The arithmetic is the same either way** and always was — the winner
 * collects the stake from every other side, which for four players at $10 is
 * +$30 and three × −$10, i.e. a $40 pot taken by one person. What differs is
 * what is OFFERED (presses, carryover) and what is DISPLAYED (`holeValue`).
 * At two players the two kinds are identical, which needs no special case.
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
  /** Stakes per hole, in whole currency units, per SIDE. */
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
  /** The standing rate: the sum of the stakes of every live bet. */
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
    amount: parent.amount,
    startHole: triggerHole + 1,
    endHole: null, // §3.3 — to the end of the round, not to where the original ends
    carryover: parent.carryover,
    autoPressAt: parent.pressOnPress ? parent.autoPressAt : null,
    pressOnPress: parent.pressOnPress,
    origin: { kind: "press", parentId: parent.id, level },
  };
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
 * What a hole is WORTH, as the tracker says it — distinct from `pot`, which is
 * what each side has at risk (§11's "two numbers, two names").
 *
 * Head-to-head: the stake, because that is what changes hands.
 * Skins: the stake times everyone in, because that is the pot — four at $10 is
 * a $40 skin, and three carries makes it $160.
 *
 * Derived, never set: the setup asks what you are each putting in, and this is
 * the only place that turns it into what the hole is worth.
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
    case "nassau":
      return bet.origin.leg === "front" ? "Front 9" : bet.origin.leg === "back" ? "Back 9" : "Overall";
    case "press":
      return `Press ${bet.origin.level}`;
    case "double":
      return "Last hole";
    default:
      return bet.kind === "skins" ? "Skins" : "Bet";
  }
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
    const pot = bet.amount * (1 + carried);
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
    tallies.reduce((sum, t) => sum + (liveOn(t.bet, hole, lastHole) ? t.bet.amount : 0), 0);

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

  const liveBets = tallies.filter((t) => t.live);
  const perHole = liveBets.reduce((s, t) => s + t.bet.amount, 0);
  const baseStake = liveBets
    .filter((t) => t.bet.origin.kind !== "press")
    .reduce((s, t) => s + t.bet.amount, 0);

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
  /** Stakes of the double: twice the parent's, for one hole. */
  amount: number;
}

/**
 * Whether to prompt for a last-hole double, and on which bets.
 *
 * Offered once the second-to-last hole is in and the last one isn't — "after
 * the 17th is entered" on a full round, and after the 8th on a nine (§8), which
 * falls out of counting from the round's real length rather than from 18.
 *
 * A PROMPT, never automatic (§9): it is a decision, and the app doing it to you
 * is exactly the thing that makes a bet feel like it got away from someone.
 * Only two-sided bets with someone actually behind are offered — there is no
 * "down" to offer a double to in a tied bet or a four-way skin.
 */
export function lastHoleDoubleOffers(
  result: SideBetsResult,
  holes: number[],
  declinedParentIds: string[] = []
): DoubleOffer[] {
  const sorted = [...holes].sort((a, b) => a - b);
  const lastHole = sorted[sorted.length - 1];
  if (lastHole == null || sorted.length < 2) return [];
  const penultimate = sorted[sorted.length - 2];
  if (result.playedThrough !== penultimate) return [];
  const declined = new Set(declinedParentIds);

  const offers: DoubleOffer[] = [];
  for (const t of result.bets) {
    if (declined.has(t.bet.id)) continue;
    if (t.bet.origin.kind === "double") continue;
    if (t.bet.sides.length !== 2) continue;
    if (!t.live) continue;
    const [a, b] = t.bet.sides;
    const va = t.totals[a.id] ?? 0;
    const vb = t.totals[b.id] ?? 0;
    if (va === vb) continue;
    offers.push({
      bet: t.bet,
      trailingSideId: va < vb ? a.id : b.id,
      leadingSideId: va < vb ? b.id : a.id,
      amount: t.bet.amount * 2,
    });
  }
  return offers;
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

/** What the NEXT hole is worth across every live bet, carryovers included —
 *  the "the 7th is worth $40" fact (§6). Distinct from `exposure.perHole`,
 *  which is the standing rate. */
export function nextHoleValue(result: SideBetsResult): number {
  const line = result.holeLines.find((l) => l.hole === result.playedThrough + 1);
  return line?.pot ?? 0;
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
  /** Bet ids whose last-hole double was declined, so the prompt asks once. */
  declinedDoubles: string[];
}

export const EMPTY_SIDE_BETS: SideBetsState = {
  bets: [],
  perspectivePlayerId: null,
  declinedDoubles: [],
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
    declinedDoubles: Array.isArray(r.declinedDoubles)
      ? r.declinedDoubles.filter((x): x is string => typeof x === "string")
      : [],
  };
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
