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
 * `Void` here and `Voided` on the row's own result chip — the same word, short
 * where 52px will not hold the longer one. It used to be `Void` against
 * `Cancelled`, on the reasoning that the chip was about the GAME and this about
 * the STAKE; see the chip for why that split no longer holds.
 */
const ZERO_SHORT: Record<ZeroKind, string> = {
  push: "Push",
  cancelled: "Void",
  both: "Both",
  neither: "Neither",
  // NOBODY picked — not "one of them didn't". A wrong pick against an empty
  // slot is `neither` now: something was wagered and lost, and reporting the
  // quiet half of the row says nothing about the half where that happened.
  // With both slots empty there is no contest to be wrong about, and this is
  // the whole story.
  unpicked: "No pick",
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
  if (pill === "no-sheet") return "Nothing submitted";
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
  useConfidence,
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
  /** Whether ranks mean anything here. With confidence OFF every stored rank is
   *  null and that is normal, so the missing-rank mark below must not fire. */
  useConfidence: boolean;
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
        /**
         * Spent and gone — the one condition, derived once per side.
         *
         * The team NAME and the rank CHIP both fade on it, and they are one
         * statement: this side took Alabama, at 12, and got nothing. Two
         * private derivations of that would be two things that must always
         * agree, which is how they stop agreeing.
         *
         * `r.aPick != null` matters: an absent pick is not a miss. It has its
         * own treatment ("No pick", italic) and fading that too would say
         * somebody lost something they never staked.
         */
        const aMissed = played && r.aPick != null && !(r.aPoints > 0);
        const bMissed = played && r.bPick != null && !(r.bPoints > 0);
        return (
          <div
            key={r.slateGameId}
            data-testid="pickem-board-row"
            className="flex flex-col gap-1.5"
            style={{
              /**
               * ── THE UNPLAYED ROWS ARE THE RAISED ONES ────────────────────
               *
               * The inverse of what this was. Played rows carried the fill and
               * unplayed ones were flat, so the only contests that can still
               * change were the quietest thing on the screen — and they are
               * what somebody opens a live match to look at.
               *
               * Same reasoning that put the outstanding games above the ENTERED
               * list on the results page: what is left to do gets the
               * emphasis, and what is settled keeps its record without
               * shouting. That page marks a resolved row with a BADGE rather
               * than by making the row loud, and this borrows the rule rather
               * than the styling — the two screens answer different questions.
               *
               * The swing column is why this screen exists, and it does not
               * recede with the row: `Swing` carries its own accent colour and
               * accent-faint fill, independent of the surface underneath. On a
               * flattened row it stands out MORE, not less.
               *
               * A match with nothing left is then all-flat, which is correct —
               * a settled match should read as a record rather than as a board
               * with nothing highlighted on it.
               */
              ...pickemRowSurface({ weighted: r.multiplier > 1, quiet: played }),
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
                <SidePick pick={r.aPick} game={g} missed={aMissed} />
                <Conf
                  value={r.aConfidence}
                  hit={r.aPoints > 0}
                  missed={aMissed}
                  picked={r.aPick != null}
                  ranksMatter={useConfidence}
                />
              </span>

              <Swing cell={cell} />

              <span
                className="flex min-w-0 items-center gap-1.5 truncate"
                style={{ fontSize: TYPE_SCALE.caption }}
              >
                <Conf
                  value={r.bConfidence}
                  hit={r.bPoints > 0}
                  missed={bMissed}
                  picked={r.bPick != null}
                  ranksMatter={useConfidence}
                />
                <SidePick pick={r.bPick} game={g} missed={bMissed} />
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
  /**
   * ── `Voided`, not `Cancelled` — and this REVERSES a twice-settled split ────
   *
   * The glossary ratified two names for one DB value: `Cancelled` where the GAME
   * is the subject, `Void` where the STAKE is. That was correct while a runner
   * pressing Void was the only producer of `cancelled` — they were asserting the
   * contest did not happen.
   *
   * Finalizing with contests outstanding is a second producer, and those games
   * were probably PLAYED; the runner just never entered a result. So the
   * game-subject fact the split depended on — "this did not happen" — is no
   * longer knowable from the value. Only the stake-subject fact survives, and
   * one surviving fact does not need two names.
   *
   * The premise changed; the decision follows it. CLAUDE.md's glossary row is
   * updated in the same change and cites this. Display-string tier: the DB value
   * is untouched.
   */
  const label =
    result === "push"
      ? "Push"
      : result === "cancelled"
        ? "Voided"
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

/**
 * What this side took — or that they took nothing.
 *
 * A null pick used to render as the HOME TEAM, because `buildBoardRows`
 * defaulted it. So a non-submitter read as having taken the chalk in every
 * game, which is a specific claim about somebody who is not playing.
 *
 * Dimmed and in the same slot rather than blanked: the column has to stay
 * readable down the page, and an empty cell is the ambiguity this feature keeps
 * having to remove — "they didn't pick" against "this hasn't loaded".
 *
 * ── A MISSED PICK FADES THE NAME TOO ──────────────────────────────────────
 *
 * The rank chip beside it already fades on a miss, and a wrong pick was
 * rendering as a full-strength team name next to a faded number — which reads
 * as one of them being uncertain rather than as the pair of them being spent.
 * They are one statement: this side took Alabama, at 12, and got nothing.
 *
 * Same `opacity: 0.45` as the chip, deliberately, for the reason the chip gives:
 * there is no step below `--color-bt-text-dim` in the system, and fading the
 * element keeps both halves on the same token and degrades identically in each
 * theme. `missed` is DERIVED ONCE at the call site and handed to both, so the
 * two cannot fade by different amounts or at different moments.
 */
function SidePick({
  pick,
  game,
  missed,
}: {
  pick: BoardRow["aPick"];
  game: BoardSlateGame;
  missed: boolean;
}) {
  if (pick == null) {
    return (
      <span
        className="truncate"
        data-testid="pickem-h2h-no-pick"
        style={{ color: "var(--color-bt-text-dim)", fontStyle: "italic" }}
      >
        No pick
      </span>
    );
  }
  return (
    <span className="truncate" data-testid="pickem-h2h-team" style={{ opacity: missed ? 0.45 : 1 }}>
      {pick === "away" ? game.awayTeam : game.homeTeam}
    </span>
  );
}

/**
 * The rank somebody spent.
 *
 * ── THREE STATES, AND THE STRIKE-THROUGH WAS CARRYING ONE OF THEM ──────────
 *
 * A missed pick used to be struck through, which was hard to read: a line
 * across two tabular digits at 11px fights the digits for the same pixels, and
 * the number is the thing worth reading — what somebody SPENT is the
 * interesting part of a wrong pick.
 *
 * Dimming it instead is the obvious fix and it has a trap in it. Missed and
 * UNPLAYED were identical but for the line, so removing the line without
 * replacing it merges two states: a rank that lost and a rank still in play
 * would render the same. Both are "not accent", and only one of them is over.
 *
 * So the ladder is explicit, and each step is a different amount of ink:
 *
 *   banked    accent on accent-faint — the teal that means points were awarded
 *   in play   the ordinary dim, on the raised chip — undecided, still yours
 *   missed    dimmer again, and the chip loses its fill — spent, and gone
 *
 * The fade is what says "no points", where the line used to. It reads as less
 * ink rather than as damage, and it cannot be confused with the accent, which
 * is the distinction that actually matters on this screen.
 *
 * ── DELIBERATELY UNLIKE THE SHEET'S RANK CHIP, WHICH STILL STRIKES ─────────
 *
 * `PickemSheetRow`'s chip keeps its strike-through, and that is not drift. On
 * the SHEET a settled row is already at `opacity: 0.38` as a whole, so a further
 * fade on the chip inside it has nothing to work with — it would be invisible
 * against a row that is itself faded. The line survives that, because it is
 * shape rather than contrast.
 *
 * Here the row is flat and undimmed, so the fade has the full range to itself
 * and the strike-through is what fails: a rule across two tabular digits at 11px
 * competes with the digits for the same pixels.
 *
 * So the two chips answer the same question with opposite tools because they sit
 * on opposite surfaces. Unifying them would make the sheet's chip disappear —
 * please do not, and if the sheet's row ever stops dimming itself, THAT is when
 * this becomes one treatment.
 */
function Conf({
  value,
  hit,
  missed,
  picked,
  ranksMatter,
}: {
  value: number | null;
  hit: boolean;
  /** Played, picked, and no points. Passed IN rather than derived from `played`
   *  and `hit` here, because `SidePick` fades on the same condition and two
   *  private derivations of one condition is how the halves of a single
   *  statement drift apart. */
  missed: boolean;
  /** Did this side pick this contest at all? A missing rank on a missing pick is
   *  not worth marking — `SidePick` already says "No pick". */
  picked: boolean;
  /** Confidence ON. Every rank is null with it off, and normal. */
  ranksMatter: boolean;
}) {
  /**
   * ── A PICK WITH NO RANK IS NOT A PICK WITH NO CHIP ─────────────────────────
   *
   * `pickPoints` reads `confidence ?? 0` when confidence is on, so a sheet whose
   * ranks were cleared by a reopen (migration 150) scores ZERO for every correct
   * pick until they are re-entered. The chip simply vanished, so the row showed
   * two team names and a zero — indistinguishable at a glance from a push, which
   * is exactly how it was read.
   *
   * Two states, one appearance, again. The dash is the smallest thing that tells
   * them apart, and it says what is true: there is no rank here.
   *
   * NOT a `0`. Zero is a rank somebody spent, and nobody spent this one — that
   * would be the same conflation pointing the other way. The points are indeed
   * zero; the RANK is absent, and this chip shows ranks.
   */
  if (value == null) {
    if (!picked || !ranksMatter) return null;
    return (
      <span
        className="shrink-0 text-center"
        data-testid="pickem-conf-unranked"
        title="No rank — this pick scores nothing until the sheet is ranked again"
        style={{
          minWidth: 22,
          height: 20,
          lineHeight: "20px",
          borderRadius: 6,
          fontSize: 11,
          fontWeight: 700,
          color: "var(--color-bt-text-dim)",
          opacity: 0.45,
        }}
      >
        –
      </span>
    );
  }
  return (
    <span
      className="shrink-0 text-center"
      data-testid={hit ? "pickem-conf-banked" : missed ? "pickem-conf-missed" : "pickem-conf-open"}
      style={{
        minWidth: 22,
        height: 20,
        lineHeight: "20px",
        borderRadius: 6,
        fontSize: 11,
        fontWeight: 700,
        fontVariantNumeric: "tabular-nums",
        /**
         * `opacity` on the whole chip rather than a fainter colour token,
         * because there is no step below `--color-bt-text-dim` in the system
         * and inventing one for a single chip would put a colour outside the
         * surface hierarchy (STYLE_GUIDE §1). Fading the element keeps it on
         * the same token in both themes and degrades identically in each.
         */
        opacity: missed ? 0.45 : 1,
        background: hit
          ? "var(--color-bt-accent-faint)"
          : missed
            ? "transparent"
            : "var(--color-bt-card-raised)",
        color: hit ? "var(--color-bt-accent)" : "var(--color-bt-text-dim)",
      }}
    >
      {value}
    </span>
  );
}
