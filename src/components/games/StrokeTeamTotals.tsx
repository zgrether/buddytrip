"use client";

import type { StrokeTeamStanding } from "@/lib/strokePlay";
import type { StablefordRubric } from "@/lib/stableford";
import { ordinalShort } from "@/components/competition/CompetitionGamesPanel";

/**
 * TEAM TOTALS — the section that sits ABOVE the individual board, never instead
 * of it.
 *
 * ── Why both, and in this order ─────────────────────────────────────────────
 *
 * Teams on top with the full individual board below, rather than teams with
 * players nested. Both boards already exist, so this is the smallest build, and
 * mid-round a reader wants both facts. Nesting 3 team rows and 16 player rows is
 * more structure than the information justifies, and if the page runs long on a
 * phone, collapsing this section later is a smaller change than unpicking a
 * nesting.
 *
 * ── NO THRU COLUMN, and the reason is that it was not a quantity ────────────
 *
 * This section briefly carried one, to show that two teams mid-round are not a
 * like-for-like comparison. It was removed, and the argument for removing it is
 * better than the argument that put it there: **a single player's THRU is a
 * real number, and a team's is not.** One player thru 9 has played nine holes.
 * A team "thru 27" is three players' unrelated progress added together — a sum
 * over different people, which is not a hole count, not a position in a round,
 * and not anything a reader can act on. Naming it THRU borrows the individual
 * column's meaning for a figure that does not have it.
 *
 * The individual board keeps its THRU for exactly that reason: there it says
 * what it appears to say.
 *
 * ── The ranking stays, and it is a RUNNING STATUS ───────────────────────────
 *
 * Dropping the column does not restore the comparability problem, because the
 * ranking was never claiming the totals are comparable right now. It is a
 * running status that CONVERGES as the round completes — wrong-ish early, exact
 * at the end, in the ordinary way a live leaderboard is. That is a familiar
 * contract a reader already holds, and it needed a caveat column less than it
 * needed to not be dressed up as more.
 *
 * ── Where this gets displayed properly ──────────────────────────────────────
 *
 * A live PROJECTION — points for the day as they currently stand — which is
 * what match play already has via `liveProjection.ts` folded into the
 * competition board's pill. Stroke has no such arm yet (#1120), and when it
 * gains one, that is the surface that answers "where does this actually stand"
 * honestly, because a projection says it is a projection.
 *
 * **Deliberately NOT points-per-hole here.** A rate normalises the mid-round
 * gap and would make the totals look comparable, but it is a projection wearing
 * a fact's clothes — presented as a plain column with no statement of what it
 * assumes. The projection work does it correctly or it does not get done.
 */
export function StrokeTeamTotals({
  rows,
  teams,
  rubric,
}: {
  /** From `computeStrokeTeamStandings` — the same function the finalize banks. */
  rows: StrokeTeamStanding[];
  /** id → display, for the teams in the competition. */
  teams: { id: string; name: string; color: string }[];
  /**
   * Stableford's rubric, or `null` — the SAME value the individual board takes,
   * never a second derivation. It decides the column heading only: under
   * Stableford a total is POINTS and more is better, under Traditional it is
   * STROKES and fewer is. The ordering already arrived correct in `rows`.
   */
  rubric: StablefordRubric | null;
}) {
  const byId = new Map(teams.map((t) => [t.id, t]));

  return (
    <div style={{ padding: "12px 12px 4px" }} data-testid="stroke-team-totals">
      <div className="mb-2 flex items-center justify-between">
        <span
          className="text-[11px] font-semibold uppercase tracking-wider"
          style={{ color: "var(--color-bt-text-dim)" }}
        >
          Team totals
        </span>
        {rows.length > 0 && (
          <span className="w-12 text-right text-[10px] font-semibold uppercase tracking-wider" style={{ color: "var(--color-bt-text-dim)" }}>
            {rubric ? "Pts" : "Strk"}
          </span>
        )}
      </div>

      {rows.length === 0 ? (
        <div
          className="rounded-xl border px-4 py-6 text-center"
          style={{ background: "var(--color-bt-card)", borderColor: "var(--color-bt-border)" }}
          data-testid="stroke-team-totals-empty"
        >
          <p className="text-sm font-medium" style={{ color: "var(--color-bt-text)" }}>No team has started</p>
          {/* A team with nobody playing yet gets NO row rather than a row
              totalling zero — under lowest-wins a zero is a WIN, and "has not
              teed off" must never render as "leading". */}
          <p className="mt-1 text-[12px]" style={{ color: "var(--color-bt-text-dim)" }}>
            Totals appear as each team&rsquo;s players post scores.
          </p>
        </div>
      ) : (
        <div className="flex flex-col">
          {rows.map((r, i) => {
            const t = byId.get(r.teamId);
            const isFirst = i === 0;
            return (
              <div
                key={r.teamId}
                className="flex items-center gap-3"
                style={{
                  paddingTop: isFirst ? 0 : 8,
                  paddingBottom: 8,
                  borderTop: isFirst ? undefined : "1px solid var(--color-bt-subtle-border)",
                }}
                data-testid={`stroke-team-row-${r.teamId}`}
              >
                <span className="w-6 flex-shrink-0 text-center text-sm font-bold tabular-nums" style={{ color: "var(--color-bt-text-dim)" }}>
                  {ordinalShort(r.position)}
                </span>
                <span
                  style={{ width: 10, height: 10, borderRadius: "50%", background: t?.color ?? "var(--color-bt-text-dim)", flexShrink: 0 }}
                />
                <span className="min-w-0 flex-1 truncate text-sm font-semibold" style={{ color: "var(--color-bt-text)" }}>
                  {t?.name ?? "Team"}
                </span>
                <span
                  className="w-12 text-right text-sm font-bold tabular-nums"
                  style={{ color: "var(--color-bt-text)" }}
                  data-testid={`stroke-team-total-${r.teamId}`}
                >
                  {r.total}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
