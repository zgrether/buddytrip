import Link from "next/link";
import { fmtPts, getCell } from "./mock-score";
import { placeStyle, type StyleProps } from "./types";

/** Grid layout but each score cell is colored by the team's finishing
 *  place for that event — green 1st, blue 2nd, amber 3rd, red 4th+. */
export function HeatmapStyle({ data }: StyleProps) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-[12px]" style={{ borderCollapse: "separate", borderSpacing: 0 }}>
        <thead>
          <tr>
            <th
              className="px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-wider"
              style={{ color: "var(--color-bt-text-dim)" }}
            >
              Event
            </th>
            {data.teams.map((t) => (
              <th
                key={t.id}
                className="px-2 py-2 text-center text-[11px] font-semibold"
                style={{ color: "var(--color-bt-text)" }}
              >
                <div className="flex items-center justify-center gap-1.5">
                  <span
                    className="h-2 w-2 flex-shrink-0 rounded-full"
                    style={{ background: t.color }}
                    aria-hidden
                  />
                  <span>{t.short_name}</span>
                </div>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.events.map((event) => (
            <tr key={event.id}>
              <td
                className="px-3 py-1.5"
                style={{ borderTop: "1px solid var(--color-bt-border)" }}
              >
                <Link
                  href={`/trips/${data.tripId}/events/${event.id}`}
                  className="flex items-center gap-2 underline-offset-2 hover:underline"
                  style={{ color: "var(--color-bt-text)" }}
                >
                  <span>{event.title}</span>
                  <span
                    className="text-[10px] no-underline"
                    style={{ color: "var(--color-bt-text-dim)" }}
                  >
                    · {event.points_available ?? 0}
                  </span>
                </Link>
              </td>
              {data.teams.map((team) => {
                const cell = getCell(data, team.id, event.id);
                const ps = placeStyle(cell?.place ?? 0);
                return (
                  <td
                    key={team.id}
                    className="p-1"
                    style={{ borderTop: "1px solid var(--color-bt-border)" }}
                  >
                    <div
                      className="flex h-7 items-center justify-center rounded-md text-xs font-bold tabular-nums"
                      style={{
                        background: ps.bg,
                        color: ps.text,
                      }}
                    >
                      {fmtPts(cell?.points ?? 0)}
                    </div>
                  </td>
                );
              })}
            </tr>
          ))}
          <tr
            style={{
              borderTop: "1px solid var(--color-bt-border)",
              background: "var(--color-bt-card-raised)",
            }}
          >
            <td
              className="px-3 py-2 text-[11px] font-semibold uppercase tracking-wider"
              style={{ color: "var(--color-bt-text-dim)" }}
            >
              Total
            </td>
            {data.teams.map((t) => (
              <td
                key={t.id}
                className="px-2 py-2 text-center font-bold tabular-nums"
                style={{ color: "var(--color-bt-text)" }}
              >
                {fmtPts(data.totals[t.id] ?? 0)}
              </td>
            ))}
          </tr>
        </tbody>
      </table>
    </div>
  );
}
