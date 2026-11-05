"use client";

import { standingsRows, type StandingsUnit } from "@/lib/standingsRows";
import { fmtPts, sharedPlaceWord } from "@/lib/vocabulary";
import { teamInk } from "@/lib/teamTextColor";
import { TeamBadge } from "@/components/TeamBadge";

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
 *  - The FULL name, on its own line with the bar beneath: a standings row is a
 *    subject slot (Zach, 2026-11-05; STYLE_GUIDE reverses the old label ruling).
 *  - A LOCKED place (`pointsClinch`) puts the rank on a filled square; an open
 *    one keeps the plain dim number. A shared place reads "T3" on both rows.
 */

/** The hatch — the unit's colour, striped over a faded copy of itself. The first
 *  stripe pattern in the app; it means "if today holds" wherever it appears. */
export function hatch(color: string): string {
  return `repeating-linear-gradient(135deg, ${color} 0 2px, color-mix(in srgb, ${color} 30%, transparent) 2px 5px)`;
}

export const PERSON_COLOR = "var(--color-bt-accent)";

/** The rank column, the gap after it, and the team badge with its gap: what the
 *  bar's line indents by to sit under the name. */
const RANK_SLOT = 18;
const RANK_GAP = 12;
const BADGE_SIZE = 18;
const BADGE_GAP = 8;

function RankChip({ id, rank, shared, locked }: { id: string; rank: number | null; shared: boolean; locked: boolean }) {
  const text = rank == null ? "–" : shared ? sharedPlaceWord(rank) : rank;
  return (
    <span
      className="flex shrink-0 items-center justify-center text-[12px] font-semibold tabular-nums"
      style={{
        width: RANK_SLOT,
        height: RANK_SLOT,
        borderRadius: 5,
        background: locked ? "var(--color-bt-text)" : undefined,
        color: locked ? "var(--color-bt-base)" : "var(--color-bt-text-dim)",
      }}
      data-testid={`standings-rank-${id}`}
      data-locked={locked ? "true" : undefined}
    >
      {text}
    </span>
  );
}

export function StandingsRows({
  units,
  unitTotals,
  projections,
  lockedUnitIds,
  viewerUnitId,
  kind,
}: {
  units: StandingsUnit[];
  unitTotals: Record<string, number>;
  projections: Record<string, Record<string, number>>;
  /** The units whose place is locked (`pointsClinch`). */
  lockedUnitIds?: readonly string[];
  viewerUnitId: string | null | undefined;
  kind: "teams" | "players";
}) {
  const rows = standingsRows({ units, unitTotals, projections, lockedUnitIds, viewerUnitId });
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
        {rows.map((r) => {
          const color = r.color ?? PERSON_COLOR;
          // A shared 1st has no single leader, so every row in it reads the same.
          const isLeader = r.rank === 1 && r.banked > 0;
          return (
            <div
              key={r.id}
              className="rounded-lg"
              style={{ background: r.isViewer ? "var(--color-bt-accent-faint)" : undefined }}
              data-testid={`standings-row-${r.id}`}
              data-viewer={r.isViewer ? "true" : undefined}
            >
              <div className="px-2 py-1.5">
                <div className="flex w-full items-center" style={{ gap: RANK_GAP }}>
                  <RankChip id={r.id} rank={r.rank} shared={r.shared} locked={r.locked} />
                  <span className="flex min-w-0 flex-1 items-center" style={{ gap: BADGE_GAP }}>
                    {/* A team is a square (TeamBadge); a person in a teamless race carries no mark. */}
                    {r.color && <TeamBadge teamId={r.id} name={r.label} shortName={r.shortName ?? r.label} color={r.color} size={BADGE_SIZE} />}
                    <span className={`min-w-0 text-sm ${r.color ? "font-semibold" : "font-normal"}`} style={{ color: "var(--color-bt-text)" }}>
                      {r.label}
                    </span>
                  </span>
                  <span
                    className="shrink-0 text-right font-bold tabular-nums"
                    style={{
                      fontSize: isLeader ? 19 : 15,
                      color: isLeader && r.color ? teamInk(r.color) : "var(--color-bt-text)",
                    }}
                    data-testid={`standings-points-${r.id}`}
                  >
                    {r.hasResult ? fmtPts(r.banked) : ""}
                  </span>
                </div>
                <div className="mt-1" style={{ paddingLeft: RANK_SLOT + RANK_GAP + (r.color ? BADGE_SIZE + BADGE_GAP : 0) }}>
                  {!r.hasResult && r.projected === 0 ? (
                    <span className="block text-[12px]" style={{ color: "var(--color-bt-text-dim)" }} data-testid={`standings-waiting-${r.id}`}>
                      No points yet
                    </span>
                  ) : (
                    <span
                      className="flex h-2.5 min-w-0 overflow-hidden rounded-full"
                      style={{ background: "var(--color-bt-card-raised)" }}
                      data-testid={`standings-bar-${r.id}`}
                    >
                      <span className="h-full" style={{ width: `${r.bankedPct}%`, background: color }} data-testid={`standings-banked-${r.id}`} />
                      <span className="h-full" style={{ width: `${r.projectedPct}%`, background: hatch(color) }} data-testid={`standings-projected-${r.id}`} />
                    </span>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
