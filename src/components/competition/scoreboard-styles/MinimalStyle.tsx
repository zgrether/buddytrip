import { fmtPts } from "./mock-score";
import type { StyleProps } from "./types";

/** Typography-only — no chrome, big numbers, lots of breathing room. */
export function MinimalStyle({ data }: StyleProps) {
  const sorted = [...data.teams].sort(
    (a, b) => (data.totals[b.id] ?? 0) - (data.totals[a.id] ?? 0)
  );

  return (
    <div className="px-5 py-6">
      {sorted.map((team, i) => {
        const total = data.totals[team.id] ?? 0;
        return (
          <div
            key={team.id}
            className="flex items-baseline gap-4 py-3"
            style={{
              borderTop:
                i === 0 ? "none" : "1px solid var(--color-bt-border)",
            }}
          >
            <span
              className="text-xs font-bold tabular-nums"
              style={{
                color:
                  i === 0
                    ? "var(--color-bt-accent)"
                    : "var(--color-bt-text-dim)",
                minWidth: 18,
              }}
            >
              {String(i + 1).padStart(2, "0")}
            </span>
            <div className="min-w-0 flex-1">
              <p
                className="truncate text-lg font-light leading-tight"
                style={{ color: "var(--color-bt-text)" }}
              >
                {team.name}
              </p>
              <p
                className="text-[10px] uppercase tracking-widest"
                style={{ color: "var(--color-bt-text-dim)" }}
              >
                {team.short_name}
              </p>
            </div>
            <p
              className="text-3xl font-light tabular-nums leading-none"
              style={{
                color:
                  total > 0
                    ? "var(--color-bt-text)"
                    : "var(--color-bt-text-dim)",
              }}
            >
              {fmtPts(total)}
            </p>
          </div>
        );
      })}
      <p
        className="mt-4 text-center text-[10px] uppercase tracking-widest"
        style={{ color: "var(--color-bt-text-dim)" }}
      >
        {fmtPts(data.totalAvailable)} pts · {data.events.length} event
        {data.events.length === 1 ? "" : "s"}
      </p>
    </div>
  );
}
