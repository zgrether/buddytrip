import {
  buildManualBet,
  buildNassauBets,
  nassauAvailable,
  rulesForKind,
  type BetKind,
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
  shape: BetDraftKind;
  /** Head-to-head or a pot (§11/§12). Forced to `skins` above two players —
   *  there is no three-way head-to-head, since "who pays whom" has no coherent
   *  answer with three sides. */
  kind: BetKind;
  /** Stakes per hole. Head-to-head: what changes hands. Skins: what each
   *  player puts IN — the skin itself is `stake × players`, derived. */
  amount: number;
  /** Where it begins — defaults to the hole you are standing on. */
  startHole: number;
  autoPressAt: number | null;
  pressOnPress: boolean;
  /**
   * Who is in, by player id (§10). A SET, not a side assignment: the old
   * per-player button cycling `OUT → SIDE 1 → SIDE 2 …` needed a sentence of
   * instructions to explain, and a control needing a sentence is usually the
   * wrong control. Everyone in is their own side; at exactly two that is the
   * head-to-head pairing, above two it is the pot.
   */
  whoIsIn: string[];
}

/** The stake chips. Whole dollars, the amounts people actually say out loud. */
export const STAKE_PRESETS = [2, 5, 10, 20] as const;
export const MIN_STAKE = 1;
export const MAX_STAKE = 500;
/** How many sides the assignment control offers. Four is the roster cap. */
export const MAX_BET_SIDES = 4;

export function emptyBetDraft(startHole: number): BetDraft {
  return {
    shape: "single",
    kind: "head_to_head",
    amount: 10,
    startHole: Math.max(1, startHole),
    autoPressAt: null,
    pressOnPress: false,
    whoIsIn: [],
  };
}

/** Toggle a player in or out, keeping the kind coherent: above two players
 *  head-to-head cannot apply, so the draft becomes a pot rather than offering
 *  a choice that has no meaning (§11). Dropping back to two leaves the kind
 *  alone — skins at two is legitimate and identical. */
export function toggleWhoIsIn(draft: BetDraft, playerId: string): BetDraft {
  const inNow = draft.whoIsIn.includes(playerId);
  const whoIsIn = inNow
    ? draft.whoIsIn.filter((id) => id !== playerId)
    : [...draft.whoIsIn, playerId];
  const kind: BetKind = whoIsIn.length > 2 ? "skins" : draft.kind;
  return { ...draft, whoIsIn, kind, ...rulesForKind(kind, draft) };
}

/**
 * Replace who is in outright — the Everyone / Clear control.
 *
 * Routed through the same kind rule as `toggleWhoIsIn` rather than assigning
 * `whoIsIn` directly: tapping Everyone in a foursome has to make the bet a pot
 * for exactly the reason tapping the fourth chip does, and two paths to the
 * same state is how one of them forgets.
 */
export function setWhoIsIn(draft: BetDraft, playerIds: string[]): BetDraft {
  const kind: BetKind = playerIds.length > 2 ? "skins" : draft.kind;
  return { ...draft, whoIsIn: playerIds, kind, ...rulesForKind(kind, draft) };
}

/** Set the bet kind, dropping any rule the new kind does not carry. */
export function setBetKind(draft: BetDraft, kind: BetKind): BetDraft {
  return { ...draft, kind, ...rulesForKind(kind, draft) };
}

/** Head-to-head is only offered at exactly two players (§11). */
export function canBeHeadToHead(draft: BetDraft): boolean {
  return draft.whoIsIn.length <= 2;
}

/**
 * The sides an assignment describes, in side-index order.
 *
 * Side ids are minted HERE, once, at build time — a press copies its parent's
 * sides rather than re-deriving them, so the id only has to be stable within
 * the bet it belongs to.
 */
export function sidesFromWhoIsIn(
  playerIds: string[],
  whoIsIn: string[],
  mkId: () => string
): BetSide[] {
  // Roster order, not tap order — the bet reads the way the card does.
  return playerIds.filter((p) => whoIsIn.includes(p)).map((pid) => ({ id: mkId(), playerIds: [pid] }));
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
  if (sides.length < 2) return "Pick at least two players.";
  if (!(draft.amount >= MIN_STAKE)) return `The stake has to be at least $${MIN_STAKE} a hole.`;
  if (draft.amount > MAX_STAKE) return `Keep the stake under $${MAX_STAKE} a hole.`;
  if (draft.startHole < 1 || draft.startHole > ctx.holeCount) {
    return `This round is ${ctx.holeCount} holes — pick a start hole inside it.`;
  }
  if (draft.shape === "nassau" && !nassauAvailable(ctx.holeCount)) {
    return "Nassau needs a front and a back nine.";
  }
  if (draft.shape === "nassau" && draft.kind === "skins") {
    return "Nassau is a head-to-head bet — it needs exactly two players.";
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
  if (draft.shape === "nassau") {
    return buildNassauBets({
      mkId: ctx.mkId,
      sides,
      amount: draft.amount,
      startHole: draft.startHole,
      holeCount: ctx.holeCount,
      autoPressAt: draft.autoPressAt,
      pressOnPress: draft.pressOnPress,
    });
  }
  return [
    buildManualBet({
      mkId: ctx.mkId,
      kind: draft.kind,
      sides,
      amount: draft.amount,
      startHole: draft.startHole,
      autoPressAt: draft.autoPressAt,
      pressOnPress: draft.pressOnPress,
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
  // Routed through `rulesForKind` so a press cannot be set on a pot even by a
  // caller that forgot to check — the gating is the data's, not the form's.
  return { ...draft, ...rulesForKind(draft.kind, { autoPressAt, pressOnPress }) };
}

