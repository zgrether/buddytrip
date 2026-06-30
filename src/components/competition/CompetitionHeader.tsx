"use client";

import { useMemo } from "react";
import { Pause, Radio, Settings, Trophy } from "lucide-react";
import { trpc } from "@/lib/trpc-client";
import type { CSSProperties } from "react";

// ── Status strip (§2) ───────────────────────────────────────────────────────
// Content-driven, collapses entirely when empty. Priority ladder: games
// underway now ("On tap: …") → standing glance ("BLU 8½ · RED 7½") → nothing.
// Quiet, not a live ticker (the live pulse belongs on game pages — deferred).
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
  status: "upcoming" | "active" | "completed";
}

const STATUS_CHIP: Record<
  Competition["status"],
  { label: string; bg: string; color: string; border: string }
> = {
  upcoming: {
    label: "Setup",
    bg: "var(--color-bt-warning-faint)",
    color: "var(--color-bt-warning)",
    border: "var(--color-bt-warning-border)",
  },
  active: {
    label: "Active",
    bg: "var(--color-bt-accent-faint)",
    color: "var(--color-bt-accent)",
    border: "var(--color-bt-accent-border)",
  },
  completed: {
    label: "Completed",
    bg: "var(--color-bt-tag-bg)",
    color: "var(--color-bt-accent)",
    border: "var(--color-bt-accent-border)",
  },
};

interface Props {
  competition: Competition;
  tripId: string;
  /**
   * Chrome-shrink (§3): post-live the header collapses to a compact bar
   * (smaller glyph, no tagline) so the leaderboard is the hero and doesn't
   * start halfway down the page.
   */
  compact?: boolean;
  /**
   * Go-live toggle handler. The mutation is owned by the host
   * (CompetitionFace) so going live can also flip the default view to the
   * board. When omitted, a read-only status badge is shown instead of the
   * toggle (non-owners / completed competitions).
   */
  onToggleLive?: () => void;
  /** True while the go-live mutation is in flight (disables the toggle). */
  togglePending?: boolean;
  /** Open competition Settings (the consolidated details + rosters + delete
   *  home). Editors only — renders a gear in the header's right cluster. */
  onSettings?: () => void;
}

/**
 * CompetitionHeader — title strip + go-live toggle + at-a-glance status.
 *
 * Editing the name/tagline and deleting the competition both moved into the
 * consolidated Settings page (the gear) — the header is now read-only chrome
 * plus the go-live switch.
 */
export function CompetitionHeader({
  competition,
  tripId,
  compact = false,
  onToggleLive,
  togglePending = false,
  onSettings,
}: Props) {
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

  // Chrome-shrink (§3): compact glyph + tighter spacing post-live so the
  // board is the hero. The tagline is dropped in compact mode.
  const glyphBox: CSSProperties = {
    background: "var(--color-bt-accent-faint)",
    color: "var(--color-bt-accent)",
  };

  return (
    <div data-testid="competition-header">
      {/* Title row — no outer card, sits directly on the page background */}
      <div className={`flex items-start gap-3 ${compact ? "pb-2" : "pb-3"}`}>
        <div
          className={`flex flex-shrink-0 items-center justify-center rounded-xl ${
            compact ? "h-8 w-8" : "h-10 w-10"
          }`}
          style={glyphBox}
        >
          <Trophy size={compact ? 16 : 18} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p
              className={`font-bold ${compact ? "text-sm" : "text-base"}`}
              style={{ color: "var(--color-bt-text)" }}
            >
              {competition.name}
            </p>
            {onToggleLive && competition.status !== "completed" ? (
              <LiveToggleButton
                status={competition.status}
                pending={togglePending}
                onClick={onToggleLive}
              />
            ) : (
              <StatusBadge status={competition.status} />
            )}
          </div>
          {!compact && competition.tagline && competition.tagline.trim() && (
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
          className={compact ? "pb-2" : "pb-3"}
          style={{ color: "var(--color-bt-text-dim)", fontSize: 12 }}
          data-testid="competition-status-strip"
        >
          {statusStrip}
        </p>
      )}
    </div>
  );
}

// ── StatusBadge ─────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: Competition["status"] }) {
  const cfg = STATUS_CHIP[status];
  return (
    <span
      className="rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider"
      style={{
        background: cfg.bg,
        color: cfg.color,
        border: `1px solid ${cfg.border}`,
      }}
      data-testid="competition-status-badge"
    >
      {cfg.label}
    </span>
  );
}

// ── LiveToggleButton (owner only) ──────────────────────────────────────────
//
// Replaces the SETUP / Active badge for owners with a one-tap toggle.
// "upcoming" → tap to GO LIVE (activates bottom nav + scoreboard
// surface for the whole crew). "active" → tap to return to setup
// (hides nav + scoreboard until ready again).

function LiveToggleButton({
  status,
  pending,
  onClick,
}: {
  status: "upcoming" | "active";
  pending: boolean;
  onClick: () => void;
}) {
  const isLive = status === "active";
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={pending}
      aria-label={isLive ? "Switch back to setup mode" : "Go live for the crew"}
      className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider transition-opacity disabled:opacity-60"
      style={
        isLive
          ? {
              background: "transparent",
              color: "var(--color-bt-text-dim)",
              border: "1px solid var(--color-bt-border)",
            }
          : {
              background: "var(--color-bt-accent)",
              color: "var(--color-bt-base)",
              border: "1px solid var(--color-bt-accent)",
            }
      }
      data-testid="competition-live-toggle"
    >
      {isLive ? <Pause size={10} strokeWidth={3} /> : <Radio size={10} strokeWidth={3} />}
      {isLive ? "Back to Setup" : "Go Live"}
    </button>
  );
}
