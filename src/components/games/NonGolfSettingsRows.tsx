"use client";

import { useState } from "react";
import { Check, Hash, Scale } from "lucide-react";
import { FormatPointsPanel } from "@/components/games/FormatPointsPanel";
import { ChecklistRow } from "@/components/games/ChecklistRow";
import { Stepper } from "@/components/games/Stepper";
import {
  COMP_FORMATS,
  fmtValue,
  type GameRow,
} from "@/components/competition/CompetitionGamesPanel";
import type { ScoringModel } from "@/lib/gameTypes";
import type { PlaceCapacity } from "@/lib/gameConfig";
import type { NonGolfConfigDraft, CompetitionFormat } from "@/lib/configDraft";
import { isPlacement, type PointsDistribution } from "@/lib/pointsDistribution";
import { MATCHES_COMPETITION_FORMAT } from "@/lib/resultStrategy";

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
  game, scoringModel, draft, canEdit, capacity, bracketRows, matchRows, onFormatChange, onPointsTotalChange, onPointsDistChange,
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
  /** Matches' pairing grid (170) — the same slot pattern as `bracketRows`, one
   *  per structural format. */
  matchRows?: React.ReactNode;
  onFormatChange: (format: CompetitionFormat | null) => void;
  onPointsTotalChange: (total: number | null) => void;
  onPointsDistChange: (dist: PointsDistribution | null) => void;
}) {
  // Only the distribution row is an accordion now — the format is a tile row that
  // is always open, so it no longer takes part in the single-open rule.
  const [openAccordion, setOpenAccordion] = useState<null | "distribution">(null);
  // The distribution row's THREE outputs — the subtitle, the resolved/empty state,
  // and the panel's winner-takes-all mode — all derive from here. They used to be
  // spelled three different ways in the JSX below (and the third wasn't wired at
  // all), which is what let the collapsed row say "Winner takes all" while the
  // panel it opened said "not distributed yet".
  const hasSplit = isPlacement(draft.pointsDistribution);
  const isPool = usesPointsPool(scoringModel, draft.pointsDistribution);
  return (
    <>
      <CompetitionFormatTiles
        value={draft.competitionFormat}
        canEdit={canEdit}
        onChange={onFormatChange}
      />
      {bracketRows}
      {matchRows}
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
          hasSplit
            ? "Custom placement split — tap to edit"
            : isPool
              ? "Even — tap to set a placement split"
              : "Winner takes all — tap to set a placement split"
        }
        state={hasSplit ? "resolved" : "empty"}
        expanded={openAccordion === "distribution"}
        onToggle={() => setOpenAccordion((o) => (o === "distribution" ? null : "distribution"))}
        testId="row-point-distribution"
      >
        <FormatPointsPanel
          capacity={capacity}
          game={game}
          canEdit={canEdit}
          part="distribution"
          // The fix (#911's contradiction): the panel defaults `winnerTakesAll` to
          // FALSE, so it always rendered the placement editor — "0 of 2 · not
          // distributed yet" — under a row whose own subtitle said "Winner takes
          // all". Two claims about one game, on screen together.
          //
          // NOT stroke's bare `winnerTakesAll`. Stroke can pass it unconditionally
          // because for stroke an unset split ALWAYS means the winner takes the
          // pool. Non-golf's answer depends on the cup: unset means winner-takes-all
          // in a match-play cup and EVEN in a points cup. Same prop, different
          // predicate behind it — and it is the predicate this row already keys its
          // subtitle on, not a third derivation of the same question.
          winnerTakesAll={!isPool}
          controlled={{
            value: { total: draft.pointsTotal, distribution: draft.pointsDistribution },
            onChange: (t, d) => { onPointsTotalChange(t); onPointsDistChange(d); },
          }}
        />
      </ChecklistRow>
    </>
  );
}

/**
 * Competition Format — a row of TILES, always visible.
 *
 * ── Why not the ChecklistRow dropdown it replaced ───────────────────────────
 * The format was a collapsed accordion showing only the current pick, which is
 * the right treatment for a setting people rarely change and the wrong one here:
 * Bracket is a whole feature living behind that chevron, and a reader who never
 * opened the row never learned it existed. Tiles cost one row of vertical space
 * and make the choice — including the two that are coming — legible without a
 * tap. This is the same trade `ChecklistRow`'s own `requires` scrim makes: show
 * the thing and say why, rather than hide it.
 *
 * Selectable: **Simple**, **Bracket**, and **Matches**. Best of N renders as a
 * disabled "Soon" tile so the direction stays legible — its engine isn't built
 * (DO-NOT: don't implement it). Live Results was the fourth tile and is GONE
 * rather than disabled: it named a feature nobody built (removed in 168/169,
 * after its one production row was repointed to `head_to_head`). Matches takes
 * its SLOT in this list, not its value — see `MATCHES_COMPETITION_FORMAT`.
 *
 * Simple is the DEFAULT: a null value displays as Simple selected (non-golf
 * already runs that way when unset), so this reserves the shape without a
 * creation-time write.
 *
 * CONTROLLED — reports the pick to the parent draft; Save persists. Picking one
 * can COST something (leaving Bracket discards the field), which is why the
 * parent, not this list, owns the confirm.
 *
 * Two columns at phone width, four across from `sm`. The tiles carry a
 * description, and four of those side by side at 375px would each be ~85px wide
 * — a "row of tiles" that nobody can read is not the ask.
 */
function CompetitionFormatTiles({
  value, canEdit, onChange,
}: {
  value: CompetitionFormat | null;
  canEdit: boolean;
  onChange: (format: CompetitionFormat | null) => void;
}) {
  // Simple is the default — a null value reads as head_to_head.
  const effective: CompetitionFormat = value ?? "head_to_head";
  return (
    <div data-testid="row-competition-format">
      <div
        className="px-1 pb-2"
        style={{ fontSize: 12.5, fontWeight: 600, color: "var(--color-bt-text-dim)" }}
      >
        Competition Format
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4" data-testid="competition-format-options">
        {COMP_FORMATS.map((f) => {
          const enabled = f.key === "head_to_head" || f.key === "bracket" || f.key === MATCHES_COMPETITION_FORMAT;
          const selected = effective === f.key;
          return (
            <button
              key={f.key}
              type="button"
              disabled={!enabled || !canEdit}
              onClick={() => enabled && onChange(f.key as CompetitionFormat)}
              aria-pressed={selected}
              className="flex flex-col gap-1 rounded-xl px-2.5 py-2.5 text-left disabled:cursor-not-allowed"
              style={{
                background: selected ? "var(--color-bt-accent-faint)" : "var(--color-bt-card-raised)",
                border: `1px solid ${selected ? "var(--color-bt-accent-border)" : "var(--color-bt-border)"}`,
                opacity: enabled ? 1 : 0.5,
              }}
              data-testid={`competition-format-tile-${f.key}`}
            >
              <div className="flex items-center gap-1.5">
                <f.Icon size={15} style={{ color: "var(--color-bt-accent)", flexShrink: 0 }} />
                {enabled
                  ? selected && <Check size={13} style={{ color: "var(--color-bt-accent)", marginLeft: "auto" }} />
                  : (
                    <span
                      className="ml-auto rounded px-1 py-0.5 text-[9px] font-bold uppercase"
                      style={{ background: "var(--color-bt-card)", color: "var(--color-bt-text-dim)", border: "1px solid var(--color-bt-border)" }}
                    >
                      Soon
                    </span>
                  )}
              </div>
              <span className="text-sm font-semibold" style={{ color: "var(--color-bt-text)", lineHeight: 1.2 }}>
                {f.label}
              </span>
              <span className="text-[11px]" style={{ color: "var(--color-bt-text-dim)", lineHeight: 1.3 }}>
                {f.desc}
              </span>
            </button>
          );
        })}
      </div>
    </div>
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
/**
 * The bare "Total Points" row: a number the whole game is worth.
 *
 * EXPORTED for pick'em (Phase 4), which always wants a total whatever its
 * roll-up — individual matches divide it, team totals award it whole, points
 * mode splits it across places. It deliberately does NOT route through
 * `NonGolfTotalPointsRow`, whose `usesPointsPool` branch would hand a match-play
 * pick'em game `MatchValueRow` — a per-match VALUE, which is the one shape
 * pick'em never has.
 *
 * Same component, same stepper, same empty/resolved state; the caller decides
 * what dividing the total means.
 */
export function TotalPoolRow({
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
