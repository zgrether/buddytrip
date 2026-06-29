"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import { GameSetupRows } from "@/components/games/GameSetupRows";
import { GameDangerZone } from "@/components/games/GameDangerZone";
import { GameManagementPanel } from "@/components/games/GameManagementPanel";
import { GameIdentityHeader } from "@/components/games/GameIdentityHeader";
import { GameRulesNote } from "@/components/games/GameRulesNote";
import type { GameRow } from "@/components/competition/CompetitionGamesPanel";

/**
 * The ONE game settings page (A2-ux correction) — the single home for ALL setup.
 * It holds the full redesigned checklist (reuses `GameSetupRows` + per-format
 * drill-downs + an optional `extraRows` slot), the single **Setup / Scoring** toggle
 * (`GameManagementPanel` — the one game-mode control, both directions), and the
 * Danger Zone. Reached via the corner settings GEAR in BOTH modes (the scoreboard
 * page is a pass-through that routes here — never a setup surface itself).
 *
 * Switching to Setup = `scoring_enabled=false`, **scores kept**, and you keep
 * configuring RIGHT HERE (this page stays valid after the flip — not a
 * self-destroying control). Switching to Scoring opens the game to the crew.
 */
export function GameConfigurationView({
  subtitle,
  onBack,
  tripId,
  competitionId,
  game,
  canEdit,
  isOwner,
  onChanged,
  onDeleted,
  whosPlayingLabel,
  onEditWhosPlaying,
  extraRows,
  scoringEnabled,
  ready = true,
  onEnable,
  onDisable,
  busy,
}: {
  subtitle: string;
  onBack: () => void;
  tripId: string;
  competitionId: string | null;
  game: GameRow;
  canEdit: boolean;
  /** Owner gates the per-game danger zone (reset/delete) — owner-only, matching
   *  the server. Co-admins/delegates configure but don't get the danger ladder. */
  isOwner: boolean;
  onChanged: () => void;
  /** Game deleted from the danger zone — leave the page (back to the board). */
  onDeleted: () => void;
  /** Summary + drill-down into the format's existing who's-playing/handicaps
   *  editor (the setup body — pairings / groups). Omit when the format has no
   *  post-create roster editor (stroke today — its handicaps step lands in §3). */
  whosPlayingLabel?: string;
  onEditWhosPlaying?: () => void;
  /** Extra setup rows below the who's-playing drill-down (e.g. the stroke
   *  Modifiers row). The match page renders its full checklist inline, so this is
   *  only for the GameSetupRows-based formats that need one more drill-down. */
  extraRows?: React.ReactNode;
  scoringEnabled: boolean;
  /** Minimum requirements met — gates the toggle's Scoring segment. Formats with
   *  no hard readiness gate (stroke/rack) leave it at the default `true`. */
  ready?: boolean;
  onEnable: () => void;
  onDisable: () => void;
  busy: boolean;
}) {
  return (
    <div className="flex min-h-screen flex-col" style={{ background: "var(--color-bt-base)" }}>
      <header
        className="flex shrink-0 items-center"
        style={{ height: 52, padding: "0 8px", background: "var(--color-bt-nav-bg)", borderBottom: "1px solid var(--color-bt-subtle-border)" }}
      >
        <button onClick={onBack} aria-label="Back" className="flex h-9 w-9 items-center justify-center">
          <ChevronLeft size={20} style={{ color: "var(--color-bt-text)" }} />
        </button>
        <div className="min-w-0 flex-1 text-center" style={{ marginRight: 36 }}>
          <div style={{ fontSize: 17, fontWeight: 600, color: "var(--color-bt-text)" }}>Configuration</div>
          <div style={{ fontSize: 13, color: "var(--color-bt-text-dim)" }}>{subtitle}</div>
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-5">
        {/* Zone 1 — IDENTITY (W-EDITMODAL-01): name (tap-to-edit) + assigned-to. */}
        {competitionId && (
          <GameIdentityHeader tripId={tripId} game={game} canEdit={canEdit} isOwner={isOwner} />
        )}

        {/* Same editors as the setup hull — reused, never rebuilt. */}
        <GameSetupRows
          tripId={tripId}
          competitionId={competitionId}
          game={game}
          canEdit={canEdit}
          onChanged={onChanged}
        />
        {onEditWhosPlaying && (
          <button
            type="button"
            onClick={onEditWhosPlaying}
            disabled={!canEdit}
            className="mt-2 flex w-full items-center justify-between gap-3 rounded-xl px-3.5 py-3 text-left disabled:opacity-60"
            style={{ background: "var(--color-bt-card)", border: "1px solid var(--color-bt-border)" }}
          >
            <div className="flex min-w-0 flex-col">
              <span className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: "var(--color-bt-text-dim)" }}>
                Who&rsquo;s playing · Handicaps
              </span>
              <span className="truncate text-sm" style={{ color: "var(--color-bt-text)", marginTop: 2 }}>{whosPlayingLabel}</span>
            </div>
            <ChevronRight size={16} style={{ color: "var(--color-bt-text-dim)", flexShrink: 0 }} />
          </button>
        )}

        {/* Optional extra drill-down rows (e.g. stroke's Modifiers). */}
        {extraRows}

        {/* Zone 3 — RULES note (W-EDITMODAL-01): saves on blur (no Save&exit here —
            the back arrow navigates; the blur commit is the flush). */}
        {competitionId && <GameRulesNote tripId={tripId} game={game} canEdit={canEdit} />}

        {/* The single Setup / Scoring toggle — the one game-mode control (it retired
            the old Enabled/Disabled segmented control). Owner/delegate only. */}
        {canEdit && (
          <div className="mt-6">
            <GameManagementPanel
              mode={scoringEnabled ? "scoring" : "setup"}
              ready={ready}
              onEnable={onEnable}
              onDisable={onDisable}
              pending={busy}
            />
          </div>
        )}

        {/* Per-game danger zone — owner-only (reset scores → reset settings →
            delete), reusing the shared confirm vocabulary + the Phase A resets. */}
        {isOwner && (
          <GameDangerZone
            tripId={tripId}
            gameId={game.id}
            competitionId={competitionId}
            status={game.status as string | null | undefined}
            onChanged={onChanged}
            onDeleted={onDeleted}
          />
        )}
      </div>
    </div>
  );
}
