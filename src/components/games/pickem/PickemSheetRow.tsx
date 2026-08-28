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
 * The points this game carries, from its POSITION.
 *
 * The rank is the position — never stored beside it — so the chip renumbers as
 * the list moves and confidence cannot drift out of step with order.
 */
function RankChip({ points, picked }: { points: number; picked: boolean }) {
  return (
    <span
      data-testid="pickem-row-rank"
      className="flex shrink-0 items-center justify-center"
      style={{
        width: 28,
        height: 28,
        borderRadius: 8,
        fontSize: 13,
        fontWeight: 700,
        fontVariantNumeric: "tabular-nums",
        background: picked ? "var(--color-bt-accent-faint)" : "transparent",
        border: picked
          ? "1px solid var(--color-bt-accent-border)"
          : "1px dashed var(--color-bt-border)",
        color: picked ? "var(--color-bt-accent)" : "var(--color-bt-text-dim)",
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
        fontSize: TYPE_SCALE.bodyDense,
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
  editable,
  onPick,
}: {
  game: SheetRowGame;
  /** The chosen side, or null while nobody has been taken. */
  pick: "away" | "home" | null;
  /** What this position is worth — null when confidence is off, and then the
   *  chip is ABSENT rather than showing a 1 nobody chose. */
  points: number | null;
  editable: boolean;
  onPick: (side: "away" | "home") => void;
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
      }}
    >
      {points != null && <RankChip points={points} picked={pick !== null} />}

      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-center gap-x-0.5 gap-y-1">
          <TeamTarget
            name={game.awayTeam}
            side="away"
            state={sideState("away")}
            editable={editable}
            onPick={() => onPick("away")}
          />
          {/* Not a tap target — a preposition between two of them. */}
          <span style={{ fontSize: 12, color: "var(--color-bt-text-dim)" }}>at</span>
          <TeamTarget
            name={game.homeTeam}
            side="home"
            state={sideState("home")}
            editable={editable}
            onPick={() => onPick("home")}
          />
          {/* The line is the HOME team's, which is why it sits with the home
              team rather than in a column of its own. */}
          {game.spread && <SpreadBadge spread={game.spread} />}
          {weighted && <MultiplierBadge multiplier={game.multiplier as number} />}
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
