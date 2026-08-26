import {
  buildManualBet,
  buildNassauBets,
  nassauAvailable,
  pressRules,
  type BetSide,
  type SideBet,
} from "@/lib/sideBets";

/**
 * The side-bet create form's draft, and the rules for turning it into recorded
 * bets — pure, for the reason the whole feature is (`sideBets.ts`'s doc): the
 * test environment is `node`, so validation living inside the form could only be
 * asserted as "a disabled button rendered", which is true of a button disabled
 * for the wrong reason.
 *
 * The draft is a DRAFT, in the same sense CLAUDE.md #18 uses for game settings:
 * nothing is written until the form commits, so an abandoned form leaves the
 * round exactly as it was.
 */

/** How a draft resolves into bets. `nassau` is one action and three bets
 *  (§5.1/§9) — the option lives here rather than as a second form, because
 *  everything else about the two is identical. */
export type BetDraftKind = "single" | "nassau";

export interface BetDraft {
  kind: BetDraftKind;
  /** Stakes per hole, per side. */
  amount: number;
  /** Where it begins — defaults to the hole you are standing on. */
  startHole: number;
  carryover: boolean;
  autoPressAt: number | null;
  pressOnPress: boolean;
  /** `{ [playerId]: sideIndex }`. A player not in the map is not in the bet —
   *  two people betting inside a foursome is normal, so "out" is the default
   *  rather than a state you have to select. */
  assignment: Record<string, number>;
}

/** The stake chips. Whole dollars, the amounts people actually say out loud. */
export const STAKE_PRESETS = [2, 5, 10, 20] as const;
export const MIN_STAKE = 1;
export const MAX_STAKE = 500;
/** How many sides the assignment control offers. Four is the roster cap. */
export const MAX_BET_SIDES = 4;

export function emptyBetDraft(startHole: number): BetDraft {
  return {
    kind: "single",
    amount: 10,
    startHole: Math.max(1, startHole),
    carryover: false,
    autoPressAt: null,
    pressOnPress: false,
    assignment: {},
  };
}

/**
 * The sides an assignment describes, in side-index order.
 *
 * Side ids are minted HERE, once, at build time — a press copies its parent's
 * sides rather than re-deriving them, so the id only has to be stable within
 * the bet it belongs to.
 */
export function sidesFromAssignment(
  playerIds: string[],
  assignment: Record<string, number>,
  mkId: () => string
): BetSide[] {
  const byIndex = new Map<number, string[]>();
  for (const pid of playerIds) {
    const idx = assignment[pid];
    if (idx == null) continue;
    byIndex.set(idx, [...(byIndex.get(idx) ?? []), pid]);
  }
  return [...byIndex.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([, playerIds]) => ({ id: mkId(), playerIds }));
}

/**
 * Why this draft can't be recorded yet, in the words the form shows — or null.
 *
 * Refusals, not silent disabling: every one of these is a thing the person can
 * fix, and a Save button that is simply grey teaches nothing.
 */
export function betDraftError(
  draft: BetDraft,
  sides: BetSide[],
  ctx: { holeCount: number }
): string | null {
  if (sides.length < 2) return "A bet needs at least two sides. Tap a player to put them in.";
  if (!(draft.amount >= MIN_STAKE)) return `The stake has to be at least $${MIN_STAKE} a hole.`;
  if (draft.amount > MAX_STAKE) return `Keep the stake under $${MAX_STAKE} a hole.`;
  if (draft.startHole < 1 || draft.startHole > ctx.holeCount) {
    return `This round is ${ctx.holeCount} holes — pick a start hole inside it.`;
  }
  if (draft.kind === "nassau" && !nassauAvailable(ctx.holeCount)) {
    return "Nassau needs a front and a back nine.";
  }
  // Automatic press is a two-sided idea: there is no "down" to press from in a
  // four-way skin, so the rule is refused rather than quietly doing nothing.
  if (draft.autoPressAt != null && sides.length !== 2) {
    return "Automatic press only applies to a bet with two sides.";
  }
  return null;
}

/** The bets a valid draft records — one, or Nassau's three. Callers gate on
 *  `betDraftError` first; this assumes a draft that passed it. */
export function buildBetsFromDraft(
  draft: BetDraft,
  sides: BetSide[],
  ctx: { holeCount: number; mkId: () => string }
): SideBet[] {
  const rules = pressRules(draft.autoPressAt, draft.pressOnPress);
  if (draft.kind === "nassau") {
    return buildNassauBets({
      mkId: ctx.mkId,
      sides,
      amount: draft.amount,
      startHole: draft.startHole,
      holeCount: ctx.holeCount,
      carryover: draft.carryover,
      ...rules,
    });
  }
  return [
    buildManualBet({
      mkId: ctx.mkId,
      sides,
      amount: draft.amount,
      startHole: draft.startHole,
      carryover: draft.carryover,
      ...rules,
    }),
  ];
}

/**
 * Apply a change to the press rules, keeping the ☠️ option's dependency honest.
 *
 * Turning automatic press OFF turns presses-on-presses off with it, in the
 * draft and not only in what the form draws. An option that is merely hidden
 * while still set is how a round ends up compounding after someone believed
 * they had switched it off.
 */
export function setPressRules(
  draft: BetDraft,
  next: { autoPressAt?: number | null; pressOnPress?: boolean }
): BetDraft {
  const autoPressAt = next.autoPressAt !== undefined ? next.autoPressAt : draft.autoPressAt;
  const pressOnPress = next.pressOnPress !== undefined ? next.pressOnPress : draft.pressOnPress;
  return { ...draft, ...pressRules(autoPressAt, pressOnPress) };
}

/**
 * The money-language description of what presses-on-presses does (§5/§9: label
 * it in money, not in rules). One string, so the toggle's blurb and any confirm
 * can't describe the same switch two ways.
 *
 * The numbers are the REAL progression, not the handoff's "exposure can double
 * repeatedly": a press is a bet of the SAME size (§3.1), so a $10 round with
 * three of them is four live bets at $40 a hole — which is also the arithmetic
 * §6's own worked example uses. Doubling would be a different rule, and a
 * warning that overstates the number is still a warning that is wrong.
 */
export function pressOnPressBlurb(amount: number, threshold: number | null): string {
  const n = threshold ?? 2;
  return `A press that goes ${n} down starts its own press — $${amount} a hole becomes $${amount * 2}, then $${amount * 3}, then $${amount * 4}, with nobody deciding to.`;
}
