"use client";

import { useMemo, useState } from "react";
import { BarChart3, Sparkles } from "lucide-react";
import { trpc } from "@/lib/trpc-client";
import {
  buildMockData,
  DEFAULT_STYLE,
  STYLE_COMPONENTS,
  STYLE_META,
  type ScoreboardStyleId,
} from "./scoreboard-styles";
import { ScoreboardStyleChooser } from "./ScoreboardStyleChooser";

interface Props {
  competitionId: string;
  tripId: string;
  /** Only the owner sees the style chooser button — they pick the
   *  official style that everyone else views. */
  isOwner: boolean;
}

interface Team {
  id: string;
  name: string;
  short_name: string;
  color: string;
}

interface EventRow {
  id: string;
  title: string;
  type: "GOLF" | "GENERIC";
  is_practice: boolean;
  points_available: number | null;
  point_distributions?: Array<{ position: number; points: number }>;
}

const STORAGE_KEY = (compId: string) => `bt-scoreboard-style-${compId}`;

/**
 * ScoreboardPanel — at-a-glance leaderboard for the competition tab.
 *
 * Dispatches the actual rendering to one of 8 style variants chosen by
 * the owner (see `scoreboard-styles/`). The chosen style persists in
 * localStorage for now; will move to a `competitions.scoreboard_style`
 * column once the official scoreboard page ships.
 *
 * Scoring data is mocked deterministically while the scoring backend is
 * still under construction — see `buildMockData` in `mock-score.ts`.
 */
export function ScoreboardPanel({ competitionId, tripId, isOwner }: Props) {
  const { data: teams = [] } = trpc.teams.list.useQuery(
    { tripId, competitionId },
    { enabled: !!competitionId }
  );
  const { data: events = [] } = trpc.events.list.useQuery(
    { tripId, competitionId },
    { enabled: !!competitionId }
  );

  const teamsTyped = teams as Team[];
  const eventsTyped = (events as EventRow[]).filter((e) => !e.is_practice);

  const [styleId, setStyleId] = useState<ScoreboardStyleId>(() => {
    if (typeof window === "undefined") return DEFAULT_STYLE;
    const stored = window.localStorage.getItem(STORAGE_KEY(competitionId));
    if (stored && stored in STYLE_META) return stored as ScoreboardStyleId;
    return DEFAULT_STYLE;
  });
  const [chooserOpen, setChooserOpen] = useState(false);

  const handlePick = (id: ScoreboardStyleId) => {
    setStyleId(id);
    if (typeof window !== "undefined") {
      window.localStorage.setItem(STORAGE_KEY(competitionId), id);
    }
  };

  const data = useMemo(
    () => buildMockData(tripId, teamsTyped, eventsTyped),
    [tripId, teamsTyped, eventsTyped]
  );

  const hasTeams = teamsTyped.length > 0;
  const hasEvents = eventsTyped.length > 0;

  // ── Empty state ────────────────────────────────────────────────────────
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
        <div className="flex flex-col items-center gap-2 px-4 py-8 text-center">
          <span
            className="flex h-10 w-10 items-center justify-center rounded-xl"
            style={{
              background: "var(--color-bt-card-raised)",
              color: "var(--color-bt-text-dim)",
            }}
            aria-hidden
          >
            <BarChart3 size={18} />
          </span>
          <p
            className="text-sm font-semibold"
            style={{ color: "var(--color-bt-text)" }}
          >
            Scoreboard
          </p>
          <p
            className="max-w-xs text-[12px] leading-snug"
            style={{ color: "var(--color-bt-text-dim)" }}
          >
            Add {missing} to see the leaderboard.
          </p>
        </div>
      </div>
    );
  }

  const StyleComponent = STYLE_COMPONENTS[styleId];
  const meta = STYLE_META[styleId];

  return (
    <div
      data-testid="scoreboard-panel"
      className="overflow-hidden rounded-xl"
      style={{ border: "1px solid var(--color-bt-border)" }}
    >
      <div className="flex items-center justify-between gap-3 px-4 py-3">
        <PanelHeader
          accent
          subtitle={`${data.totalAvailable} total pts · ${eventsTyped.length} event${
            eventsTyped.length === 1 ? "" : "s"
          }`}
        />
        {isOwner && (
          <button
            type="button"
            onClick={() => setChooserOpen(true)}
            className="flex flex-shrink-0 items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold"
            style={{
              background: "var(--color-bt-card-raised)",
              color: "var(--color-bt-text)",
              border: "1px solid var(--color-bt-border)",
            }}
            data-testid="scoreboard-style-button"
            aria-label="Change scoreboard style"
          >
            <Sparkles size={12} style={{ color: "var(--color-bt-accent)" }} />
            {meta.label}
          </button>
        )}
      </div>

      <div style={{ borderTop: "1px solid var(--color-bt-border)" }}>
        <StyleComponent data={data} />
      </div>

      {chooserOpen && (
        <ScoreboardStyleChooser
          current={styleId}
          data={data}
          onPick={handlePick}
          onClose={() => setChooserOpen(false)}
        />
      )}
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
    <div className="flex min-w-0 items-center gap-2.5">
      <span
        style={{
          color: accent ? "var(--color-bt-accent)" : "var(--color-bt-text-dim)",
        }}
        aria-hidden
      >
        <BarChart3 size={16} />
      </span>
      <div className="min-w-0">
        <p
          className="text-sm font-semibold"
          style={{ color: "var(--color-bt-text)" }}
        >
          Scoreboard
        </p>
        <p
          className="truncate text-[11px]"
          style={{ color: "var(--color-bt-text-dim)" }}
        >
          {subtitle}
        </p>
      </div>
    </div>
  );
}
