/**
 * The pick'em sheet — every rule about what a sheet IS, with no React, no tRPC
 * and no Supabase in it.
 *
 * Client-safe by construction (CLAUDE.md #8), for the usual reason: the sheet
 * screen, the save path and — in Phase 6 — the scoring engine all have to agree
 * on what "a complete sheet" means, and three implementations of that would
 * agree today and drift on the first change to the slate.
 *
 * ── NOBODY HAS PICKS UNTIL THEY SUBMIT ─────────────────────────────────────
 *
 * This module used to open on the home team in every game, on the reasoning
 * that a sheet is always complete and always valid, with no partial state and
 * no forfeit — so the engine would never have to answer "what if someone
 * picked nine".
 *
 * **The code has never done that.** Rows are written on Save and nowhere else,
 * so a person who never submitted holds no rows and scores zero. Verified on
 * the live game rather than argued: three people with no `pickem_picks` rows
 * and no points, beside sixteen rows on every submitted sheet. The engine has
 * answered the forfeit question correctly since it was built; only the SHEET
 * pretended otherwise, by opening pre-filled with an answer the server would
 * never store unless the person pressed Save.
 *
 * So the default is REMOVED rather than implemented. A fresh sheet has nothing
 * selected, and `All home` / `All away` put the old default one tap away —
 * reproducing it exactly, with the difference that somebody chose it.
 *
 * Three things fall out, and each had a workaround before:
 *
 *   - **You can tell what you picked.** Pre-filled, a home team you chose and
 *     one you never touched rendered identically; the design worked around it
 *     with "untouched in plain text, accent on tap". Now it is structural.
 *   - **The progress count is real.** "All 16 picked" was true of a sheet
 *     nobody had opened, which is why the design left the count out. "12 of 16"
 *     is a fact worth showing.
 *   - **A missing sheet reads as missing.** "Nothing submitted" is what
 *     happened; "Didn't pick" implied a choice.
 *
 * What did NOT change: `_pickem_write_sheet` still refuses an incomplete
 * sheet, so it is still all N or none. `completedPicks` is how that is enforced
 * on the way out — an incomplete sheet cannot be turned into a payload at all,
 * rather than merely having its button disabled.
 */

export type PickSide = "away" | "home";

/**
 * One row of a sheet being edited.
 *
 * `pick` is nullable and that is the whole change: NOT YET CHOSEN is a state a
 * sheet can be in now, and it is the state every sheet starts in.
 *
 * `confidence` is null when the game runs with confidence off — never a stored
 * 1 (migration 146's column comment). The two nulls mean different things and
 * are deliberately not folded together: an unpicked game still has a rank.
 */
export interface SheetPick {
  slateGameId: string;
  pick: PickSide | null;
  confidence: number | null;
}

/**
 * A sheet that can actually be sent — every game called.
 *
 * The narrowing exists so an incomplete sheet is UNSENDABLE rather than merely
 * disabled. A disabled button is a promise the caller can forget to keep;
 * `completedPicks` returning null is one `tsc` enforces at the only place a
 * payload is built.
 */
export interface SubmittedPick {
  slateGameId: string;
  pick: PickSide;
  confidence: number | null;
}

/** Only the fields the sheet reasons about. Structural on purpose: the router's
 *  slate row satisfies it, and so does a test fixture, without either importing
 *  a type from the other. */
export interface SheetSlateGame {
  id: string;
  spread?: string | null;
  multiplier?: number;
}

export interface SheetSettings {
  useConfidence: boolean;
  rollUp: "team_totals" | "individual_matches";
}

/**
 * The sheet everyone starts with: NOTHING picked, slate order.
 *
 * ── The ranking still has a default, and the pick does not ────────────────
 *
 * They are different kinds of thing. A ranking is an ORDER over games, and
 * every order is as valid as any other — the runner's own slate order is the
 * one the picker just read the games in, so starting there is coherent rather
 * than arbitrary and costs nobody an opinion they did not hold.
 *
 * A pick is a CLAIM about a contest, and there is no neutral one. Home was
 * chosen because it wins more often than not and is the same for everybody,
 * which is a fine tiebreak and a poor default: it put an opinion on the sheet
 * that the person had not formed, and then scored it.
 *
 * Rank N..1 by position, so a 16-game slate hands game 1 a 16.
 */
export function emptySheet(slate: SheetSlateGame[], useConfidence = true): SheetPick[] {
  const n = slate.length;
  return slate.map((g, i) => ({
    slateGameId: g.id,
    pick: null,
    confidence: useConfidence ? n - i : null,
  }));
}

/**
 * Both shortcuts, in one function — All home and All away.
 *
 * Sets PICKS ONLY. The ranking is untouched by design: the shortcut is for
 * somebody who does not want to make sixteen calls, and re-ordering their list
 * as a side effect would be a second decision they did not ask for. It is also
 * what makes "All home, then Save" reproduce the old default sheet exactly,
 * ranking included — the same sheet, now chosen.
 */
export function fillAll(picks: SheetPick[], side: PickSide): SheetPick[] {
  return picks.map((p) => ({ ...p, pick: side }));
}

/** How many games still have no call — the number beside a disabled Save. */
export function unpickedCount(picks: SheetPick[]): number {
  return picks.filter((p) => p.pick == null).length;
}

/**
 * The payload — the games actually picked, and only those.
 *
 * ── It used to return null for an unfinished sheet ────────────────────────
 *
 * That was the client half of migration 150's completeness gate, and both are
 * gone (migration 166). A sheet may now be saved at any point, so the question
 * this answers changed from "is it sendable" to "what is there to send".
 *
 * Unpicked games are DROPPED rather than sent as nulls, because the server
 * cannot store them — `pickem_picks.pick` is NOT NULL, so a row exists only for
 * a game with a pick. Dropping them is also what makes the write a REPLACE: the
 * RPC deletes rows this sheet holds that the payload does not name, so a game
 * left out here is a game whose pick is cleared. Sending nulls would have
 * needed a second convention for the same fact.
 */
export function submittablePicks(picks: SheetPick[]): SubmittedPick[] {
  const out: SubmittedPick[] = [];
  for (const p of picks) {
    if (p.pick == null) continue;
    out.push({ slateGameId: p.slateGameId, pick: p.pick, confidence: p.confidence });
  }
  return out;
}

/** Is every game called? Still worth naming — it decides the RANK rule the
 *  server applies, and nothing else now. */
export function sheetComplete(picks: SheetPick[]): boolean {
  return picks.length > 0 && picks.every((p) => p.pick != null);
}

export interface ReconciledSheet {
  /**
   * Folded onto the current slate — NOT necessarily complete. Completeness is
   * the person's job now, and `unpickedCount` is how far off they are.
   */
  picks: SheetPick[];
  /**
   * True when the person had a sheet and its ranking is no longer theirs — a
   * reopen cleared it (migration 150), or the slate moved under it. The screen
   * must SAY so; a silently re-defaulted ranking reads as one they chose.
   */
  rankingReset: boolean;
  /** True when they have saved this sheet at least once. Spec §4's "submitted",
   *  which is not the same as locked and does not stop them editing. */
  submitted: boolean;
}

/**
 * Fold whatever the server holds onto the CURRENT slate.
 *
 * The four inputs this has to survive, all reachable:
 *
 *   1. nothing stored — an EMPTY sheet, nothing selected
 *   2. a full stored sheet matching the slate — return it
 *   3. stored picks whose ranks were nulled by a reopen — keep the WINNERS,
 *      re-default the ranking, and raise `rankingReset`
 *   4. a slate that gained or lost games since the sheet was saved — keep the
 *      picks that still have a game, leave the new ones UNPICKED, ranking reset
 *
 * Case 4 is where the removed default did real harm: a runner adding a
 * seventeenth game silently answered it for everybody, and the next Save
 * submitted an opinion nobody had been shown.
 *
 * Cases 3 and 4 collapse into one test: **is the stored ranking still exactly
 * 1..N over this slate?** If it is, it is usable whatever happened. If it is
 * not — a hole, a duplicate, a rank above N, a null — it is not a ranking of
 * this slate and no part of it is salvageable.
 *
 * That is the decision in HANDOFF §7.2 and it is deliberately all-or-nothing.
 * Compacting the survivors (1,2,4,5 → 1,2,3,4) produces a complete, plausible
 * ranking that the person did not choose and cannot tell apart from one they
 * did — the worst available outcome, because it is the one nobody checks.
 */
export function reconcileSheet(
  slate: SheetSlateGame[],
  stored: SheetPick[],
  settings: SheetSettings
): ReconciledSheet {
  const byGame = new Map(stored.map((p) => [p.slateGameId, p]));
  const submitted = stored.length > 0;

  // `?? null` — a game with nothing stored is UNPICKED, not a home pick. On a
  // first-time sheet that is every game; on a sheet whose slate has grown since
  // it was saved it is exactly the new games, which is the right answer for
  // both without a branch.
  const winners: SheetPick[] = slate.map((g, i) => ({
    slateGameId: g.id,
    pick: byGame.get(g.id)?.pick ?? null,
    confidence: slate.length - i,
  }));

  if (!settings.useConfidence) {
    // Confidence off: no ranking exists, so none can have been reset. Returning
    // `rankingReset: true` here would put a banner about ranking on a screen
    // that has no ranking — spec §5's falsehood rule, one layer down.
    return { picks: winners.map((p) => ({ ...p, confidence: null })), rankingReset: false, submitted };
  }

  const storedRanks = slate.map((g) => byGame.get(g.id)?.confidence ?? null);
  if (isCompleteRanking(storedRanks, slate.length)) {
    return {
      picks: winners.map((p, i) => ({ ...p, confidence: storedRanks[i] as number })),
      rankingReset: false,
      submitted,
    };
  }

  /**
   * ── A PARTIAL SHEET HAS A PARTIAL RANKING, AND THAT IS NORMAL ────────────
   *
   * Ranks for unpicked games are not stored and cannot be: `pick` is NOT NULL,
   * so no row exists for a game with no pick (migration 166). A sheet with
   * three of sixteen picked therefore comes back with three ranks and thirteen
   * nulls — which `isCompleteRanking` correctly rejects, and which is not a
   * reset, a loss, or anything the person did.
   *
   * Before this, that fell through to the branch below and raised
   * `rankingReset` on every reload of every partial sheet — announcing a loss
   * that had not happened, every time. Sixth instance of empty-versus-something
   * in this feature, and it arrived through a predicate that was correct when
   * it was written: partial sheets could not exist then.
   *
   * So the order is REBUILT rather than defaulted. Each game sorts by the rank
   * it has — its stored one if it was picked, its slate-order default if it was
   * not — and the result is renumbered N..1. A picked game keeps its place
   * relative to the others; an unpicked game lands where it would have started.
   *
   * That is the honest half of the trade: the person's drag of an unpicked row
   * is not restored, because it was never stored, and showing a remembered
   * order that cannot be reproduced is worse than showing the default. An
   * unpicked game's rank is not a preference anyway — confidence is how sure
   * you are about a pick.
   */
  if (usableSubsetRanking(storedRanks, slate.length)) {
    const bySortKey = slate
      .map((g, i) => ({
        id: g.id,
        // The rank it holds, or the one it would have started with.
        key: byGame.get(g.id)?.confidence ?? slate.length - i,
        // Ties are possible — a stored 14 beside an unpicked game whose default
        // is also 14 — and slate order breaks them, which is the same rule the
        // default itself follows.
        at: i,
      }))
      .sort((a, b) => b.key - a.key || a.at - b.at);
    const rank = new Map(bySortKey.map((x, i) => [x.id, slate.length - i]));
    return {
      picks: winners.map((p) => ({ ...p, confidence: rank.get(p.slateGameId) ?? p.confidence })),
      // NOT a reset. Nothing was lost that was ever kept.
      rankingReset: false,
      submitted,
    };
  }

  // Defaults are already on `winners`. The person is told only if they HAD
  // something to lose — a first-time picker has not had a ranking reset, they
  // have simply not ranked yet, and telling them otherwise is confusing.
  //
  // Reached now only when a sheet HAS rows and NONE of them carries a rank,
  // which is what migration 150's reopen left behind: the winners survived and
  // every rank was nulled. That is a real reset and still says so.
  return { picks: winners, rankingReset: submitted, submitted };
}

/**
 * Are the ranks that ARE present usable as a partial ranking of this slate?
 *
 * In range, and no two the same — the weaker of migration 166's two rules, and
 * deliberately the same one. A partial sheet's ranks are a subset of 1..N with
 * gaps where the unpicked games sit, and that is a ranking of this slate.
 *
 * ── The distinction this draws, which is the whole point ──────────────────
 *
 * A rank OUTSIDE 1..N is not a sparse ranking of this slate; it is a ranking of
 * a DIFFERENT slate, left behind when games were removed. Rank 4 over three
 * games cannot be salvaged, and the salvage is what makes it dangerous:
 * re-sorting by it produces a complete, plausible order that the person did not
 * choose and cannot tell apart from one they did.
 *
 * The first build of the partial rebuild missed this and re-sorted by any
 * stored rank at all — reintroducing exactly the compaction the reconciliation
 * rule has always forbidden. The test that forbids it is what caught it.
 */
export function usableSubsetRanking(ranks: (number | null)[], n: number): boolean {
  const seen = new Set<number>();
  for (const r of ranks) {
    if (r == null) continue;
    if (!Number.isInteger(r) || r < 1 || r > n) return false;
    if (seen.has(r)) return false;
    seen.add(r);
  }
  return seen.size > 0;
}

/** Exactly 1..N, each once, no nulls. The same set test `save_pickem_picks`
 *  applies server-side — stated twice because one of them is a gate and the
 *  other is what stops the client sending something the gate will refuse. */
export function isCompleteRanking(ranks: (number | null)[], n: number): boolean {
  if (ranks.length !== n) return false;
  const seen = new Set<number>();
  for (const r of ranks) {
    if (r == null || !Number.isInteger(r) || r < 1 || r > n) return false;
    if (seen.has(r)) return false;
    seen.add(r);
  }
  return true;
}

/**
 * The ranking as an ORDER — highest confidence first, which is the order the
 * drag list renders in.
 *
 * `ReorderableList` speaks in `string[]` and nothing else; keeping the
 * conversion here means the component never learns what a confidence is, and
 * the ranking never exists in two representations at once inside the screen.
 */
export function rankedOrder(picks: SheetPick[]): string[] {
  return [...picks]
    .sort((a, b) => (b.confidence ?? 0) - (a.confidence ?? 0))
    .map((p) => p.slateGameId);
}

/** The inverse: a new order becomes ranks N..1 by position. */
export function applyOrder(picks: SheetPick[], orderedIds: string[]): SheetPick[] {
  const rank = new Map(orderedIds.map((id, i) => [id, orderedIds.length - i]));
  return picks.map((p) => ({ ...p, confidence: rank.get(p.slateGameId) ?? p.confidence }));
}

/**
 * Set or CLEAR one game's winner, leaving the ranking alone.
 *
 * Null is a real argument now. Tapping the team you already took un-takes it,
 * which is the only way back to "I have not decided" — and without it the very
 * first tap on a row would be irreversible, on a sheet whose whole premise is
 * that an opinion has to be given rather than assumed. It is also what keeps
 * the progress count honest: it has to be able to go down.
 */
export function setPick(
  picks: SheetPick[],
  slateGameId: string,
  pick: PickSide | null
): SheetPick[] {
  return picks.map((p) => (p.slateGameId === slateGameId ? { ...p, pick } : p));
}

/** Order-insensitive equality — the dirty check. Compared as a keyed map rather
 *  than by index, because the drag list reorders the array without the SHEET
 *  having changed in any way the server cares about. */
export function sheetsEqual(a: SheetPick[], b: SheetPick[]): boolean {
  if (a.length !== b.length) return false;
  const m = new Map(a.map((p) => [p.slateGameId, p]));
  return b.every((p) => {
    const other = m.get(p.slateGameId);
    return !!other && other.pick === p.pick && (other.confidence ?? null) === (p.confidence ?? null);
  });
}

// ── the explanation ────────────────────────────────────────────────────────

export interface ExplanationParagraph {
  /** Stable id, so a test asserts WHICH paragraphs render rather than matching
   *  prose that will be reworded. */
  id:
    | "how-to-pick"
    | "spreads"
    | "scoring"
    | "multipliers"
    | "head-to-head"
    | "edge"
    | "team-totals"
    | "points-placement";
  text: string;
}

/**
 * "How this works", assembled from the settings.
 *
 * ── Copy is not decoration here ────────────────────────────────────────────
 *
 * Spec §5: **copy describing a mechanic that is not in play is a falsehood**,
 * the same defect as the "Not live — scoring disabled" line that Phase 2's look
 * found on a game whose picks were open. Two settings and two slate facts each
 * remove real paragraphs:
 *
 *   * confidence off  → every sentence about ranking goes, including the half
 *     of the head-to-head argument that turns on being "more certain"
 *   * team totals     → every sentence about playing one person goes
 *   * no multipliers  → the 2× paragraph goes; a slate with none of them is the
 *     common case and the paragraph would be a rule about nothing
 *   * no spreads      → same
 *
 * Assembling it rather than branching over four hand-written blocks is what
 * keeps the combinations honest: there are 2×2×2×2 of them, nobody is going to
 * proofread sixteen blocks, and the two that ship most are not the two anyone
 * writes first.
 */
/** Blank line between paragraphs, for callers flattening `explanationCopy`
 *  into a single free-text block (the Rules of the Day starter). */
export const PARA_BREAK = "\n\n";

export function explanationCopy(
  settings: SheetSettings,
  slate: SheetSlateGame[],
  /**
   * The COMPETITION's scoring model (Phase 7). Points makes this an ordering of
   * N teams paid by placement, and makes `roll_up` inert — so it is read before
   * the roll-up rather than beside it.
   */
  opts: { pointsMode?: boolean } = {}
): ExplanationParagraph[] {
  const n = slate.length;
  const conf = settings.useConfidence;
  const pointsMode = opts.pointsMode === true;
  /**
   * Head-to-head is a MATCH-PLAY concept. In a points cup you are contributing
   * to a total, so "you have to be right where they're wrong" is false — there
   * is nobody whose wrongness helps you.
   *
   * This is the tenth instance in this feature of copy naming a mechanic that
   * is not in play, which is why it is a condition on the roll-up rather than
   * another edit: the roll-up is inert in a points cup, so anything derived
   * from it has to be too.
   */
  const h2h = !pointsMode && settings.rollUp === "individual_matches";
  const hasMultipliers = slate.some((g) => (g.multiplier ?? 1) > 1);
  const hasSpreads = slate.some((g) => !!g.spread);

  const out: ExplanationParagraph[] = [];

  out.push({
    id: "how-to-pick",
    text: conf
      ? `Pick a winner in all ${n} games, then rank them 1 to ${n} — ${n} on the game you're surest about, 1 on the coin flip.`
      : `Pick a winner in all ${n} games. That's the whole sheet.`,
  });

  if (hasSpreads) {
    out.push({
      id: "spreads",
      text: "Where a spread is shown, pick against it — not just who wins.",
    });
  }

  out.push({
    id: "scoring",
    text: conf
      ? "Get it right and you score what you ranked it. Get it wrong and you score nothing."
      : "Get it right and you score a point. Get it wrong and you score nothing.",
  });

  if (hasMultipliers) {
    out.push({
      id: "multipliers",
      text: conf
        ? "A game marked 2× pays double, so it's worth more than its rank suggests — spend your confidence accordingly."
        : "A game marked 2× pays double.",
    });
  }

  if (h2h) {
    out.push({
      id: "head-to-head",
      text: "You're playing one person on the other team, head to head. Highest total wins.",
    });
    out.push({
      id: "edge",
      text: conf
        ? "So being right isn't enough — you have to be right where they're wrong, or more certain than they are. You both took the same team? Whoever ranked it higher takes the points."
        : "So being right isn't enough — you have to be right where they're wrong. Games you both call the same way cancel out.",
    });
  } else if (pointsMode) {
    out.push({
      id: "points-placement",
      // No "the higher total", which is two-team language and the same trap one
      // level down: with four teams the payout is a POSITION, not a winner.
      text: "Every sheet on your team adds into one team total. The teams finish in order, and each place pays out.",
    });
  } else {
    out.push({
      id: "team-totals",
      text: "Every sheet on your side adds into one team total, and the higher total takes the points.",
    });
  }

  return out;
}

/**
 * Does moving from one slate to another invalidate every ranking?
 *
 * The id SET, and nothing else. A ranking is a permutation of 1..N over the
 * slate, so gaining or losing a game destroys it while reordering,
 * re-spreading or re-weighting one leaves it a perfectly good ranking of the
 * same N games.
 *
 * ── Why this is a named function and not an inline comparison ──────────────
 *
 * The identical test runs in `save_pickem_config` as
 * `v_prior IS DISTINCT FROM v_keep` (migration 156), and that one decides
 * whether sixteen people's rankings are actually deleted. This one only decides
 * whether they are WARNED first. Two spellings of the same question, one of
 * them destructive, is how a screen ends up promising something the server does
 * not do — so the client half is written once, here, next to the reconciliation
 * rule it has to agree with.
 *
 * The client can never suppress the clear by disagreeing: the server does not
 * consult it.
 */
export function slateSetChanged(
  before: { id: string }[],
  after: { id: string }[]
): boolean {
  const a = new Set(before.map((g) => g.id));
  const b = new Set(after.map((g) => g.id));
  if (a.size !== b.size) return true;
  for (const id of b) if (!a.has(id)) return true;
  return false;
}
