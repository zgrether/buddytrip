"use client";

import { TYPE_SCALE } from "@/lib/typeScale";
import {
  MultiplierBadge,
  SpreadBadge,
  pickemRowSurface,
  type MatchupLineGame,
} from "./slateRowVisual";

/**
 * One game on the picks sheet — the row IS the control.
 *
 * ── What this replaces, and why ────────────────────────────────────────────
 *
 * The old sheet printed each team name TWICE: once in a matchup line, once on a
 * large select button underneath. Sixteen games of that is thirty-two names for
 * sixteen decisions, and it left the right half of every card empty.
 *
 * Here the matchup line is the control — the team names themselves are the tap
 * targets — and the kickoff fills the space the buttons used to waste. One row
 * per game, around 52px, so a sixteen-game slate is a list you scan rather than
 * a stack you scroll.
 *
 * ── Confidence OFF is a different product, not a disabled version ──────────
 *
 * With confidence off there is no rank chip and no grip, and nothing reorders:
 * slate order stands and every correct pick is worth 1 before the multiplier.
 * The row is not showing greyed-out controls — the concepts do not exist in
 * that variant, so neither do their affordances (§11's rule: absent, never
 * disabled). The GRIP is not rendered here at all; `ReorderableList` owns it and
 * is simply not enabled.
 */

export interface SheetRowGame extends MatchupLineGame {
  id: string;
  kickoff: string | null;
  note: string | null;
}

/**
 * What became of this pick, once the game has been played.
 *
 * Null while nothing is known — and null is the ONLY value that means that.
 * "void" is a decided outcome that paid nobody (a push, or a game pulled from
 * the scoring), which looks identical to "not played yet" in every number on
 * this row and means the opposite thing about what is left to come.
 */
export type PickOutcome = "won" | "lost" | "void";

/**
 * "Sun" over "4:25p" — the two-line kickoff stack that fills the right side.
 *
 * Parsed and re-rendered rather than printed: the stored `kickoff` is free text
 * a runner typed ("Sun 4:25p", "Thu 7:30p"), so this splits on the first space
 * and shows what it finds. A value that does not split just renders whole,
 * because a kickoff nobody can parse is still a kickoff somebody wrote.
 */
function Kickoff({ kickoff }: { kickoff: string }) {
  const trimmed = kickoff.trim();
  const gap = trimmed.indexOf(" ");
  const day = gap > 0 ? trimmed.slice(0, gap) : null;
  const time = gap > 0 ? trimmed.slice(gap + 1) : trimmed;

  return (
    <span
      className="flex shrink-0 flex-col items-end text-right"
      data-testid="pickem-row-kickoff"
      style={{
        fontSize: 10.5,
        fontWeight: 500,
        lineHeight: 1.25,
        color: "var(--color-bt-text-dim)",
        fontVariantNumeric: "tabular-nums",
      }}
    >
      {day && <span>{day}</span>}
      <span>{time}</span>
    </span>
  );
}

/**
 * The points this game carries, from its POSITION — and, once it has been
 * played, what became of them.
 *
 * The rank is the position — never stored beside it — so the chip renumbers as
 * the list moves and confidence cannot drift out of step with order.
 *
 * ── ONE number, three fates ────────────────────────────────────────────────
 *
 * The chip always shows the STAKE: what this position was worth, multiplier
 * included. What changes is the treatment — accent for points banked, struck
 * through for points missed, dim for a game that paid nobody.
 *
 * Showing the stake rather than the EARNED value is what makes the three
 * readable as one column. Earned would print 0 on both a miss and a push,
 * which is the same number for opposite facts, and it would make the wrong
 * picks vanish into a column of zeroes — the exact thing a person scanning a
 * finished sheet wants to find.
 *
 * The strike-through is the one that carries meaning without colour: a number
 * crossed out is a number that did not count, in any theme and at any size.
 */
function RankChip({
  points,
  picked,
  outcome,
}: {
  points: number;
  picked: boolean;
  outcome: PickOutcome | null;
}) {
  const banked = outcome === "won";
  const missed = outcome === "lost";
  return (
    <span
      data-testid="pickem-row-rank"
      data-outcome={outcome ?? "open"}
      className="flex shrink-0 items-center justify-center"
      style={{
        width: 28,
        height: 28,
        borderRadius: 8,
        fontSize: 13,
        fontWeight: 700,
        fontVariantNumeric: "tabular-nums",
        // A banked stake takes the SOLID accent — the only filled chip on the
        // sheet, so a scan down a played slate reads as the points that landed.
        background: banked
          ? "var(--color-bt-accent)"
          : outcome != null
            ? "transparent"
            : picked
              ? "var(--color-bt-accent-faint)"
              : "transparent",
        border: banked
          ? "1px solid var(--color-bt-accent)"
          : outcome != null
            ? "1px solid var(--color-bt-border)"
            : picked
              ? "1px solid var(--color-bt-accent-border)"
              : "1px dashed var(--color-bt-border)",
        color: banked
          ? "var(--color-bt-base)"
          : outcome != null
            ? "var(--color-bt-text-dim)"
            : picked
              ? "var(--color-bt-accent)"
              : "var(--color-bt-text-dim)",
        textDecoration: missed ? "line-through" : undefined,
      }}
    >
      {points}
    </span>
  );
}

/**
 * One team name, as a tap target.
 *
 * Three states, and the middle one is the point: once a side is picked the OTHER
 * side dims, so a scan down the sheet reads as a column of choices rather than a
 * column of pairs. Untouched — neither side picked — renders in plain text,
 * which is what lets a person see at a glance whether they actually made a call
 * on this game or are looking at the default.
 */
function TeamTarget({
  name,
  side,
  state,
  onPick,
  editable,
}: {
  name: string;
  /** Encoded in the testid so an assertion can say WHICH side is taken, not
   *  merely that something is. */
  side: "away" | "home";
  state: "picked" | "other" | "neither";
  onPick: () => void;
  editable: boolean;
}) {
  const picked = state === "picked";
  return (
    <button
      type="button"
      onClick={editable ? onPick : undefined}
      disabled={!editable}
      data-testid={`pickem-team-${side}`}
      data-picked={picked ? "true" : "false"}
      aria-pressed={picked}
      className={editable ? "active:scale-[0.98]" : undefined}
      style={{
        display: "inline-block",
        padding: "10px 6px",
        borderRadius: 8,
        // `emphasis` (14) — the rung for "emphasis inside a row", and what the
        // design specifies. It was `bodyDense` (12), which is the SUBTITLE rung:
        // the team names are the primary content of this row and the thing you
        // tap, so they were a step too small for both jobs.
        fontSize: TYPE_SCALE.emphasis,
        fontWeight: picked ? 600 : state === "other" ? 500 : 600,
        color: picked
          ? "var(--color-bt-accent)"
          : state === "other"
            ? "var(--color-bt-text-dim)"
            : "var(--color-bt-text)",
        background: picked ? "var(--color-bt-accent-faint)" : "transparent",
        boxShadow: picked ? "inset 0 0 0 1px var(--color-bt-accent-border)" : undefined,
        cursor: editable ? "pointer" : "default",
        WebkitTapHighlightColor: "transparent",
      }}
    >
      {name}
    </button>
  );
}

export function PickemSheetRow({
  game,
  pick,
  points,
  outcome = null,
  editable,
  onPick,
}: {
  game: SheetRowGame;
  /** The chosen side, or null while nobody has been taken. */
  pick: "away" | "home" | null;
  /**
   * What this position is worth.
   *
   * Null when confidence is off AND the game is unplayed — the chip is then
   * ABSENT rather than showing a 1 nobody chose. Once a game HAS been played
   * the caller passes the stake either way, because with confidence off the
   * stake is still 1 times the multiplier and "what became of it" is the
   * question this row has stopped being able to answer without it.
   */
  points: number | null;
  /**
   * What became of the pick. Null while the game is unplayed, which is also
   * what the editable sheet always passes: dimming a row that can still be
   * tapped would read as disabled, and it is not.
   */
  outcome?: PickOutcome | null;
  editable: boolean;
  /** Null means "clear this game" — the row calls it when the SELECTED side is
   *  tapped again. */
  onPick: (side: "away" | "home" | null) => void;
}) {
  const weighted = (game.multiplier ?? 1) > 1;
  const sideState = (side: "away" | "home") =>
    pick === null ? "neither" : pick === side ? "picked" : "other";

  return (
    <div
      data-testid="pickem-sheet-row"
      className="flex items-center gap-2"
      style={{
        ...pickemRowSurface({ weighted }),
        borderRadius: 11,
        padding: "5px 10px 5px 12px",
        minHeight: 52,
        /**
         * ONE dim, on the whole row, chip included.
         *
         * The first version faded the content BESIDE the chip and left the chip
         * at full strength, on the reasoning that the stake is the reason to
         * look at a played row. On screen that made the chip a third kind of
         * bright number — beside the live rows' accent chips and the unplayed
         * rows' outlined ones — so a finished slate had three brightnesses
         * competing and the settled rows read as the loudest thing on it.
         *
         * The chip does not need brightness to stay legible, because its three
         * fates are carried by SHAPE: a filled disc, a strike-through, a plain
         * outline. Those survive the fade; a brightness contest does not.
         */
        opacity: outcome != null ? 0.38 : 1,
      }}
    >
      {points != null && (
        <RankChip points={points} picked={pick !== null} outcome={outcome} />
      )}

      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-center gap-x-1 gap-y-1">
          {/* Tapping the side you already took CLEARS it. Without that the
              first tap on a row is irreversible, which is a strange thing to be
              true of a sheet whose whole premise is that nothing is decided
              until you decide it. */}
          <TeamTarget
            name={game.awayTeam}
            side="away"
            state={sideState("away")}
            editable={editable}
            onPick={() => onPick(pick === "away" ? null : "away")}
          />
          {/* Not a tap target — a preposition between two of them. */}
          <span style={{ fontSize: 12, color: "var(--color-bt-text-dim)" }}>at</span>
          <TeamTarget
            name={game.homeTeam}
            side="home"
            state={sideState("home")}
            editable={editable}
            onPick={() => onPick(pick === "home" ? null : "home")}
          />
          {/* The line is the HOME team's, which is why it sits WITH the home
              team rather than in a column of its own — but it is a badge beside
              a name, not part of it, so it needs air the tap target's own
              padding does not provide. */}
          {(game.spread || weighted) && (
            <span className="ml-0.5 flex items-center gap-1.5">
              {game.spread && <SpreadBadge spread={game.spread} />}
              {weighted && <MultiplierBadge multiplier={game.multiplier as number} />}
            </span>
          )}
        </span>
        {game.note && (
          <span
            className="mt-0.5 block truncate"
            style={{ fontSize: 11, color: "var(--color-bt-text-dim)" }}
          >
            {game.note}
          </span>
        )}
      </span>

      {game.kickoff && <Kickoff kickoff={game.kickoff} />}
    </div>
  );
}
