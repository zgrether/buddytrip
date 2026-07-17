"use client";

import type { ReactNode } from "react";
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
 * (`GameManagementPanel`), and the Danger Zone. Reached via the corner settings GEAR.
 *
 * TWO MODES, selected by the EXPLICIT `controlled` discriminant (never inferred from
 * whether draft props happen to be present):
 *
 *  - **Legacy** (`controlled` omitted — stroke, until its P2 phase): rows self-persist,
 *    and game-altering editors FREEZE in scoring mode (`scoringEnabled` locks them,
 *    `ScoringLockBanner` explains). The original A2 behavior.
 *  - **Controlled** (`controlled: true` — rack, P2): the page owns ONE draft that only
 *    commits on Save. Every row is controlled off it (identity/rules/course/points), the
 *    lie-sweep is GONE (no `scoringEnabled` lock, no banner — the RPC refuses only the
 *    genuinely-destructive structural change on a scored game), the toggle stages into
 *    the draft, the Danger Zone alone still reads the LIVE server flag (reset is immediate
 *    surgery), and the shared `saveBar` sits at the top.
 */
type BaseProps = {
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
  /** Extra setup rows below the who's-playing drill-down (stroke's Modifiers row / rack's
   *  Handicaps row). */
  extraRows?: ReactNode;
  /** Valid unit count for the Points row's "Total Points Available" readout. Rack passes
   *  its slot count so the total isn't stuck at 0. */
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
};

/** Legacy self-persisting mode (stroke): the rows lock when the game is live. */
type LegacyProps = BaseProps & {
  controlled?: false;
  scoringEnabled: boolean;
};

/** Controlled draft-then-save mode (rack): the whole page is one draft. */
type ControlledProps = BaseProps & {
  controlled: true;
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
  /** Course ACTION controlled props (threaded to GameSetupRows → CourseRowContent) —
   *  each stages into the page's course draft slice. */
  onApplyFront: (courseId: string, teeName?: string) => void;
  onApplyBack: (backCourseId: string, backTeeName?: string) => void;
  onRemoveBackNine: () => void;
  onClearCourse: () => void;
  courseBusy: boolean;
  /** The Total-Points stepper's controlled hook — reports the total to the rack draft. */
  rackPoints: { value: number | null; onChange: (total: number) => void };
  /** The shared SettingsSaveBar, rendered at the top of the column. */
  saveBar: ReactNode;
};

type GameConfigurationViewProps = LegacyProps | ControlledProps;

export function GameConfigurationView(props: GameConfigurationViewProps) {
  const {
    subtitle, onBack, tripId, competitionId, game, canEdit, isOwner, onChanged, onDeleted,
    whosPlayingLabel, onEditWhosPlaying, leadingSettingsRows, extraRows,
    matchCount, defaultPointsTotal, pointsRowTitle, ready = true, onEnable, onDisable, busy,
    hideHeader = false,
  } = props;

  // The live server flag drives the Danger Zone (immediate surgery) + the toggle's staged
  // read. The management toggle's ACTIVE segment reads the draft in controlled mode.
  const serverScoring = props.controlled ? props.serverScoringEnabled : props.scoringEnabled;
  const managementScoring = props.controlled ? props.draftScoringEnabled : props.scoringEnabled;
  // #501 lie-sweep: legacy freezes game-altering editors when live; controlled never does
  // (every editor stays editable — Save commits, and the RPC refuses only the genuinely
  // destructive structural change on a scored game).
  const settingsEditable = props.controlled ? canEdit : (canEdit && !props.scoringEnabled);
  const rowsLocked = props.controlled ? false : props.scoringEnabled;

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
          {/* Controlled: the Save bar sits at the TOP — every row below is a draft edit
              (matching the match / non-golf settings pages). */}
          {props.controlled && props.saveBar}

          {/* IDENTITY: name (tap-to-edit) + assigned-to. Controlled → draft slices. */}
          {competitionId && (
            props.controlled ? (
              <GameIdentityHeader
                tripId={tripId}
                game={game}
                canEdit={canEdit}
                isOwner={isOwner}
                nameValue={props.nameValue}
                onNameChange={props.onNameChange}
                delegateValue={props.delegateValue}
                onDelegateChange={props.onDelegateChange}
              />
            ) : (
              <GameIdentityHeader tripId={tripId} game={game} canEdit={canEdit} isOwner={isOwner} />
            )
          )}

          {/* Format explainer — the compact "how you compete" block above Rules. */}
          {competitionId && (
            <div className="mt-6">
              <GameFormatExplainer gameTypeId={game.game_type_id} variant="settings" />
            </div>
          )}

          {/* RULES OF THE DAY — at the TOP. Controlled → a draft slice; legacy → save-on-blur. */}
          {competitionId && (
            props.controlled ? (
              <GameRulesNote tripId={tripId} game={game} canEdit={canEdit} controlled value={props.rulesValue ?? ""} onChange={props.onRulesChange} />
            ) : (
              <GameRulesNote tripId={tripId} game={game} canEdit={canEdit} />
            )
          )}

          {/* GAME MANAGEMENT — the single Setup/Scoring toggle (owner/delegate only).
              Controlled → the toggle stages into the draft (`staged` = draft ≠ server). */}
          {canEdit && (
            <>
              <ZoneHeader>Game Management</ZoneHeader>
              <GameManagementPanel
                mode={managementScoring ? "scoring" : "setup"}
                ready={ready}
                onEnable={onEnable}
                onDisable={onDisable}
                pending={busy}
                staged={props.controlled ? props.draftScoringEnabled !== props.serverScoringEnabled : false}
              />
            </>
          )}

          {/* #501 live-game lock banner — LEGACY ONLY. Controlled has no lock, so no banner. */}
          {!props.controlled && props.scoringEnabled && canEdit && <ScoringLockBanner />}

          {/* SETTINGS — the required spine: Course + Format·Points (GameSetupRows). */}
          <ZoneHeader>Settings</ZoneHeader>
          {/* Format-specific leading rows (rack's GROUPINGS) sit ABOVE the shared spine. */}
          {leadingSettingsRows}
          {props.controlled ? (
            <GameSetupRows
              tripId={tripId}
              competitionId={competitionId}
              game={game}
              canEdit={settingsEditable}
              locked={rowsLocked}
              onChanged={onChanged}
              matchCount={matchCount}
              defaultTotal={defaultPointsTotal}
              pointsTitle={pointsRowTitle}
              // Course ACTIONS stage into the draft; the Total-Points stepper reports up.
              onApplyFront={props.onApplyFront}
              onApplyBack={props.onApplyBack}
              onRemoveBackNine={props.onRemoveBackNine}
              onClearCourse={props.onClearCourse}
              courseBusy={props.courseBusy}
              rackPoints={props.rackPoints}
            />
          ) : (
            <GameSetupRows
              tripId={tripId}
              competitionId={competitionId}
              game={game}
              canEdit={settingsEditable}
              locked={rowsLocked}
              onChanged={onChanged}
              matchCount={matchCount}
              defaultTotal={defaultPointsTotal}
              pointsTitle={pointsRowTitle}
            />
          )}

          {/* OPTIONS — Who's playing · Handicaps + any extra rows. */}
          {(onEditWhosPlaying || extraRows) && (
            <>
              <ZoneHeader>Options</ZoneHeader>
              {onEditWhosPlaying && (
                <button
                  type="button"
                  onClick={onEditWhosPlaying}
                  disabled={!settingsEditable}
                  // Legacy live-lock: dim + swap the chevron for a lock. Controlled never locks.
                  className="flex w-full items-center justify-between gap-3 rounded-xl px-3.5 py-3 text-left disabled:opacity-60"
                  style={{ background: "var(--color-bt-card)", border: "1px solid var(--color-bt-border)", opacity: rowsLocked ? 0.55 : undefined }}
                >
                  <div className="flex min-w-0 flex-col">
                    <span className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: "var(--color-bt-text-dim)" }}>
                      Who&rsquo;s playing · Handicaps
                    </span>
                    <span className="truncate text-sm" style={{ color: "var(--color-bt-text)", marginTop: 2 }}>{whosPlayingLabel}</span>
                  </div>
                  {rowsLocked
                    ? <Lock size={15} style={{ color: "var(--color-bt-text-dim)", flexShrink: 0 }} />
                    : <ChevronRight size={16} style={{ color: "var(--color-bt-text-dim)", flexShrink: 0 }} />}
                </button>
              )}
              {extraRows}
            </>
          )}

          {/* Per-game danger zone — owner-only. `disabled` reads the LIVE server flag in
              BOTH modes (reset-scores is immediate surgery and must not unlock off a staged
              toggle) — the one deliberate server read on the controlled page. */}
          {isOwner && (
            <GameDangerZone
              tripId={tripId}
              gameId={game.id}
              competitionId={competitionId}
              onChanged={onChanged}
              onDeleted={onDeleted}
              disabled={serverScoring}
            />
          )}
        </SettingsColumn>
      </div>
    </div>
  );
}
