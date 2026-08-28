/**
 * The pick'em sheet — every rule about what a sheet IS, with no React, no tRPC
 * and no Supabase in it.
 *
 * Client-safe by construction (CLAUDE.md #8), for the usual reason: the sheet
 * screen, the save path and — in Phase 6 — the scoring engine all have to agree
 * on what "a complete sheet" means, and three implementations of that would
 * agree today and drift on the first change to the slate.
 *
 * ── The one idea everything here follows from ───────────────────────────────
 *
 * **A sheet is always complete and always valid** (spec §4). There is no
 * partial state, no "not started", no forfeit. Everyone begins with the home
 * team in every game and the runner's slate order as their ranking, and PICKING
 * IS EDITING. That is not a convenience — it is what removes the entire class
 * of "what happens if someone only picked nine" from the engine, the board, and
 * every screen downstream.
 *
 * So `reconcile` never returns something unsubmittable. Given a slate that has
 * changed underneath a stored sheet, given ranks that were cleared by a reopen,
 * given nothing stored at all, it returns a sheet a person could submit as-is —
 * and a flag saying whether they should be told their ranking was reset.
 */

export type PickSide = "away" | "home";

/** One call on one contest. `confidence` is null when the game runs with
 *  confidence off — never a stored 1 (migration 146's column comment). */
export interface SheetPick {
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
 * The sheet everyone starts with: home team, slate order.
 *
 * ── Why HOME, and why the FIRST slate game gets the HIGHEST rank ───────────
 *
 * Home is the closest thing to a neutral default that is also a real answer —
 * it wins more often than not, it needs no data the app has, and it is the same
 * for everybody, which matters because a default that varied by person would be
 * a hidden edge.
 *
 * The ranking is the runner's own order, highest first. He built the slate with
 * the marquee game at the top; borrowing that ordering means an untouched sheet
 * is at least *coherent* rather than arbitrary, and it makes the drag list start
 * in the order the picker just read the games in.
 *
 * Rank N..1 by position, so `defaultSheet` of a 16-game slate hands game 1 a 16.
 */
export function defaultSheet(slate: SheetSlateGame[], useConfidence = true): SheetPick[] {
  const n = slate.length;
  return slate.map((g, i) => ({
    slateGameId: g.id,
    pick: "home" as PickSide,
    confidence: useConfidence ? n - i : null,
  }));
}

export interface ReconciledSheet {
  /** Always complete, always valid, always submittable. */
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
 *   1. nothing stored — a fresh sheet
 *   2. a full stored sheet matching the slate — return it
 *   3. stored picks whose ranks were nulled by a reopen — keep the WINNERS,
 *      re-default the ranking, and raise `rankingReset`
 *   4. a slate that gained or lost games since the sheet was saved — keep the
 *      picks that still have a game, default the rest, ranking reset
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

  const winners: SheetPick[] = slate.map((g, i) => ({
    slateGameId: g.id,
    pick: byGame.get(g.id)?.pick ?? "home",
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

  // Defaults are already on `winners`. The person is told only if they HAD
  // something to lose — a first-time picker has not had a ranking reset, they
  // have simply not ranked yet, and telling them otherwise is confusing.
  return { picks: winners, rankingReset: submitted, submitted };
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

/** Flip one game's winner, leaving the ranking alone. */
export function setPick(picks: SheetPick[], slateGameId: string, pick: PickSide): SheetPick[] {
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
