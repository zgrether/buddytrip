"use client";

import type { ReactNode } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { GameSetupRows } from "@/components/games/GameSetupRows";
import { GameDangerZone } from "@/components/games/GameDangerZone";
import { GameManagementPanel } from "@/components/games/GameManagementPanel";
import { GameIdentityHeader } from "@/components/games/GameIdentityHeader";
import { GameRulesNote } from "@/components/games/GameRulesNote";
import { GameFormatExplainer } from "@/components/games/GameFormatExplainer";
import { ZoneHeader } from "@/components/games/ZoneHeader";
import { SettingsColumn } from "@/components/games/SettingsColumn";
import type { GameRow } from "@/components/competition/CompetitionGamesPanel";
import type { PointsDistribution } from "@/lib/pointsDistribution";

/**
 * The ONE game settings page (A2-ux correction) — the single home for ALL golf setup
 * (rack + stroke; match renders its checklist inline, non-golf has its own view). It
 * holds the redesigned checklist (`GameSetupRows` + per-format drill-downs + an optional
 * `extraRows` slot), the single **Setup / Scoring** toggle (`GameManagementPanel`), and
 * the Danger Zone. Reached via the corner settings GEAR.
 *
 * FULLY CONTROLLED (draft-then-save, P2): the page owns ONE draft that only commits on
 * Save. Every row is controlled off it (identity / rules / course / points), there is NO
 * scoring-enabled lock (the RPC refuses only the genuinely-destructive change on a scored
 * game — rack's groupings / stroke's course), the toggle stages into the draft, the
 * Danger Zone alone reads the LIVE server flag (reset is immediate surgery), and the
 * shared `saveBar` sits at the top. (The pre-P2 self-persisting "legacy" mode was removed
 * once rack + stroke — its only callers — both converted.)
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
  defaultPointsTotal,
  pointsRowTitle,
  ready = true,
  onEnable,
  onDisable,
  busy,
  hideHeader = false,
  serverScoringEnabled,
  draftScoringEnabled,
  nameValue,
  onNameChange,
  delegateValue,
  onDelegateChange,
  rulesValue,
  onRulesChange,
  onApplyFront,
  onApplyBack,
  onRemoveBackNine,
  onClearCourse,
  courseBusy,
  rackPoints,
  placementPoints,
  saveBar,
}: {
  subtitle: string;
  onBack: () => void;
  tripId: string;
  competitionId: string | null;
  game: GameRow;
  canEdit: boolean;
  /** Owner gates the per-game danger zone (reset/delete) — owner-only, matching the
   *  server. Co-admins/delegates configure but don't get the danger ladder. */
  isOwner: boolean;
  onChanged: () => void;
  /** Game deleted from the danger zone — leave the page (back to the board). */
  onDeleted: () => void;
  /** Summary + drill-down into the format's who's-playing/handicaps editor. Omit when
   *  the format has no post-create roster editor. */
  whosPlayingLabel?: string;
  onEditWhosPlaying?: () => void;
  /** Format-specific rows at the TOP of the Settings section, before Course/Points
   *  (rack's GROUPINGS). Additive — every other format omits it. */
  leadingSettingsRows?: ReactNode;
  /** Extra setup rows below the who's-playing drill-down (stroke's Modifiers row). */
  extraRows?: ReactNode;
  /** Valid unit count for the Points row's "Total Points Available" readout (rack). */
  matchCount?: number;
  /** Total-points migration: the first-setup default for the owner-set `points_total`. */
  defaultPointsTotal?: number;
  /** Display-only override for the Points row title ("Points per Slot" for rack). */
  pointsRowTitle?: string;
  /** Minimum requirements met — gates the toggle's Scoring segment. */
  ready?: boolean;
  onEnable: () => void;
  onDisable: () => void;
  busy: boolean;
  /** #550: hide the view's own header — as a panel the app bar carries back/title. */
  hideHeader?: boolean;
  /** The LIVE server flag — the Danger Zone + the toggle's `staged` read it. The ROWS
   *  read the draft, never this. */
  serverScoringEnabled: boolean;
  /** The drafted scoring flag — drives the toggle's active segment; Save commits it. */
  draftScoringEnabled: boolean;
  nameValue: string;
  onNameChange: (next: string) => void;
  delegateValue: string | null;
  onDelegateChange: (next: string | null) => void;
  rulesValue: string | null;
  onRulesChange: (next: string) => void;
  /** Course ACTION controlled props (threaded to GameSetupRows → CourseRowContent). */
  onApplyFront: (courseId: string, teeName?: string) => void;
  onApplyBack: (backCourseId: string, backTeeName?: string) => void;
  onRemoveBackNine: () => void;
  onClearCourse: () => void;
  courseBusy: boolean;
  /** Rack's Total-Points stepper controlled hook (reports the total). Rack passes this;
   *  placement formats (stroke) pass `placementPoints` instead. */
  rackPoints?: { value: number | null; onChange: (total: number) => void };
  /** Placement (stroke) points controlled hook — the total + distribution PAIR. */
  placementPoints?: {
    value: { total: number | null; distribution: PointsDistribution | null };
    onChange: (total: number | null, distribution: PointsDistribution | null) => void;
  };
  /** The shared SettingsSaveBar, rendered at the top of the column. */
  saveBar: ReactNode;
}) {
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
        <SettingsColumn>
          {/* Save bar at the TOP — every row below is a draft edit. */}
          {saveBar}

          {/* IDENTITY: name (tap-to-edit) + assigned-to — draft slices. */}
          {competitionId && (
            <GameIdentityHeader
              tripId={tripId}
              canEdit={canEdit}
              isOwner={isOwner}
              nameValue={nameValue}
              onNameChange={onNameChange}
              delegateValue={delegateValue}
              onDelegateChange={onDelegateChange}
            />
          )}

          {/* Format explainer — the compact "how you compete" block above Rules. */}
          {competitionId && (
            <div className="mt-6">
              <GameFormatExplainer gameTypeId={game.game_type_id} variant="settings" />
            </div>
          )}

          {/* RULES OF THE DAY — at the TOP; a draft slice. */}
          {competitionId && (
            <GameRulesNote canEdit={canEdit} value={rulesValue ?? ""} onChange={onRulesChange} />
          )}

          {/* GAME MANAGEMENT — the single Setup/Scoring toggle (owner/delegate only). The
              toggle stages into the draft (`staged` = draft ≠ server). */}
          {canEdit && (
            <>
              <ZoneHeader>Game Management</ZoneHeader>
              <GameManagementPanel
                mode={draftScoringEnabled ? "scoring" : "setup"}
                ready={ready}
                onEnable={onEnable}
                onDisable={onDisable}
                pending={busy}
                staged={draftScoringEnabled !== serverScoringEnabled}
              />
            </>
          )}

          {/* SETTINGS — the required spine: Course + Format·Points (GameSetupRows). */}
          <ZoneHeader>Settings</ZoneHeader>
          {/* Format-specific leading rows (rack's GROUPINGS) sit ABOVE the shared spine. */}
          {leadingSettingsRows}
          <GameSetupRows
            tripId={tripId}
            competitionId={competitionId}
            game={game}
            canEdit={canEdit}
            locked={false}
            onChanged={onChanged}
            matchCount={matchCount}
            defaultTotal={defaultPointsTotal}
            pointsTitle={pointsRowTitle}
            // Course ACTIONS stage into the draft; points report up (rack stepper / placement panel).
            onApplyFront={onApplyFront}
            onApplyBack={onApplyBack}
            onRemoveBackNine={onRemoveBackNine}
            onClearCourse={onClearCourse}
            courseBusy={courseBusy}
            rackPoints={rackPoints}
            placementPoints={placementPoints}
          />

          {/* OPTIONS — Who's playing · Handicaps + any extra rows (stroke's Modifiers). */}
          {(onEditWhosPlaying || extraRows) && (
            <>
              <ZoneHeader>Options</ZoneHeader>
              {onEditWhosPlaying && (
                <button
                  type="button"
                  onClick={onEditWhosPlaying}
                  disabled={!canEdit}
                  className="flex w-full items-center justify-between gap-3 rounded-xl px-3.5 py-3 text-left disabled:opacity-60"
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
              {extraRows}
            </>
          )}

          {/* Per-game danger zone — owner-only. `disabled` reads the LIVE server flag
              (reset-scores is immediate surgery, must not unlock off a staged toggle) —
              the one deliberate server read on this controlled page. */}
          {isOwner && (
            <GameDangerZone
              tripId={tripId}
              gameId={game.id}
              competitionId={competitionId}
              onChanged={onChanged}
              onDeleted={onDeleted}
              disabled={serverScoringEnabled}
            />
          )}
        </SettingsColumn>
      </div>
    </div>
  );
}
