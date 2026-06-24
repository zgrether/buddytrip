"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import { GameSetupRows } from "@/components/games/GameSetupRows";
import { GameDangerZone } from "@/components/games/GameDangerZone";
import type { GameRow } from "@/components/competition/CompetitionGamesPanel";

/**
 * §B Configuration page (Phase 2B.3) — the post-Enable home for editing. The
 * ONE genuinely new §B surface. Reached from the score-entry hub (top-right), it
 * holds the SAME field editors as the setup hull (reuses `GameSetupRows` +
 * per-format drill-downs) PLUS the **Enabled / Disabled** pressed-state control.
 *
 * Disable here = `scoring_enabled=false`, **scores kept**, and you keep
 * configuring RIGHT HERE — it is NOT a hub reverse-transform (the score-entry
 * hub never morphs backward; editing happens in Configuration). Re-Enable returns
 * to score entry. Vocabulary locked: Enabled / Disabled — never arm/open.
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
  scoringEnabled,
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
  scoringEnabled: boolean;
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

        {/* Enabled / Disabled — the pressed-state control. */}
        <div className="mt-6">
          <span className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: "var(--color-bt-text-dim)" }}>Scoring</span>
          <div
            className="mt-2 flex gap-1 rounded-xl p-1"
            style={{ background: "var(--color-bt-card-raised)", border: "1px solid var(--color-bt-border)" }}
          >
            <SegBtn label="Enabled" active={scoringEnabled} disabled={!canEdit || busy} onClick={scoringEnabled ? undefined : onEnable} />
            <SegBtn label="Disabled" active={!scoringEnabled} disabled={!canEdit || busy} onClick={scoringEnabled ? onDisable : undefined} />
          </div>
          <p className="mt-2 text-[12px] leading-relaxed" style={{ color: "var(--color-bt-text-dim)" }}>
            {scoringEnabled
              ? "Enabled — open to the crew for scoring. Disabling closes it and returns to setup; scores are kept."
              : "Disabled — closed to the crew. Keep configuring here; enable when you’re ready. Any scores already entered are kept."}
          </p>
        </div>

        {/* Per-game danger zone — owner-only (reset scores → reset settings →
            delete), reusing the shared confirm vocabulary + the Phase A resets. */}
        {isOwner && (
          <GameDangerZone
            tripId={tripId}
            gameId={game.id}
            competitionId={competitionId}
            onChanged={onChanged}
            onDeleted={onDeleted}
          />
        )}
      </div>
    </div>
  );
}

function SegBtn({ label, active, disabled, onClick }: { label: string; active: boolean; disabled?: boolean; onClick?: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled || !onClick}
      className="flex-1 rounded-lg py-2 text-sm font-semibold disabled:opacity-60"
      style={
        active
          ? { background: "var(--color-bt-accent)", color: "#0d1f1a" }
          : { background: "transparent", color: "var(--color-bt-text-dim)" }
      }
    >
      {label}
    </button>
  );
}
