"use client";

import { BarChart3 } from "lucide-react";
import { trpc } from "@/lib/trpc-client";

interface Props {
  competitionId: string;
  tripId: string;
}

interface Team {
  id: string;
  name: string;
  short_name: string;
  color: string;
  color_dim: string;
}

interface EventRow {
  id: string;
  title: string;
  type: "GOLF" | "GENERIC";
  is_practice: boolean;
  points_available: number | null;
}

/**
 * ScoreboardPanel — at-a-glance grid showing each team's points per event.
 *
 * Layout (rows × cols):
 *   - Header row: blank | Pts (available per event) | one column per team
 *   - One row per non-practice event with the team scores filled in
 *   - Total row aggregating each team's points across all events
 *
 * The grid expands as teams and events get added. Scoring backend isn't
 * wired up yet, so every score cell renders an em-dash placeholder; team
 * totals show zero. When the scoring API lands, the cell value just
 * swaps in for the dash — no layout changes needed.
 */
export function ScoreboardPanel({ competitionId, tripId }: Props) {
  const { data: teams = [] } = trpc.teams.list.useQuery(
    { tripId, competitionId },
    { enabled: !!competitionId }
  );
  const { data: events = [] } = trpc.events.list.useQuery(
    { tripId, competitionId },
    { enabled: !!competitionId }
  );

  const teamsTyped = teams as Team[];
  // Practice rounds don't contribute to the leaderboard, so we hide them
  // from the grid entirely — matches the "Excluded from tournament points"
  // copy on the event editor's practice toggle.
  const eventsTyped = (events as EventRow[]).filter((e) => !e.is_practice);

  const totalAvailable = eventsTyped.reduce(
    (sum, e) => sum + (e.points_available ?? 0),
    0
  );

  const hasTeams = teamsTyped.length > 0;
  const hasEvents = eventsTyped.length > 0;

  // ── Empty state ─────────────────────────────────────────────────────────
  if (!hasTeams || !hasEvents) {
    const missing =
      !hasTeams && !hasEvents
        ? "teams and events"
        : !hasTeams
        ? "teams"
        : "events";
    return (
      <div
        data-testid="scoreboard-panel"
        className="overflow-hidden rounded-xl"
        style={{ border: "1px solid var(--color-bt-border)" }}
      >
        <PanelHeader
          accent={false}
          subtitle={`Add ${missing} to see the leaderboard`}
        />
      </div>
    );
  }

  return (
    <div
      data-testid="scoreboard-panel"
      className="overflow-hidden rounded-xl"
      style={{ border: "1px solid var(--color-bt-border)" }}
    >
      <PanelHeader
        accent
        subtitle={`${totalAvailable} total pts · ${eventsTyped.length} event${
          eventsTyped.length === 1 ? "" : "s"
        }`}
      />

      {/* Scrollable container — many teams/long event names push past
          phone widths, so we let the table scroll horizontally rather
          than squashing cells into illegible columns. */}
      <div
        className="overflow-x-auto"
        style={{ borderTop: "1px solid var(--color-bt-border)" }}
      >
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
              {teamsTyped.map((t) => (
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
            {eventsTyped.map((event) => (
              <tr
                key={event.id}
                style={{ borderTop: "1px solid var(--color-bt-border)" }}
              >
                <td
                  className="px-3 py-2"
                  style={{ color: "var(--color-bt-text)" }}
                >
                  {event.title}
                </td>
                <td
                  className="px-2 py-2 text-right"
                  style={{ color: "var(--color-bt-text-dim)" }}
                >
                  {event.points_available ?? "—"}
                </td>
                {teamsTyped.map((team) => (
                  <td
                    key={team.id}
                    className="px-2 py-2 text-right tabular-nums"
                    style={{ color: "var(--color-bt-text-dim)" }}
                  >
                    —
                  </td>
                ))}
              </tr>
            ))}

            {/* Totals row — bold, slightly raised background to set it
                apart from the per-event rows */}
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
                {totalAvailable}
              </td>
              {teamsTyped.map((t) => (
                <td
                  key={t.id}
                  className="px-2 py-2 text-right font-semibold tabular-nums"
                  style={{ color: "var(--color-bt-text)" }}
                >
                  0
                </td>
              ))}
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── PanelHeader ─────────────────────────────────────────────────────────────

function PanelHeader({
  accent,
  subtitle,
}: {
  accent: boolean;
  subtitle: string;
}) {
  return (
    <div className="flex items-center gap-2.5 px-4 py-3">
      <span
        style={{
          color: accent ? "var(--color-bt-accent)" : "var(--color-bt-text-dim)",
        }}
        aria-hidden
      >
        <BarChart3 size={16} />
      </span>
      <div>
        <p
          className="text-sm font-semibold"
          style={{ color: "var(--color-bt-text)" }}
        >
          Scoreboard
        </p>
        <p
          className="text-[11px]"
          style={{ color: "var(--color-bt-text-dim)" }}
        >
          {subtitle}
        </p>
      </div>
    </div>
  );
}
