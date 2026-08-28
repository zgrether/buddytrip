"use client";

import { useMemo, useState } from "react";
import { TYPE_SCALE, EYEBROW } from "@/lib/typeScale";
import { PickemMatchCard } from "./PickemMatchCard";
import { placementPointsByTeam } from "@/lib/placementGroups";
import { MatchupLine, pickemRowSurface } from "./slateRowVisual";
import {
  buildBoardRows,
  matchStanding,
  sideStanding,
  leaderId,
  leaderClinched,
  orderByTotal,
  tiedWithPrevious,
  type BoardRow,
  type ZeroKind,
} from "@/lib/pickemBoard";
import { resolvedCount, type ScoredPick, type ScoredSlateGame } from "@/lib/pickemScoring";

/**
 * The board — "am I winning, and is it still live."
 *
 * Everything derives from the picks and the results. Nothing is stored, so a
 * result landing anywhere recomputes every total, margin and clinch on the next
 * render.
 *
 * ── Two shapes, one set of rules ───────────────────────────────────────────
 *
 * `individual_matches` — a match list, tap for game-by-game.
 * `team_totals`        — two side cards with participants beneath.
 *
 * Both clinch on the same rule: a lead bigger than everything the other side
 * can still score.
 */

export interface BoardSlateGame extends ScoredSlateGame {
  awayTeam: string;
  homeTeam: string;
  spread: string | null;
  kickoff: string | null;
}

/**
 * A match, in the shape the router already returns.
 *
 * `sideAId` / `sideBId` rather than `aUserId` — a pick'em side IS a user (a
 * sheet belongs to a person), but the field names come from `game_matches`,
 * which pick'em shares with golf. Renaming them here would mean the board and
 * the divisor described the same row differently, which is how the two drift.
 */
export interface BoardMatch {
  id: string;
  sideAId: string | null;
  sideBId: string | null;
}

/** The three kinds of zero, said as three different things. A dash for all of
 *  them would tell the reader a cancelled game was played. */
const ZERO_LABEL: Record<ZeroKind, string> = {
  both: "Both right",
  neither: "Both wrong",
  push: "Push",
  cancelled: "Cancelled",
};

function ResultChip({ row }: { row: BoardRow }) {
  if (row.result == null) {
    return (
      <span style={{ fontSize: TYPE_SCALE.caption, color: "var(--color-bt-planning)", fontWeight: 600 }}>
        {/* Unplayed rows carry what each side stands to gain. Same pick means
            only the DIFFERENCE is in play, which `upsideFor` already resolved. */}
        +{row.upsideA} / +{row.upsideB}
      </span>
    );
  }
  if (row.swing === 0) {
    return (
      <span
        data-testid={`pickem-zero-${row.zeroKind}`}
        style={{ fontSize: TYPE_SCALE.caption, color: "var(--color-bt-text-dim)", fontWeight: 600 }}
      >
        {ZERO_LABEL[row.zeroKind as ZeroKind]}
      </span>
    );
  }
  return (
    <span
      style={{
        fontSize: TYPE_SCALE.bodyDense,
        fontWeight: 800,
        fontVariantNumeric: "tabular-nums",
        color: row.swing > 0 ? "var(--color-bt-accent)" : "var(--color-bt-owner)",
      }}
    >
      {row.swing > 0 ? "+" : ""}
      {row.swing}
    </span>
  );
}

/** Level 2 — one row per slate game, with the swing that shows where the match
 *  is being won. */
function MatchDetail({
  slate,
  rows,
  aName,
  bName,
  onBack,
}: {
  slate: BoardSlateGame[];
  rows: BoardRow[];
  aName: string;
  bName: string;
  onBack: () => void;
}) {
  const byId = new Map(slate.map((g) => [g.id, g]));
  const s = matchStanding(rows);

  return (
    <div className="flex flex-col gap-2" data-testid="pickem-board-detail">
      <button
        type="button"
        onClick={onBack}
        data-testid="pickem-board-back"
        className="self-start px-1 py-1"
        style={{ fontSize: TYPE_SCALE.bodyDense, fontWeight: 600, color: "var(--color-bt-accent)" }}
      >
        ← All matches
      </button>

      <div
        className="mx-1 flex items-center gap-3 rounded-xl px-3 py-3"
        style={{ background: "var(--color-bt-card)", border: "1px solid var(--color-bt-border)" }}
      >
        <span className="min-w-0 flex-1 text-center">
          <span className="block truncate" style={{ fontSize: TYPE_SCALE.caption, fontWeight: 600 }}>
            {aName}
          </span>
          <span style={{ fontSize: 26, fontWeight: 800, fontVariantNumeric: "tabular-nums" }}>
            {s.aTotal}
          </span>
        </span>
        <span style={{ fontSize: TYPE_SCALE.caption, color: "var(--color-bt-text-dim)" }}>VS</span>
        <span className="min-w-0 flex-1 text-center">
          <span className="block truncate" style={{ fontSize: TYPE_SCALE.caption, fontWeight: 600 }}>
            {bName}
          </span>
          <span style={{ fontSize: 26, fontWeight: 800, fontVariantNumeric: "tabular-nums" }}>
            {s.bTotal}
          </span>
        </span>
      </div>

      <div className="px-1" style={EYEBROW}>
        Game by game
      </div>

      {rows.map((r) => {
        const g = byId.get(r.slateGameId);
        if (!g) return null;
        return (
          <div
            key={r.slateGameId}
            data-testid="pickem-board-row"
            className="mx-1 flex flex-col gap-1.5 rounded-xl px-3 py-2.5"
            style={pickemRowSurface({ weighted: r.multiplier > 1 })}
          >
            <MatchupLine
              game={{
                awayTeam: g.awayTeam,
                homeTeam: g.homeTeam,
                spread: g.spread,
                kickoff: r.result == null ? (g.kickoff ?? "TBD") : null,
                note: null,
                multiplier: r.multiplier,
              }}
            />
            <div className="flex items-center gap-2">
              <span className="min-w-0 flex-1 truncate" style={{ fontSize: TYPE_SCALE.caption }}>
                <Conf value={r.aConfidence} hit={r.aPoints > 0} />{" "}
                {r.aPick === "away" ? g.awayTeam : g.homeTeam}
              </span>
              <ResultChip row={r} />
              <span
                className="min-w-0 flex-1 truncate text-right"
                style={{ fontSize: TYPE_SCALE.caption }}
              >
                {r.bPick === "away" ? g.awayTeam : g.homeTeam}{" "}
                <Conf value={r.bConfidence} hit={r.bPoints > 0} />
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function Conf({ value, hit }: { value: number | null; hit: boolean }) {
  if (value == null) return null;
  return (
    <span
      className="rounded px-1.5"
      style={{
        fontSize: TYPE_SCALE.caption,
        fontWeight: 700,
        fontVariantNumeric: "tabular-nums",
        background: hit ? "var(--color-bt-accent-faint)" : "var(--color-bt-card-raised)",
        color: hit ? "var(--color-bt-accent)" : "var(--color-bt-text-dim)",
      }}
    >
      {value}
    </span>
  );
}

export function PickemBoard({
  slate,
  sheets,
  matches,
  rollUp: rollUpSetting,
  useConfidence,
  meId,
  nameOf,
  teams,
  teamOf,
  pointsMode = false,
  distribution,
}: {
  slate: BoardSlateGame[];
  /** Every sheet the caller may see, keyed by user. RLS-gated upstream. */
  sheets: Record<string, ScoredPick[]>;
  matches: BoardMatch[];
  rollUp: "team_totals" | "individual_matches";
  useConfidence: boolean;
  meId: string | null;
  nameOf: (userId: string) => string;
  teams: { id: string; name: string }[];
  teamOf: (userId: string) => string | null;
  /**
   * The COMPETITION is a points cup (Phase 7): N teams ordered, placement pays.
   *
   * Overrides `rollUp`, which is inert in a points cup — so this is read first
   * everywhere it appears rather than combined with it.
   */
  pointsMode?: boolean;
  /**
   * The authored placement schedule — `points_distribution.values`. No divisor
   * and nothing derived (#1068): 1st takes `values[0]`, 2nd `values[1]`, and a
   * tie averages across the places it spans.
   *
   * Undefined on a game with no schedule, which renders the ordering without
   * payouts rather than inventing one.
   */
  distribution?: number[];
}) {
  /**
   * POINTS OVERRIDES ROLL-UP, in ONE place.
   *
   * `roll_up` is inert in a points cup but still SET — a cup can carry
   * `individual_matches` and mean nothing by it. Four sites below branch on
   * this value to choose a match list over standings, and a points cup that
   * reached any of them would render a match list for a competition that has
   * no matches.
   *
   * Resolved once here rather than by adding `!pointsMode &&` to each site: a
   * fifth site is inevitable, and the version where each caller remembers the
   * override is the version where one of them does not.
   */
  const rollUp = pointsMode ? "team_totals" : rollUpSetting;
  const [openMatch, setOpenMatch] = useState<string | null>(null);
  const { resolved, total } = resolvedCount(slate);

  /** Sheets that are in no match at all — the individual-matches counterpart of
   *  a person with no team. */
  const unmatched = useMemo(() => {
    const paired = new Set<string>();
    for (const m of matches) {
      if (m.sideAId) paired.add(m.sideAId);
      if (m.sideBId) paired.add(m.sideBId);
    }
    return Object.keys(sheets).filter((uid) => !paired.has(uid)).map(nameOf).sort();
  }, [matches, sheets, nameOf]);

  const matchRows = useMemo(() => {
    const out = new Map<string, BoardRow[]>();
    for (const m of matches) {
      if (!m.sideAId || !m.sideBId) continue;
      out.set(
        m.id,
        buildBoardRows(slate, sheets[m.sideAId] ?? [], sheets[m.sideBId] ?? [], useConfidence)
      );
    }
    return out;
  }, [matches, slate, sheets, useConfidence]);

  if (rollUp === "individual_matches" && openMatch) {
    const m = matches.find((x) => x.id === openMatch);
    const rows = matchRows.get(openMatch);
    if (m && rows && m.sideAId && m.sideBId) {
      return (
        <MatchDetail
          slate={slate}
          rows={rows}
          aName={nameOf(m.sideAId)}
          bName={nameOf(m.sideBId)}
          onBack={() => setOpenMatch(null)}
        />
      );
    }
  }

  return (
    <div className="flex flex-col gap-2" data-testid="pickem-board">
      <div className="flex items-baseline justify-between px-1" style={EYEBROW}>
        <span>{rollUp === "individual_matches" ? "Matches" : "Standings"}</span>
        <span
          data-testid="pickem-board-count"
          style={{ textTransform: "none", letterSpacing: 0, fontWeight: 600 }}
        >
          {resolved} of {total} in
        </span>
      </div>

      {/* The same state on the match side: a sheet with no opponent scores
          nowhere either, and the match list would simply not mention them. */}
      {rollUp === "individual_matches" && <UnassignedNote names={unmatched} />}

      {rollUp === "individual_matches"
        ? matches.map((m) => {
            const rows = matchRows.get(m.id);
            if (!rows || !m.sideAId || !m.sideBId) return null;
            return (
              <PickemMatchCard
                key={m.id}
                aName={nameOf(m.sideAId)}
                bName={nameOf(m.sideBId)}
                standing={matchStanding(rows)}
                // Separates "level" from "nothing played" — two states that both
                // show 0-0 and mean opposite things about what is left.
                resolvedCount={resolved}
                // A sheet is all-or-nothing, so presence in `sheets` IS "picked".
                picked={{
                  a: (sheets[m.sideAId] ?? []).length > 0,
                  b: (sheets[m.sideBId] ?? []).length > 0,
                }}
                mine={meId != null && (m.sideAId === meId || m.sideBId === meId)}
                youSide={
                  meId == null ? null : m.sideAId === meId ? "a" : m.sideBId === meId ? "b" : null
                }
                selected={openMatch === m.id}
                onOpen={() => setOpenMatch(m.id)}
              />
            );
          })
        : (() => {
            const bySide = teams.map((t) => ({
              team: t,
              sheets: Object.entries(sheets)
                .filter(([uid]) => teamOf(uid) === t.id)
                .map(([uid, picks]) => ({ uid, picks })),
            }));
            const standings = bySide.map((s) => ({
              ...s,
              standing: sideStanding(slate, s.sheets.map((x) => x.picks), useConfidence),
            }));
            const remaining = total - resolved;

            /**
             * ORDERED in points mode, roster order otherwise.
             *
             * Points PAYS by position, so the order is the result rather than a
             * presentation choice. Roster order is invisible at two teams —
             * two cards side by side read as a comparison — and wrong the
             * moment a third makes the row a ranking.
             */
            const ranked = pointsMode ? orderByTotal(standings) : standings;

            /**
             * The clinch, over N.
             *
             * This replaced `const [x, y] = standings` — a destructure that is
             * correct at two teams and silently drops every team after the
             * second. `leaderClinched` asks whether the leader is beyond ALL of
             * them, because clinching against the runner-up says nothing about
             * a third team whose upside may be larger from further back.
             */
            const asTeamStandings = ranked.map((r) => ({
              id: r.team.id,
              standing: r.standing,
            }));
            const clinched = leaderClinched(asTeamStandings, remaining);
            const leadId = leaderId(asTeamStandings);

            /**
             * What each place pays. Shared with every other points-mode surface
             * via `placementPointsByTeam` — the authored `values[]` schedule, no
             * divisor and nothing derived (#1068). The tie handling lives in
             * that function, which is why the sort above deliberately does not
             * pre-empt it.
             */
            const payout =
              // `length` checked, not just presence: `effectiveDistribution` returns
              // an EMPTY array for a game with no authored split and no points
              // total, and an empty array is truthy — so the bare check paid
              // everyone "0 pts", which reads as a decided prize of nothing
              // rather than as an unconfigured game.
              pointsMode && distribution && distribution.length > 0
                ? placementPointsByTeam(
                    asTeamStandings.map((t) => t.id),
                    tiedWithPrevious(asTeamStandings),
                    distribution
                  )
                : null;

            const unplaced = Object.keys(sheets)
              .filter((uid) => teamOf(uid) == null)
              .map(nameOf)
              .sort();

            return (
              <>
                {/* `flex-wrap` for N: two cards fill a row, four wrap to two
                    rows rather than squeezing to unreadable columns on a
                    phone. `basis` keeps a wrapped row balanced. */}
                <div className="mx-1 flex flex-wrap gap-2">
                  {ranked.map((s) => (
                    <div
                      key={s.team.id}
                      data-testid="pickem-board-side"
                      className="flex-1 rounded-xl px-3 py-3 text-center"
                      style={{
                        background: "var(--color-bt-card)",
                        border:
                          s.team.id === leadId
                            ? "1px solid var(--color-bt-accent-border)"
                            : "1px solid var(--color-bt-border)",
                      }}
                    >
                      <span className="block truncate" style={EYEBROW}>
                        {s.team.name}
                      </span>
                      <span
                        className="mt-0.5 block"
                        style={{ fontSize: 28, fontWeight: 800, fontVariantNumeric: "tabular-nums" }}
                      >
                        {s.standing.total}
                      </span>
                      {payout && (
                        /* What finishing here is WORTH, on the card rather than
                           behind a tap. The Cadence question for this phase is
                           whether you can tell what second place pays without
                           opening anything, and a payout you have to go and
                           find is the same as one that is not shown. */
                        <span
                          data-testid="pickem-board-payout"
                          className="mt-1 block"
                          style={{
                            fontSize: TYPE_SCALE.caption,
                            color: "var(--color-bt-text-dim)",
                          }}
                        >
                          {formatPayout(payout.get(s.team.id) ?? 0)}
                        </span>
                      )}
                    </div>
                  ))}
                </div>
                {clinched && (
                  <p
                    data-testid="pickem-board-side-clinch"
                    className="px-1"
                    style={{ fontSize: TYPE_SCALE.caption, fontWeight: 600, color: "var(--color-bt-accent)" }}
                  >
                    {standings.find((s) => s.team.id === leadId)?.team.name} has clinched —{" "}
                    {remaining} still to play.
                  </p>
                )}
                <UnassignedNote names={unplaced} teamCount={teams.length} />
                {ranked.map((s) => (
                  <div key={s.team.id} className="flex flex-col gap-1.5">
                    <div className="mt-1 flex items-baseline justify-between px-1" style={EYEBROW}>
                      <span>{s.team.name}</span>
                      <span style={{ textTransform: "none", letterSpacing: 0 }}>
                        {s.standing.total} pts
                      </span>
                    </div>
                    {s.sheets.map(({ uid, picks }) => (
                      <div
                        key={uid}
                        data-testid="pickem-board-participant"
                        className="mx-1 flex items-center gap-3 rounded-xl px-3 py-2"
                        style={{ background: "var(--color-bt-card)", border: "1px solid var(--color-bt-border)" }}
                      >
                        <span className="min-w-0 flex-1 truncate" style={{ fontSize: TYPE_SCALE.bodyDense, fontWeight: 600 }}>
                          {nameOf(uid)}
                          {uid === meId && <YouTag />}
                        </span>
                        <span style={{ fontSize: TYPE_SCALE.body, fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>
                          {sideStanding(slate, [picks], useConfidence).total}
                        </span>
                      </div>
                    ))}
                  </div>
                ))}
              </>
            );
          })()}
    </div>
  );
}

/**
 * A payout as it reads on a card: "2 pts", "1.5 pts", "0 pts".
 *
 * Trailing zeros trimmed, because the historical BBMI schedule is 2 / 1.5 / 0.5
 * / 0 and rendering "2.0" beside "1.5" makes the whole column look like a
 * measurement rather than a prize.
 */
function formatPayout(v: number): string {
  const n = Math.round(v * 100) / 100;
  return `${n} pt${n === 1 ? "" : "s"}`;
}

/** "Bill", "Bill and Ty", "Bill, Ty and Frank" — an Oxford-less join, because
 *  this reads as a sentence rather than a list. */
function names(list: string[]): string {
  if (list.length === 1) return list[0];
  if (list.length === 2) return `${list[0]} and ${list[1]}`;
  return `${list.slice(0, -1).join(", ")} and ${list[list.length - 1]}`;
}

/**
 * People who filled in a sheet that counts for nothing.
 *
 * ── Not a cosmetic gap ─────────────────────────────────────────────────────
 *
 * Someone with a sheet and no side — or no opponent — did the work and it
 * scores nowhere. That is a real state and two people need it visible: the
 * PERSON, who otherwise opens a board they are simply absent from, and the
 * RUNNER, for whom it is usually a setup error they would want to fix.
 *
 * Rendering nothing is the empty-versus-unknown pattern: fifteen rows where
 * there are seventeen people reads as "there are fifteen people", and the
 * reader has no way to tell a short field from a dropped one.
 */
function UnassignedNote({
  names: list,
  teamCount = 2,
}: {
  names: string[];
  /**
   * "Either side" is TWO-TEAM language, and this is the tenth instance in this
   * feature of copy naming a mechanic that is not in play. With four teams the
   * sentence has to be about the scoring, not about a pair.
   *
   * Defaulted to 2 so the match-play call sites read exactly as they did.
   */
  teamCount?: number;
}) {
  if (list.length === 0) return null;
  return (
    <p
      data-testid="pickem-board-unassigned"
      className="mx-1 rounded-xl px-3 py-2.5"
      style={{
        fontSize: TYPE_SCALE.caption,
        lineHeight: 1.5,
        color: "var(--color-bt-text-dim)",
        background: "var(--color-bt-card)",
        border: "1px solid var(--color-bt-border)",
      }}
    >
      <b style={{ color: "var(--color-bt-text)" }}>{names(list)}</b>{" "}
      {list.length === 1 ? "isn't" : "aren't"} in the scoring —{" "}
      {list.length === 1 ? "their sheet doesn't" : "their sheets don't"} count toward{" "}
      {teamCount > 2 ? "any team" : "either side"}.
    </p>
  );
}

function YouTag() {
  return (
    <span
      className="ml-1.5 rounded px-1.5"
      style={{
        fontSize: 9,
        fontWeight: 700,
        letterSpacing: "0.08em",
        color: "var(--color-bt-accent)",
        background: "var(--color-bt-accent-faint)",
        border: "1px solid var(--color-bt-accent-border)",
      }}
    >
      YOU
    </span>
  );
}
