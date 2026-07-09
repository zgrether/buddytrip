"use client";

import { ChevronLeft, ChevronRight, Lock } from "lucide-react";
import { GameSetupRows } from "@/components/games/GameSetupRows";
import { GameDangerZone } from "@/components/games/GameDangerZone";
import { GameManagementPanel } from "@/components/games/GameManagementPanel";
import { GameIdentityHeader } from "@/components/games/GameIdentityHeader";
import { GameRulesNote } from "@/components/games/GameRulesNote";
import { GameFormatExplainer } from "@/components/games/GameFormatExplainer";
import { ScoringLockBanner } from "@/components/games/ScoringLockBanner";
import { ZoneHeader } from "@/components/games/ZoneHeader";
import { SettingsColumn } from "@/components/games/SettingsColumn";
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
  leadingSettingsRows,
  extraRows,
  matchCount,
  pointsRowTitle,
  scoringEnabled,
  ready = true,
  onEnable,
  onDisable,
  busy,
  hideHeader = false,
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
  /** Format-specific rows rendered at the TOP of the Settings section, before
   *  Course/Points (rack's GROUPINGS + Handicaps checklist rows). Additive — every
   *  other format omits it. */
  leadingSettingsRows?: React.ReactNode;
  /** Extra setup rows below the who's-playing drill-down (e.g. the stroke
   *  Modifiers row). The match page renders its full checklist inline, so this is
   *  only for the GameSetupRows-based formats that need one more drill-down. */
  extraRows?: React.ReactNode;
  /** Valid unit count for the Points row's "Total Points Available" readout
   *  (points × count). Rack passes its slot count so the total isn't stuck at 0;
   *  omitted by formats that don't build units (stroke → no Total shown). */
  matchCount?: number;
  /** Display-only override for the Points row title (rack shows "Points per Slot"
   *  since a rack slot isn't obviously a "match"). The underlying `per_match`
   *  field is UNCHANGED — label only. Defaults to "Points Per Match". */
  pointsRowTitle?: string;
  scoringEnabled: boolean;
  /** Minimum requirements met — gates the toggle's Scoring segment. Formats with
   *  no hard readiness gate (stroke/rack) leave it at the default `true`. */
  ready?: boolean;
  onEnable: () => void;
  onDisable: () => void;
  busy: boolean;
  /** #550: hide the view's own header — as a panel the app bar carries back/title.
   *  Standalone route (no bar) keeps it. Also fills the panel height instead of
   *  forcing 100vh (avoids a spurious scroll). */
  hideHeader?: boolean;
}) {
  // #501: in scoring mode game-altering settings freeze. `settingsEditable` gates
  // every game-altering editor (course/points/who's-playing/handicaps/modifiers);
  // Rules of the Day keeps plain `canEdit` (the carved-out exception), the toggle
  // stays active (the path back to Setup), and the Danger Zone disables wholesale.
  const settingsEditable = canEdit && !scoringEnabled;
  return (
    <div className={`flex flex-col ${hideHeader ? "h-full" : "min-h-screen"}`} style={{ background: "var(--color-bt-base)" }}>
      {!hideHeader && (
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
      )}

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-5">
        {/* Stroke + rack now follow the canonical cleaned ORDER (Spec 7 — same
            family as the match/non-golf settings): identity → explainer → Rules
            (top) → Game Management → grouped Settings / Options → Danger Zone. Each
            format keeps its real rows (stroke's teamless net-total; rack's
            HandicapRoster + course); only the ordering + ZoneHeader grouping change.
            Section grouping reuses the shared ZoneHeader (Spec 6).

            Spacing is owned by SettingsColumn (one home): a uniform gap between
            every header + row, so no section is cramped and no rows sit flush —
            the SAME rule the match checklist uses. Rows carry NO margin of their
            own. */}
        <SettingsColumn>
          {/* IDENTITY (W-EDITMODAL-01): name (tap-to-edit) + assigned-to. */}
          {competitionId && (
            <GameIdentityHeader tripId={tripId} game={game} canEdit={canEdit} isOwner={isOwner} />
          )}

          {/* Format explainer — the compact "how you compete" block that pairs
              directly ABOVE Rules (the slot reserved for it). The extra mt-6 gives
              it a larger break under the identity header (matches the match page). */}
          {competitionId && (
            <div className="mt-6">
              <GameFormatExplainer gameTypeId={game.game_type_id} variant="settings" />
            </div>
          )}

          {/* RULES OF THE DAY — at the TOP (matching canonical). Saves on blur (no
              Save&exit — the back arrow navigates; the blur commit is the flush); the
              carved-out exception keeps it editable in scoring mode (plain canEdit). */}
          {competitionId && <GameRulesNote tripId={tripId} game={game} canEdit={canEdit} />}

          {/* GAME MANAGEMENT — a labeled peer section + the single Setup/Scoring toggle
              (owner/delegate only). The ZoneHeader supplies the caption, so the panel's
              own caption is suppressed (hideLabel) — matching canonical. */}
          {canEdit && (
            <>
              <ZoneHeader>Game Management</ZoneHeader>
              <GameManagementPanel
                mode={scoringEnabled ? "scoring" : "setup"}
                ready={ready}
                onEnable={onEnable}
                onDisable={onDisable}
                pending={busy}
                hideLabel
              />
            </>
          )}

          {/* #501: live-game lock banner — the settings below freeze until the owner/
              delegate flips the toggle above back to Setup (after the toggle, canonical). */}
          {scoringEnabled && canEdit && <ScoringLockBanner />}

          {/* SETTINGS — the required spine: Course + Format·Points (GameSetupRows).
              Same editors as the setup hull, reused (never rebuilt); the accordion
              drill-downs inherit the continuous-panel / no-under-header-divider /
              scroll-into-view treatment from the shared ChecklistRow. */}
          <ZoneHeader>Settings</ZoneHeader>
          {/* Format-specific leading rows (rack's GROUPINGS) sit ABOVE the shared
              Course/Points spine as the first Settings items — a plain fragment so
              its rows join the column's uniform gap. */}
          {leadingSettingsRows}
          <GameSetupRows
            tripId={tripId}
            competitionId={competitionId}
            game={game}
            canEdit={settingsEditable}
            locked={scoringEnabled}
            onChanged={onChanged}
            matchCount={matchCount}
            pointsTitle={pointsRowTitle}
          />

          {/* OPTIONS — the optional layer: Who's playing · Handicaps (stroke's
              per-player strokes / rack's HandicapRoster) + any extra rows (stroke's
              Modifiers). Rendered only when the format supplies one of them. */}
          {(onEditWhosPlaying || extraRows) && (
            <>
              <ZoneHeader>Options</ZoneHeader>
              {onEditWhosPlaying && (
                <button
                  type="button"
                  onClick={onEditWhosPlaying}
                  disabled={!settingsEditable}
                  // #512 Option B: when live-locked, dim + swap the chevron for a lock icon.
                  className="flex w-full items-center justify-between gap-3 rounded-xl px-3.5 py-3 text-left disabled:opacity-60"
                  style={{ background: "var(--color-bt-card)", border: "1px solid var(--color-bt-border)", opacity: scoringEnabled ? 0.55 : undefined }}
                >
                  <div className="flex min-w-0 flex-col">
                    <span className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: "var(--color-bt-text-dim)" }}>
                      Who&rsquo;s playing · Handicaps
                    </span>
                    <span className="truncate text-sm" style={{ color: "var(--color-bt-text)", marginTop: 2 }}>{whosPlayingLabel}</span>
                  </div>
                  {scoringEnabled
                    ? <Lock size={15} style={{ color: "var(--color-bt-text-dim)", flexShrink: 0 }} />
                    : <ChevronRight size={16} style={{ color: "var(--color-bt-text-dim)", flexShrink: 0 }} />}
                </button>
              )}
              {extraRows}
            </>
          )}

          {/* Per-game danger zone — owner-only (reset scores → reset settings →
              delete), reusing the shared confirm vocabulary + the Phase A resets.
              Dimmed-header + disabled wholesale in scoring mode (shared treatment). */}
          {isOwner && (
            <GameDangerZone
              tripId={tripId}
              gameId={game.id}
              competitionId={competitionId}
              onChanged={onChanged}
              onDeleted={onDeleted}
              disabled={scoringEnabled}
            />
          )}
        </SettingsColumn>
      </div>
    </div>
  );
}
