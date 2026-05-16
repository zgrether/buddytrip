import { fmtPts } from "./mock-score";
import type { StyleProps } from "./types";

/** Jumbotron-style display: each team gets a panel with a huge total. */
export function StadiumStyle({ data }: StyleProps) {
  const sorted = [...data.teams].sort(
    (a, b) => (data.totals[b.id] ?? 0) - (data.totals[a.id] ?? 0)
  );
  const leader = sorted[0];
  // Choose 2 columns for 2-4 teams, 3 columns for 5-6, etc.
  const cols = data.teams.length <= 4 ? 2 : 3;

  return (
    <div className="p-3">
      <div
        className="grid gap-px overflow-hidden rounded-lg"
        style={{
          background: "var(--color-bt-border)",
          gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`,
        }}
      >
        {sorted.map((team) => {
          const total = data.totals[team.id] ?? 0;
          const isLeader = team.id === leader?.id && total > 0;
          return (
            <div
              key={team.id}
              className="flex flex-col items-center justify-center px-3 py-4"
              style={{
                background: isLeader
                  ? `color-mix(in srgb, ${team.color} 10%, var(--color-bt-card))`
                  : "var(--color-bt-card)",
                borderTop: isLeader
                  ? `2px solid ${team.color}`
                  : "2px solid transparent",
              }}
            >
              <div className="flex items-center gap-1.5">
                <span
                  className="h-2 w-2 flex-shrink-0 rounded-full"
                  style={{ background: team.color }}
                  aria-hidden
                />
                <span
                  className="text-[10px] font-bold uppercase tracking-widest"
                  style={{ color: "var(--color-bt-text-dim)" }}
                >
                  {team.short_name}
                </span>
              </div>
              <p
                className="mt-1 font-mono text-4xl font-black tabular-nums leading-none"
                style={{
                  color: isLeader
                    ? "var(--color-bt-accent)"
                    : "var(--color-bt-text)",
                }}
              >
                {fmtPts(total)}
              </p>
              <p
                className="mt-2 text-[10px] tabular-nums"
                style={{ color: "var(--color-bt-text-dim)" }}
              >
                / {fmtPts(data.totalAvailable)}
              </p>
            </div>
          );
        })}
      </div>
      <p
        className="mt-3 text-center font-mono text-[10px] uppercase tracking-widest"
        style={{ color: "var(--color-bt-text-dim)" }}
      >
        ── {data.events.length} event{data.events.length === 1 ? "" : "s"} · {fmtPts(data.totalAvailable)} pts available ──
      </p>
    </div>
  );
}
