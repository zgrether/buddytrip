"use client";

import { useMemo, useState } from "react";
import { TYPE_SCALE, EYEBROW } from "@/lib/typeScale";
import { PickemMatchCard, h2hNote } from "./PickemMatchCard";
import { PickemHeadToHead } from "./PickemHeadToHead";
import { PickemTeamRollUp } from "./PickemTeamRollUp";
import { PickemUnassignedNote } from "./PickemUnassignedNote";
import { fmtPoints } from "@/lib/rackNStack";
import {
  buildBoardRows,
  matchStanding,
  matchesWonByTeam,
  type BoardRow,
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
  avatarFor,
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
   * Identity for the head-to-head header, where the two people are the whole
   * subject. An accessor like `nameOf`/`teamOf` rather than a table, so the board
   * stays free of how a person is looked up.
   */
  avatarFor: (userId: string) => { avatarIcon: string | null; teamColor: string | null };
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

  /**
   * Two teams, or none. A tally between three sides is not a thing this shape
   * has — `individual_matches` is match play — so rather than render something
   * meaningless the tally is simply absent, which is also what happens on a
   * game with no points on it.
   */
  const tally =
    rollUp === "individual_matches" && teams.length === 2
      ? matchesWonByTeam(
          matches.flatMap((m) => {
            const rows = matchRows.get(m.id);
            if (!rows || !m.sideAId || !m.sideBId) return [];
            const st = matchStanding(rows);
            return [
              {
                aTeamId: teamOf(m.sideAId),
                bTeamId: teamOf(m.sideBId),
                margin: st.margin,
                remaining: st.remaining,
                clinched: st.clinched,
              },
            ];
          })
        )
      : null;

  if (rollUp === "individual_matches" && openMatch) {
    const idx = matches.findIndex((x) => x.id === openMatch);
    const m = idx >= 0 ? matches[idx] : undefined;
    const rows = matchRows.get(openMatch);
    if (m && rows && m.sideAId && m.sideBId) {
      const aName = nameOf(m.sideAId);
      const bName = nameOf(m.sideBId);
      const pickedSides = {
        a: (sheets[m.sideAId] ?? []).length > 0,
        b: (sheets[m.sideBId] ?? []).length > 0,
      };
      const st = matchStanding(rows);
      return (
        <PickemHeadToHead
          slate={slate}
          rows={rows}
          aName={aName}
          bName={bName}
          aUserId={m.sideAId}
          bUserId={m.sideBId}
          avatarFor={avatarFor}
          /* 1-based, and over the WHOLE match list rather than the paired
             subset — "Match 3 of 8" has to agree with the list the reader just
             came back from. */
          matchIndex={idx + 1}
          matchCount={matches.length}
          resolved={resolved}
          picked={pickedSides}
          /* Shared with the card for every state but the mid-match one, so the
             two screens cannot disagree about a clinch or a final. */
          note={h2hNote(st, resolved, st.margin > 0 ? aName : bName, pickedSides, {
            a: aName,
            b: bName,
          })}
          onBack={() => setOpenMatch(null)}
        />
      );
    }
  }

  return (
    <div className="flex flex-col gap-2" data-testid="pickem-board">
      {/* MATCHES only. The roll-up brings its own TEAM TOTALS header with the
          count of what is left to play, so a shared eyebrow here put two of
          them on one screen — "STANDINGS" directly above "TEAM TOTALS", which
          reads as two sections with nothing in the first.

          The count that used to sit beside this moved to the results button
          above; it is a fact about the RESULTS and was being said twice. What
          belongs beside MATCHES is what the matches have paid. */}
      {rollUp === "individual_matches" && (
      <div className="flex items-baseline justify-between px-1" style={EYEBROW}>
        <span>Matches</span>
        {tally && (
          <span
            data-testid="pickem-board-tally"
            className="flex items-baseline gap-1.5"
            style={{ textTransform: "none", letterSpacing: 0 }}
          >
            <span style={{ fontSize: TYPE_SCALE.bodyDense, fontWeight: 600, fontVariantNumeric: "tabular-nums" }}>
              {fmtPoints(tally.get(teams[0].id) ?? 0)} – {fmtPoints(tally.get(teams[1].id) ?? 0)}
            </span>
            <span style={{ fontSize: TYPE_SCALE.caption, fontWeight: 400 }}>matches won</span>
          </span>
        )}
      </div>
      )}

      {/* The same state on the match side: a sheet with no opponent scores
          nowhere either, and the match list would simply not mention them. */}
      {rollUp === "individual_matches" && <PickemUnassignedNote names={unmatched} />}

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
        : (
            <PickemTeamRollUp
              slate={slate}
              sheets={sheets}
              teams={teams}
              teamOf={teamOf}
              nameOf={nameOf}
              meId={meId}
              useConfidence={useConfidence}
              resolved={resolved}
              total={total}
              distribution={distribution}
              pointsMode={pointsMode}
            />
          )}
    </div>
  );
}
