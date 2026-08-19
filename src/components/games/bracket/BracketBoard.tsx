"use client";

import { Check } from "lucide-react";
import { matchKey, type ResolvedMatch } from "@/lib/bracketAdvance";
import type { BracketSide } from "@/lib/bracket";
import { bracketDisplay, roundName } from "@/lib/bracketLabels";
import { doubleBracketDisplay, doubleRoundName } from "@/lib/bracketDoubleLabels";
import { roundLayout, BRACKET_METRICS, SLOT_HEIGHT, MATCH_HEADER_HEIGHT, BRACKET_COLUMN_WIDTH } from "@/lib/bracketLayout";
import { matchStakes, type MatchStakes } from "@/lib/bracketStakes";
import { EYEBROW, TYPE_SCALE } from "@/lib/typeScale";

/**
 * The bracket board — the draw as a readable tree.
 *
 * Presentation-only (CLAUDE.md #7): every value arrives as a prop and every tap
 * emits through a callback. No tRPC, no DB, no auth. The parent owns
 * persistence, which is what lets the same component render the organizer's
 * pickable board and the member's read-only one from one code path — the only
 * difference between them is `canPick`.
 *
 * ── Rows within a match, columns across rounds ─────────────────────────────
 * The spec's "rows, not columns" is about a MATCH, and it is a real contrast
 * with match play: match play puts one team left and one right with players
 * stacked inside a side, because a side is a unit. A bracket stacks OPPONENTS —
 * each competitor is a row, the opponent is the row beneath, and a second line
 * carries the partner in 2v2. The rounds themselves still run left to right,
 * because that is what a bracket is.
 *
 * ── Scroll, not pan-and-zoom ───────────────────────────────────────────────
 * The wrapper scrolls horizontally and the page scrolls vertically. The spec
 * asked for a draggable, zoomable canvas for the member view and then asked for
 * a recommendation before building one; scroll was the settled answer. Note the
 * mockup still draws zoom controls in its member view — they are deliberately
 * NOT here, because a control that does nothing is worse than no control.
 */

/** One entrant's display identity. Seeds come from the draw; names, partners
 *  and team colour come from the roster the parent already holds. */
export interface BracketEntrantMeta {
  seed: number;
  name: string;
  /** The second member in 2v2 — the mockup's second line. Null in singles. */
  partner: string | null;
  /** The cup team's colour, for the dot. Null for an entrant with no team. */
  teamColor: string | null;
}

export function BracketBoard({
  matches,
  entrants,
  pointsDistribution = [],
  canPick = false,
  onPick,
  stakesFor,
  mustWin,
}: {
  matches: ResolvedMatch[];
  entrants: BracketEntrantMeta[];
  /** The game's placement split. Empty → the headers quote no points, which is
   *  right for a game that pays no per-place values. */
  pointsDistribution?: readonly number[];
  /** Organizer view when true; the member's read-only board when false. */
  canPick?: boolean;
  /** `seed` is the winner, or null to clear. Only called when `canPick`. */
  onPick?: (ref: { bracket: BracketSide; round: number; slot: number }, seed: number | null) => void;
  /** What a match is worth. Supplied by the CALLER so this component never has to ask
   *  which format it is rendering — double elim passes its own, single elim gets the
   *  default below. Branching here on "does the draw have a lower bracket" is exactly
   *  the signal the spec calls out. */
  stakesFor?: (m: ResolvedMatch) => MatchStakes | null;
  /** "If I lose this, am I out?" — PER SEED, because at the grand final the same match
   *  is must-win for one side and not the other (glossary: lives). Unstyled and applied
   *  to every match on purpose for the first look: the open question is whether it is
   *  noise at this density, and that cannot be judged from a version that hides it. */
  mustWin?: (seed: number) => boolean;
}) {
  const stakes = stakesFor ?? ((m: ResolvedMatch) => matchStakes(m, matches, pointsDistribution));
  const display = matches.some((m) => m.bracket === "lower" || m.bracket === "final")
    ? doubleBracketDisplay(matches)
    : bracketDisplay(matches);
  const bySeed = new Map(entrants.map((e) => [e.seed, e]));
  const main = matches.filter((m) => m.bracket === "main");
  const consolation = matches.filter((m) => m.bracket === "consolation");
  const lower = matches.filter((m) => m.bracket === "lower");
  const finals = matches.filter((m) => m.bracket === "final");
  const lowerRounds = [...new Set(lower.map((m) => m.round))].sort((a, b) => a - b);
  const lastRound = main.reduce((max, m) => Math.max(max, m.round), 0);
  const rounds = [...new Set(main.map((m) => m.round))].sort((a, b) => a - b);
  const upperRounds = rounds;
  /** Rendering the structure it was GIVEN, not a format flag: a draw carrying lower or
   *  final rows is a double-elim draw, and there is nothing to configure. */
  const isDouble = lower.length > 0 || finals.length > 0;
  /**
   * COLUMNS COUNTED FROM THE RIGHT — the tournament converges, so the layout is
   * anchored to what rounds converge TO, not to where their losers came from.
   *
   * Anchoring the lower tier to its FEEDERS (the previous rule) forced upper matches
   * apart to make room for lower rounds between them, so the upper bracket acquired
   * gaps it does not need: two independent left-to-right layouts colliding. Counting
   * from the right is one layout, and it does not collide.
   *
   *   column 0 (rightmost)  the Grand Final, and the if-necessary game with it
   *   column 1              the Upper Final and the Lower Final, side by side
   *   leftward from there   each tier walks independently, one column per round
   *
   * Counted from the right, upper round r lands at grid column r — its NATURAL
   * spacing, unchanged from a single-elim board of the same size. That equality is the
   * test that the extra columns are gone.
   *
   * SHARED COLUMNS. The lower tier has 2(W-1) rounds against the upper's W, so it runs
   * out of columns and the excess pair up, stacked vertically — which is what the
   * spreadsheet does, and why it fits in seven columns rather than one per lower round.
   * The two columns NEAREST the convergence (Lower Final, and the round feeding it)
   * keep a column each, because those are the rounds whose separation matters most;
   * every column left of them holds two. The upper bracket's count sets the total and
   * the lower tier fits inside it, never the reverse.
   */
  const gridCols = lastRound + 1;
  /** Lower round -> grid column, walking leftward from the convergence. */
  const lowerColumn = new Map<number, number>();
  {
    let col = 1;                                  // 1 = counted from the right
    const descending = [...lowerRounds].sort((a, b) => b - a);
    for (let i = 0; i < descending.length; i++) {
      lowerColumn.set(descending[i], gridCols - col);
      // The first two get a column each; after that, every column takes a pair.
      if (i === 0 || i === 1 || i % 2 === 1) col += 1;
    }
  }

  if (matches.length === 0) return null;

  return (
    <div
      data-testid="bracket-board"
      style={{
        border: "1px solid var(--color-bt-border)",
        borderRadius: 12,
        background: "var(--color-bt-base)",
        padding: 12,
        overflowX: "auto",
      }}
    >
      {isDouble ? (
        /**
         * ONE TOURNAMENT, CONVERGING RIGHTWARD.
         *
         * The stacked version read as three separate brackets, because each block
         * started at the left margin and lower round k sat at column k of its own row —
         * unrelated to where its feeders were. The one relationship a newcomer has to
         * see (these two streams meet HERE) was the one the layout hid.
         *
         * So position is derived from the FEEDER, on one grid:
         *
         *   upper round r  ->  column 2r - 1
         *   lower round k  ->  column k + 1
         *   grand final    ->  the last column, spanning both tiers
         *
         * Upper rounds sit two columns apart because the lower bracket runs at twice
         * their cadence (a minor and a major round per upper round after the first).
         * That is what puts each lower major round in the same column as the upper round
         * whose losers it receives, and the Lower Final directly beneath the Upper Final
         * with the Grand Final to the right of both — convergence you can see.
         *
         * The borrowed `roundLayout` offsets are GONE from the lower tier rather than
         * approximated. They encode "centre on the pair directly below", which is true
         * in `main` and false in `lower`, so keeping them implied a relationship that
         * does not exist. Wrong spacing is worse than none.
         */
        <div
          style={{
            display: "grid",
            gridTemplateColumns: `repeat(${gridCols}, ${BRACKET_COLUMN_WIDTH}px)`,
            // 26 is the single-elim board's column gap. Matching it exactly is what makes
            // "the upper bracket is no wider apart than single elim" a measurable claim
            // rather than an approximate one.
            columnGap: 26, rowGap: 22, minWidth: "min-content", alignItems: "start",
          }}
        >
          {/* Per-round headers are gone (Option A): the spreadsheet has none and is
              legible, and with two lower rounds sharing a column a single header
              cannot name both tiers' rounds anyway. What remains is one caption per
              TIER — the lower one still has to say "second life", because that is what
              carries the meaning must-win no longer repeats on every row. */}
          <div style={{ gridColumn: "1 / -1", gridRow: 1, ...EYEBROW }}>Upper bracket</div>
          <div style={{ gridColumn: "1 / -1", gridRow: 3, ...EYEBROW }}>Lower bracket · second life</div>

          {upperRounds.map((round) => (
            <div key={`u${round}`} style={{ gridColumn: round, gridRow: 2 }}>
              <div className="flex flex-col" style={{ gap: roundLayout(round, BRACKET_METRICS).gap, paddingTop: roundLayout(round, BRACKET_METRICS).offset }}>
                {main.filter((m) => m.round === round).sort((a, b) => a.slot - b.slot).map((m) => (
                  <MatchCard key={matchKey(m)} match={m} display={display} bySeed={bySeed} canPick={canPick} onPick={onPick} stakes={stakes(m)} mustWin={mustWin} />
                ))}
              </div>
            </div>
          ))}

          {[...new Set([...lowerColumn.values()])].sort((a, b) => a - b).map((col) => (
            // One cell per COLUMN, not per round: two lower rounds can share a column,
            // and two grid items placed in the same cell overlap rather than stack.
            <div key={`lc${col}`} className="flex flex-col" style={{ gridColumn: col, gridRow: 4, gap: BRACKET_METRICS.baseGap }}>
              {lowerRounds
                .filter((r) => lowerColumn.get(r) === col)
                .map((round) => (
                  <div key={`l${round}`} className="flex flex-col" style={{ gap: BRACKET_METRICS.baseGap }}>
                    {lower.filter((m) => m.round === round).sort((a, b) => a.slot - b.slot).map((m) => (
                      <MatchCard key={matchKey(m)} match={m} display={display} bySeed={bySeed} canPick={canPick} onPick={onPick} stakes={stakes(m)} mustWin={mustWin} />
                    ))}
                  </div>
                ))}
            </div>
          ))}

          <div
            style={{ gridColumn: gridCols, gridRow: "2 / span 3", alignSelf: "center", display: "flex", flexDirection: "column", gap: BRACKET_METRICS.baseGap }}
          >
            {finals.sort((a, b) => a.round - b.round).map((m) => {
              const d = display.get(matchKey(m));
              const vacant = (d?.aVacant ?? false) && (d?.bVacant ?? false);
              return (
                <div key={matchKey(m)} style={{ opacity: vacant ? 0.4 : 1 }}>
                  <div className="text-center" style={{ ...EYEBROW, marginBottom: 2 }}>
                    {doubleRoundName("final", m.round, 1)}
                  </div>
                  <MatchCard match={m} display={display} bySeed={bySeed} canPick={canPick} onPick={onPick} stakes={stakes(m)} mustWin={mustWin} />
                </div>
              );
            })}
          </div>
        </div>
      ) : (
      <>
      {/* `items-start`, not the default stretch: each round column is exactly as
          tall as its own content, and the vertical placement comes from the
          computed offsets below rather than from how the columns happen to
          stretch against each other. */}
      <div className="flex items-start" style={{ gap: 26, minWidth: "min-content" }}>
        {rounds.map((round) => {
          const { offset, gap } = roundLayout(round, BRACKET_METRICS);
          return (
            <div key={round} className="flex flex-col" style={{ minWidth: BRACKET_COLUMN_WIDTH }}>
              {/* OUTSIDE the offset container. The heading used to be a sibling of
                  the match cards inside a `justify-around` column, so it was being
                  distributed along with them — round 1 spacing 5 items and round 2
                  spacing 3 is what broke the alignment. */}
              <div
                className="text-center"
                style={{ ...EYEBROW, marginBottom: 2 }}
              >
                {roundName(round, lastRound)}
              </div>
              {/* Each match centres on the separator between its two feeders:
                  half a span down, then one span apart (`bracketLayout`). */}
              <div className="flex flex-col" style={{ gap, paddingTop: offset }}>
                {main
                  .filter((m) => m.round === round)
                  .sort((a, b) => a.slot - b.slot)
                  .map((m) => (
                    <MatchCard key={matchKey(m)} match={m} display={display} bySeed={bySeed} canPick={canPick} onPick={onPick} stakes={stakes(m)} mustWin={mustWin} />
                  ))}
              </div>
            </div>
          );
        })}
      </div>

      </>
      )}

      {consolation.length > 0 && (
        <div style={{ marginTop: 14, paddingTop: 12, borderTop: "1px dashed var(--color-bt-border)" }}>
          {/* Warning tone, matching the mockup — this is the one match that does
              not decide the title, and colouring it as such stops it reading as
              a second final. STATUS DISPLAY ONLY, which is what the token is for. */}
          <div
            // A STATUS eyebrow — the one property the convention lets a surface
            // override, because this match deliberately does not read as a final.
            style={{ ...EYEBROW, color: "var(--color-bt-warning)", marginBottom: 7 }}
          >
            Consolation · 3rd place
          </div>
          <div style={{ maxWidth: BRACKET_COLUMN_WIDTH }}>
            {consolation.map((m) => (
              <MatchCard key={matchKey(m)} match={m} display={display} bySeed={bySeed} canPick={canPick} onPick={onPick} stakes={stakes(m)} mustWin={mustWin} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function MatchCard({
  match, display, bySeed, canPick, onPick, stakes, mustWin,
}: {
  mustWin?: (seed: number) => boolean;
  match: ResolvedMatch;
  display: ReturnType<typeof bracketDisplay>;
  bySeed: Map<number, BracketEntrantMeta>;
  canPick: boolean;
  /** What this match is worth, or null when the game pays no placement split. */
  stakes: MatchStakes | null;
  onPick?: (ref: { bracket: BracketSide; round: number; slot: number }, seed: number | null) => void;
}) {
  const d = display.get(matchKey(match));
  const ref = { bracket: match.bracket, round: match.round, slot: match.slot };
  return (
    <div
      style={{
        border: "1px solid var(--color-bt-border)",
        borderRadius: 10,
        overflow: "hidden",
        background: "var(--color-bt-card)",
        // FIXED, not content-sized. Equal card heights are a precondition of the
        // round offsets — a bye row and a competitor row render different content,
        // and letting them size themselves is what made every round below the
        // first drift.
        height: BRACKET_METRICS.cardHeight,
      }}
      data-testid={`bracket-match-${d?.number ?? "?"}`}
    >
      {/* The shared eyebrow recipe (STYLE_GUIDE §2b) — 10px / 700 / 0.08em /
          uppercase / text-dim, the same one match play's card header already
          used. This was 9px at 0.08em: close enough to look deliberate, off the
          scale, and arrived at independently. */}
      <div
        className="flex items-center justify-between"
        style={{
          ...EYEBROW,
          padding: "0 8px", height: MATCH_HEADER_HEIGHT, background: "var(--color-bt-card-raised)",
          borderBottom: "1px solid var(--color-bt-border)",
        }}
      >
        <span>Match {d?.number}</span>
        {/* WHAT'S AT STAKE — only where places are actually PAID.
            See `matchStakes`: a round-one match awards nothing directly, so it
            carries no points here. */}
        {stakes && (
          // No leading separator: the header is `justify-between`, so the two
          // segments already sit at opposite ends. A middot here dangles.
          <span data-testid="bracket-match-stakes">{stakes.label}</span>
        )}
      </div>
      <Slot seat="a" match={match} pending={d?.aPending ?? null} vacant={d?.aVacant ?? false} bySeed={bySeed} canPick={canPick} onPick={onPick} matchRef={ref} mustWin={mustWin} />
      <Slot seat="b" match={match} pending={d?.bPending ?? null} vacant={d?.bVacant ?? false} bySeed={bySeed} canPick={canPick} onPick={onPick} matchRef={ref} mustWin={mustWin} />
    </div>
  );
}

/**
 * One competitor's row.
 *
 * TAP TO ADVANCE, tap again to undo. The spec's affordance is "tap a competitor
 * to advance them", and the same tap on the current winner CLEARS the pick —
 * because someone picking the wrong winner is a certainty, and the undo has to
 * be where the mistake was made rather than behind a menu. It costs nothing:
 * clearing is one column wide, and everything above re-derives.
 */
function Slot({
  seat, match, pending, vacant, bySeed, canPick, onPick, matchRef, mustWin,
}: {
  vacant: boolean;
  mustWin?: (seed: number) => boolean;
  seat: "a" | "b";
  match: ResolvedMatch;
  pending: string | null;
  bySeed: Map<number, BracketEntrantMeta>;
  canPick: boolean;
  onPick?: (ref: { bracket: BracketSide; round: number; slot: number }, seed: number | null) => void;
  matchRef: { bracket: BracketSide; round: number; slot: number };
}) {
  const seed = seat === "a" ? match.aSeed : match.bSeed;
  const meta = seed === null ? undefined : bySeed.get(seed);
  const won = seed !== null && match.winnerSeed === seed;
  const base = {
    display: "flex", alignItems: "center", gap: 7,
    // FIXED height, not minimum — see the card's own note. A "Bye" row and a
    // "waiting on the round below" row must occupy exactly what a competitor row
    // does, or the geometry above is computing against the wrong unit.
    //
    // The COMPETITOR NAME is the primary text on this surface and was the most
    // undersized thing on it: 12px against match play's 17. Raised to the 15
    // rung (STYLE_GUIDE §2a). Not 17: match play renders ONE card per row, and a
    // bracket shows up to sixteen at once, so a step down is a real density
    // difference rather than the old undersizing.
    padding: "0 9px", fontSize: TYPE_SCALE.name, height: SLOT_HEIGHT,
    borderBottom: seat === "a" ? "1px solid var(--color-bt-border)" : undefined,
  } as const;

  // The empty half of a bye. Nobody played, so there is nothing to tap.
  if (seed === null && match.bye && seat === "b") {
    return (
      // Secondary, like the pending row — a bye is a state, not a competitor.
      <div style={{ ...base, color: "var(--color-bt-text-dim)", fontSize: TYPE_SCALE.caption }} data-testid="bracket-slot-bye">
        <span>Bye</span>
      </div>
    );
  }
  // PERMANENTLY EMPTY — nobody is ever coming. Distinct from waiting, and given no
  // placeholder: naming a feeder that can never deliver is the waiting/empty conflation
  // reappearing with better typography. Dimmed and wordless, so the eye skips it.
  if (seed === null && vacant) {
    return (
      <div
        style={{ ...base, color: "var(--color-bt-text-dim)", fontSize: TYPE_SCALE.caption, opacity: 0.45 }}
        data-testid="bracket-slot-vacant"
      >
        <span aria-hidden>·</span>
      </div>
    );
  }
  // Waiting on the round below — named rather than blank, so the reader knows
  // where to look instead of wondering whether something failed to load.
  if (seed === null) {
    return (
      <div style={{ ...base, color: "var(--color-bt-text-dim)", fontSize: TYPE_SCALE.caption }} data-testid="bracket-slot-pending">
        <span>{pending ?? "—"}</span>
      </div>
    );
  }

  /**
   * WINNERS ARE RADIO BUTTONS. Tapping the other competitor SWITCHES the winner;
   * it does not require clearing the current one first.
   *
   * This used to read `playable === true ? true : won`, and `playable` is false
   * the moment a winner exists — so once anyone was picked, the loser's row went
   * dead and the only live target was the winner (to clear). Switching a wrong
   * pick took two taps and a round trip in between, for a control that is
   * visibly a radio group.
   *
   * The gate was purely on this side: `games.pickWinner` validates only that the
   * seed is one of the match's resolved occupants and never required the current
   * winner to be null. Measured directly during the phase 0 pass — a straight
   * replacement is ACCEPTED, which is what settled this as a client fix rather
   * than a batched save-the-board button.
   *
   * A seat is tappable whenever the match is DECIDABLE — both occupants known
   * and somebody actually played. That predicate is computed once in
   * `resolveDraw` beside `playable` rather than re-derived here, so a second
   * bracket surface cannot answer "can I tap this?" differently (CLAUDE.md #24).
   * Byes stay untappable, and so does a match still waiting on the round below.
   *
   * Tapping the CURRENT winner still clears — `won ? null : seed` below is
   * unchanged, and clearing still does not cascade (#925). Clear a semi and
   * re-pick the same entrant and the final's result comes back, deliberately.
   */
  const tappable = canPick && match.decidable;
  const content = (
    <>
      <i
        style={{
          width: 5, height: 5, borderRadius: "50%", flexShrink: 0,
          background: meta?.teamColor ?? "var(--color-bt-text-dim)",
        }}
      />
      {/* ONE LINE — "Brad & Zach", never stacked.
          The two-line form came from match play, where it solves a real
          score-entry constraint: fitting a side's players into a phone-width
          scoring column. A bracket has no such column — this board scrolls
          horizontally — so the constraint doesn't transfer, and stacking cost a
          line of height while reading as two separate competitors. */}
      <span className="min-w-0 flex-1" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        {meta ? (meta.partner ? `${meta.name} & ${meta.partner}` : meta.name) : `Seed ${seed}`}
      </span>
      {/* MUST-WIN — the GRAND FINAL only (T5).
          Everywhere else it restated its own column heading: the lower bracket is
          headed "second life", so every row in it is must-win by definition and the
          badge added nothing while spending the signal. At the grand final it is the
          one place nothing else says it — true for the entrant who came through the
          lower bracket, false for the one who did not, which is the asymmetry the
          if-necessary final exists for. `isMustWin` is unchanged; this is scope. */}
      {/* Only on a match still to be played. `!won` was not enough: it left the marker
          on the LOSER's row of a settled match, which is both meaningless (it is over)
          and doubles the count — 8 markers on a board where 4 are real. Must-win is a
          question about a match you are about to play. */}
      {seed !== null && match.playable && match.bracket === "final" && mustWin?.(seed) && (
        <span
          data-testid="bracket-must-win"
          style={{
            ...EYEBROW, flexShrink: 0, color: "var(--color-bt-warning)",
            border: "1px solid var(--color-bt-warning-border)", borderRadius: 4,
            padding: "1px 4px", lineHeight: 1.2,
          }}
        >
          Must win
        </span>
      )}
      {canPick && (
        <span
          style={{
            width: 19, height: 19, borderRadius: "50%", flexShrink: 0,
            display: "grid", placeItems: "center",
            border: `1px solid ${won ? "var(--color-bt-accent)" : "var(--color-bt-border)"}`,
            background: won ? "var(--color-bt-accent)" : "transparent",
            color: won ? "var(--color-bt-base)" : "transparent",
          }}
        >
          {won && <Check size={11} strokeWidth={3.2} />}
        </span>
      )}
    </>
  );

  const style = {
    ...base,
    background: won ? "var(--color-bt-accent-faint)" : undefined,
    fontWeight: won ? 650 : undefined,
    width: "100%",
    textAlign: "left" as const,
    color: "var(--color-bt-text)",
  };

  if (!tappable) return <div style={style} data-testid={`bracket-slot-${seed}`}>{content}</div>;
  return (
    <button
      type="button"
      style={style}
      onClick={() => onPick?.(matchRef, won ? null : seed)}
      aria-pressed={won}
      data-testid={`bracket-slot-${seed}`}
    >
      {content}
    </button>
  );
}
