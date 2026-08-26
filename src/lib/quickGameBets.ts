import {
  computeSideBets,
  lastHoleDoubleOffers,
  nassauAvailable,
  nextHoleValue,
  playerTotal,
  type BetScoring,
  type BetSide,
  type DoubleOffer,
  type SideBetsResult,
} from "@/lib/sideBets";
import {
  isMatchGame,
  quickGamePips,
  quickGameUnits,
  quickMatchDecided,
  type QuickGameState,
  type QuickMatchState,
} from "@/lib/quickGame";

/**
 * The adapter between a saved Quick round and the pure side-bet rules — the ONE
 * place Quick Play's state shape meets `sideBets.ts`, in the same spirit as
 * `quickMatchGroupData` for the entry views. The rules module learns nothing
 * about local storage; this file learns nothing about money.
 *
 * Its whole job is answering "who won this hole" the way the round already
 * answers it, so the tracker and the scoreboard cannot disagree (CLAUDE.md #8).
 * That means routing a match through `quickMatchDecided` rather than
 * re-deriving hole winners from `values` — the two would drift the first time a
 * relative handicap or an entry-mode difference came up.
 *
 * **Glorious Finishing Holes does not touch the money.** It doubles what a hole
 * is worth in the MATCH, and a bet is worth its stake per hole with carryover
 * as its own doubling mechanic; nothing in the handoff couples them, and
 * silently making the last three holes worth double the cash is exactly the
 * "how did a $5 bet become $40" surprise §6 exists to prevent.
 */

/** The round's hole numbers — course-driven via the shared `quickGameUnits`,
 *  so a nine-hole round is nine holes here too and no literal 18 appears. */
export function quickBetHoles(state: QuickGameState): number[] {
  return quickGameUnits(state).map((_, i) => i + 1);
}

/**
 * How this round's holes are decided, in the shape the rules module takes.
 *
 * A MATCH round is `outcome` in BOTH entry modes. Outcome mode records the
 * winner directly; score mode has one ball per side, so there is no per-player
 * net to hand over either — and `quickMatchDecided` already resolves both,
 * relative handicap included. Everything else is `net`: gross minus a stroke on
 * a pipped hole, using the SAME `quickGamePips` the entry screen and the
 * standings run on.
 */
export function quickBetScoring(state: QuickGameState): BetScoring {
  if (isMatchGame(state)) return matchScoring(state);
  const units = quickGameUnits(state);
  const pips = quickGamePips(state);
  const net: Record<string, Record<number, number>> = {};
  for (const p of state.players) {
    const row: Record<number, number> = {};
    units.forEach((u, i) => {
      const gross = state.values[p.id]?.[u.label];
      if (gross == null) return;
      row[i + 1] = gross - (pips[p.id]?.has(u.label) ? 1 : 0);
    });
    net[p.id] = row;
  }
  return { mode: "net", net };
}

function matchScoring(state: QuickMatchState): BetScoring {
  const outcomes: Record<number, "side_a" | "side_b" | "halved"> = {};
  for (const d of quickMatchDecided(state)) {
    outcomes[d.hole] = d.result === "W" ? "side_a" : d.result === "L" ? "side_b" : "halved";
  }
  return {
    mode: "outcome",
    sideA: state.sideA.playerIds,
    sideB: state.sideB.playerIds,
    outcomes,
  };
}

/** The whole derived tally for a saved round. Every side-bet surface calls
 *  THIS — the strip, the hole line, the breakdown, the final settlement — so
 *  none of them can compute a different total from the same round. */
export function quickSideBets(state: QuickGameState): SideBetsResult {
  return computeSideBets({
    holes: quickBetHoles(state),
    bets: state.bets.bets,
    scoring: quickBetScoring(state),
  });
}

/** Does this round have any bets at all? The gate on every side-bet surface:
 *  false means nothing renders and the round is exactly what it was (§7). */
export function quickHasBets(state: QuickGameState | null): boolean {
  return (state?.bets.bets.length ?? 0) > 0;
}

/**
 * Whether a bet's sides are the round's to choose.
 *
 * In a MATCH round they are not, and this is a fact about the data rather than
 * a shortcut: an outcome names the match's two sides and nothing else, and a
 * score-mode match has one ball per side, so a Zach-against-Cal bet inside a
 * 2v2 has no per-player result to settle it. §2.1's "accept or change it"
 * applies to the rounds that actually carry per-player scores.
 */
export function quickBetSidesLocked(state: QuickGameState): boolean {
  return isMatchGame(state);
}

/**
 * The sides a new bet starts with. A match hands its two sides over for free
 * (§2.1) — which is the whole reason the pre-fill exists — and a stroke or rack
 * round with exactly two players has only one possible pairing, so it gets the
 * same treatment. Anything larger starts unassigned: two people betting inside
 * a foursome is normal, and guessing which two is worse than asking.
 */
export function quickBetDefaultSides(state: QuickGameState, mkId: () => string): BetSide[] {
  if (isMatchGame(state)) {
    return [
      { id: state.sideA.id, playerIds: state.sideA.playerIds },
      { id: state.sideB.id, playerIds: state.sideB.playerIds },
    ];
  }
  if (state.players.length === 2) {
    return state.players.map((p) => ({ id: mkId(), playerIds: [p.id] }));
  }
  return [];
}

/** Everyone in this round, as one side each — the skins preset. */
export function quickBetEveryoneSides(state: QuickGameState, mkId: () => string): BetSide[] {
  return state.players.map((p) => ({ id: mkId(), playerIds: [p.id] }));
}

/** A side's display name: the players' first names, joined — the same shape
 *  `quickSideName` gives a match side, applied to any betting side. */
export function quickBetSideName(state: QuickGameState, side: BetSide): string {
  const byId = new Map(state.players.map((p) => [p.id, p]));
  const names = side.playerIds.map((id) => byId.get(id)?.name.split(/\s+/)[0] ?? "Player");
  return names.join(" & ") || "Side";
}

/** Whose number the live banner reads. Falls back to the first player entered
 *  when nothing has been chosen, or when the chosen player has since been
 *  removed from the roster (which the always-open roster editor allows). */
export function quickBetPerspective(state: QuickGameState): string | null {
  const stored = state.bets.perspectivePlayerId;
  if (stored && state.players.some((p) => p.id === stored)) return stored;
  return state.players[0]?.id ?? null;
}

/** Nassau needs a front and a back nine to be about — hidden, not offered
 *  broken, on a nine-hole round (§5.1). */
export function quickNassauAvailable(state: QuickGameState): boolean {
  return nassauAvailable(quickBetHoles(state).length);
}

/** The last-hole double prompts, if the round is at that point (§3.2). */
export function quickDoubleOffers(state: QuickGameState, result: SideBetsResult): DoubleOffer[] {
  return lastHoleDoubleOffers(result, quickBetHoles(state), state.bets.declinedDoubles);
}

/** Everything the live strip shows, in one derived object.
 *
 *  `total` is the round's total for the perspective player and is NOT a
 *  function of the hole being viewed — there is no hole argument here, which is
 *  the mechanism behind "the banner reads the same on every hole" (§6/§9)
 *  rather than a rule someone has to remember at the call site. */
export function quickBetStrip(state: QuickGameState, result: SideBetsResult): {
  perspectivePlayerId: string | null;
  perspectiveName: string;
  total: number;
  exposure: SideBetsResult["exposure"];
  /** What the next hole is worth, carryovers included. */
  nextHole: number;
  nextHoleNumber: number;
} {
  const pid = quickBetPerspective(state);
  const name = state.players.find((p) => p.id === pid)?.name.split(/\s+/)[0] ?? "You";
  return {
    perspectivePlayerId: pid,
    perspectiveName: name,
    total: playerTotal(result, pid),
    exposure: result.exposure,
    nextHole: nextHoleValue(result),
    nextHoleNumber: result.playedThrough + 1,
  };
}
