"use client";

import { useMemo } from "react";
import { Settings, Trophy } from "lucide-react";
import { trpc } from "@/lib/trpc-client";
import type { CSSProperties } from "react";

// ── Status strip (§2) ───────────────────────────────────────────────────────
// Content-driven, collapses entirely when empty. Priority ladder: games
// underway now ("On tap: …") → standing glance ("BLU 8½ · RED 7½") → nothing.
// Quiet, not a live ticker (the live pulse belongs on game pages — deferred).
// NB this reads per-GAME status ("active" = a game in scoring), NOT a
// competition-level status (that distinction was retired with GO LIVE).
interface StripLB {
  teams: { id: string; short_name: string }[];
  games: { name: string; status: string }[];
  teamTotals: Record<string, number>;
}
function fmtHalf(n: number): string {
  const whole = Math.floor(n);
  const isHalf = Math.abs(n - whole - 0.5) < 0.001;
  if (!isHalf) return String(whole);
  return whole === 0 ? "½" : `${whole}½`;
}
function buildStatusStrip(lb: StripLB | undefined): string | null {
  if (!lb) return null;
  const active = (lb.games ?? []).filter((g) => g.status === "active");
  if (active.length > 0) return `On tap: ${active.map((g) => g.name).join(", ")}`;
  const teams = lb.teams ?? [];
  const totals = lb.teamTotals ?? {};
  if (teams.length >= 2 && teams.some((t) => (totals[t.id] ?? 0) > 0)) {
    return [...teams]
      .sort((a, b) => (totals[b.id] ?? 0) - (totals[a.id] ?? 0))
      .map((t) => `${t.short_name} ${fmtHalf(totals[t.id] ?? 0)}`)
      .join("  ·  ");
  }
  return null;
}

interface Competition {
  id: string;
  name: string;
  tagline: string | null;
}

interface Props {
  competition: Competition;
  tripId: string;
  /** Open competition Settings (the consolidated details + rosters + delete
   *  home). Editors only — renders a gear in the header's right cluster. */
  onSettings?: () => void;
}

/**
 * CompetitionHeader — title strip + at-a-glance status.
 *
 * The GO LIVE / BACK TO SETUP toggle was removed at the root (option A): a
 * competition is visible to the whole crew the moment it exists, so a
 * competition-level reveal/status is meaningless. The header is now read-only
 * chrome — title + the quiet status strip + the Settings gear. Editing the
 * name/tagline and deleting the competition live in the Settings page (the gear).
 */
export function CompetitionHeader({ competition, tripId, onSettings }: Props) {
  // Status strip content (§2). Shares the leaderboard query with the board view
  // (same key → deduped), so it adds no fetch when the board is showing.
  const { data: lb } = trpc.competitions.leaderboard.useQuery(
    { tripId, competitionId: competition.id },
    { enabled: !!competition.id }
  );
  const statusStrip = useMemo(
    () => buildStatusStrip(lb as unknown as StripLB | undefined),
    [lb]
  );

  const glyphBox: CSSProperties = {
    background: "var(--color-bt-accent-faint)",
    color: "var(--color-bt-accent)",
  };

  return (
    <div data-testid="competition-header">
      {/* Title row — no outer card, sits directly on the page background */}
      <div className="flex items-start gap-3 pb-3">
        <div
          className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl"
          style={glyphBox}
        >
          <Trophy size={18} />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-base font-bold" style={{ color: "var(--color-bt-text)" }}>
            {competition.name}
          </p>
          {competition.tagline && competition.tagline.trim() && (
            <p
              className="mt-0.5 text-xs"
              style={{ color: "var(--color-bt-text-dim)" }}
            >
              {competition.tagline}
            </p>
          )}
        </div>
        {/* The gear is the single entry to Settings (details · rosters · delete). */}
        {onSettings && (
          <button
            type="button"
            onClick={onSettings}
            aria-label="Competition settings"
            className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg"
            style={{ background: "transparent", color: "var(--color-bt-text-dim)" }}
            data-testid="competition-settings-btn"
          >
            <Settings size={15} />
          </button>
        )}
      </div>

      {/* Status strip (§2) — lower region, collapses entirely when empty. */}
      {statusStrip && (
        <p
          className="pb-3"
          style={{ color: "var(--color-bt-text-dim)", fontSize: 12 }}
          data-testid="competition-status-strip"
        >
          {statusStrip}
        </p>
      )}
    </div>
  );
}
