"use client";

import { useState } from "react";
import { ChevronDown, Flag, Check } from "lucide-react";
import { useTeeVisibility } from "@/hooks/useTeeVisibility";
import { computeStrokePlayStandings, type StrokeEntry } from "@/lib/strokePlay";
import type { TeeRow } from "@/lib/teeRows";
import { isGloriousHole, NO_GLORIOUS, type GloriousConfig } from "@/lib/gloriousHoles";
import { Avatar } from "@/components/Avatar";
import { GolfChip } from "./GolfChip";
import {
  scoreCellKey,
  type ScoreUnit,
  type Participant,
  type ScoreValues,
  type ScoreDirection,
  type SaveStatusMap,
} from "./types";

/**
 * StandardGrid — the review / spot-correction scorecard (Slice A, Task 7).
 *
 * Read-only + navigational: tapping a cell calls `onCellTap(unitLabel)` so the
 * parent jumps to that unit's entry view. The grid NEVER edits inline — entry
 * is always the focused per-unit surface.
 *
 * Sections (Out/In) and the section divider come from the units' `section`
 * field (`scorecard_schema.scoring.sections`), not hardcoded at 9/10.
 *
 * Orientation: golf's review sheet is conventionally participants-across /
 * units-across-the-top, which is the default here. `orientation` is a typed
 * prop so non-golf formats (units running down the portrait screen) can flip it
 * later without a rewrite — the flipped layout itself lands when Slice C needs
 * it (GolfCard). Slice A renders `participants-rows` only.
 *
 * The tee/yardage/par/stroke-index HEADER (everything above the player rows)
 * is factored out as `ScorecardChrome` below, so `OutcomeScorecard` (hole-
 * outcome entry) can render the identical chrome around its own lead rows —
 * one scorecard look, two row kinds. StandardGrid's own body (below) is what
 * `ScorecardChrome`'s `children` render-prop supplies here.
 */
interface StandardGridProps {
  units: ScoreUnit[];
  participants: Participant[];
  values: ScoreValues;
  direction: ScoreDirection;
  onCellTap?: (unitLabel: string) => void;
  orientation?: "participants-rows" | "participants-cols";
  /**
   * Slice B stroke pips: `{ [participantId]: Set<unitLabel> }` — a player gets a
   * pip on each cell they receive a handicap stroke on. Omit for Slice A.
   */
  pips?: Record<string, Set<string>>;
  /**
   * Per-cell save state (Connectivity Layer 1). Errored cells get a danger ring
   * so the whole card can be scanned for unsaved scores; tapping the cell jumps
   * to that hole's entry view where the per-cell Retry lives. Keyed by
   * `${participantId}:${unitLabel}`.
   */
  saveStatus?: SaveStatusMap;
  /**
   * The configured tee (name + ratings) for the header line. Present only when a
   * course/tee is applied; informational (does not affect scoring). The per-hole
   * yardage rides on `units[].yardage` instead.
   */
  tee?: { name: string; courseRating?: number | null; slopeRating?: number | null; bogeyRating?: number | null } | null;
  /**
   * Multi-tee yardage rows (Spec 5b) — DISPLAY ONLY (scoring/structure/handicaps
   * are unchanged; these are reference rows). When present + non-empty, the grid
   * shows one yardage row per tee (with a checkbox legend to hide/reveal tees)
   * INSTEAD of the single snapshot `Yards` row. Omit/empty → the single-tee row
   * (today's behavior) is kept. The rows arrive pre-assembled (order, default
   * visibility, chosen flag, color) from `useScorecardTeeRows`.
   */
  teeRows?: TeeRow[];
  /**
   * Game id — keys the persisted tee filter so it survives reloads and is
   * consistent across the scorecard's entry points. Omit for Quick Game /
   * tests → the tee filter is in-memory only.
   */
  gameId?: string | null;
  /**
   * Glorious Finishing Holes (#569/#571) — the LIVE 2×-last-N weight. Purely
   * config + format driven: a diamond marks each glorious hole number, a gold
   * bracket + faint column wash mark the glorious columns, and the tees bar gets
   * one label. Renders identically whether or not scores/participants exist
   * (never gated on emptiness — only the config+format predicate decides).
   * Omit (defaults to `NO_GLORIOUS`) for non-match-play grids — the format guard
   * inside `gloriousConfig`/`isGloriousHole` makes that redundant but explicit.
   */
  glorious?: GloriousConfig;
}

export const NAME_W = 124;
export const HOLE_W = 30;
export const SUB_W = 44;
export const TOTAL_W = 50;
// The right-edge fade (below) is NOT scroll-position-aware — it's pinned to the
// sheet's edge and stays rendered even once the grid is scrolled all the way to
// its true end, permanently shading the last FADE_W px of CONTENT (not just
// "more to scroll" — there's nothing more there). At TOTAL_W (50px) that shaded
// strip covered roughly half the Total column's numbers. Every row ends in a
// transparent RightGutter of this same width so the fade lands on empty space
// instead of real content — shared constant so the two can't drift apart.
export const FADE_W = 24;

/** Everything a `ScorecardChrome` body (the `children` render-prop) needs to
 *  paint cells that align pixel-for-pixel with the header above them. */
export interface ScorecardChromeRenderCtx {
  hasSections: boolean;
  front: ScoreUnit[];
  back: ScoreUnit[];
  cellBase: React.CSSProperties;
  nameCell: React.CSSProperties;
  divider: (l?: string) => React.CSSProperties;
  isGloriousCol: (i: number) => boolean;
  gloriousWash: React.CSSProperties;
}

export interface ScorecardChromeProps {
  units: ScoreUnit[];
  tee?: { name: string; courseRating?: number | null; slopeRating?: number | null; bogeyRating?: number | null } | null;
  teeRows?: TeeRow[];
  glorious?: GloriousConfig;
  /** Game id — keys the persisted tee filter (which yardage rows are shown) so
   *  the choice survives reloads and is consistent across the scorecard's entry
   *  points. Omit for Quick Game / tests → the filter is in-memory only. */
  gameId?: string | null;
  /** The player/lead rows — rendered between the Index row and the Glorious
   *  bracket, using the same cell geometry the header above used. */
  children: (ctx: ScorecardChromeRenderCtx) => React.ReactNode;
}

/**
 * ScorecardChrome — the tee-selector bar + Hole/Yardage/Par/Stroke-Index
 * header + sticky name column + glorious bracket + right-edge fade. Extracted
 * from `StandardGrid` (Refactor B follow-up) so `OutcomeScorecard` can reuse
 * the identical course-structure chrome around its own lead rows instead of a
 * bespoke, chrome-less table — "look just like the normal scorecard; only the
 * player rows differ." Behavior-preserving: this is the exact JSX StandardGrid
 * rendered before the extraction, just wrapped so a second caller can supply
 * different body rows through `children`.
 */
export function ScorecardChrome({ units, tee, teeRows = [], glorious = NO_GLORIOUS, gameId, children }: ScorecardChromeProps) {
  // The ONE predicate — reused, never re-derived. `hole` = the unit's ARRAY
  // POSITION (index + 1), matching the engine's numbering (buildDecided/
  // holeWeight), not a parsed label. A non-contiguous/short `units` array (a
  // 9-hole round, or a test fixture) naturally yields an empty set here — that
  // IS the "glorious is inert on a short round" behavior, inherited for free,
  // never special-cased.
  const gloriousCols = new Set(units.map((_, i) => i).filter((i) => isGloriousHole(i + 1, glorious)));
  const isGloriousCol = (i: number) => gloriousCols.has(i);
  const gloriousWash: React.CSSProperties = { background: "var(--color-bt-glorious-faint)" };
  const front = units.filter((u) => u.section === "front");
  const back = units.filter((u) => u.section === "back");
  const hasSections = front.length > 0 && back.length > 0;
  const firstBackLabel = back[0]?.label;

  // Multi-tee rows (Spec 5b): user overrides on top of each row's default
  // visibility; the CHOSEN tee is always shown (non-hidable — it's in play).
  const multiTee = teeRows.length > 0;
  // The tee selector is collapsed by default (it's setup busy-ness, not scoring);
  // the chosen tee still shows in the trigger summary and in the grid below.
  const [teePanelOpen, setTeePanelOpen] = useState(false);
  // Tee filter overrides are PERSISTED per game (localStorage, keyed on gameId
  // — consistent across the scorecard's entry points). Absent gameId → in-memory.
  const [teeOverrides, setTeeOverrides] = useTeeVisibility(gameId);
  const teeVisible = (row: TeeRow) => row.isChosen || (teeOverrides[row.name] ?? row.defaultVisible);
  const chosenTee = teeRows.find((r) => r.isChosen);
  const toggleTee = (row: TeeRow) =>
    setTeeOverrides({ ...teeOverrides, [row.name]: !(teeOverrides[row.name] ?? row.defaultVisible) });
  // A tee's front/back/total yardage — its yards align with `units` by index.
  const teeSum = (ys: (number | null)[], from: number, to: number) =>
    ys.slice(from, to).reduce((a: number, y) => a + (y ?? 0), 0);

  // GolfCard: par-relative coloring + a Par row + ±-vs-par subtotals, when the
  // units carry par (always for stroke play; real course par lands with the
  // picker). ±-vs-par is over the holes a player has actually scored.
  const hasPar = units.length > 0 && units.every((u) => u.par != null);
  const hasIndex = units.length > 0 && units.every((u) => u.strokeIndex != null);
  // Yardage (the configured tee) is informational; show the row when ANY hole
  // carries a yardage (a tee may miss a hole or two).
  const hasYards = units.length > 0 && units.some((u) => u.yardage != null);
  const parSum = (list: ScoreUnit[]) => list.reduce((a, u) => a + (u.par ?? 0), 0);
  const yardSum = (list: ScoreUnit[]) => list.reduce((a, u) => a + (u.yardage ?? 0), 0);

  const cellBase: React.CSSProperties = {
    width: HOLE_W,
    minWidth: HOLE_W,
    textAlign: "center",
    flexShrink: 0,
  };
  // Front/back-9 separator on the first back-9 hole — a neutral divider line,
  // NOT a teal tint (teal reads as 'current/leader' elsewhere; a tint here looks
  // like the hole is highlighted).
  const divider = (l?: string): React.CSSProperties =>
    hasSections && l === firstBackLabel
      ? { borderLeft: "1px solid var(--color-bt-border)" }
      : {};

  const nameCell: React.CSSProperties = {
    width: NAME_W,
    minWidth: NAME_W,
    position: "sticky",
    left: 0,
    zIndex: 1,
    flexShrink: 0,
    borderRight: "1px solid var(--color-bt-border)",
    background: "var(--color-bt-card)",
  };

  // Compact tee header: "Blue tees · CR 72.3 / Slope 131" (ratings shown only
  // when present — a manual course carries a tee name but usually no ratings).
  const teeRatings = tee
    ? [
        tee.courseRating != null ? `CR ${tee.courseRating}` : null,
        tee.slopeRating != null ? `Slope ${tee.slopeRating}` : null,
      ].filter(Boolean).join(" / ")
    : "";

  const ctx: ScorecardChromeRenderCtx = { hasSections, front, back, cellBase, nameCell, divider, isGloriousCol, gloriousWash };

  return (
    <div className="h-full" style={{ background: "var(--color-bt-base)" }}>
      {/* Multi-tee selector (Spec 5b) — reveal/hide each tee's yardage row.
          Collapsed behind a disclosure (mirrors the leaderboard's "Game by game"
          PointsMatrix toggle) so the selection controls aren't always taking up
          space; the chosen tee shows in the trigger and always renders in the grid.
          The chosen tee is checked + disabled (in play, never hidable). */}
      {multiTee ? (
        // Wave 2: an itinerary-style FLOATING tee filter — a compact "Tees" pill
        // that opens a popover checklist over the grid (Level-3 float surface),
        // replacing the inline checkbox grid that pushed the scorecard down.
        <div className="relative flex items-center gap-2" style={{ padding: "8px 12px", borderBottom: "1px solid var(--color-bt-subtle-border)" }}>
          <button
            type="button"
            onClick={() => setTeePanelOpen((o) => !o)}
            aria-haspopup="menu"
            aria-expanded={teePanelOpen}
            className="inline-flex min-w-0 items-center gap-2 rounded-full"
            style={{ padding: "6px 12px", background: "var(--color-bt-card-raised)", border: "1px solid var(--color-bt-border)" }}
            data-testid="tee-legend-toggle"
          >
            <Flag size={12} style={{ color: "var(--color-bt-text-dim)", flexShrink: 0 }} />
            <span className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: "var(--color-bt-text-dim)" }}>
              Tees
            </span>
            {chosenTee && (
              <span className="flex min-w-0 items-center gap-1.5">
                <span style={{ width: 8, height: 8, borderRadius: "50%", background: chosenTee.color, border: "1px solid var(--color-bt-subtle-border)", flexShrink: 0 }} />
                <span className="truncate" style={{ fontSize: 12, fontWeight: 600, color: "var(--color-bt-text-dim)" }}>
                  {chosenTee.name} · playing
                </span>
              </span>
            )}
            <ChevronDown
              size={14}
              className="transition-transform"
              style={{ color: "var(--color-bt-text-dim)", transform: teePanelOpen ? "rotate(180deg)" : undefined, flexShrink: 0 }}
            />
          </button>
          {/* Glorious label — a sibling of the pill (never nested in a button). */}
          {gloriousCols.size > 0 && (
            <span data-testid="glorious-tees-label" className="ml-auto truncate" style={{ fontSize: 11, fontWeight: 700, color: "var(--color-bt-glorious)" }}>
              {glorious.n} Glorious Finishing Holes · Worth Double
            </span>
          )}
          {teePanelOpen && (
            <>
              {/* Click-outside backdrop (the itinerary filter closes on re-tap
                  only; a tee filter over a scrollable grid wants outside-dismiss). */}
              <button
                aria-hidden
                tabIndex={-1}
                onClick={() => setTeePanelOpen(false)}
                className="fixed inset-0 z-40 cursor-default"
                style={{ background: "transparent" }}
              />
              <div
                role="menu"
                data-testid="tee-legend"
                className="absolute left-3 top-[calc(100%-2px)] z-50 flex min-w-[200px] flex-col gap-0.5 rounded-xl p-1.5"
                style={{ background: "var(--color-bt-card-float)", border: "1px solid var(--color-bt-border)", boxShadow: "var(--shadow-floating)" }}
              >
                {teeRows.map((row) => {
                  const on = teeVisible(row);
                  return (
                    <button
                      key={row.name}
                      type="button"
                      role="menuitemcheckbox"
                      aria-checked={on}
                      disabled={row.isChosen}
                      onClick={() => toggleTee(row)}
                      className="flex items-center justify-between gap-3 rounded-lg px-3 py-2 text-left transition-colors hover:bg-[var(--color-bt-card)] disabled:cursor-default"
                      aria-label={`${row.name} tee yardages`}
                    >
                      <span className="flex min-w-0 items-center gap-2.5">
                        <span style={{ width: 10, height: 10, borderRadius: "50%", background: row.color, border: "1px solid var(--color-bt-subtle-border)", flexShrink: 0 }} />
                        <span className="truncate" style={{ fontSize: 13, fontWeight: row.isChosen ? 700 : 600, color: on ? "var(--color-bt-text)" : "var(--color-bt-text-dim)" }}>
                          {row.name}{row.isChosen ? " · playing" : ""}
                        </span>
                      </span>
                      {on ? (
                        <Check size={14} style={{ color: "var(--color-bt-accent)", flexShrink: 0 }} />
                      ) : (
                        <span style={{ width: 14, flexShrink: 0 }} />
                      )}
                    </button>
                  );
                })}
              </div>
            </>
          )}
        </div>
      ) : tee ? (
        <div className="flex items-center gap-2" style={{ padding: "8px 12px", borderBottom: "1px solid var(--color-bt-subtle-border)" }}>
          <span style={{ fontSize: 12, fontWeight: 600, color: "var(--color-bt-text)" }}>{tee.name} tees</span>
          {teeRatings && (
            <span style={{ fontSize: 12, color: "var(--color-bt-text-dim)", fontVariantNumeric: "tabular-nums" }}>· {teeRatings}</span>
          )}
          {gloriousCols.size > 0 && (
            <span
              data-testid="glorious-tees-label"
              style={{ marginLeft: "auto", fontSize: 11, fontWeight: 700, color: "var(--color-bt-glorious)" }}
            >
              {glorious.n} Glorious Finishing Holes · Worth Double
            </span>
          )}
        </div>
      ) : null}
      <div className="relative">
        <div className="no-scrollbar overflow-x-auto">
          <div style={{ minWidth: "max-content", position: "relative" }}>
          {/* Header */}
          <div
            className="flex"
            style={{
              height: 38,
              position: "sticky",
              top: 0,
              zIndex: 2,
              background: "var(--color-bt-card-raised)",
              borderBottom: "1px solid var(--color-bt-border)",
            }}
          >
            <div className="flex items-center" style={{ ...nameCell, background: "var(--color-bt-card-raised)", padding: "0 10px" }}>
              <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--color-bt-text-dim)" }}>
                Hole
              </span>
            </div>
            {units.map((u, i) => (
              // Header row: DIAMOND ONLY, no flat wash — layering both the same
              // faint token double-stacks their alpha and muddies the diamond
              // exactly where it needs to read clearest. The wash marks the
              // column on the rows BELOW (yardage/par/index/score).
              <div key={u.label} className="relative flex items-center justify-center" style={{ ...cellBase, ...divider(u.label) }}>
                {isGloriousCol(i) && (
                  <span
                    aria-hidden
                    data-testid={`glorious-diamond-${u.label}`}
                    style={{
                      position: "absolute",
                      width: 18,
                      height: 18,
                      // -faint (8-10% alpha) reads as almost nothing on the header's
                      // opaque card-raised surface — bumped to the eagle chip's
                      // proven-visible fill level (22%) + a border ring, the same
                      // "fill + ring" grammar GolfChip already uses for its highest
                      // score tier, so this reads as a deliberate marker, not noise.
                      background: "color-mix(in srgb, var(--color-bt-glorious) 22%, transparent)",
                      border: "1px solid var(--color-bt-glorious-border)",
                      transform: "rotate(45deg)",
                    }}
                  />
                )}
                <span style={{ position: "relative", fontSize: 13, fontWeight: 600, color: "var(--color-bt-text-dim)" }}>{u.label}</span>
              </div>
            ))}
            {/* Out / In subtotals + Total as trailing columns. */}
            {hasSections && <HeaderSub label="Out" />}
            {hasSections && <HeaderSub label="In" />}
            <HeaderSub label="Total" wide />
            <RightGutter />
          </div>

          {/* Yardage — DISPLAY ONLY. Multi-tee (Spec 5b): one row per VISIBLE tee,
              zebra-striped, the chosen tee brighter (accent-faint fill + an accent
              rail). Falls back to the single snapshot Yards row when no tee rows are
              supplied. Sits on base like Index; informational only. */}
          {multiTee
            ? teeRows.filter(teeVisible).map((row, ti) => {
                const zebraBg = row.isChosen
                  ? "var(--color-bt-accent-faint)"
                  : ti % 2 === 0
                    ? "var(--color-bt-card-raised)"
                    : "var(--color-bt-base)";
                const valColor = row.isChosen ? "var(--color-bt-text)" : "var(--color-bt-text-dim)";
                // The chosen row gets a left accent rail on the sticky name cell
                // (inset shadow — no layout shift), so it's unmistakable at a glance.
                // Its fill (accent-faint) is TRANSLUCENT, so the sticky column must
                // composite it over an OPAQUE surface — otherwise the yardage cells
                // scrolling underneath bleed through the frozen tee-name cell. Layer
                // the tint over base (matches the row, which sits on base) so it
                // masks cleanly at every scroll position.
                const nameStyle = {
                  ...nameCell,
                  background: zebraBg,
                  padding: "0 10px",
                  ...(row.isChosen
                    ? {
                        background:
                          "linear-gradient(var(--color-bt-accent-faint), var(--color-bt-accent-faint)), var(--color-bt-base)",
                        boxShadow: "inset 3px 0 0 var(--color-bt-accent)",
                      }
                    : {}),
                } as React.CSSProperties;
                return (
                  <div key={row.name} className="flex" style={{ height: 26, background: zebraBg, borderBottom: "1px solid var(--color-bt-subtle-border)" }} data-testid={`tee-row-${row.name}`}>
                    <div className="flex items-center gap-1.5" style={nameStyle}>
                      <span style={{ width: 8, height: 8, borderRadius: "50%", background: row.color, border: "1px solid var(--color-bt-subtle-border)", flexShrink: 0 }} />
                      <span className="truncate" style={{ fontSize: 11, fontWeight: row.isChosen ? 700 : 600, letterSpacing: "0.02em", color: valColor }}>
                        {row.name}
                      </span>
                    </div>
                    {units.map((u, i) => (
                      <div key={u.label} className="flex items-center justify-center" style={{ ...cellBase, ...divider(u.label), ...(isGloriousCol(i) ? gloriousWash : {}) }}>
                        <span style={{ fontSize: 11, color: valColor, opacity: row.isChosen ? 1 : 0.75, fontVariantNumeric: "tabular-nums" }}>{row.yards[i] ?? "—"}</span>
                      </div>
                    ))}
                    {hasSections && <ParSub value={teeSum(row.yards, 0, front.length)} />}
                    {hasSections && <ParSub value={teeSum(row.yards, front.length, units.length)} />}
                    <ParSub value={teeSum(row.yards, 0, units.length)} wide />
                    <RightGutter />
                  </div>
                );
              })
            : hasYards && (
                <div className="flex" style={{ height: 26, background: "var(--color-bt-base)", borderBottom: "1px solid var(--color-bt-subtle-border)" }}>
                  <div className="flex items-center" style={{ ...nameCell, background: "var(--color-bt-base)", padding: "0 10px" }}>
                    <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--color-bt-text-dim)" }}>
                      Yards
                    </span>
                  </div>
                  {units.map((u, i) => (
                    <div key={u.label} className="flex items-center justify-center" style={{ ...cellBase, ...divider(u.label), ...(isGloriousCol(i) ? gloriousWash : {}) }}>
                      <span style={{ fontSize: 11, color: "var(--color-bt-text-dim)", opacity: 0.75, fontVariantNumeric: "tabular-nums" }}>{u.yardage ?? "—"}</span>
                    </div>
                  ))}
                  {hasSections && <ParSub value={yardSum(front)} />}
                  {hasSections && <ParSub value={yardSum(back)} />}
                  <ParSub value={yardSum(units)} wide />
                  <RightGutter />
                </div>
              )}

          {/* Par row — same surface as the Hole header. */}
          {hasPar && (
            <div className="flex" style={{ height: 30, background: "var(--color-bt-card-raised)", borderBottom: "1px solid var(--color-bt-subtle-border)" }}>
              <div className="flex items-center" style={{ ...nameCell, background: "var(--color-bt-card-raised)", padding: "0 10px" }}>
                <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--color-bt-text-dim)" }}>
                  Par
                </span>
              </div>
              {units.map((u, i) => (
                <div key={u.label} className="flex items-center justify-center" style={{ ...cellBase, ...divider(u.label), ...(isGloriousCol(i) ? gloriousWash : {}) }}>
                  <span style={{ fontSize: 13, color: "var(--color-bt-text-dim)", fontVariantNumeric: "tabular-nums" }}>{u.par}</span>
                </div>
              ))}
              {hasSections && <ParSub value={parSum(front)} />}
              {hasSections && <ParSub value={parSum(back)} />}
              <ParSub value={parSum(units)} wide />
              <RightGutter />
            </div>
          )}

          {/* Stroke-index row — no surface (sits on base), smaller + dimmer. */}
          {hasIndex && (
            <div className="flex" style={{ height: 26, background: "var(--color-bt-base)", borderBottom: "1px solid var(--color-bt-subtle-border)" }}>
              <div className="flex items-center" style={{ ...nameCell, background: "var(--color-bt-base)", padding: "0 10px" }}>
                <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--color-bt-text-dim)" }}>
                  Index
                </span>
              </div>
              {units.map((u, i) => (
                <div key={u.label} className="flex items-center justify-center" style={{ ...cellBase, ...divider(u.label), ...(isGloriousCol(i) ? gloriousWash : {}) }}>
                  <span style={{ fontSize: 12, color: "var(--color-bt-text-dim)", opacity: 0.75, fontVariantNumeric: "tabular-nums" }}>{u.strokeIndex}</span>
                </div>
              ))}
              {hasSections && <IndexSub />}
              {hasSections && <IndexSub />}
              <IndexSub wide />
              <RightGutter />
            </div>
          )}

          {/* Rows — supplied by the caller (StandardGrid's score rows, or
              OutcomeScorecard's lead rows). */}
          {children(ctx)}

          {/* Glorious bracket — a rectangle frame around the glorious columns,
              spanning header through the last row. Border-only (the wash fill is
              per-cell, above); pointerEvents:none so it never blocks a score-cell
              tap. min/max of the glorious index set, not an assumed "last N" span
              — robust if the predicate ever yields a non-suffix set.
              zIndex MUST exceed the header row's (2): the header is `position:
              sticky` with an OPAQUE background, so at zIndex 1 its top border
              segment (which sits at the header's own top edge) was fully painted
              over — the bracket visually "started" below the header instead of
              enclosing it. At zIndex 3 the thin border renders on top instead. */}
          {gloriousCols.size > 0 && (
            <div
              aria-hidden
              data-testid="glorious-bracket"
              style={{
                position: "absolute",
                left: NAME_W + Math.min(...gloriousCols) * HOLE_W,
                width: (Math.max(...gloriousCols) - Math.min(...gloriousCols) + 1) * HOLE_W,
                top: 0,
                bottom: 0,
                border: "1px solid var(--color-bt-glorious-border)",
                pointerEvents: "none",
                zIndex: 3,
              }}
            />
          )}
          </div>
        </div>
        {/* Right-edge fade signalling more columns — NOT scroll-position-aware
            (always rendered, even at true max scroll), which is exactly why every
            row ends in a RightGutter of the same FADE_W: the fade always has
            FADE_W of real spacer to land on instead of the Total column. */}
        <div
          className="pointer-events-none absolute right-0 top-0 h-full"
          style={{ width: FADE_W, background: "linear-gradient(to right, transparent, var(--color-bt-base))" }}
        />
      </div>
    </div>
  );
}

export function StandardGrid({
  units,
  participants,
  values,
  onCellTap,
  pips,
  saveStatus,
  tee,
  teeRows = [],
  glorious = NO_GLORIOUS,
  gameId,
}: StandardGridProps) {
  const hasPar = units.length > 0 && units.every((u) => u.par != null);

  const valOf = (pid: string, l: string) => values[pid]?.[l];
  const sumOf = (pid: string, list: ScoreUnit[]) =>
    list.reduce((a, u) => a + (valOf(pid, u.label) ?? 0), 0);
  const totalOf = (pid: string) => sumOf(pid, units);
  const vsParOf = (pid: string, list: ScoreUnit[]): number => {
    const scored = list.filter((u) => valOf(pid, u.label) != null);
    return scored.reduce((a, u) => a + (valOf(pid, u.label)! - (u.par ?? 0)), 0);
  };

  // Leader (low total among participants who have any score).
  const scoredIds = participants
    .filter((p) => Object.keys(values[p.id] ?? {}).length > 0)
    .map((p) => p.id);
  const entries: StrokeEntry[] = [];
  for (const p of participants)
    for (const u of units) {
      const v = valOf(p.id, u.label);
      if (v != null) entries.push({ participant_id: p.id, value: v });
    }
  const standings = computeStrokePlayStandings(scoredIds, entries);
  // ALL position-1 entities, so tied co-leaders each get the leader treatment.
  const leaderIds = new Set(
    scoredIds.length ? standings.filter((s) => s.position === 1).map((s) => s.entityId) : []
  );

  return (
    <>
      <ScorecardChrome units={units} tee={tee} teeRows={teeRows} glorious={glorious} gameId={gameId}>
        {({ hasSections, front, back, cellBase, nameCell, divider, isGloriousCol, gloriousWash }) => (
          <>
          {participants.map((p, i) => {
            const isLeader = leaderIds.has(p.id);
            const rowBg = i % 2 === 0 ? "var(--color-bt-card)" : "var(--color-bt-base)";
            return (
              <div key={p.id} className="flex" style={{ height: 44, background: rowBg, borderBottom: "1px solid var(--color-bt-subtle-border)" }}>
                <div className="@container flex items-center gap-1.5" style={{ ...nameCell, background: rowBg, padding: "0 10px" }}>
                  <Avatar name={p.name} teamColor={p.color} avatarIcon={p.avatarIcon} sizePx={18} collapse collapseAt="chip" />
                  <span style={{ fontSize: 16, fontWeight: 700, color: "var(--color-bt-text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {p.name}
                  </span>
                </div>
                {units.map((u, i) => {
                  const v = valOf(p.id, u.label);
                  const hasPip = pips?.[p.id]?.has(u.label);
                  const colored = v != null && hasPar && u.par != null;
                  const errored = saveStatus?.[scoreCellKey(p.id, u.label)] === "error";
                  return (
                    <button
                      key={u.label}
                      data-testid={`score-cell-${p.id}-${u.label}`}
                      onClick={() => onCellTap?.(u.label)}
                      className="relative flex items-center justify-center"
                      style={{
                        ...cellBase,
                        height: 44,
                        ...divider(u.label),
                        // Wash sits on the button's OWN background — behind the
                        // GolfChip/content, which always paints on top of an
                        // element's background regardless of DOM order, so the
                        // eagle ring etc. stay crisp over it (§7 DO-NOT).
                        ...(isGloriousCol(i) ? gloriousWash : {}),
                        fontSize: 13,
                        fontWeight: 500,
                        color: v != null ? "var(--color-bt-text)" : "var(--color-bt-text-dim)",
                        // Unsaved → danger ring so it's scannable across the card.
                        ...(errored
                          ? { boxShadow: "inset 0 0 0 2px var(--color-bt-danger)" }
                          : {}),
                      }}
                    >
                      {colored ? <GolfChip value={v!} par={u.par!} size={26} fontSize={13} /> : (v ?? "—")}
                      {hasPip && <StrokePip />}
                      {errored && <UnsavedDot />}
                    </button>
                  );
                })}
                {hasSections && <SubCell value={sumOf(p.id, front)} vsPar={hasPar ? vsParOf(p.id, front) : undefined} />}
                {hasSections && <SubCell value={sumOf(p.id, back)} vsPar={hasPar ? vsParOf(p.id, back) : undefined} />}
                <SubCell value={totalOf(p.id)} vsPar={hasPar ? vsParOf(p.id, units) : undefined} wide bold leader={isLeader} />
                <RightGutter />
              </div>
            );
          })}
          </>
        )}
      </ScorecardChrome>
      {/* Legend is pinned below the scroller — it does NOT scroll with the
          grid and doesn't apply to lead rows, so it's a sibling of the shared
          chrome rather than rendered inside it. */}
      {hasPar && (
        <div className="shrink-0" style={{ borderTop: "1px solid var(--color-bt-subtle-border)" }}>
          <Legend />
        </div>
      )}
    </>
  );
}

/** Eagle / birdie / par / bogey / dbl+ chips with labels (Slice C §2). */
function Legend() {
  const items: { label: string; gross: number; par: number }[] = [
    { label: "Eagle", gross: 3, par: 5 },
    { label: "Birdie", gross: 3, par: 4 },
    { label: "Par", gross: 4, par: 4 },
    { label: "Bogey", gross: 5, par: 4 },
    { label: "Dbl+", gross: 6, par: 4 },
  ];
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2" style={{ padding: "12px 12px 14px" }}>
      {items.map((it) => (
        <span key={it.label} className="flex items-center gap-1.5">
          <GolfChip value={it.gross} par={it.par} size={22} fontSize={11} />
          <span style={{ fontSize: 12, color: "var(--color-bt-text-dim)" }}>{it.label}</span>
        </span>
      ))}
    </div>
  );
}

/** Unsaved marker — a danger dot in the cell's lower-left corner, paired with
 *  the danger ring, so an unsaved score reads at a glance on the review grid. */
function UnsavedDot() {
  return (
    <span
      aria-label="Not saved"
      style={{
        position: "absolute",
        bottom: 5,
        left: 5,
        width: 6,
        height: 6,
        borderRadius: "50%",
        background: "var(--color-bt-danger)",
      }}
    />
  );
}

/** Stroke pip — a player receives a handicap stroke on this cell (§3). */
function StrokePip() {
  return (
    <span
      style={{
        position: "absolute",
        top: 6,
        right: 5,
        width: 6,
        height: 6,
        borderRadius: "50%",
        background: "var(--color-bt-warning)",
        boxShadow: "0 0 0 1.5px var(--color-bt-base)",
      }}
    />
  );
}

function HeaderSub({ label, wide }: { label: string; wide?: boolean }) {
  return (
    <div
      className="flex items-center justify-center"
      style={{
        width: wide ? TOTAL_W : SUB_W,
        minWidth: wide ? TOTAL_W : SUB_W,
        flexShrink: 0,
        background: wide ? "rgba(45,212,191,0.07)" : "rgba(255,255,255,0.025)",
      }}
    >
      <span style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.04em", color: "var(--color-bt-text-dim)" }}>
        {label}
      </span>
    </div>
  );
}

/** A tinted Out/In/Total-style subtotal cell — exported so `OutcomeScorecard`
 *  can render its own lead-at-checkpoint values through the identical visual
 *  treatment the score grid uses. */
export function SubCell({
  value,
  vsPar,
  wide,
  bold,
  leader,
}: {
  value: number;
  vsPar?: number;
  wide?: boolean;
  bold?: boolean;
  leader?: boolean;
}) {
  return (
    <div
      className="flex flex-col items-center justify-center"
      style={{
        width: wide ? TOTAL_W : SUB_W,
        minWidth: wide ? TOTAL_W : SUB_W,
        height: 44,
        flexShrink: 0,
        background: wide ? "rgba(45,212,191,0.07)" : "rgba(255,255,255,0.025)",
        // Totals are white; only the leader/winner goes green.
        color: leader ? "var(--color-bt-place-1-text)" : "var(--color-bt-text)",
      }}
    >
      <span style={{ fontSize: bold ? 17 : 16, fontWeight: bold ? 700 : 600 }}>{value}</span>
      {vsPar != null && <VsPar diff={vsPar} />}
    </div>
  );
}

/** ±-vs-par line: over = blue, under = red, even = dim "E" (Slice C §2). */
function VsPar({ diff }: { diff: number }) {
  const text = diff > 0 ? `+${diff}` : diff < 0 ? `−${Math.abs(diff)}` : "E";
  const color = diff > 0 ? "#93c5fd" : diff < 0 ? "#fca5a5" : "var(--color-bt-text-dim)";
  return <span style={{ fontSize: 10, fontWeight: 600, color, fontVariantNumeric: "tabular-nums" }}>{text}</span>;
}

/** Blank subtotal cell for the index row — keeps the Out/In/Total tint columns
 *  continuous without showing a meaningless index sum. */
function IndexSub({ wide }: { wide?: boolean }) {
  return (
    <div
      style={{
        width: wide ? TOTAL_W : SUB_W,
        minWidth: wide ? TOTAL_W : SUB_W,
        flexShrink: 0,
        background: wide ? "rgba(45,212,191,0.07)" : "rgba(255,255,255,0.025)",
      }}
    />
  );
}

/** Transparent trailing spacer, the same width as the right-edge fade — so the
 *  fade always lands on empty space at the true end of the scroll, never on the
 *  Total column's real numbers (see FADE_W). One per row, after its last cell.
 *  Exported so `OutcomeScorecard`'s lead rows end in the identical spacer. */
export function RightGutter() {
  return <div aria-hidden style={{ width: FADE_W, minWidth: FADE_W, flexShrink: 0 }} />;
}

function ParSub({ value, wide }: { value: number; wide?: boolean }) {
  return (
    <div
      className="flex items-center justify-center"
      style={{
        width: wide ? TOTAL_W : SUB_W,
        minWidth: wide ? TOTAL_W : SUB_W,
        flexShrink: 0,
        background: wide ? "rgba(45,212,191,0.07)" : "rgba(255,255,255,0.025)",
      }}
    >
      <span style={{ fontSize: 11, color: "var(--color-bt-text-dim)", fontVariantNumeric: "tabular-nums" }}>{value}</span>
    </div>
  );
}
