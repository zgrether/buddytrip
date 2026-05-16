import { fmtPts } from "./mock-score";
import type { StyleProps } from "./types";

/** Horizontal stacked bars sized by each team's share of total points. */
export function BarsStyle({ data }: StyleProps) {
  const sorted = [...data.teams].sort(
    (a, b) => (data.totals[b.id] ?? 0) - (data.totals[a.id] ?? 0)
  );
  const maxTotal =
    Math.max(...sorted.map((t) => data.totals[t.id] ?? 0), 1) || 1;

  return (
    <div className="space-y-3 p-4">
      {sorted.map((team) => {
        const total = data.totals[team.id] ?? 0;
        // Bar width scales relative to the leader, not totalAvailable —
        // makes the visual differences more readable when no team is
        // close to maxing out.
        const pct = (total / maxTotal) * 100;
        const fillPct =
          data.totalAvailable > 0
            ? Math.round((total / data.totalAvailable) * 100)
            : 0;
        return (
          <div key={team.id}>
            <div className="mb-1 flex items-center gap-2">
              <span
                className="h-2.5 w-2.5 flex-shrink-0 rounded-full"
                style={{ background: team.color }}
                aria-hidden
              />
              <p
                className="flex-1 truncate text-sm font-semibold"
                style={{ color: "var(--color-bt-text)" }}
              >
                {team.name}
              </p>
              <p
                className="text-sm font-bold tabular-nums"
                style={{ color: "var(--color-bt-text)" }}
              >
                {fmtPts(total)}
              </p>
              <span
                className="text-[10px] tabular-nums"
                style={{ color: "var(--color-bt-text-dim)" }}
              >
                {fillPct}%
              </span>
            </div>
            <div
              className="h-5 overflow-hidden rounded-md"
              style={{ background: "var(--color-bt-card-raised)" }}
            >
              <div
                className="h-full rounded-md"
                style={{
                  width: `${pct}%`,
                  background: `linear-gradient(90deg, ${team.color} 0%, color-mix(in srgb, ${team.color} 70%, transparent) 100%)`,
                  transition: "width 200ms",
                }}
              />
            </div>
          </div>
        );
      })}
      <p
        className="mt-2 text-center text-[10px]"
        style={{ color: "var(--color-bt-text-dim)" }}
      >
        {fmtPts(data.totalAvailable)} pts available across {data.events.length} event
        {data.events.length === 1 ? "" : "s"}
      </p>
    </div>
  );
}
