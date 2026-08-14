"use client";

import { Check } from "lucide-react";
import { matchKey, type ResolvedMatch } from "@/lib/bracketAdvance";
import { bracketDisplay, roundName } from "@/lib/bracketLabels";
import { roundLayout, BRACKET_METRICS, SLOT_HEIGHT, MATCH_HEADER_HEIGHT } from "@/lib/bracketLayout";
import { matchStakes, formatStake, type MatchStakes } from "@/lib/bracketStakes";

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
}: {
  matches: ResolvedMatch[];
  entrants: BracketEntrantMeta[];
  /** The game's placement split. Empty → the headers quote no points, which is
   *  right for a game that pays no per-place values. */
  pointsDistribution?: readonly number[];
  /** Organizer view when true; the member's read-only board when false. */
  canPick?: boolean;
  /** `seed` is the winner, or null to clear. Only called when `canPick`. */
  onPick?: (ref: { bracket: "main" | "consolation"; round: number; slot: number }, seed: number | null) => void;
}) {
  const display = bracketDisplay(matches);
  const bySeed = new Map(entrants.map((e) => [e.seed, e]));
  const main = matches.filter((m) => m.bracket === "main");
  const consolation = matches.filter((m) => m.bracket === "consolation");
  const lastRound = main.reduce((max, m) => Math.max(max, m.round), 0);
  const rounds = [...new Set(main.map((m) => m.round))].sort((a, b) => a - b);

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
      {/* `items-start`, not the default stretch: each round column is exactly as
          tall as its own content, and the vertical placement comes from the
          computed offsets below rather than from how the columns happen to
          stretch against each other. */}
      <div className="flex items-start" style={{ gap: 26, minWidth: "min-content" }}>
        {rounds.map((round) => {
          const { offset, gap } = roundLayout(round, BRACKET_METRICS);
          return (
            <div key={round} className="flex flex-col" style={{ minWidth: 172 }}>
              {/* OUTSIDE the offset container. The heading used to be a sibling of
                  the match cards inside a `justify-around` column, so it was being
                  distributed along with them — round 1 spacing 5 items and round 2
                  spacing 3 is what broke the alignment. */}
              <div
                className="text-center"
                style={{
                  fontSize: 9.5, textTransform: "uppercase", letterSpacing: "0.09em",
                  color: "var(--color-bt-text-dim)", fontWeight: 700, marginBottom: 2,
                }}
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
                    <MatchCard key={matchKey(m)} match={m} display={display} bySeed={bySeed} canPick={canPick} onPick={onPick} stakes={matchStakes(m, matches, pointsDistribution)} />
                  ))}
              </div>
            </div>
          );
        })}
      </div>

      {consolation.length > 0 && (
        <div style={{ marginTop: 14, paddingTop: 12, borderTop: "1px dashed var(--color-bt-border)" }}>
          {/* Warning tone, matching the mockup — this is the one match that does
              not decide the title, and colouring it as such stops it reading as
              a second final. STATUS DISPLAY ONLY, which is what the token is for. */}
          <div
            style={{
              fontSize: 9.5, textTransform: "uppercase", letterSpacing: "0.09em",
              color: "var(--color-bt-warning)", fontWeight: 700, marginBottom: 7,
            }}
          >
            Consolation · 3rd place
          </div>
          <div style={{ maxWidth: 172 }}>
            {consolation.map((m) => (
              <MatchCard key={matchKey(m)} match={m} display={display} bySeed={bySeed} canPick={canPick} onPick={onPick} stakes={matchStakes(m, matches, pointsDistribution)} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function MatchCard({
  match, display, bySeed, canPick, onPick, stakes,
}: {
  match: ResolvedMatch;
  display: ReturnType<typeof bracketDisplay>;
  bySeed: Map<number, BracketEntrantMeta>;
  canPick: boolean;
  /** What this match is worth, or null when the game pays no placement split. */
  stakes: MatchStakes | null;
  onPick?: (ref: { bracket: "main" | "consolation"; round: number; slot: number }, seed: number | null) => void;
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
      <div
        className="flex items-center justify-between"
        style={{
          fontSize: 9, letterSpacing: "0.08em", color: "var(--color-bt-text-dim)", fontWeight: 700,
          padding: "0 8px", height: MATCH_HEADER_HEIGHT, background: "var(--color-bt-card-raised)",
          borderBottom: "1px solid var(--color-bt-border)",
        }}
      >
        <span>Match {d?.number}</span>
        {/* WHAT'S AT STAKE — one formula at every depth: what the loser takes,
            and what the winner is guaranteed. In the final the two tie groups
            are singletons, so this reads as the literal 1st/2nd without a
            special case; earlier rounds honestly say "at least", because a
            first-round winner is not playing for 1st yet.

            Absent entirely when the game pays no placement split — quoting "L 0"
            would state a payout the game does not have. */}
        {stakes && (
          <span
            style={{ fontWeight: 600, letterSpacing: 0, color: "var(--color-bt-text-dim)" }}
            data-testid="bracket-match-stakes"
          >
            W {stakes.winnerIsExact ? "" : "≥"}
            {formatStake(stakes.winner)} · L {formatStake(stakes.loser)}
          </span>
        )}
      </div>
      <Slot seat="a" match={match} pending={d?.aPending ?? null} bySeed={bySeed} canPick={canPick} onPick={onPick} matchRef={ref} />
      <Slot seat="b" match={match} pending={d?.bPending ?? null} bySeed={bySeed} canPick={canPick} onPick={onPick} matchRef={ref} />
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
  seat, match, pending, bySeed, canPick, onPick, matchRef,
}: {
  seat: "a" | "b";
  match: ResolvedMatch;
  pending: string | null;
  bySeed: Map<number, BracketEntrantMeta>;
  canPick: boolean;
  onPick?: (ref: { bracket: "main" | "consolation"; round: number; slot: number }, seed: number | null) => void;
  matchRef: { bracket: "main" | "consolation"; round: number; slot: number };
}) {
  const seed = seat === "a" ? match.aSeed : match.bSeed;
  const meta = seed === null ? undefined : bySeed.get(seed);
  const won = seed !== null && match.winnerSeed === seed;
  const base = {
    display: "flex", alignItems: "center", gap: 7,
    // FIXED height, not minimum — see the card's own note. A "Bye" row and a
    // "waiting on the round below" row must occupy exactly what a competitor row
    // does, or the geometry above is computing against the wrong unit.
    padding: "0 9px", fontSize: 12, height: SLOT_HEIGHT,
    borderBottom: seat === "a" ? "1px solid var(--color-bt-border)" : undefined,
  } as const;

  // The empty half of a bye. Nobody played, so there is nothing to tap.
  if (seed === null && match.bye && seat === "b") {
    return (
      <div style={{ ...base, color: "var(--color-bt-text-dim)" }} data-testid="bracket-slot-bye">
        <span>Bye</span>
      </div>
    );
  }
  // Waiting on the round below — named rather than blank, so the reader knows
  // where to look instead of wondering whether something failed to load.
  if (seed === null) {
    return (
      <div style={{ ...base, color: "var(--color-bt-text-dim)", fontSize: 11 }} data-testid="bracket-slot-pending">
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
