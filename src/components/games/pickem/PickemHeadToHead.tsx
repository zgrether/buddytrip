"use client";

import { ChevronLeft } from "lucide-react";
import { Avatar } from "@/components/Avatar";
import { TYPE_SCALE, EYEBROW } from "@/lib/typeScale";
import { MatchupLine, pickemRowSurface } from "./slateRowVisual";
import { matchPill, type SidesPicked } from "./PickemMatchCard";
import { matchStanding, type BoardRow, type ZeroKind } from "@/lib/pickemBoard";
import type { BoardSlateGame } from "./PickemBoard";

/**
 * Screen D — the head-to-head.
 *
 * ── The swing column is the reason this screen exists ──────────────────────
 *
 * Two totals tell you who is ahead. They do not tell you WHERE, and in a
 * confidence game that is the whole story: both players taking Alabama, one at
 * 16 and one at 3, is a thirteen-point swing on a game they agreed about. A
 * totals-only view hides it completely, and it is the single largest thing that
 * happened in the match.
 *
 * So the middle column is not decoration between two lists. It is the content,
 * and the two sides are its argument.
 */

/**
 * The four zeros, short enough for a 70px cell.
 *
 * A dash for all of them would tell the reader a cancelled game was played.
 * They are four different FACTS — the stake voided, or both were right, or
 * neither was — and a reader wants to know which, because only one of them is
 * anybody's fault.
 *
 * `Void` rather than `Cancelled` here while the row's own result chip says
 * `Cancelled`: the chip is about the GAME and this is about the STAKE. The game
 * was cancelled, so the stake voided.
 */
const ZERO_SHORT: Record<ZeroKind, string> = {
  push: "Push",
  cancelled: "Void",
  both: "Both",
  neither: "Neither",
};

export type SwingDirection = "a" | "b" | "both" | "zero" | "none";

export interface SwingCell {
  dir: SwingDirection;
  text: string;
}

/**
 * What the swing cell says, for every state a row can be in.
 *
 * ── Never a symmetric ± on an agreement row ────────────────────────────────
 *
 * When both sides picked the same team only ONE of them can gain, and only by
 * the difference in their ranks — they either both bank or both miss.
 * `upsideFor` already collapses that to a one-sided number, so this reads
 * whichever of the two is non-zero and points the arrow at them. Rendering
 * `±16` there would claim sixteen points are on a game that can move the match
 * by three.
 *
 * The one legitimate dash is the last case: unplayed, and nobody can gain. That
 * is not a zero with a reason behind it, it is an absence of stake — the two
 * agreed at the same rank, so the game cannot move the match at all.
 */
export function swingCell(row: BoardRow): SwingCell {
  if (row.result != null) {
    if (row.swing > 0) return { dir: "a", text: `◀ ${row.swing}` };
    if (row.swing < 0) return { dir: "b", text: `${Math.abs(row.swing)} ▶` };
    // Played and level. `zeroKind` is non-null exactly here, but the fallback
    // is a fact rather than a dash even if that ever stops being true.
    return { dir: "zero", text: row.zeroKind ? ZERO_SHORT[row.zeroKind] : "Level" };
  }

  if (row.upsideA > 0 && row.upsideB > 0) {
    return { dir: "both", text: `${row.upsideA}↔${row.upsideB}` };
  }
  if (row.upsideA > 0) return { dir: "a", text: `◀ ${row.upsideA}` };
  if (row.upsideB > 0) return { dir: "b", text: `${row.upsideB} ▶` };
  return { dir: "none", text: "—" };
}

/** The header pill, derived from the ONE `matchPill` so the two screens cannot
 *  disagree about a clinch — with the live case spending its space on the
 *  number a reader actually wants there. */
export function h2hPill(
  rows: BoardRow[],
  resolved: number,
  picked: SidesPicked
): string {
  const s = matchStanding(rows);
  const pill = matchPill(s, resolved, picked);
  if (pill === "final") return "Final";
  if (pill === "clinched") return "Clinched";
  if (pill === "no-picks") return "No picks";
  return `${s.remaining} left`;
}

export function PickemHeadToHead({
  slate,
  rows,
  aName,
  bName,
  aUserId,
  bUserId,
  avatarFor,
  matchIndex,
  matchCount,
  resolved,
  picked,
  note,
  onBack,
}: {
  slate: BoardSlateGame[];
  rows: BoardRow[];
  aName: string;
  bName: string;
  aUserId: string;
  bUserId: string;
  /** Identity for the header. The two people ARE the subject here, and there is
   *  room for them that a match card in a list of eight does not have. */
  avatarFor: (userId: string) => { avatarIcon: string | null; teamColor: string | null };
  /** 1-based, for "Match 3 of 8". */
  matchIndex: number;
  matchCount: number;
  resolved: number;
  picked: SidesPicked;
  /** The one-line state, from the shared `h2hNote`. */
  note: string;
  onBack: () => void;
}) {
  const byId = new Map(slate.map((g) => [g.id, g]));
  const s = matchStanding(rows);
  const a = avatarFor(aUserId);
  const b = avatarFor(bUserId);

  return (
    <div className="flex flex-col gap-2" data-testid="pickem-board-detail">
      <div className="flex items-center gap-1 px-1">
        <button
          type="button"
          onClick={onBack}
          data-testid="pickem-board-back"
          className="-ml-1 flex shrink-0 items-center justify-center"
          style={{ width: 32, height: 32, color: "var(--color-bt-accent)" }}
          aria-label="All matches"
        >
          <ChevronLeft size={20} />
        </button>
        <span className="min-w-0 flex-1 truncate" style={{ fontSize: 17, fontWeight: 700 }}>
          {aName} vs {bName}
        </span>
        <span
          className="shrink-0"
          style={{ fontSize: TYPE_SCALE.caption, color: "var(--color-bt-text-dim)" }}
        >
          Match {matchIndex} of {matchCount}
        </span>
      </div>

      <div
        className="flex items-center gap-3 rounded-xl px-3 py-3"
        style={{ background: "var(--color-bt-card)", border: "1px solid var(--color-bt-border)" }}
      >
        <Side
          name={aName}
          total={s.aTotal}
          leading={s.margin > 0}
          avatarIcon={a.avatarIcon}
          teamColor={a.teamColor}
          align="left"
        />
        <span
          data-testid="pickem-h2h-pill"
          className="shrink-0 rounded-full"
          style={{
            fontSize: 9.5,
            fontWeight: 700,
            letterSpacing: "0.08em",
            textTransform: "uppercase",
            padding: "2px 7px",
            color: "var(--color-bt-text-dim)",
            background: "var(--color-bt-card-raised)",
          }}
        >
          {h2hPill(rows, resolved, picked)}
        </span>
        <Side
          name={bName}
          total={s.bTotal}
          leading={s.margin < 0}
          avatarIcon={b.avatarIcon}
          teamColor={b.teamColor}
          align="right"
        />
      </div>

      <div
        className="px-1"
        data-testid="pickem-h2h-note"
        style={{ fontSize: TYPE_SCALE.caption, color: "var(--color-bt-text-dim)", lineHeight: 1.45 }}
      >
        {note}
      </div>

      <div className="px-1" style={EYEBROW}>
        Game by game
      </div>

      {rows.map((r) => {
        const g = byId.get(r.slateGameId);
        if (!g) return null;
        const played = r.result != null;
        const cell = swingCell(r);
        return (
          <div
            key={r.slateGameId}
            data-testid="pickem-board-row"
            className="flex flex-col gap-1.5"
            style={{
              ...pickemRowSurface({ weighted: r.multiplier > 1, quiet: !played }),
              borderRadius: 11,
              padding: "7px 10px",
            }}
          >
            <span className="flex items-center gap-2">
              <span className="min-w-0 flex-1">
                <MatchupLine
                  game={{
                    awayTeam: g.awayTeam,
                    homeTeam: g.homeTeam,
                    spread: g.spread,
                    kickoff: played ? null : (g.kickoff ?? "TBD"),
                    note: null,
                    multiplier: r.multiplier,
                  }}
                />
              </span>
              {played && <ResultChip result={r.result} game={g} />}
            </span>

            <span
              className="grid items-center gap-2"
              style={{ gridTemplateColumns: "1fr 70px 1fr" }}
            >
              <span
                className="flex min-w-0 items-center justify-end gap-1.5 truncate"
                style={{ fontSize: TYPE_SCALE.caption }}
              >
                <span className="truncate">{r.aPick === "away" ? g.awayTeam : g.homeTeam}</span>
                <Conf value={r.aConfidence} hit={r.aPoints > 0} played={played} />
              </span>

              <Swing cell={cell} />

              <span
                className="flex min-w-0 items-center gap-1.5 truncate"
                style={{ fontSize: TYPE_SCALE.caption }}
              >
                <Conf value={r.bConfidence} hit={r.bPoints > 0} played={played} />
                <span className="truncate">{r.bPick === "away" ? g.awayTeam : g.homeTeam}</span>
              </span>
            </span>
          </div>
        );
      })}
    </div>
  );
}

/** One side of the header — the person, then what they have. */
function Side({
  name,
  total,
  leading,
  avatarIcon,
  teamColor,
  align,
}: {
  name: string;
  total: number;
  leading: boolean;
  avatarIcon: string | null;
  teamColor: string | null;
  align: "left" | "right";
}) {
  return (
    <span
      className={`flex min-w-0 flex-1 flex-col items-center gap-1 ${align === "right" ? "text-right" : "text-left"}`}
    >
      <Avatar name={name} avatarIcon={avatarIcon} teamColor={teamColor} sizePx={30} />
      <span
        className="block w-full truncate text-center"
        style={{ fontSize: TYPE_SCALE.bodyDense, color: "var(--color-bt-text-dim)" }}
      >
        {name}
      </span>
      <span
        className="block w-full text-center"
        style={{
          fontSize: 26,
          fontWeight: 800,
          lineHeight: 1.05,
          fontVariantNumeric: "tabular-nums",
          color: leading ? "var(--color-bt-accent)" : "var(--color-bt-text)",
        }}
      >
        {total}
      </span>
    </span>
  );
}

/** The middle column. Accent-faint whenever somebody's points are involved;
 *  flat when the row is a zero or a non-stake, because those are facts about
 *  nothing having moved. */
function Swing({ cell }: { cell: SwingCell }) {
  const live = cell.dir === "a" || cell.dir === "b" || cell.dir === "both";
  return (
    <span
      data-testid={`pickem-swing-${cell.dir}`}
      className="justify-self-center rounded px-1.5 py-0.5 text-center"
      style={{
        borderRadius: 7,
        fontSize: 11,
        fontWeight: 700,
        fontVariantNumeric: "tabular-nums",
        color: live ? "var(--color-bt-accent)" : "var(--color-bt-text-dim)",
        background: live ? "var(--color-bt-accent-faint)" : "transparent",
      }}
    >
      {cell.text}
    </span>
  );
}

/** What happened to the GAME — as distinct from the swing cell, which says what
 *  happened to the MATCH. */
function ResultChip({
  result,
  game,
}: {
  result: BoardRow["result"];
  game: BoardSlateGame;
}) {
  const label =
    result === "push"
      ? "Push"
      : result === "cancelled"
        ? "Cancelled"
        : `${result === "away" ? game.awayTeam : game.homeTeam} covered`;
  return (
    <span
      className="shrink-0"
      style={{
        fontSize: 9.5,
        fontWeight: 700,
        borderRadius: 5,
        padding: "2px 5px",
        color: "var(--color-bt-text-dim)",
        background: "var(--color-bt-card-raised)",
      }}
    >
      {label}
    </span>
  );
}

/** The rank somebody spent. Struck through when it missed — the number stays
 *  readable, because what they spent is the interesting part of a wrong pick. */
function Conf({
  value,
  hit,
  played,
}: {
  value: number | null;
  hit: boolean;
  played: boolean;
}) {
  if (value == null) return null;
  const missed = played && !hit;
  return (
    <span
      className="shrink-0 text-center"
      style={{
        minWidth: 22,
        height: 20,
        lineHeight: "20px",
        borderRadius: 6,
        fontSize: 11,
        fontWeight: 700,
        fontVariantNumeric: "tabular-nums",
        textDecoration: missed ? "line-through" : undefined,
        background: hit ? "var(--color-bt-accent-faint)" : "var(--color-bt-card-raised)",
        color: hit ? "var(--color-bt-accent)" : "var(--color-bt-text-dim)",
      }}
    >
      {value}
    </span>
  );
}
