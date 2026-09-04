"use client";

import { buildDecidedFromOutcomes, matchState, type DecidedHole, type HoleOutcomeRow } from "@/lib/matchPlay";
import { holeWeight, isGloriousHole, NO_GLORIOUS, type GloriousConfig } from "@/lib/gloriousHoles";
import { ScorecardChrome, RightGutter, SUB_W, TOTAL_W } from "./StandardGrid";
import type { SidePlayer } from "./MatchSides";
import { fitName } from "@/lib/nameLadder";

import type { TeeRow } from "@/lib/teeRows";
import type { Participant, ScoreUnit } from "./types";

/**
 * OutcomeScorecard — the hole-outcome-entry scorecard (Refactor B2, built to
 * `outcome_scorecard_mockup.html`; header parity added as a follow-up — "look
 * just like the normal scorecard, only the player rows differ"). Renders the
 * SAME `ScorecardChrome` `StandardGrid` uses (tee selector, yardage/par/
 * stroke-index rows, sticky name column, Out/In/Total columns, Glorious
 * bracket, right-edge fade) around two team-colored LEAD rows instead of
 * gross-score rows — there are no scores in outcome mode. The running lead
 * lives in the LEADER's row (`N▲`, team-colored); a tied hole shows neutral
 * `AS`; a Glorious hole's double-jump is directly visible in the number;
 * closeout dims the unplayed remainder. Same W/L/H color vocabulary
 * `MatchCard`'s history strip uses (win/lose/halve), reused here for the
 * per-hole win-green treatment.
 */

/** This scorecard's step-1 size. Denser grid than the match card, so it starts
 *  lower; the ladder steps down from here exactly as it does elsewhere. */
const SCORECARD_NAME_SIZE = 15;

const WIN_GREEN = "#22c55e"; // = --color-bt-place-1 base; matches MatchCard's neutral "winning" color

interface LeadCell {
  hole: number;
  /** Signed running lead as of this hole (+A, −B), or null when not yet played. */
  lead: number | null;
  /** Past the freeze boundary of a decided match — never played. */
  dead: boolean;
  glorious: boolean;
}

/** Pure — the per-hole running lead track + the final match state. Exported for
 *  unit testing apart from render. */
export function computeLeadTrack(
  decided: DecidedHole[],
  holeCount: number,
  glorious: GloriousConfig
): { track: LeadCell[]; st: ReturnType<typeof matchState> } {
  const st = matchState(decided, holeCount, glorious);
  const byHole = new Map(decided.map((d) => [d.hole, d.result]));
  let diff = 0;
  const track: LeadCell[] = [];
  for (let h = 1; h <= holeCount; h++) {
    const glor = isGloriousHole(h, glorious);
    if (st.closed && h > st.thru) {
      track.push({ hole: h, lead: null, dead: true, glorious: glor });
      continue;
    }
    const result = byHole.get(h);
    if (result == null) {
      track.push({ hole: h, lead: null, dead: false, glorious: glor }); // not yet played
      continue;
    }
    const w = holeWeight(h, glorious);
    if (result === "W") diff += w;
    else if (result === "L") diff -= w;
    // "H" (halved) carries the lead forward unchanged — still shown, not blank.
    track.push({ hole: h, lead: diff, dead: false, glorious: glor });
  }
  return { track, st };
}

/**
 * Signed swing (±weighted W/L; halves are 0) over holes [from,to] (1-indexed,
 * inclusive). Exported for unit testing.
 *
 * ── NO LONGER RENDERED, and the reasoning here has been REVERSED ────────────
 *
 * This used to end: "the match-play equivalent of a gross-score section sum, so
 * the Out/In/Total columns carry real meaning for a lead row the same way they
 * do for a stroke row (Out = how the front 9 went, In = how the back 9 went,
 * Total = the two combined = the final lead)."
 *
 * The arithmetic was never wrong. The PREMISE was: match play is not nine plus
 * nine, it is one continuous eighteen-hole state, and the turn has no standing
 * in the format. Being 2 up after nine is not a milestone, a subtotal, or
 * anything a player would say — so a front-nine figure is valid arithmetic
 * about a quantity the format does not recognise. That is the worst kind of
 * number to put on a card: it looks authoritative and answers a question
 * nobody asked.
 *
 * TOTAL went with them rather than surviving alone. It is a real number — it
 * equals the final lead — but the match header already shows exactly that, so
 * once Out and In are blank a lone Total is redundant with the header AND reads
 * as a leftover in the space where three numbers used to be. The header owns
 * the lead; the grid owns the hole-by-hole.
 *
 * KEPT, not deleted: this stays exported and tested because the computation is
 * correct and the decision that retired it is a DISPLAY decision. If a future
 * surface has a genuine use for a section swing — a stats view, a recap — it
 * should reuse this rather than re-derive it, and the tests below still pin
 * that it is right.
 */
export function sectionSwing(decided: DecidedHole[], glorious: GloriousConfig, from: number, to: number): number {
  const byHole = new Map(decided.map((d) => [d.hole, d.result]));
  let diff = 0;
  for (let h = from; h <= to; h++) {
    const result = byHole.get(h);
    if (result == null) continue;
    const w = holeWeight(h, glorious);
    diff += result === "W" ? w : result === "L" ? -w : 0;
  }
  return diff;
}

export interface OutcomeScorecardProps {
  units: ScoreUnit[];
  a: Participant;
  b: Participant;
  /** Per-side players — a 2v2 renders two stacked NAMES (no avatars) in the name
   *  column instead of the compound "R & B" single name. */
  aPlayers?: SidePlayer[];
  bPlayers?: SidePlayer[];
  outcomes: HoleOutcomeRow[];
  glorious?: GloriousConfig;
  leftColor?: string;
  rightColor?: string;
  /** Same tee/yardage header StandardGrid gets — outcome mode has no scores,
   *  but the course structure (tees, par, stroke index) is identical. */
  tee?: { name: string; courseRating?: number | null; slopeRating?: number | null; bogeyRating?: number | null } | null;
  teeRows?: TeeRow[];
  /** Game id — keys the persisted tee filter (see ScorecardChrome). */
  gameId?: string | null;
}

export function OutcomeScorecard({
  units,
  a,
  b,
  aPlayers,
  bPlayers,
  outcomes,
  glorious = NO_GLORIOUS,
  leftColor,
  rightColor,
  tee,
  teeRows = [],
  gameId,
}: OutcomeScorecardProps) {
  const decided = buildDecidedFromOutcomes(outcomes);
  const { track, st } = computeLeadTrack(decided, units.length, glorious);
  const lc = leftColor || WIN_GREEN;
  const rc = rightColor || WIN_GREEN;
  const winner = st.leader === "A" ? a : st.leader === "B" ? b : null;
  const loser = st.leader === "A" ? b : st.leader === "B" ? a : null;

  return (
    <div data-testid="outcome-scorecard">
      <ScorecardChrome units={units} tee={tee} teeRows={teeRows} glorious={glorious} gameId={gameId}>
        {/* `front` is no longer destructured: it existed only to bound the
            front-nine `sectionSwing`, and those columns are blank now. */}
        {({ hasSections, cellBase, nameCell, divider, isGloriousCol, gloriousWash }) => {
          const rowProps = { units, track, nameCell, cellBase, divider, isGloriousCol, gloriousWash, hasSections };
          return (
            <>
              <LeadRow {...rowProps} name={a.name} players={aPlayers} side="A" color={lc} />
              <LeadRow {...rowProps} name={b.name} players={bPlayers} side="B" color={rc} />
            </>
          );
        }}
      </ScorecardChrome>

      {st.over && (
        <p className="text-center" style={{ padding: "12px 10px 2px", fontSize: 13, fontWeight: 800, color: "var(--color-bt-place-1-text)" }} data-testid="outcome-closeout">
          {winner && loser ? `${winner.name} def. ${loser.name} — ${st.margin}` : `Match halved — ${st.margin}`}
        </p>
      )}
    </div>
  );
}

function LeadRow({
  name,
  players,
  units,
  track,
  side,
  color,
  nameCell,
  cellBase,
  divider,
  isGloriousCol,
  gloriousWash,
  hasSections,
}: {
  name: string;
  players?: SidePlayer[];
  units: ScoreUnit[];
  track: LeadCell[];
  side: "A" | "B";
  color: string;
  nameCell: React.CSSProperties;
  cellBase: React.CSSProperties;
  divider: (l?: string) => React.CSSProperties;
  isGloriousCol: (i: number) => boolean;
  gloriousWash: React.CSSProperties;
  hasSections: boolean;
}) {
  const stacked = players && players.length > 1;
  return (
    // minHeight (not fixed 44) so a 2v2's two-line names grow the row and every
    // cell stretches to match; a 1v1 keeps the 44px single-name row.
    <div className="flex" style={{ minHeight: 44, borderBottom: "1px solid var(--color-bt-subtle-border)" }}>
      <div className={`flex ${stacked ? "flex-col justify-center" : "items-center"}`} style={{ ...nameCell, padding: stacked ? "6px 10px" : "0 10px" }}>
        {stacked ? (
          // 2v2 → two stacked NAMES, no avatar disks — avatars don't fit the dense
          // grid; the row grows to fit two full-size names (same as MatchCard).
          // The same ladder, per name, at this surface's base size (15). The
          // column is narrower here than on the match card and now shrinks with
          // the viewport, so the step-down matters more, not less.
          players!.map((p) => {
            const fit = fitName(p.name, SCORECARD_NAME_SIZE);
            return (
              <span
                key={p.id}
                className="max-w-full truncate"
                data-name-step={fit.step}
                style={{ fontSize: fit.fontSize, fontWeight: 700, color: "var(--color-bt-text)", lineHeight: 1.35 }}
              >
                {fit.text}
              </span>
            );
          })
        ) : (
          (() => {
            const fit = fitName(name, SCORECARD_NAME_SIZE);
            return (
              <span
                data-name-step={fit.step}
                style={{ fontSize: fit.fontSize, fontWeight: 700, color: "var(--color-bt-text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
              >
                {fit.text}
              </span>
            );
          })()
        )}
      </div>
      {track.map((c, i) => (
        <div
          key={c.hole}
          className="flex items-center justify-center"
          style={{
            ...cellBase,
            minHeight: 44,
            ...divider(units[i]?.label),
            ...(isGloriousCol(i) && !c.dead ? gloriousWash : {}),
            ...(c.glorious && !c.dead
              ? { outline: "1px dashed var(--color-bt-glorious-border)", outlineOffset: -3, borderRadius: 8 }
              : {}),
          }}
        >
          {c.dead ? (
            <span style={{ color: "var(--color-bt-text-dim)", opacity: 0.4 }}>·</span>
          ) : c.lead == null ? null : side === "A" && c.lead > 0 ? (
            <LeadPill value={c.lead} color={color} />
          ) : side === "B" && c.lead < 0 ? (
            <LeadPill value={-c.lead} color={color} />
          ) : side === "B" && c.lead === 0 ? (
            <span style={{ fontSize: 11, fontWeight: 700, color: "var(--color-bt-text-dim)" }} data-testid="outcome-as">
              AS
            </span>
          ) : null}
        </div>
      ))}
      {/* Out / In / Total are NOT APPLICABLE in outcome mode — the columns keep
          the grid's structure, the numbers go. See `sectionSwing` for why the
          arithmetic was right and the quantity meaningless. */}
      {hasSections && <LeadSubCell side={side} />}
      {hasSections && <LeadSubCell side={side} />}
      <LeadSubCell side={side} wide />
      <RightGutter />
    </div>
  );
}

/**
 * The Out/In/Total column for a lead row — the same tinted footprint `SubCell`
 * uses for a stroke row's subtotals, kept so the grid's structure survives, and
 * now holding NO VALUE.
 *
 * ── The mark is not "nothing", and that is the point ────────────────────────
 *
 * This card already spends emptiness on a different meaning. Three states have
 * to stay apart in one row of cells:
 *
 *   (empty)   a hole not yet played          — `c.lead == null` renders null
 *   `·`       past the close-out, never played — the `dead` branch
 *   `–`       NOT APPLICABLE — this column, always
 *
 * So blanking these to `null` would have made "the format has no such number"
 * look identical to "this hole has not happened yet" — the empty-is-not-unknown
 * failure this repo has catalogued ten times, arriving through a layout
 * decision rather than a value. An en-dash at low emphasis says a cell that is
 * deliberately not filled, which is neither of the other two.
 *
 * Rendered on ONE row would be ambiguous; rendered on BOTH sides' rows, for
 * every section, in every state of the match, it reads as a property of the
 * column rather than of the data.
 */
function LeadSubCell({ side, wide }: { side: "A" | "B"; wide?: boolean }) {
  return (
    <div
      className="flex items-center justify-center"
      style={{
        width: wide ? TOTAL_W : SUB_W,
        minWidth: wide ? TOTAL_W : SUB_W,
        minHeight: 44,
        flexShrink: 0,
        background: wide ? "rgba(45,212,191,0.07)" : "rgba(255,255,255,0.025)",
      }}
      data-testid={`lead-subcell-${side}${wide ? "-total" : ""}`}
    >
      <span
        aria-hidden
        style={{ fontSize: 11, fontWeight: 600, color: "var(--color-bt-text-dim)", opacity: 0.45 }}
      >
        –
      </span>
    </div>
  );
}

/** Team-tinted lead pill — same visual grammar as the board's ProjectionPill
 *  (16%-alpha team fill, value in plain team color). */
function LeadPill({ value, color }: { value: number; color: string }) {
  return (
    <span
      className="inline-flex items-center justify-center"
      data-testid="outcome-lead-pill"
      style={{
        minWidth: 30,
        height: 26,
        padding: "0 7px",
        borderRadius: 7,
        fontSize: 13,
        fontWeight: 800,
        background: `color-mix(in srgb, ${color} 16%, transparent)`,
        color,
      }}
    >
      {value}
      <span style={{ fontSize: 8, marginLeft: 2 }}>▲</span>
    </span>
  );
}
