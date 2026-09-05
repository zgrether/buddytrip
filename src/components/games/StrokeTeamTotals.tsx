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
 * ── THRU is not decoration ──────────────────────────────────────────────────
 *
 * A team's total is only comparable against another team's when both have
 * played the same holes, and mid-round they have not. The individual board
 * solves this by ranking on to-par over SCORED holes, so a player thru 9 and a
 * player thru 18 read fairly; a team TOTAL cannot do that, because it is the
 * banked figure the competition scores and summing to-par would be a second,
 * different number wearing the same name.
 *
 * So the incomparability is SHOWN rather than hidden: every row carries how many
 * holes its team has played, and two teams on different counts are visibly not
 * yet a like-for-like comparison. Displaying a rank with no way to see that is
 * how a board states more than it knows.
 */
export function StrokeTeamTotals({
  rows,
  teams,
  rubric,
  thruByTeam,
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
  /**
   * teamId -> holes played across its counted players. A SEPARATE prop rather
   * than a field on the standing, because `computeStrokeTeamStandings` is the
   * function the finalize banks and it has no business growing a display count.
   * The view sums it off the individual board rows, which already carry it.
   */
  thruByTeam: Record<string, number>;
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
          <div className="flex items-center gap-4">
            <span className="w-10 text-right text-[10px] font-semibold uppercase tracking-wider" style={{ color: "var(--color-bt-text-dim)" }}>Thru</span>
            <span className="w-12 text-right text-[10px] font-semibold uppercase tracking-wider" style={{ color: "var(--color-bt-text-dim)" }}>
              {rubric ? "Pts" : "Strk"}
            </span>
          </div>
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
                  className="w-10 text-right text-[13px] tabular-nums"
                  style={{ color: "var(--color-bt-text-dim)" }}
                  data-testid={`stroke-team-thru-${r.teamId}`}
                >
                  {thruByTeam[r.teamId] ?? 0}
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
