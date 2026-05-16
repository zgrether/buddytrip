import Link from "next/link";
import { fmtPts, getCell } from "./mock-score";
import type { StyleProps } from "./types";

/** One card per event with teams ranked by finishing place inside. */
export function CardsStyle({ data }: StyleProps) {
  const medals = ["🥇", "🥈", "🥉"];

  return (
    <div className="space-y-2 p-3">
      {data.events.map((event) => {
        const rows = data.teams
          .map((t) => ({
            team: t,
            cell: getCell(data, t.id, event.id),
          }))
          .sort(
            (a, b) => (b.cell?.points ?? 0) - (a.cell?.points ?? 0)
          );

        return (
          <div
            key={event.id}
            className="rounded-lg"
            style={{
              background: "var(--color-bt-card-raised)",
              border: "1px solid var(--color-bt-border)",
            }}
          >
            <Link
              href={`/trips/${data.tripId}/events/${event.id}`}
              className="flex items-baseline justify-between px-3 py-2 underline-offset-2 hover:underline"
              style={{ borderBottom: "1px solid var(--color-bt-border)" }}
            >
              <p
                className="text-sm font-semibold"
                style={{ color: "var(--color-bt-text)" }}
              >
                {event.title}
              </p>
              <p
                className="text-[11px] no-underline"
                style={{ color: "var(--color-bt-text-dim)" }}
              >
                {fmtPts(event.points_available ?? 0)} pts
              </p>
            </Link>
            <div className="divide-y" style={{ borderColor: "var(--color-bt-border)" }}>
              {rows.map((r, i) => (
                <div
                  key={r.team.id}
                  className="flex items-center gap-3 px-3 py-1.5"
                >
                  <span className="w-5 text-center text-sm">
                    {medals[i] ?? (
                      <span
                        className="text-[10px] font-bold"
                        style={{ color: "var(--color-bt-text-dim)" }}
                      >
                        {i + 1}
                      </span>
                    )}
                  </span>
                  <span
                    className="h-2.5 w-2.5 flex-shrink-0 rounded-full"
                    style={{ background: r.team.color }}
                    aria-hidden
                  />
                  <span
                    className="flex-1 truncate text-[13px]"
                    style={{ color: "var(--color-bt-text)" }}
                  >
                    {r.team.name}
                  </span>
                  <span
                    className="text-sm font-semibold tabular-nums"
                    style={{
                      color:
                        (r.cell?.points ?? 0) > 0
                          ? "var(--color-bt-text)"
                          : "var(--color-bt-text-dim)",
                    }}
                  >
                    {fmtPts(r.cell?.points ?? 0)}
                  </span>
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}
