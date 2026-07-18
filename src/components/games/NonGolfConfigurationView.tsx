"use client";

import { useState, type ReactNode } from "react";
import { ChevronRight } from "lucide-react";
import { GameDangerZone } from "@/components/games/GameDangerZone";
import { GameManagementPanel } from "@/components/games/GameManagementPanel";
import { GameIdentityHeader } from "@/components/games/GameIdentityHeader";
import { GameRulesNote } from "@/components/games/GameRulesNote";
import { GameFormatExplainer } from "@/components/games/GameFormatExplainer";
import { FormatPointsPanel } from "@/components/games/FormatPointsPanel";
import { ZoneHeader } from "@/components/games/ZoneHeader";
import { SettingsColumn } from "@/components/games/SettingsColumn";
import { SettingsSlideOver } from "@/components/games/SettingsSlideOver";
import {
  PointStepper,
  FormatSheet,
  formatLabel,
  fmtValue,
  type GameRow,
} from "@/components/competition/CompetitionGamesPanel";
import type { ScoringModel } from "@/lib/gameTypes";
import type { NonGolfConfigDraft, CompetitionFormat } from "@/lib/configDraft";
import type { PointsDistribution } from "@/lib/pointsDistribution";

/**
 * NonGolfConfigurationView (W-NONGOLF lifecycle surface) — the non-golf twin of
 * golf's `GameConfigurationView`: the ONE settings home, reached by the corner
 * gear, carrying the mode toggle + Danger Zone. It mirrors the cleaned golf ORDER
 * (Phase 2 topology): explainer → identity → **Game Management** (Total Points →
 * Game State) → **Settings** (Competition Format) → **Rules** → Danger Zone — same
 * grouping + treatment, but a **LEAN payload**:
 * only what non-golf needs, no golf cruft (no Matches / Course / Handicaps /
 * Modifiers):
 *
 *  - **competition_format** (its real home now — drives future matchup/bracket dev),
 *  - by the competition's `scoring_model`:
 *      - **match_play** → a single game-value stepper (the points for the one
 *        Team-A-vs-B match; win = N, draw = split). It feeds the EXISTING
 *        win/lose/tie path via `games.points_total` — no second mechanism.
 *      - **points** → the two points sections (value + placement split), reusing
 *        `FormatPointsPanel` (its manual branch is exactly the placement editor),
 *  - **Rules of the Day**, the **Setup/Scoring** toggle, the **Danger Zone**.
 */
export function NonGolfConfigurationView({
  onBack,
  tripId,
  competitionId,
  game,
  scoringModel,
  canEdit,
  isOwner,
  onChanged,
  onDeleted,
  draft,
  onNameChange,
  onRulesChange,
  onDelegatesChange,
  onFormatChange,
  onPointsTotalChange,
  onPointsDistChange,
  serverScoringEnabled,
  ready,
  onEnable,
  onDisable,
  saving,
  saveBar,
}: {
  onBack: () => void;
  tripId: string;
  competitionId: string;
  game: GameRow;
  scoringModel: ScoringModel;
  canEdit: boolean;
  isOwner: boolean;
  /** Server-direct refresh after a Danger-Zone action (reset/delete) — NOT a draft edit. */
  onChanged: () => void;
  onDeleted: () => void;
  /** Draft-then-save (P2): the whole page is controlled off this composite draft; the
   *  parent (NonGolfGameView) owns it + commits via ONE atomic save_game_config. */
  draft: NonGolfConfigDraft;
  onNameChange: (name: string) => void;
  onRulesChange: (rules: string) => void;
  onDelegatesChange: (delegates: string[]) => void;
  onFormatChange: (format: CompetitionFormat | null) => void;
  onPointsTotalChange: (total: number | null) => void;
  onPointsDistChange: (dist: PointsDistribution | null) => void;
  /** The LIVE server flag — the toggle reads the DRAFT (`draft.scoringEnabled`) and
   *  `staged` is draft ≠ this, so the subtitle never claims a state the server lacks. */
  serverScoringEnabled: boolean;
  ready: boolean;
  onEnable: () => void;
  onDisable: () => void;
  saving: boolean;
  /** The shared SettingsSaveBar, rendered at the top of the column. */
  saveBar: ReactNode;
}) {
  // NO settingsEditable / NO locks (P2 lie sweep): non-golf has no destroys-tier setting,
  // so every row stays editable in every mode — an edit stages into the draft and Save
  // commits it (the RPC refuses nothing for non-golf). `canEdit` is the only gate (role),
  // never scoring_enabled. `ScoringLockBanner` is gone; the format-row/points dimming and
  // the `settingsEditable` freeze are gone with it.
  const staged = draft.scoringEnabled !== serverScoringEnabled;
  return (
    <SettingsSlideOver
      title={draft.name || "Game settings"}
      onClose={onBack}
      footer={saveBar}
      testId="game-settings-slideover"
    >
        <SettingsColumn>

          {/* Format explainer — "HOW YOU COMPETE" — leads the page, above the identity
              header (cross-format layout consistency pass; matches Match Play's
              canonical order). */}
          <div className="mb-2">
            <GameFormatExplainer gameTypeId={game.game_type_id} variant="settings" />
          </div>

          {/* Identity — controlled: name + assigned-to are draft slices now. */}
          <GameIdentityHeader
            tripId={tripId}
            canEdit={canEdit}
            isOwner={isOwner}
            nameValue={draft.name}
            onNameChange={onNameChange}
            delegateValue={draft.delegates[0] ?? null}
            onDelegateChange={(next) => onDelegatesChange(next ? [next] : [])}
          />

          {/* RULES OF THE DAY moved to the BOTTOM (after Settings) — see below,
              matching Match Play's canonical order (cross-format layout consistency
              pass). */}

          {/* GAME MANAGEMENT (Phase 2): Total Points (1st) → Game State (2nd). Non-golf
              has no course, so the canonical trio is just these two. Points moved UP from
              the old SETTINGS zone. (The full points-panel redesign is Phase 4.) */}
          <ZoneHeader>Game Management</ZoneHeader>
          {/* Total Points (1st) — by scoring model: a single match value, or the
              value + placement split. */}
          {scoringModel === "match_play" ? (
            <MatchValueStepper value={draft.pointsTotal} canEdit={canEdit} onChange={onPointsTotalChange} />
          ) : (
            <FormatPointsPanel
              game={game}
              canEdit={canEdit}
              // Non-golf has no outer "Total Points" ChecklistRow (unlike Stroke, which
              // wraps this same panel) — this panel's own label IS the points row's
              // title here, so it's set explicitly for cross-format consistency.
              pointsLabel="Total Points"
              controlled={{
                value: { total: draft.pointsTotal, distribution: draft.pointsDistribution },
                onChange: (t, d) => { onPointsTotalChange(t); onPointsDistChange(d); },
              }}
            />
          )}
          {/* Game State (2nd) — the Setup/Scoring toggle (owner/delegate only). */}
          {canEdit && (
            <GameManagementPanel
              mode={draft.scoringEnabled ? "scoring" : "setup"}
              ready={ready}
              onEnable={onEnable}
              onDisable={onDisable}
              pending={saving}
              staged={staged}
            />
          )}

          {/* SETTINGS — Competition Format (Quiet: recalculates nothing). Points moved to
              GAME MANAGEMENT above (Phase 2). Editable in every mode; no dimming, no lock. */}
          <ZoneHeader>Settings</ZoneHeader>
          <CompetitionFormatRow value={draft.competitionFormat} canEdit={canEdit} onChange={onFormatChange} />

          {/* RULES OF THE DAY — relocated to the BOTTOM (after Settings): a draft slice,
              QUIET tier — matching Match Play's canonical order (cross-format layout
              consistency pass). */}
          <GameRulesNote
            canEdit={canEdit}
            value={draft.rulesForToday ?? ""}
            onChange={onRulesChange}
          />

          {/* Danger Zone — owner-only. Its `disabled` is the ONE deliberate SERVER read
              (not the draft): reset-scores is immediate surgery and must not unlock off a
              staged toggle. Everything else on this page follows the draft. */}
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

/** Competition-format picker row — CONTROLLED (P2 draft): opens the shared `FormatSheet`
 *  and reports the pick to the parent draft. No persistence, no lock (Quiet tier). */
function CompetitionFormatRow({
  value, canEdit, onChange,
}: {
  value: CompetitionFormat | null;
  canEdit: boolean;
  onChange: (format: CompetitionFormat | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const label = formatLabel(value);

  return (
    <>
      <button
        type="button"
        onClick={() => canEdit && setOpen(true)}
        disabled={!canEdit}
        className="flex w-full items-center justify-between gap-3 rounded-xl px-3.5 py-3 text-left disabled:opacity-60"
        style={{ background: "var(--color-bt-card)", border: "1px solid var(--color-bt-border)" }}
        data-testid="row-competition-format"
      >
        <div className="flex min-w-0 flex-col">
          <span className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: "var(--color-bt-text-dim)" }}>
            Competition format
          </span>
          <span className="truncate text-sm" style={{ color: label ? "var(--color-bt-text)" : "var(--color-bt-text-dim)", marginTop: 2 }}>
            {label ?? "Choose how it’s played"}
          </span>
        </div>
        <ChevronRight size={16} style={{ color: "var(--color-bt-text-dim)", flexShrink: 0 }} />
      </button>
      {open && (
        <FormatSheet
          current={value}
          onPick={(key) => { setOpen(false); onChange(key as CompetitionFormat); }}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}

/** The single-match game-value stepper (match_play scoring model) — CONTROLLED (P2
 *  draft): the points for the one Team-A-vs-B match (`games.points_total`, the value the
 *  leaderboard derives win/lose/tie from). Reports to the parent draft; Save persists. */
function MatchValueStepper({
  value: total, canEdit, onChange,
}: {
  value: number | null;
  canEdit: boolean;
  onChange: (total: number | null) => void;
}) {
  const value = total ?? 1;
  return (
    <PointStepper
      label="Total Points"
      caption="POINTS FOR THE MATCH"
      value={value}
      onChange={canEdit ? onChange : () => {}}
      footer={
        <div className="flex items-center justify-between">
          <span className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: "var(--color-bt-text-dim)" }}>
            Win / Draw
          </span>
          <span className="text-sm font-semibold tabular-nums" style={{ color: "var(--color-bt-text)" }}>
            Win {fmtValue(value)} · Draw {fmtValue(value / 2)} each
          </span>
        </div>
      }
    />
  );
}
