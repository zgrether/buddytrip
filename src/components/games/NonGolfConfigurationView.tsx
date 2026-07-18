"use client";

import { useState, type ReactNode } from "react";
import { Check, Hash, Scale } from "lucide-react";
import { GameDangerZone } from "@/components/games/GameDangerZone";
import { GameManagementPanel } from "@/components/games/GameManagementPanel";
import { GameIdentityHeader } from "@/components/games/GameIdentityHeader";
import { GameRulesNote } from "@/components/games/GameRulesNote";
import { GameFormatExplainer } from "@/components/games/GameFormatExplainer";
import { FormatPointsPanel } from "@/components/games/FormatPointsPanel";
import { ChecklistRow } from "@/components/games/ChecklistRow";
import { Stepper } from "@/components/games/Stepper";
import { ZoneHeader } from "@/components/games/ZoneHeader";
import { SettingsColumn } from "@/components/games/SettingsColumn";
import { SettingsSlideOver } from "@/components/games/SettingsSlideOver";
import {
  COMP_FORMATS,
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
  // Single-open accordion for the SETTINGS panels (Competition Format dropdown / the
  // points-model Point Distribution).
  const [openAccordion, setOpenAccordion] = useState<null | "format" | "distribution">(null);
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

          {/* GAME MANAGEMENT: Total Points (1st) → Game State (2nd). Non-golf has no
              course, so the canonical trio is just these two. P4 standardized the Total
              Points row to the SAME ChecklistRow + inline stepper the golf formats use
              (was a bespoke PointStepper block). */}
          <ZoneHeader>Game Management</ZoneHeader>
          {/* Total Points (1st) — by scoring model: a single match value (win/draw), or
              the owner-set pool (the placement split is its own row in SETTINGS). */}
          {scoringModel === "match_play" ? (
            <MatchValueRow value={draft.pointsTotal} canEdit={canEdit} onChange={onPointsTotalChange} />
          ) : (
            <TotalPoolRow value={draft.pointsTotal} canEdit={canEdit} onChange={onPointsTotalChange} />
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

          {/* SETTINGS — Competition Format (an inline dropdown now, P4) + the points-model
              Point Distribution. Both Quiet/Warned; editable in every mode, no lock. */}
          <ZoneHeader>Settings</ZoneHeader>
          <CompetitionFormatDropdown
            value={draft.competitionFormat}
            canEdit={canEdit}
            onChange={onFormatChange}
            open={openAccordion === "format"}
            onToggle={() => setOpenAccordion((o) => (o === "format" ? null : "format"))}
          />
          {/* Point Distribution — points model only (the placement split). Match_play's
              single value carries no distribution. Reads its total from the DRAFT. */}
          {scoringModel === "points" && (
            <ChecklistRow
              icon={Scale}
              title="Point Distribution"
              subtitle={draft.pointsDistribution?.type === "placement" ? "Custom placement split — tap to edit" : "Even — tap to set a placement split"}
              state={draft.pointsDistribution?.type === "placement" ? "resolved" : "empty"}
              disabled={!canEdit}
              expanded={openAccordion === "distribution"}
              onToggle={() => setOpenAccordion((o) => (o === "distribution" ? null : "distribution"))}
              testId="row-point-distribution"
            >
              <FormatPointsPanel
                game={game}
                canEdit={canEdit}
                part="distribution"
                controlled={{
                  value: { total: draft.pointsTotal, distribution: draft.pointsDistribution },
                  onChange: (t, d) => { onPointsTotalChange(t); onPointsDistChange(d); },
                }}
              />
            </ChecklistRow>
          )}

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

/** Competition Format — an INLINE dropdown panel (P4; was the `FormatSheet` modal). Lists
 *  every format so the direction is legible, but only **Head-to-Head / Match** is
 *  selectable — the rest are disabled placeholders ("Soon") since their engines aren't
 *  built (DO-NOT: don't implement them). H2H is the DEFAULT: a null value displays as H2H
 *  selected (non-golf already runs as H2H when unset), so this reserves the shape without
 *  a creation-time write. CONTROLLED — reports the pick to the parent draft; Save persists. */
function CompetitionFormatDropdown({
  value, canEdit, onChange, open, onToggle,
}: {
  value: CompetitionFormat | null;
  canEdit: boolean;
  onChange: (format: CompetitionFormat | null) => void;
  open: boolean;
  onToggle: () => void;
}) {
  // H2H is the default — a null value reads as head_to_head (the only live option).
  const effective: CompetitionFormat = value ?? "head_to_head";
  const RowIcon = COMP_FORMATS.find((f) => f.key === effective)?.Icon ?? Hash;
  return (
    <ChecklistRow
      icon={RowIcon}
      title="Competition Format"
      subtitle={formatLabel(effective) ?? "Head-to-Head / Match"}
      state="resolved"
      disabled={!canEdit}
      expanded={open}
      onToggle={onToggle}
      testId="row-competition-format"
    >
      <div className="flex flex-col gap-1.5" data-testid="competition-format-options">
        {COMP_FORMATS.map((f) => {
          const enabled = f.key === "head_to_head";
          const selected = effective === f.key;
          return (
            <button
              key={f.key}
              type="button"
              disabled={!enabled || !canEdit}
              onClick={() => enabled && onChange(f.key as CompetitionFormat)}
              className="flex w-full items-start gap-3 rounded-xl px-3 py-3 text-left disabled:cursor-not-allowed"
              style={{
                background: selected ? "var(--color-bt-accent-faint)" : "var(--color-bt-card-raised)",
                border: `1px solid ${selected ? "var(--color-bt-accent-border)" : "var(--color-bt-border)"}`,
                opacity: enabled ? 1 : 0.5,
              }}
            >
              <f.Icon size={16} style={{ color: "var(--color-bt-accent)", flexShrink: 0, marginTop: 1 }} />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-semibold" style={{ color: "var(--color-bt-text)" }}>{f.label}</span>
                  {enabled
                    ? selected && <Check size={13} style={{ color: "var(--color-bt-accent)", marginLeft: "auto" }} />
                    : <span className="ml-auto rounded px-1 py-0.5 text-[9px] font-bold uppercase" style={{ background: "var(--color-bt-card)", color: "var(--color-bt-text-dim)", border: "1px solid var(--color-bt-border)" }}>Soon</span>}
                </div>
                <p className="mt-0.5 text-[11px]" style={{ color: "var(--color-bt-text-dim)" }}>{f.desc}</p>
              </div>
            </button>
          );
        })}
        <p className="px-1 pt-1 text-[11px] leading-relaxed" style={{ color: "var(--color-bt-text-dim)" }}>
          However it runs, you enter the result by hand — the other formats are coming.
        </p>
      </div>
    </ChecklistRow>
  );
}

/** Total Points — the single game value (match_play scoring model). Standard ChecklistRow
 *  + inline stepper (P4, matching the golf formats), with the win/draw derivation as the
 *  subtitle. CONTROLLED — reports `games.points_total` to the parent draft; Save persists. */
function MatchValueRow({
  value: total, canEdit, onChange,
}: {
  value: number | null;
  canEdit: boolean;
  onChange: (total: number | null) => void;
}) {
  const value = total ?? 1;
  return (
    <ChecklistRow
      icon={Hash}
      title="Total Points"
      subtitle={<>Win {fmtValue(value)} · Draw {fmtValue(value / 2)} each</>}
      state={value > 0 ? "resolved" : "empty"}
      disabled={!canEdit}
      testId="row-total-points"
      control={
        <Stepper
          size="inline"
          value={value}
          min={0}
          onChange={canEdit ? (v) => onChange(v) : () => {}}
          disabled={!canEdit}
          testId="total-points-stepper"
        />
      }
    />
  );
}

/** Total Points — the owner-set pool (points scoring model). Standard ChecklistRow +
 *  inline stepper (P4); the placement split is its own Point Distribution row in SETTINGS.
 *  CONTROLLED — reports `games.points_total` to the parent draft; Save persists. */
function TotalPoolRow({
  value: total, canEdit, onChange,
}: {
  value: number | null;
  canEdit: boolean;
  onChange: (total: number | null) => void;
}) {
  const value = total ?? 8;
  return (
    <ChecklistRow
      icon={Hash}
      title="Total Points"
      subtitle={
        <>
          Points for this game:{" "}
          <span style={{ color: value > 0 ? "var(--color-bt-accent)" : "var(--color-bt-text-dim)", fontWeight: 600 }}>{value}</span>
        </>
      }
      state={value > 0 ? "resolved" : "empty"}
      disabled={!canEdit}
      testId="row-total-points"
      control={
        <Stepper
          size="inline"
          value={value}
          min={0}
          onChange={canEdit ? (v) => onChange(v) : () => {}}
          disabled={!canEdit}
          testId="total-points-stepper"
        />
      }
    />
  );
}
