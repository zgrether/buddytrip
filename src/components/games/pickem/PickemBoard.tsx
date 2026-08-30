"use client";

import { useMemo, useState } from "react";
import { useModalBackButton } from "@/hooks/useModalBackButton";
import { PickemMatchCard, h2hNote } from "./PickemMatchCard";
import { PickemHeadToHead } from "./PickemHeadToHead";
import { PickemTeamRollUp } from "./PickemTeamRollUp";
import { PickemUnassignedNote } from "./PickemUnassignedNote";
import { buildBoardRows, matchStanding, type BoardRow } from "@/lib/pickemBoard";
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
  /**
   * The head-to-head REPLACES this board — its own header, its own back chevron
   * — so back has to close it rather than tear the game panel down underneath
   * it. Third surface in this feature with a back control that the OS back
   * button did not reach; they are registered together rather than one at a
   * time, because the shape is what recurs and not the screen.
   */
  useModalBackButton(() => setOpenMatch(null), openMatch != null);
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
          useConfidence={useConfidence}
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
      {/* NEITHER a header NOR a tally over the list.
          The header went first — a list of match cards says it is a list of
          match cards, the third instance of copy labelling content that
          announces itself. The tally went after: "0 – 3 matches won", floated
          right above eight cards with no eyebrow left to attach it to, read as
          a score for a contest that is not on this screen. The cards each carry
          their own score, so a second pair of numbers over them is a second
          subject with no label — and the one thing it added, who is winning the
          CUP, belongs where the cup is. */}

      {rollUp === "individual_matches" ? (
        <>
          {matches.map((m) => {
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
                aAvatar={avatarFor(m.sideAId)}
                bAvatar={avatarFor(m.sideBId)}
                mine={meId != null && (m.sideAId === meId || m.sideBId === meId)}
                youSide={
                  meId == null ? null : m.sideAId === meId ? "a" : m.sideBId === meId ? "b" : null
                }
                selected={openMatch === m.id}
                onOpen={() => setOpenMatch(m.id)}
              />
            );
          })}

          {/* AFTER the matches, not before them.
              It sat at the top, where a grey paragraph about people who are not
              in the scoring was the first thing on a screen whose subject is
              the eight matches that are. Nothing about it is urgent — nobody
              can act on it from here, and once picks are locked nobody can act
              on it at all — so it belongs where a footnote belongs. */}
          <PickemUnassignedNote names={unmatched} />
        </>
      ) : (
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
