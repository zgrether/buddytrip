"use client";

import { useState } from "react";
import { Check, Hash, Scale } from "lucide-react";
import { FormatPointsPanel } from "@/components/games/FormatPointsPanel";
import { ChecklistRow } from "@/components/games/ChecklistRow";
import { Stepper } from "@/components/games/Stepper";
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
 * Non-golf's own settings rows — the slot contents `GameSettingsPage` arranges.
 *
 * These are the LEAN payload: competition format, and the points shape for the
 * competition's `scoring_model`. No course, no handicaps, no modifiers — a
 * non-golf game has no holes to weight and no stroke index to allocate against,
 * which is what `FORMAT_SURFACE.nongolf` records.
 *
 * NO locks and no `settingsEditable` (the P2 lie sweep): non-golf has no
 * destroys-tier setting, so every row stays editable in every mode — an edit
 * stages into the draft and Save commits it, and the RPC refuses nothing here.
 * `canEdit` is the only gate, and it is a ROLE answer, never `scoring_enabled`.
 */

/** GAME MANAGEMENT slot — Total Points, by scoring model. */
export function NonGolfTotalPointsRow({
  scoringModel, value, canEdit, onChange,
}: {
  scoringModel: ScoringModel;
  value: number | null;
  canEdit: boolean;
  onChange: (total: number | null) => void;
}) {
  return scoringModel === "match_play" ? (
    <MatchValueRow value={value} canEdit={canEdit} onChange={onChange} />
  ) : (
    <TotalPoolRow value={value} canEdit={canEdit} onChange={onChange} />
  );
}

/** SETTINGS slot — Competition Format, plus the placement split for the points
 *  model. Owns the single-open accordion state shared by its two rows. */
export function NonGolfSettingsRows({
  game, scoringModel, draft, canEdit, entityCount, onFormatChange, onPointsTotalChange, onPointsDistChange,
}: {
  game: GameRow;
  scoringModel: ScoringModel;
  draft: NonGolfConfigDraft;
  canEdit: boolean;
  /** Teams in the competition — drives the inline places-vs-teams warning in
   *  `FormatPointsPanel`. Null while unknown; warns about nothing then. */
  entityCount: number | null;
  onFormatChange: (format: CompetitionFormat | null) => void;
  onPointsTotalChange: (total: number | null) => void;
  onPointsDistChange: (dist: PointsDistribution | null) => void;
}) {
  const [openAccordion, setOpenAccordion] = useState<null | "format" | "distribution">(null);
  return (
    <>
      <CompetitionFormatDropdown
        value={draft.competitionFormat}
        canEdit={canEdit}
        onChange={onFormatChange}
        open={openAccordion === "format"}
        onToggle={() => setOpenAccordion((o) => (o === "format" ? null : "format"))}
      />
      {/* Point Distribution — points model only (the placement split). match_play's
          single value carries no distribution. Reads its total from the DRAFT.
          DELIBERATELY HIDDEN rather than scrimmed with a `Requires:` (#703 family).
          The prerequisite would be "a points-based cup", and `competitions.scoring_model`
          is fixed at competition creation and editable from nowhere — so the copy
          would name something the reader cannot go and set. The rule is that only a
          SATISFIABLE prerequisite earns a scrim; a permanently-dead row is worse than
          an absent one. This is the one confirmed exception to "every prerequisite is
          reachable in this panel". */}
      {scoringModel === "points" && (
        <ChecklistRow
          icon={Scale}
          title="Point Distribution"
          subtitle={draft.pointsDistribution?.type === "placement" ? "Custom placement split — tap to edit" : "Even — tap to set a placement split"}
          state={draft.pointsDistribution?.type === "placement" ? "resolved" : "empty"}
          expanded={openAccordion === "distribution"}
          onToggle={() => setOpenAccordion((o) => (o === "distribution" ? null : "distribution"))}
          testId="row-point-distribution"
        >
          <FormatPointsPanel
            entityCount={entityCount}
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
    </>
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
  const value = total ?? 0; // item 2: new games default to 0 (was 1)
  return (
    <ChecklistRow
      icon={Hash}
      title="Total Points"
      subtitle={<>Win {fmtValue(value)} · Draw {fmtValue(value / 2)} each</>}
      state={value > 0 ? "resolved" : "empty"}
      testId="row-total-points"
      control={
        <Stepper
          size="inline"
          value={value}
          min={0}
          onChange={canEdit ? (v) => onChange(v) : () => {}}
          editable // tap the value → decimal entry (item 1); −/+ stay integer
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
  const value = total ?? 0; // item 2: new games default to 0 (was 8)
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
      testId="row-total-points"
      control={
        <Stepper
          size="inline"
          value={value}
          min={0}
          onChange={canEdit ? (v) => onChange(v) : () => {}}
          editable // tap the value → decimal entry (item 1); −/+ stay integer
          testId="total-points-stepper"
        />
      }
    />
  );
}
