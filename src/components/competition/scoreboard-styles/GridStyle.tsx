import Link from "next/link";
import { fmtPts, getCell } from "./mock-score";
import type { StyleProps } from "./types";

/** Classic table — events down, teams across. */
export function GridStyle({ data }: StyleProps) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-[12px]">
        <thead>
          <tr>
            <th
              className="px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-wider"
              style={{ color: "var(--color-bt-text-dim)" }}
            >
              Event
            </th>
            <th
              className="px-2 py-2 text-right text-[10px] font-semibold uppercase tracking-wider"
              style={{ color: "var(--color-bt-text-dim)" }}
            >
              Pts
            </th>
            {data.teams.map((t) => (
              <th
                key={t.id}
                className="px-2 py-2 text-right text-[11px] font-semibold"
                style={{ color: "var(--color-bt-text)" }}
              >
                <div className="flex items-center justify-end gap-1.5">
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
            <tr
              key={event.id}
              style={{ borderTop: "1px solid var(--color-bt-border)" }}
            >
              <td className="px-3 py-2">
                <Link
                  href={`/trips/${data.tripId}/events/${event.id}`}
                  className="underline-offset-2 hover:underline"
                  style={{ color: "var(--color-bt-text)" }}
                >
                  {event.title}
                </Link>
              </td>
              <td
                className="px-2 py-2 text-right"
                style={{ color: "var(--color-bt-text-dim)" }}
              >
                {event.points_available ?? "—"}
              </td>
              {data.teams.map((team) => {
                const cell = getCell(data, team.id, event.id);
                const pts = cell?.points ?? 0;
                return (
                  <td
                    key={team.id}
                    className="px-2 py-2 text-right tabular-nums"
                    style={{
                      color:
                        pts > 0
                          ? "var(--color-bt-text)"
                          : "var(--color-bt-text-dim)",
                    }}
                  >
                    {pts > 0 ? fmtPts(pts) : "—"}
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
            <td
              className="px-2 py-2 text-right font-semibold tabular-nums"
              style={{ color: "var(--color-bt-text)" }}
            >
              {fmtPts(data.totalAvailable)}
            </td>
            {data.teams.map((t) => (
              <td
                key={t.id}
                className="px-2 py-2 text-right font-semibold tabular-nums"
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
