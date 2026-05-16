import { Trophy } from "lucide-react";
import { fmtPts } from "./mock-score";
import type { StyleProps } from "./types";

/** Teams ranked by total descending, with medal indicators for top 3. */
export function LeaderboardStyle({ data }: StyleProps) {
  const sorted = [...data.teams].sort(
    (a, b) => (data.totals[b.id] ?? 0) - (data.totals[a.id] ?? 0)
  );
  const medals = ["🥇", "🥈", "🥉"];

  return (
    <div>
      {sorted.map((team, i) => {
        const total = data.totals[team.id] ?? 0;
        const pct =
          data.totalAvailable > 0
            ? Math.min(100, (total / data.totalAvailable) * 100)
            : 0;
        const isLeader = i === 0;
        return (
          <div
            key={team.id}
            className="flex items-center gap-3 px-4 py-3"
            style={{
              borderTop:
                i === 0 ? "none" : "1px solid var(--color-bt-border)",
              background: isLeader
                ? "var(--color-bt-card-raised)"
                : "transparent",
            }}
          >
            <span
              className="w-6 text-center text-base"
              style={{ color: "var(--color-bt-text)" }}
            >
              {medals[i] ?? (
                <span
                  className="text-xs font-bold"
                  style={{ color: "var(--color-bt-text-dim)" }}
                >
                  {i + 1}
                </span>
              )}
            </span>
            <span
              className="h-3 w-3 flex-shrink-0 rounded-full"
              style={{ background: team.color }}
              aria-hidden
            />
            <div className="min-w-0 flex-1">
              <p
                className="truncate text-sm font-semibold"
                style={{ color: "var(--color-bt-text)" }}
              >
                {team.name}
              </p>
              <div
                className="mt-1 h-1 rounded-full"
                style={{ background: "var(--color-bt-card-raised)" }}
              >
                <div
                  className="h-full rounded-full"
                  style={{
                    width: `${pct}%`,
                    background: team.color,
                    transition: "width 200ms",
                  }}
                />
              </div>
            </div>
            <div className="text-right">
              <p
                className="text-xl font-bold tabular-nums leading-none"
                style={{ color: "var(--color-bt-text)" }}
              >
                {fmtPts(total)}
              </p>
              <p
                className="mt-0.5 text-[10px]"
                style={{ color: "var(--color-bt-text-dim)" }}
              >
                of {fmtPts(data.totalAvailable)}
              </p>
            </div>
            {isLeader && (
              <Trophy
                size={14}
                style={{ color: "var(--color-bt-accent)" }}
                aria-label="Leader"
              />
            )}
          </div>
        );
      })}
    </div>
  );
}
