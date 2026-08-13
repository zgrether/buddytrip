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
import type { PlaceCapacity } from "@/lib/gameConfig";
import type { NonGolfConfigDraft, CompetitionFormat } from "@/lib/configDraft";
import { isPlacement, type PointsDistribution } from "@/lib/pointsDistribution";

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

/**
 * Does this game's points read as a POOL split across places, rather than a
 * single value the winner takes?
 *
 * The ONE predicate both rows below key on, and the same one the leaderboard
 * dispatches on (`isPlacement` on `points_distribution`) — so what the settings
 * page says a game does and what the board actually awards cannot disagree.
 * Two rows in this file previously read `scoringModel` independently, which is
 * how the pair drifts (CLAUDE.md #24: a shared input, privately re-derived).
 *
 * A points-model cup is always a pool. A match-play cup is winner-take-all
 * UNTIL the game is given a split of its own — the per-game axis that
 * `scoring_model` used to override.
 */
export function usesPointsPool(
  scoringModel: ScoringModel,
  distribution: PointsDistribution | null
): boolean {
  return scoringModel === "points" || isPlacement(distribution);
}

/** GAME MANAGEMENT slot — Total Points: a per-match value, or a pool to split. */
export function NonGolfTotalPointsRow({
  scoringModel, distribution, value, canEdit, onChange,
}: {
  scoringModel: ScoringModel;
  /** The game's own split, if it has one. A match-play game that carries one
   *  needs the POOL control, not the per-match value — the total is what the
   *  places divide up. */
  distribution: PointsDistribution | null;
  value: number | null;
  canEdit: boolean;
  onChange: (total: number | null) => void;
}) {
  return usesPointsPool(scoringModel, distribution) ? (
    <TotalPoolRow value={value} canEdit={canEdit} onChange={onChange} />
  ) : (
    <MatchValueRow value={value} canEdit={canEdit} onChange={onChange} />
  );
}

/** SETTINGS slot — Competition Format, plus the placement split for the points
 *  model. Owns the single-open accordion state shared by its two rows. */
export function NonGolfSettingsRows({
  game, scoringModel, draft, canEdit, capacity, bracketRows, onFormatChange, onPointsTotalChange, onPointsDistChange,
}: {
  game: GameRow;
  scoringModel: ScoringModel;
  draft: NonGolfConfigDraft;
  canEdit: boolean;
  /** How many places this game has — see `placeCapacity.ts`. Drives the inline
   *  too-many-places warning in `FormatPointsPanel`. A null count warns about
   *  nothing. */
  capacity: PlaceCapacity;
  /** The chosen format's OWN rows, rendered directly beneath the format that
   *  turns them on — today only the bracket has any. A slot rather than a branch
   *  in here: the rows need the pool draft, the team rosters and a confirm the
   *  parent owns, and threading all three through this component to re-emit them
   *  would make it the bracket's plumbing rather than non-golf's row list. */
  bracketRows?: React.ReactNode;
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
      {bracketRows}
      {/* Point Distribution — the placement split.

          SHOWN IN EVERY CUP NOW, which retires this file's standing exception.
          The row used to be hidden outside the points model, and hidden rather
          than scrimmed for a good reason: the prerequisite would have been "a
          points-based cup", `competitions.scoring_model` is fixed at creation and
          editable from nowhere, so the copy would have named something the reader
          could not go and set — and only a SATISFIABLE prerequisite earns a scrim.

          That reasoning was sound and is now spent: a match-play cup CAN hold a
          split, so there is no unsatisfiable prerequisite left to hide behind. The
          row is simply available, and a cup that wants winner-take-all gets it by
          leaving the split unset — which is the default and what the subtitle says.

          The subtitle names the model's actual default rather than one of them:
          "Even" is true of a points cup and false of a match-play one, where an
          unset split means the winner takes the lot. */}
      <ChecklistRow
        icon={Scale}
        title="Point Distribution"
        subtitle={
          draft.pointsDistribution?.type === "placement"
            ? "Custom placement split — tap to edit"
            : scoringModel === "match_play"
              ? "Winner takes all — tap to set a placement split"
              : "Even — tap to set a placement split"
        }
        state={draft.pointsDistribution?.type === "placement" ? "resolved" : "empty"}
        expanded={openAccordion === "distribution"}
        onToggle={() => setOpenAccordion((o) => (o === "distribution" ? null : "distribution"))}
        testId="row-point-distribution"
      >
        <FormatPointsPanel
          capacity={capacity}
          game={game}
          canEdit={canEdit}
          part="distribution"
          controlled={{
            value: { total: draft.pointsTotal, distribution: draft.pointsDistribution },
            onChange: (t, d) => { onPointsTotalChange(t); onPointsDistChange(d); },
          }}
        />
      </ChecklistRow>
    </>
  );
}

/** Competition Format — an INLINE dropdown panel (P4; was the `FormatSheet` modal). Lists
 *  every format so the direction is legible; **Head-to-Head / Match** and **Bracket** are
 *  selectable, and Best of N / Live Results stay disabled placeholders ("Soon") since their
 *  engines aren't built (DO-NOT: don't implement them). H2H is the DEFAULT: a null value
 *  displays as H2H selected (non-golf already runs as H2H when unset), so this reserves the
 *  shape without a creation-time write. CONTROLLED — reports the pick to the parent draft;
 *  Save persists. Picking one can COST something (leaving Bracket discards the field), which
 *  is why the parent, not this list, owns the confirm. */
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
          const enabled = f.key === "head_to_head" || f.key === "bracket";
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
        {/* Names what each LIVE option actually does today. The old copy —
            "however it runs, you enter the result by hand" — was true of the one
            format on offer and stops being true the moment a second one is
            selectable: a bracket's field and draw are built right here. */}
        <p className="px-1 pt-1 text-[11px] leading-relaxed" style={{ color: "var(--color-bt-text-dim)" }}>
          Head-to-Head results are entered by hand; a bracket&rsquo;s field and draw are built here. Best of N and Live
          Results are coming.
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
