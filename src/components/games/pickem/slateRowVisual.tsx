"use client";

import type { CSSProperties, ReactNode } from "react";
import { TYPE_SCALE } from "@/lib/typeScale";
import type { SlateResult } from "@/lib/pickemScoring";

/**
 * The visual language of one contest, shared by the slate modal and the sheet.
 *
 * ── Why this is a module and not a copy ────────────────────────────────────
 *
 * HANDOFF §3: "echo the slate row's visual language — same games, same
 * treatment, a picker shouldn't have to re-parse them." Two sixteen-row lists
 * showing the same sixteen contests, built ninety minutes apart, is the exact
 * setup CLAUDE.md #24 describes: the copies agree at first and then one of them
 * gets a tweak.
 *
 * And the specific thing most likely to drift here is the one that matters
 * most. The multiplier stripe is not decoration — spec §11 says multipliers
 * must be visible BEFORE picking, because a 2× game changes where you spend
 * confidence. A sheet whose stripe quietly stopped matching the slate's would
 * still look fine.
 *
 * So both surfaces call `pickemRowSurface` for the stripe and `MatchupLine` for
 * the text. Neither owns the other; the slate modal was here first and this is
 * its markup, lifted.
 */

/**
 * A row's border and background, including the weighted stripe.
 *
 * PER-SIDE LONGHANDS, never the `border` shorthand plus a `borderLeft`
 * override. React warns on that combination — "updating a style property during
 * rerender (border) when a conflicting property is set (borderLeft)" — and it
 * is right: which wins depends on property order across a re-render, so the
 * stripe can be silently clobbered when a row toggles state. Caught in the dev
 * console during Phase 2, not in review.
 *
 * The stripe is a SOLID LEFT RULE rather than a background wash. The wash was
 * tried and never read, which defeated the point: finding weighted games in a
 * sixteen-row list is a vertical eye movement down the left edge, so that edge
 * is where the mark belongs.
 */
export function pickemRowSurface(opts: {
  weighted: boolean;
  /** Selected / being edited — accent tint and accent border. */
  active?: boolean;
  /** Override the resting background (the sheet's read-only rows sit flatter). */
  background?: string;
/**
   * No fill, subtle edge — the row RECEDES.
   *
   * Deliberately not "a row for something that has not happened yet", which is
   * what this said and was already only half true: the run view's ENTERED rows
   * use it for a COLLAPSED row, which has very much happened. The two callers
   * mean different things by it and both are right, because the argument is
   * about EMPHASIS and each screen decides what deserves it.
   *
   * The head-to-head now quiets its PLAYED rows, the exact inverse of what it
   * used to do — the unplayed contests are the only ones that can still move,
   * so they are what somebody scans a live match for.
   *
   * Two changes rather than one because they say the same thing twice. The
   * weighted stripe survives either way, so a 2x game still announces itself.
   */
  quiet?: boolean;
}): CSSProperties {
  const { weighted, active = false, background, quiet = false } = opts;
  const edge = active
    ? "var(--color-bt-accent-border)"
    : quiet
      ? "var(--color-bt-subtle-border)"
      : "var(--color-bt-border)";
  return {
    background:
      background ??
      (active
        ? "var(--color-bt-accent-faint)"
        : quiet
          ? "transparent"
          : "var(--color-bt-card)"),
    borderStyle: "solid",
    borderTopWidth: 1,
    borderRightWidth: 1,
    borderBottomWidth: 1,
    borderLeftWidth: weighted ? 3 : 1,
    borderTopColor: edge,
    borderRightColor: edge,
    borderBottomColor: edge,
    borderLeftColor: weighted ? "var(--color-bt-glorious)" : edge,
  };
}

/**
 * ══ THE FOUR MARKS ON A SETTLED ROW, AND THE ONE RULE THAT PLACES THEM ══
 *
 * ── The problem this replaces, which was partly self-inflicted ───────────
 *
 * A row carries TWO facts and they are not the same fact:
 *
 *   who WON THE GAME      from the scores
 *   who COVERED           the runner's call, against a hand-entered line
 *
 * They diverge, and that divergence is the entire reason a spread exists — a
 * team can win by three against -7.5 and lose the pick'em. The vocabulary
 * this replaces had ONE mark (weight) driven by `result`, so it was answering
 * "who covered" while reading as "who won", and after the covered badges were
 * removed nothing on the row said which side the runner had marked. A row
 * could show Miami bold at 45-6 with Stanford having covered, and say nothing.
 *
 * ── Four marks, structurally different, so none can be read as another ──
 *
 *   WEIGHT      who won the GAME — winner bold white, loser grey and NORMAL
 *               weight. Never dimmed-but-bold: that is two marks fighting.
 *   THE SCORE   inherits its own name's colour and weight exactly, so the two
 *               halves of a line cannot disagree about who won.
 *   A BOX       who COVERED. A container rather than an emphasis, wrapping the
 *               name, the score and the line together — the three things that
 *               constitute the bet — so it cannot be mistaken for weight or
 *               colour, which are already spoken for.
 *   TEAL        YOUR PICK, and the PICKS PAGE ONLY. See the rule below.
 *
 * ══ THE RULE, WRITTEN DOWN BECAUSE THREE SURFACES DRIFTED APART ═════════
 *
 * **Weight carries who won the game, everywhere. Teal carries your pick, and
 * only the Picks page has one — where it OVERRIDES the winner colour, because
 * on your own sheet the question is what did I pick before who won.**
 *
 * That is one rule with one exception, and the exception is a SURFACE rather
 * than a behaviour: Matches and Results have no pick to speak of, so they pass
 * none and get the plain reading. Every surface calls `sideMarks` — there is no
 * second derivation to keep in step, which is what went wrong before: the
 * results page owned the vocabulary, the head-to-head imported it, and the
 * sheet wrapped it in a private function of its own. Three call sites, two
 * functions, one concept.
 *
 * ── Why marks and not a state name ──────────────────────────────────────
 *
 * This was a flat union — `won` / `lost` / `level` / `chosen` / `banked` / `missed`
 * — and a flat union is exactly what forced the drift. The marks are
 * INDEPENDENT: colour, weight, a line through the text and a box around it
 * are set by four different questions, so naming their combinations needs one
 * member per combination and somebody eventually adds the ninth. Answer the
 * four questions separately and the combinations take care of themselves.
 */
export interface SideMarks {
  /** This side WON the contest, on the scoreboard. Bold, full colour. */
  wonGame: boolean;
  /**
   * The other side won. NOT merely "did not win" — a game with no score
   * entered has no winner and no loser, and dimming a name on that row would
   * claim a result nobody recorded. Empty is not unknown, at the one place
   * where the two are a single missing keystroke apart.
   */
  lostGame: boolean;
  /** This side COVERED — the runner's call. Draws the box. */
  covered: boolean;
  /** The side this reader took. Picks page only; teal. */
  chosen: boolean;
  /** A line through the name: the contest was cancelled, or your pick lost. */
  struck: boolean;
}

/** No marks at all — the slate builder's rows, and the default everywhere. */
export const NO_MARKS: SideMarks = {
  wonGame: false,
  lostGame: false,
  covered: false,
  chosen: false,
  struck: false,
};

/**
 * Who won the contest, from the scores and nothing else.
 *
 * NULL is the common answer and it means UNKNOWABLE, never a draw. Three ways
 * to get it, and all three must render as no winner rather than as a loser:
 * neither score entered (most of a weekend), HALF a score entered (the state
 * manual entry passes through on its way to a pair), and a genuine tie.
 */
export function gameWinner(
  awayScore?: number | null,
  homeScore?: number | null
): "away" | "home" | null {
  if (awayScore == null || homeScore == null) return null;
  if (awayScore === homeScore) return null;
  return awayScore > homeScore ? "away" : "home";
}

/**
 * THE ONE DERIVATION. Every surface that draws a contest calls this.
 *
 * `pick` is what makes Picks different, and it is a PARAMETER rather than a
 * branch: Matches and Results simply have no pick to pass, so the teal case
 * cannot reach them and there is nothing for them to get wrong.
 */
export function sideMarks(
  side: "away" | "home",
  ctx: {
    /** The runner's call about who covered. Null until the game is marked. */
    result: SlateResult | null;
    awayScore?: number | null;
    homeScore?: number | null;
    /** PICKS PAGE ONLY — the side this reader took. */
    pick?: "away" | "home" | null;
  }
): SideMarks {
  const { result, awayScore, homeScore, pick = null } = ctx;
  /**
   * A cancelled contest was struck from the scoring, so nothing about it is
   * worth ranking: no winner, no loser, no cover. The strike is the whole
   * statement and the other marks would be competing with it.
   */
  const cancelled = result === "cancelled";
  const winner = cancelled ? null : gameWinner(awayScore, homeScore);
  const chosen = pick === side;
  /**
   * A push pays nobody, so NEITHER side covered and there is no box. It does
   * not touch the weight: the game still had a winner on the scoreboard, and
   * saying so is the one thing a push row can still tell you.
   */
  const decided = result === "away" || result === "home";
  return {
    wonGame: winner === side,
    lostGame: winner != null && winner !== side,
    covered: decided && result === side,
    chosen,
    /**
     * ONE strike means your bet, TWO mean the game — legible without knowing
     * the rule. A pick on a PUSH is not struck: the contest happened, nobody
     * covered, and your stake stood rather than lost.
     */
    struck: cancelled || (chosen && decided && result !== side),
  };
}

/**
 * The name's colour and weight — and the SCORE's, which is the same call.
 *
 * Returning one object for both is what makes rule 2 structural rather than
 * remembered: there is no second place to set a score's weight, so the two
 * halves of a line cannot disagree about who won. Its test asserts them EQUAL
 * rather than asserting two literals, because two literals pass a build where
 * both are wrong in the same way.
 */
export function sideNameStyle(m: SideMarks): CSSProperties {
  return {
    // Teal overrides the winner colour — the Picks-only rule, and the only
    // place in this function where a surface differs from another.
    color: m.chosen
      ? "var(--color-bt-accent)"
      : m.lostGame
        ? "var(--color-bt-text-dim)"
        : "var(--color-bt-text)",
    // Weight answers ONE question and never borrows: a loser is normal weight,
    // not dimmed-but-bold. With no score there is no winner, so nothing is
    // bold — which is correct, and is what a row says before anyone types one.
    fontWeight: m.wonGame ? 700 : 500,
  };
}

/**
 * The strike, applied to the TEAM NAME ALONE.
 *
 * ── `text-decoration` CANNOT BE TURNED OFF BY A DESCENDANT ────────────────
 *
 * This was first written as one style on the whole line, with
 * `textDecoration: "none"` on the "at" span to keep the connective clear. That
 * does nothing: a decoration drawn by an ancestor is propagated to its in-flow
 * descendants and there is no value a child can set to remove it. So the line
 * went through "at" as well, and the row read as damaged markup rather than as
 * a cancelled stake.
 *
 * Worse, the TEST passed. It asserted the `text-decoration:none` declaration
 * was present — which it was, and which CSS ignored. An assertion about a
 * declaration that has no effect is the "instrument cannot produce a red"
 * family with the instrument pointed at the right element and the wrong
 * property. Caught by looking at it in a browser, which is the only thing that
 * could have.
 *
 * The fix is structural rather than another declaration: the decoration is
 * applied to a span wrapping ONLY the team name, so the connective is never
 * inside the decorated box in the first place.
 *
 * The line follows its text — accent through a pick you took, dim through a
 * cancelled contest — so it never draws a grey rule across a teal word.
 */
export function sideDecoration(m: SideMarks): CSSProperties | undefined {
  if (!m.struck) return undefined;
  return {
    textDecoration: "line-through",
    textDecorationColor: m.chosen ? "var(--color-bt-accent)" : "var(--color-bt-text-dim)",
  };
}

/**
 * THE BOX — who covered.
 *
 * ── It is drawn on EVERY line, transparent where nobody covered ──────────
 *
 * A border that appears only on the covering line would add its own width and
 * padding to that line alone, so the two team names would sit at different
 * left edges and at different heights depending on which one the runner
 * marked. The row would jog when a result landed. Reserving the border on
 * both and colouring only one costs nothing and cannot move anything.
 *
 * ── Why a container and not another colour ───────────────────────────────
 *
 * Weight is spoken for (who won the game) and teal is spoken for (your pick).
 * A third colour would be a third thing to learn and would compete with both;
 * a rectangle is a different KIND of mark, so it composes with them instead —
 * a boxed grey name and a boxed bold name are both immediately readable, and
 * they say different things.
 *
 * It wraps the name, the score AND the line together because those three are
 * what constitute the bet. Boxing the name alone would mark a team; boxing all
 * three marks a wager.
 */
export function coverBoxStyle(m: SideMarks): CSSProperties {
  return {
    /**
     * ── AN OUTLINE, AND THE FILL IS GONE WITH THE FADE THAT FORCED IT ────
     *
     * This was a tinted panel, and the tint was never the design — it was a
     * workaround for the settled fade. Inside a 0.38 subtree a 1px
     * `--color-bt-text-dim` border composited to rgb(196,202,211) against a
     * card whose own border is rgb(200,208,218): the mark for the most
     * important fact on the row, the same grey as the chrome around it. And
     * it could not be tuned out, because at 0.38 over the light card even
     * pure black reaches only rgb(158,158,158) — a hard floor. A fill has no
     * such floor, because the eye integrates AREA where it cannot integrate
     * a line, so a fill is what the constraint left.
     *
     * The fade is gone (see `PickemSheetRow`), and re-measuring outside it
     * the border is simply the colour it says it is — no compositing at all:
     *
     *   light   box rgb(15,23,42)     card border rgb(200,208,218)
     *   dark    box rgb(241,245,249)  card border rgb(45,54,72)
     *
     * Unmistakable in both, so the panel has nothing left to do. It also cost
     * something: in dark mode a filled line reads as an INPUT, which is the
     * wrong affordance on a screen where nothing here is editable.
     *
     * ── THE WEIGHT, SETTLED ON A FULL PAGE RATHER THAN ON ONE ROW ────────
     *
     * Three values were tried and the first two were wrong in opposite ways.
     * Near-black on near-white shouts. `--color-bt-text-dim` and a step above
     * it still made every settled row a frame — and with fifteen of sixteen
     * settled, that is a page of frames rather than a mark.
     *
     * THE CONDITION IS WHAT SETTLED IT. Every earlier comparison used one row
     * or three, and a single boxed row looks fine at almost any brightness. On
     * the real sixteen-game slate the aggregate is a different question, and
     * the answer came down two full steps.
     *
     * The target is a RELATION, not a value: the frame must be dimmer than the
     * team name it wraps. A frame is scenery — it should draw the eye to the
     * row without competing with what is in it. Measured against the card
     * chrome it has to clear and the two name colours it must stay under:
     *
     *          box vs bg   vs chrome   plain name   your pick (teal)
     *   dark     2.39        1.74        15.2           8.95
     *   light    1.83        1.18        17.85          3.74
     *
     * IN LIGHT THIS IS VERY CLOSE TO THE CHROME — 1.18 against the card's own
     * outline, where dark gets 1.74. The value was chosen on a dark page, which
     * is where this screen is read; if the light theme needs more, the fix is a
     * per-theme value rather than a compromise that suits neither. Flagged
     * rather than quietly split.
     *
     * An ALPHA RAMP of `--color-bt-text-dim` rather than a new colour, which is
     * the right axis here: in dark the card border is already that same slate
     * hue at 0.18, so this ladder starts at the chrome and walks up from it.
     *
     * Deliberately NEUTRAL. Teal means your pick, amber means a weighted game;
     * a third hue would be a third thing to learn and would collide with one of
     * them on some row.
     */
    border:
      "1px solid " +
      (m.covered
        ? "color-mix(in srgb, var(--color-bt-text-dim) 45%, transparent)"
        : "transparent"),
    borderRadius: 7,
    paddingLeft: 5,
    paddingRight: 5,
  };
}

/**
 * BOTH SIDES OF THE LINE, from the one number the runner types.
 *
 * ── Why the other side needs one at all ─────────────────────────────────
 *
 * The box wraps the name, the score and the line. With the number on the
 * favourite only, a box around the other row wraps a team with nothing where
 * its line should be and reads as incomplete rather than as a marked side. So
 * the mirror is not decoration; it is what makes the box boxable on either
 * side, and it is how every sportsbook prints it.
 *
 * ── Whose number is it ──────────────────────────────────────────────────
 *
 * The HOME team's. Stated in three places in this codebase and consistent
 * across all of them: the builder's field is labelled "Spread Home" with a
 * matching `aria-label` (`PickemSlateModal`), that field's own comment says the
 * label exists so a runner does not have to remember which side the number is
 * for, and the badge has always rendered beside the home name.
 *
 * ── Parsing is safe here, and that is measured rather than assumed ──────
 *
 * The column is free TEXT, so this could have met anything. Production holds
 * 29 slate games, 15 with a spread, and ALL 15 parse as a signed number —
 * zero unparseable. The fallback below is therefore defensive rather than
 * load-bearing: an unparseable value is shown as typed, on the side the form
 * names, and no mirror is invented from something that was not a number.
 *
 * ── Zero shows on NEITHER side ──────────────────────────────────────────
 *
 * Two production rows carry "0". A pick'em with no line is a straight winner
 * call, and printing "0" and "-0" on the two rows would be two badges saying
 * nothing twice. The box still works: a name and a score are enough to wrap.
 */
export function spreadPair(spread: string | null | undefined): {
  away: string | null;
  home: string | null;
} {
  const raw = (spread ?? "").trim();
  if (raw === "") return { away: null, home: null };
  const n = Number(raw);
  // `Number("")` is 0, which is why the empty check comes first.
  if (!Number.isFinite(n)) return { away: null, home: raw };
  if (n === 0) return { away: null, home: null };
  return { away: signed(-n), home: signed(n) };
}

/** A line always carries its sign — an unsigned number on one row beside a
 *  signed one on the other reads as a different kind of value. */
function signed(n: number): string {
  return n > 0 ? "+" + n : String(n);
}


/**
 * The line that replaces the kickoff once a contest is settled.
 *
 * `tone` rather than a colour, for the same reason `SideEmphasis` is a state:
 * the results page should not be choosing hex values, and the three tones have
 * to stay distinguishable from each other rather than each being individually
 * reasonable.
 */
export type StatusTone = "final" | "push" | "cancelled";

export function statusToneColor(tone: StatusTone): string {
  return tone === "final"
    ? "var(--color-bt-accent)"
    : tone === "cancelled"
      ? "var(--color-bt-danger)"
      : "var(--color-bt-text-dim)";
}

export interface MatchupLineGame {
  awayTeam: string;
  homeTeam: string;
  spread?: string | null;
  kickoff?: string | null;
  note?: string | null;
  /** Null is 1. The column is nullable and several callers pass it through
   *  unmapped, so the type admits it rather than making each of them coalesce. */
  multiplier?: number | null;
}

/** The badge a weighted game carries. Colour says "worth more", number says how
 *  much — the stripe alone cannot carry the value. */
export function MultiplierBadge({ multiplier }: { multiplier: number }) {
  return (
    <span
      data-testid="pickem-multiplier-badge"
      className="rounded px-1.5"
      style={{
        fontSize: TYPE_SCALE.caption,
        fontWeight: 700,
        color: "var(--color-bt-glorious)",
        background: "color-mix(in srgb, var(--color-bt-glorious) 22%, transparent)",
        border: "1px solid var(--color-bt-glorious-border)",
      }}
    >
      {multiplier}×
    </span>
  );
}

/**
 * The line, beside the home team it belongs to.
 *
 * Sized UP and weighted DOWN against the version that sat on the old one-line
 * matchup (11px/700 → 12px/500). It shared that line with two truncating team
 * names and had to shout over them; on its own line beside a single name it
 * does not, and 700 next to a 500 team name read as the louder fact of the two.
 *
 * COLOURS ARE UNCHANGED — the mock's hexes are placeholder (its own banner says
 * so) and this keeps the `planning` tokens it already used. Only size and
 * weight, which the mock is authoritative for, move.
 */
export function SpreadBadge({ spread }: { spread: string }) {
  return (
    <span
      className="shrink-0 rounded px-1.5"
      style={{
        fontSize: TYPE_SCALE.bodyDense,
        fontWeight: 500,
        background: "var(--color-bt-planning-faint)",
        color: "var(--color-bt-planning)",
      }}
    >
      {spread}
    </span>
  );
}

/**
 * "Milwaukee Brewers" over "at Cincinnati Reds  −3.5", with the multiplier
 * pinned top-right, over "Fri Sep 4, 6:10p · Tyler".
 *
 * `leading` is whatever sits to the left — the slate's ordinal, the sheet's
 * rank chip. It is a slot rather than a prop the component interprets, because
 * the lists number their rows for different reasons and none of them should
 * have to explain itself to this file.
 *
 * ── ONE TEAM PER LINE, ALWAYS — AND THIS REVERSES r7 §12 ──────────────────
 *
 * §12 put both teams on ONE line and had it TRUNCATE, explicitly so that
 * "every row [is] the same height". The reasoning was sound and it was aimed at
 * a real problem: a `flex-wrap` run let a long matchup push the multiplier onto
 * a second line, so the same game occupied one line on one surface and two on
 * another. Uniformity across surfaces was the goal; a fixed single line was the
 * means.
 *
 * What that traded away is the thing this reverses. Real slates are college
 * football, where "Lebanon Valley Flying Dutchmen at Franklin & Marshall
 * Diplomats" is 61 characters — so the single line did not hold a matchup at
 * 390px, it held the first one and a half teams and an ellipsis. On the results
 * page, where four controls already compete for the row, that is the reported
 * truncation bug.
 *
 * Two lines ALWAYS — never conditional on length — keeps §12's actual goal
 * intact. Every row is still the same height and the same game still occupies
 * the same space on every surface; the constant is just two lines rather than
 * one. Each name gets its own line and truncates within it, so a pathological
 * name still cannot spill to a third.
 *
 * The multiplier keeps §12's other decision — it is pinned RIGHT so weighted
 * games line up in a column and the eye finds them in one pass down the edge —
 * but it is now ABSOLUTE rather than the end of a flex run, so its position no
 * longer depends on the names at all. The name block pads to clear it.
 *
 * ── The badge and the multiplier cannot collide ───────────────────────────
 *
 * The multiplier is absolute within THIS component's box, not the card's. Where
 * a surface puts something to the right of the matchup — the sheet's `NOT
 * PICKED` stamp, the head-to-head's result chip — that sibling takes its own
 * width and the matchup's box shrinks, so the badge lands just left of it
 * instead of underneath it. Where there is no sibling (the common case) this
 * component fills the row and its right edge IS the card's.
 *
 * ── The sub-line truncates, and that is a known open issue ─────────────────
 * Kickoff and note share one line with `truncate`, and since Phase 2b the
 * kickoff carries a date, so the note loses more of itself at 390px than it
 * used to. Raised at the Phase 2 look and still open; kept identical in every
 * surface on purpose, so whatever fixes it fixes them all at once. It is
 * deliberately NOT padded to clear the multiplier — the badge sits on line 1
 * only, and stealing 44px from the line that already truncates worst would pay
 * for clearance nothing needs.
 */

/**
 * How far the name lines pad to clear the pinned multiplier.
 *
 * Wide enough for a two-digit badge (`10×`) plus a gap, so the clearance does
 * not depend on which multipliers a slate happens to use.
 */
const MULTIPLIER_CLEARANCE = 44;

/**
 * One team's score, on that team's own line.
 *
 * Right-aligned and `tabular-nums` so a column of them lines up digit for
 * digit. Two digits is the ordinary case and three the ceiling (a basketball
 * final), which is why nothing here reserves a fixed width — a 3-digit score
 * grows the box rather than being clipped, and a slate of football scores does
 * not pay for the basketball case.
 */
function TeamScore({
  value,
  side,
  marks,
}: {
  value: number;
  side: "away" | "home";
  marks: SideMarks;
}) {
  return (
    <span
      className="shrink-0 pl-2"
      data-testid={`pickem-score-${side}`}
      style={{
        fontSize: TYPE_SCALE.name,
        fontVariantNumeric: "tabular-nums",
        letterSpacing: "-0.01em",
        /* THE SAME CALL THE NAME MAKES, not a matching pair of literals.
           A number sitting beside a name must not be able to disagree with
           it about who won, and the only way to guarantee that is for there
           to be one place the answer comes from. It carries no strike: the
           line is about the STAKE, and a score is a fact about the contest
           — striking it would say the game did not happen. */
        ...sideNameStyle(marks),
      }}
    >
      {value}
    </span>
  );
}

export function MatchupLine({
  game,
  leading,
  awayMarks = NO_MARKS,
  homeMarks = NO_MARKS,
  mirrorSpread = false,
  status,
  multiplierAt = "corner",
  awayScore,
  homeScore,
}: {
  game: MatchupLineGame;
  leading?: ReactNode;
  /**
   * What each side's name, score and line are saying — see `sideMarks`, which
   * is the ONE derivation every surface calls. Absent means a row with nothing
   * to say about a result: the slate builder's, and every unplayed contest.
   */
  awayMarks?: SideMarks;
  homeMarks?: SideMarks;
  /**
   * Show the line on BOTH rows — see `spreadPair`.
   *
   * OFF by default, and the default is what keeps the SLATE BUILDER out of
   * this round. That surface renders `MatchupLine` directly and is
   * deliberately excluded; an unconditional mirror would have changed it
   * without its file being touched, which is exactly the trap the multiplier
   * move fell into last round — the excluded surface shares this component
   * with the three that converge.
   *
   * Worth knowing that the argument does not run only one way: the builder is
   * where the number is TYPED, so it is the one place a reversed line could
   * be caught at the moment somebody makes the mistake rather than a week
   * later. That is a call for Zach, not a default to assume.
   */
  mirrorSpread?: boolean;
  /**
   * Replaces the KICKOFF once a contest is settled, keeping the note.
   *
   * "Status replaces the date" literally: the date is spent the moment the
   * game is over, the runner's note ("Rob and Matt", "Most of the Golf Trip")
   * is not — so the note survives beside the status rather than being replaced
   * along with it.
   */
  status?: { text: string; tone: StatusTone };
  /**
   * WHERE the weighted badge sits.
   *
   * `"corner"` is the original: absolute, pinned to this component's own
   * top-right. `"meta"` puts it inline at the start of the date/note line —
   * the bottom-left of the block.
   *
   * A PROP rather than a change, because the four surfaces that render a
   * contest are not all converging. The picks sheet, the results row and the
   * head-to-head move; the SLATE BUILDER is deliberately excluded — it is a
   * pre-game authoring surface, not a viewing one, and it has no score, no
   * result and no corner contention. Changing this component outright would
   * have moved it too, silently, which is the trap: the excluded surface shares
   * the component with the three that converge.
   */
  multiplierAt?: "corner" | "meta";
  /**
   * The contest's score, one number per team, right-aligned on that team's own
   * line — away above home, matching the two lines it annotates.
   *
   * BOTH OR NEITHER. Half a score is not a score: a runner mid-entry has typed
   * one number, and one number beside one team reads as a broken row rather
   * than as a partial. The DB deliberately admits the half state (migration
   * 180) so entry can pass through it; this is where it is refused.
   *
   * Absent renders NOTHING — no zero, no dash, no reserved width — so a row
   * whose game has no score is byte-identical to what it was before scores
   * existed. `!= null`, never falsy: 0-0 is a real score.
   */
  awayScore?: number | null;
  homeScore?: number | null;
}) {
  const meta = status
    ? game.note || null
    : [game.kickoff, game.note].filter(Boolean).join(" · ") || null;
  const multiplier = game.multiplier ?? 1;
  const weighted = multiplier > 1;
  const name = { fontSize: TYPE_SCALE.name, lineHeight: 1.3 } as const;
  const cornerBadge = weighted && multiplierAt === "corner";
  const multiplierInline = weighted && multiplierAt === "meta";
  /* The clearance exists to keep a long name out from under the CORNER badge.
     With the badge on the meta line there is nothing to clear, so the names get
     those 44px back — which is most of the reason moving it is worth doing. */
  const clearance = cornerBadge ? MULTIPLIER_CLEARANCE : undefined;
  const bothScores = awayScore != null && homeScore != null;
  /* BOTH sides of the line, so the box has something to wrap on either row.
     See `spreadPair` — including why a spread of 0 shows on neither, and
     `mirrorSpread` for why the builder still gets the single badge. */
  const line = mirrorSpread
    ? spreadPair(game.spread)
    : { away: null, home: game.spread?.trim() || null };
  return (
    <div className="relative flex min-w-0 flex-1 items-start gap-2.5">
      {leading}
      <span className="min-w-0 flex-1">
        {/* ── THE AWAY LINE, INSIDE ITS BOX ───────────────────────────────
            The box is on the LINE, so it wraps the name, the line and the
            score together — the three things that constitute the bet. It is
            drawn transparent when this side did not cover, so the two rows
            keep the same left edge and the same height whichever one the
            runner marks. */}
        {/* ── THE TWO LINES ARE THE SAME SHAPE, WHICH THEY HAD TO BECOME ──
            The away name used to be `flex-1`, which was right while it was
            the only thing on its line: it took the slack and truncated into
            it. Give that line a badge and a score and `flex-1` puts the
            slack BETWEEN the name and the badge, so the away line's number
            floated off to the right while the home line's sat against its
            name. One matchup, two alignments.

            So the away line now carries the home line's structure exactly —
            name, badge, an explicit spacer, score — and the two agree by
            construction rather than by two sets of classes happening to
            match. The name truncates without `flex-1` (the home name always
            has). */}
        <span
          className="flex min-w-0 items-baseline gap-x-1.5"
          data-testid="pickem-matchup-away"
          data-covered={awayMarks.covered ? "true" : "false"}
          style={{
            ...name,
            ...sideNameStyle(awayMarks),
            ...coverBoxStyle(awayMarks),
            marginRight: clearance,
          }}
        >
          <span
            className="min-w-0 truncate"
            data-testid="pickem-matchup-away-name"
            style={sideDecoration(awayMarks)}
          >
            {game.awayTeam}
          </span>
          {line.away && <SpreadBadge spread={line.away} />}
          {bothScores && (
            <>
              <span className="flex-1" />
              <TeamScore value={awayScore!} side="away" marks={awayMarks} />
            </>
          )}
        </span>
        {/* ── THE CLEARANCE GOES ON THE LINE, NOT ON THE NAME ────────────────
            The home line has a SIBLING — the spread badge — so padding the
            name span pushed the badge instead of reserving space at the line's
            end. Measured: the gap between the home team and its spread was 6px
            on an ordinary row and 50px on a weighted one (the 6px flex gap plus
            the 44px clearance), which is why it looked like a spacing bug on
            "some rows but not all": the affected rows were exactly the 2x ones.

            On the WRAPPER the inset applies once to the whole line, so the
            spread stays beside the name it belongs to and the pair together
            clears the badge. The away line has no sibling, so its padding can
            stay where it is. */}
        <span
          className="flex min-w-0 items-baseline gap-x-1.5"
          data-testid="pickem-matchup-home-line"
          data-covered={homeMarks.covered ? "true" : "false"}
          style={{
            ...sideNameStyle(homeMarks),
            ...coverBoxStyle(homeMarks),
            marginRight: clearance,
          }}
        >
          <span
            className="min-w-0 truncate"
            data-testid="pickem-matchup-home"
            style={{
              ...name,
              ...sideNameStyle(homeMarks),
            }}
          >
            {/* "at" is the CONNECTIVE and never carries the side's emphasis.
                It sits OUTSIDE the decorated span rather than trying to opt
                out of one — a descendant cannot remove an ancestor's
                `text-decoration`, so structure is the only thing that works
                here. See `sideDecoration`. */}
            <span style={{ color: "var(--color-bt-text-dim)", fontWeight: 400 }}>at{" "}</span>
            <span data-testid="pickem-matchup-home-name" style={sideDecoration(homeMarks)}>
              {game.homeTeam}
            </span>
          </span>
          {/* WITH the home team, because the number the runner types IS the
              home team's line (the builder's field is labelled "Spread Home").
              The away row now carries its mirror — see `spreadPair`. */}
          {line.home && <SpreadBadge spread={line.home} />}
          {bothScores && (
            <>
              {/* Pushes the home number to the same right edge as the away
                  one, so the two read as a column beside the two names rather
                  than as two trailing values. */}
              <span className="flex-1" />
              <TeamScore value={homeScore!} side="home" marks={homeMarks} />
            </>
          )}
        </span>
        {(status || meta || multiplierInline) && (
          <span className="mt-0.5 flex min-w-0 items-baseline gap-x-1">
            {/* ── THE MULTIPLIER, BOTTOM-LEFT ────────────────────────────────
                Horizontally in line with the date and the note, which is the
                bottom-left of the matchup block. It was pinned to the TOP-right
                — the busiest corner on every one of these surfaces, shared with
                the result chip, the NOT PICKED stamp, and now the score.

                Down here it sits against the amber stripe that marks the same
                fact, and it stops competing for a corner three other things
                want. */}
            {multiplierInline && (
              <span className="flex shrink-0" data-testid="pickem-matchup-multiplier-inline">
                <MultiplierBadge multiplier={multiplier} />
              </span>
            )}
            {status && (
              <span
                className="shrink-0"
                data-testid="pickem-matchup-status"
                style={{
                  fontSize: TYPE_SCALE.bodyDense,
                  fontWeight: 600,
                  letterSpacing: "0.03em",
                  color: statusToneColor(status.tone),
                }}
              >
                {status.text}
              </span>
            )}
            {meta && (
              <span
                className="min-w-0 truncate"
                style={{ fontSize: TYPE_SCALE.caption, color: "var(--color-bt-text-dim)" }}
              >
                {status ? `· ${meta}` : meta}
              </span>
            )}
          </span>
        )}
      </span>
      {cornerBadge && (
        <span
          /* `flex`, matching the badge slot in `PickemGameCard`, so the chip's
             box is content-height rather than line-height-height. As a plain
             inline span it rendered 5.5px TALLER than the NOT PICKED stamp that
             now covers it, leaving a sliver of amber below an opaque badge —
             which reads as a rendering fault. Both slots shrink-wrap, so they
             agree by construction rather than by two numbers happening to
             match. */
          className="absolute flex"
          data-testid="pickem-matchup-multiplier-slot"
          style={{ top: 0, right: 0 }}
        >
          <MultiplierBadge multiplier={multiplier} />
        </span>
      )}
    </div>
  );
}

/** The slate's ordinal / the sheet's position marker. */
export function RowOrdinal({ children }: { children: ReactNode }) {
  return (
    <span
      style={{
        fontSize: TYPE_SCALE.caption,
        fontWeight: 700,
        color: "var(--color-bt-text-dim)",
        fontVariantNumeric: "tabular-nums",
        minWidth: 16,
        paddingTop: 1,
      }}
    >
      {children}
    </span>
  );
}
