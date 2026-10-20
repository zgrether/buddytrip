"use client";

import { standingsRows, type StandingsUnit } from "@/lib/standingsRows";
import { teamInk } from "@/lib/teamTextColor";
import { TeamBadge } from "@/components/TeamBadge";
import { fmtPts } from "./GameRow";

/**
 * A POINTS TOURNAMENT'S STANDINGS (PR 9c-2) — its teams, or in a tournament of
 * individuals its people, as rows with bars. One component for both, over one
 * model (`standingsRows`), so the two boards cannot drift into two answers.
 *
 *  - The bar is BANKED solid and PROJECTED hatched, in the unit's own colour
 *    (the Presidents Cup legend). Both share one scale, so a team's hatched
 *    segment can reach past the leader's solid one — and order and rank stay on
 *    banked, because a projection is "if today holds", not a result.
 *  - NO POINTS YET for a unit with no finished game, never a 0 (ruling 30). A
 *    unit that has played and banked nothing shows its real 0, ranked.
 *  - The viewer's own row (their team, or themselves) takes the accent fill,
 *    the same "your own one is the filled card" the pick'em board uses.
 *  - A unit with no finished game but a live projection shows its hatched bar
 *    and a dash for rank: not ranked yet, something coming. No extra words
 *    (Zach's 9c-2 look).
 *  - No game-by-game expansion: the completed tiles are that view (9c-2 look).
 */

/** The hatch — the unit's colour, striped over a faded copy of itself. The first
 *  stripe pattern in the app; it means "if today holds" wherever it appears. */
export function hatch(color: string): string {
  return `repeating-linear-gradient(135deg, ${color} 0 2px, color-mix(in srgb, ${color} 30%, transparent) 2px 5px)`;
}

const PERSON_COLOR = "var(--color-bt-accent)";

export function StandingsRows({
  units,
  unitTotals,
  projections,
  viewerUnitId,
  kind,
}: {
  units: StandingsUnit[];
  unitTotals: Record<string, number>;
  projections: Record<string, Record<string, number>>;
  viewerUnitId: string | null | undefined;
  kind: "teams" | "players";
}) {
  const rows = standingsRows({ units, unitTotals, projections, viewerUnitId });
  const anyProjected = rows.some((r) => r.projected > 0);
  const noun = kind === "teams" ? (units.length === 1 ? "team" : "teams") : units.length === 1 ? "player" : "players";

  return (
    <div
      className="overflow-hidden rounded-xl"
      style={{ background: "var(--color-bt-card)", border: "1px solid var(--color-bt-border)" }}
      data-testid="standings"
    >
      <div className="flex items-center justify-between gap-3 px-4 pt-3 pb-1">
        <p className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: "var(--color-bt-text-dim)" }}>
          {units.length === 0 ? "Standings" : `${units.length} ${noun}`}
        </p>
        {anyProjected && (
          <span className="flex items-center gap-1.5 text-[11px]" style={{ color: "var(--color-bt-text-dim)" }} data-testid="standings-legend">
            <span className="inline-block h-2 w-3 rounded-sm" style={{ background: hatch("var(--color-bt-text-dim)") }} />
            If today holds
          </span>
        )}
      </div>
      <div className="space-y-1 px-2 pb-3 pt-1">
        {units.length === 0 && (
          <p className="px-2 text-[12.5px]" style={{ color: "var(--color-bt-text-dim)" }}>
            Add a game to start the standings.
          </p>
        )}
        {rows.map((r, idx) => {
          const color = r.color ?? PERSON_COLOR;
          const isLeader = idx === 0 && r.hasResult && r.banked > 0;
          return (
            <div
              key={r.id}
              className="rounded-lg"
              style={{ background: r.isViewer ? "var(--color-bt-accent-faint)" : undefined }}
              data-testid={`standings-row-${r.id}`}
              data-viewer={r.isViewer ? "true" : undefined}
            >
              <div className="flex w-full items-center gap-3 px-2 py-1.5">
                <span className="w-4 shrink-0 text-[12px] font-semibold tabular-nums" style={{ color: "var(--color-bt-text-dim)" }}>
                  {r.rank ?? "–"}
                </span>
                <span className="flex w-[34%] min-w-0 shrink-0 items-center gap-2">
                  {/* A team is a square (TeamBadge); a person in a teamless race carries no mark. */}
                  {r.color && <TeamBadge teamId={r.id} name={r.label} shortName={r.label} color={r.color} size={18} />}
                  <span className={`truncate text-sm ${r.color ? "font-semibold" : "font-normal"}`} style={{ color: "var(--color-bt-text)" }}>
                    {r.label}
                  </span>
                </span>
                {!r.hasResult && r.projected === 0 ? (
                  <span className="min-w-0 flex-1 text-[12px]" style={{ color: "var(--color-bt-text-dim)" }} data-testid={`standings-waiting-${r.id}`}>
                    No points yet
                  </span>
                ) : (
                  <span
                    className="flex h-2.5 min-w-0 flex-1 overflow-hidden rounded-full"
                    style={{ background: "var(--color-bt-card-raised)" }}
                    data-testid={`standings-bar-${r.id}`}
                  >
                    <span className="h-full" style={{ width: `${r.bankedPct}%`, background: color }} data-testid={`standings-banked-${r.id}`} />
                    <span className="h-full" style={{ width: `${r.projectedPct}%`, background: hatch(color) }} data-testid={`standings-projected-${r.id}`} />
                  </span>
                )}
                <span
                  className="w-10 shrink-0 text-right font-bold tabular-nums"
                  style={{
                    fontSize: isLeader ? 19 : 15,
                    color: isLeader && r.color ? teamInk(r.color) : "var(--color-bt-text)",
                  }}
                  data-testid={`standings-points-${r.id}`}
                >
                  {r.hasResult ? fmtPts(r.banked) : ""}
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
