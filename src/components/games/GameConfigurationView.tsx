"use client";

import type { ReactNode } from "react";
import { ChevronRight } from "lucide-react";
import { GameSetupRows } from "@/components/games/GameSetupRows";
import { GameDangerZone } from "@/components/games/GameDangerZone";
import { GameManagementPanel } from "@/components/games/GameManagementPanel";
import { GameIdentityHeader } from "@/components/games/GameIdentityHeader";
import { GameRulesNote } from "@/components/games/GameRulesNote";
import { GameFormatExplainer } from "@/components/games/GameFormatExplainer";
import { ZoneHeader } from "@/components/games/ZoneHeader";
import { SettingsColumn } from "@/components/games/SettingsColumn";
import { SettingsSlideOver } from "@/components/games/SettingsSlideOver";
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
  settingsZoneLabel = "Settings",
  leadingSettingsRows,
  extraRows,
  modifiersRow,
  matchCount,
  defaultPointsTotal,
  pointsRowTitle,
  ready = true,
  onEnable,
  onDisable,
  busy,
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
  /** The SETTINGS zone header label. Defaults to "Settings" (rack). Stroke passes
   *  "Group Settings" (P3) — its zone holds Point Distribution + Groupings + Handicaps,
   *  mirroring match play's single settings zone. */
  settingsZoneLabel?: string;
  /** Format-specific rows leading the SETTINGS section (rack's GROUPINGS; stroke's Point
   *  Distribution + Groupings). Since Phase 2 moved Course/Points up into GAME MANAGEMENT,
   *  this is now the FIRST content in SETTINGS. Additive — every other format omits it. */
  leadingSettingsRows?: ReactNode;
  /** Extra SETTINGS rows after `leadingSettingsRows` (rack's Handicaps row) — Phase 2
   *  relocated these here from the deleted OPTIONS zone, so rack's SETTINGS reads
   *  Groupings → Handicaps, still BEFORE Rules Of The Day (Match Play's
   *  Handicaps-before-Rules order). NOT for Game Modifiers — use `modifiersRow`. */
  extraRows?: ReactNode;
  /** Game Modifiers row (stroke only — rack has none, Phase 0 confirmed). Rendered
   *  AFTER Rules Of The Day, matching Match Play's canonical order (Rules before
   *  Modifiers) — kept separate from `extraRows` because the two formats that use
   *  this component need different relative positions for their "extra" content. */
  modifiersRow?: ReactNode;
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
  // Phase 2 topology: the Total-Points and Golf-Course rows move UP into GAME
  // MANAGEMENT, in that order. GameSetupRows' own "both" order is Course-then-Points,
  // so we render it in two SLOTS ("config" = Points, "course" = Course) to get the
  // canonical Total Points → Golf Course sequence. Shared props once, spread into both.
  const setupRowsProps = {
    tripId,
    competitionId,
    game,
    canEdit,
    locked: false,
    onChanged,
    matchCount,
    defaultTotal: defaultPointsTotal,
    pointsTitle: pointsRowTitle,
    // Course ACTIONS stage into the draft; points report up (rack stepper / placement panel).
    onApplyFront,
    onApplyBack,
    onRemoveBackNine,
    onClearCourse,
    courseBusy,
    rackPoints,
    placementPoints,
  };
  return (
    <SettingsSlideOver
      title={nameValue || "Game settings"}
      onClose={onBack}
      footer={saveBar}
      testId="game-settings-slideover"
    >
        <SettingsColumn>

          {/* Format explainer — "HOW YOU COMPETE" — leads the page, above the identity
              header: it frames the whole game before any settings (cross-format layout
              consistency pass; matches Match Play's canonical order). */}
          {competitionId && (
            <div className="mb-2">
              <GameFormatExplainer gameTypeId={game.game_type_id} variant="settings" />
            </div>
          )}

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

          {/* RULES OF THE DAY moved to the BOTTOM (after Settings/Options, before
              Modifiers + Danger Zone) — see below, matching Match Play's canonical
              order (cross-format layout consistency pass). */}

          {/* GAME MANAGEMENT (Phase 2 canonical order): Total Points (1st) → Golf Course
              (2nd) → Game State (3rd). Points + Course moved UP here from the old SETTINGS
              zone; the Setup/Scoring toggle (owner/delegate only) is the third, staging
              into the draft (`staged` = draft ≠ server). */}
          <ZoneHeader>Game Management</ZoneHeader>
          {/* Total Points (1st) — competition-scoped (rack stepper / stroke placement panel). */}
          {competitionId && <GameSetupRows {...setupRowsProps} slot="config" />}
          {/* Golf Course (2nd). */}
          <GameSetupRows {...setupRowsProps} slot="course" />
          {/* Game State (3rd) — the single Setup/Scoring toggle. */}
          {canEdit && (
            <GameManagementPanel
              mode={draftScoringEnabled ? "scoring" : "setup"}
              ready={ready}
              onEnable={onEnable}
              onDisable={onDisable}
              pending={busy}
              staged={draftScoringEnabled !== serverScoringEnabled}
            />
          )}

          {/* SETTINGS (Phase 2) — format-specific rows only: rack's GROUPINGS
              (`leadingSettingsRows`) + Handicaps (`extraRows`, moved here from the DELETED
              OPTIONS zone). Rendered only when a format supplies content — stroke has none
              here yet (its GROUP SETTINGS restructure is Phase 3). */}
          {(leadingSettingsRows || extraRows) && (
            <>
              <ZoneHeader>{settingsZoneLabel}</ZoneHeader>
              {leadingSettingsRows}
              {extraRows}
            </>
          )}

          {/* OPTIONS — the Who's-playing · Handicaps drill-down (stroke only). Rack has no
              such drill-down; its Handicaps ride `extraRows` in SETTINGS above, so this
              zone renders only when a format supplies the drill-down. */}
          {onEditWhosPlaying && (
            <>
              <ZoneHeader>Options</ZoneHeader>
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
            </>
          )}

          {/* RULES OF THE DAY — relocated to the BOTTOM (after Settings/Options, before
              Modifiers): a draft slice, QUIET tier (free-text, can't rescore a hole), so
              it reads before the WARNED Modifiers accordion — matching Match Play's
              canonical order (cross-format layout consistency pass). */}
          {competitionId && (
            <GameRulesNote canEdit={canEdit} value={rulesValue ?? ""} onChange={onRulesChange} />
          )}

          {/* Game Modifiers — stroke only (rack has none, Phase 0 confirmed). Sits AFTER
              Rules Of The Day, matching Match Play's order. */}
          {modifiersRow}

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
    </SettingsSlideOver>
  );
}
