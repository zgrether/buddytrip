"use client";

import type { ReactNode } from "react";
import { Hash, ListOrdered, Users } from "lucide-react";
import { ChecklistRow } from "@/components/games/ChecklistRow";
import { SegmentedToggle } from "@/components/games/SegmentedToggle";
import { Stepper } from "@/components/games/Stepper";
import { TYPE_SCALE } from "@/lib/typeScale";
import { liveMatchPointsPerMatch } from "@/lib/pointsDistribution";

/**
 * Pick'em's settings rows.
 *
 * ── Everything is a `ChecklistRow` ─────────────────────────────────────────
 *
 * These were hand-rolled — a private `ToggleRow` and `ChoiceRow` that agreed
 * with the rest of the app only by coincidence of nobody having changed either
 * side. The bracket, golf and non-golf pages all compose `ChecklistRow`, so a
 * pick'em game was the one format whose settings looked like a different
 * product: different row height, different padding, no icon tile, no resolved
 * state, and a bespoke radio list where every other page uses a segmented
 * control.
 *
 * The exception is the scoring-format pair, which is a two-card grid rather
 * than a row. Two mutually exclusive FORMATS with a sentence each are not a
 * setting with a value; the cards carry their own explanation, which is why
 * there is no "How points are awarded" heading above them any more — the
 * heading existed to say what the options could not.
 */

export interface PickemSettingsDraft {
  rollUp: "team_totals" | "individual_matches";
  useConfidence: boolean;
}

export function PickemScoringRows({
  settings,
  editable,
  frozenReason,
  showRollUp,
  slateCount,
  onChange,
  slateRow,
  matchesRow,
}: {
  settings: PickemSettingsDraft;
  /** False once picks open — spec §4 freezes these with the slate. */
  editable: boolean;
  /** WHY they are frozen, from `scoringFrozenReason` — null while editable.
   *  Derived by the caller from the phase rather than written here, because the
   *  static version of this sentence said "picks are open" on a LOCKED game. */
  frozenReason: string | null;
  /**
   * Roll-up only means something in a MATCH-PLAY competition. A standalone
   * pick'em game has no sides to total, and a POINTS cup overrides the setting
   * entirely — its teams are ordered and placement pays, whatever this column
   * happens to say.
   *
   * ABSENT rather than disabled in both cases. A disabled control still claims
   * the setting exists and is merely unavailable; these are settings that do
   * not apply at all.
   */
  showRollUp: boolean;
  /** The slate's size, for "Ranked 16 down to 1" — the concrete version. */
  slateCount: number;
  /** The page's draft setter. This component owns NO state: it used to keep a
   *  private draft with its own Save button, which made it a third write model
   *  on a page that already had three. Everything now rides the page's one
   *  atomic Save (#18). */
  onChange: (next: PickemSettingsDraft) => void;
  /** The Picks row, built by the caller because it opens a modal the caller owns. */
  slateRow?: ReactNode;
  /** The pairing grid. Null unless the game actually pairs. */
  matchesRow?: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-2">
      {/* NO zone headers here. `GameSettingsPage` already prints "Game
          Management" and "Pick'em settings", so emitting our own put a second
          GAME MANAGEMENT under the page's and a SETTINGS under PICK'EM
          SETTINGS. Third instance of the same composition bug — two components
          each correct alone, one screen saying it twice.

          The design puts Total Points and The Picks under GAME MANAGEMENT.
          Total Points goes there via the page's `totalPointsRow` slot; The
          Picks CANNOT, because that slot is gated on `competitionId` and a
          standalone game still needs its slate. Correctness over zoning: the
          row stays reachable. */}
      {slateRow}

      {/* No heading of its own: the cards say what the heading used to. */}
        {showRollUp && (
          <FormatCards
            value={settings.rollUp}
            disabled={!editable}
            onChange={(rollUp) => onChange({ ...settings, rollUp })}
          />
        )}

        {matchesRow}

        <ChecklistRow
          icon={ListOrdered}
          title="Confidence Points"
          testId="row-confidence"
          state="resolved"
          /* The CONCRETE version, and shorter — the long one truncated to
              "Ranked, highest to lowest — …" beside the toggle, which is a
              subtitle that stops before the part carrying the meaning. */
          subtitle={
            settings.useConfidence
              ? slateCount > 0
                ? `Ranked ${slateCount} down to 1`
                : "Ranked, highest first"
              : "Every correct pick scores 1"
          }
          control={
            <SegmentedToggle
              value={settings.useConfidence ? "on" : "off"}
              options={[
                { value: "off", label: "Off" },
                { value: "on", label: "On" },
              ]}
              disabled={!editable}
              onChange={(v) => onChange({ ...settings, useConfidence: v === "on" })}
              testId="pickem-confidence-toggle"
            />
          }
        />

        {/* DERIVED — the static version of this sentence claimed picks were
            open on a game that was locked. */}
      {frozenReason && (
        <p
          data-testid="pickem-scoring-frozen"
          className="px-1"
          style={{
            fontSize: TYPE_SCALE.caption,
            color: "var(--color-bt-text-dim)",
            lineHeight: 1.5,
          }}
        >
          {frozenReason}
        </p>
      )}
    </div>
  );
}

/**
 * Total Points — the page's own GAME MANAGEMENT slot.
 *
 * Separate from the rows above because it belongs to a zone this component does
 * not own, and passing it through as a slot is what keeps the zone headers in
 * one place.
 */
export function PickemTotalPointsRow({
  pointsTotal,
  canEditPoints,
  matches,
  rollUp,
  onPointsChange,
}: {
  pointsTotal: number | null;
  canEditPoints: boolean;
  matches: { sideAId: string | null; sideBId: string | null; pointValue: number | null }[];
  rollUp: PickemSettingsDraft["rollUp"];
  onPointsChange: (next: number | null) => void;
}) {
  const perMatch = liveMatchPointsPerMatch(pointsTotal, matches);
  const assigned = matches.filter((m) => m.sideAId != null && m.sideBId != null);
  const individual = rollUp === "individual_matches";

  return (
    <ChecklistRow
      icon={Hash}
      /* "Total Points" implies a division that team totals does not do, so
         the label changes with the format — but the design's "Points for this
         game" is 20 characters and truncated to "Points for this ga…" beside an
         inline stepper at 390. Shorter, same distinction. */
      title={individual ? "Total Points" : "Game Points"}
      testId="row-total-points"
      state={pointsTotal ? "resolved" : "empty"}
      subtitle={
        <PointsSubtitle
          individual={individual}
          validMatches={assigned.length}
          perMatch={perMatch}
          hasOverrides={assigned.some((m) => m.pointValue != null)}
          worthNothing={assigned.length > 0 && !pointsTotal}
        />
      }
      control={
        <Stepper
          value={pointsTotal ?? 0}
          min={0}
          max={99}
          onChange={(v) => onPointsChange(v === 0 ? null : v)}
          disabled={!canEditPoints}
          size="inline"
          /* No `label`. The row's title already says what the number is, and
             the stepper's own "TOTAL POINTS" caption ate enough width to
             truncate the subtitle to "Points per matc…". */
        />
      }
    />
  );
}

/**
 * What the total is worth per match, or why there is no such figure yet.
 *
 * The divisor is VALID matches — both sides filled — so an unpaired game says
 * so rather than dividing by a number that includes empty slots.
 */
function PointsSubtitle({
  individual,
  validMatches,
  perMatch,
  hasOverrides,
  worthNothing,
}: {
  individual: boolean;
  validMatches: number;
  perMatch: number;
  hasOverrides: boolean;
  worthNothing: boolean;
}) {
  // Team totals awards the whole total to one side and points mode splits it
  // across places, so a per-match figure there would be a number about a
  // mechanic neither of them has.
  if (!individual) return <>Higher total takes them all</>;

  if (validMatches === 0) {
    return <>Set the matches and each one&rsquo;s share appears here.</>;
  }

  return (
    <span data-testid="pickem-per-match">
      Points per match:{" "}
      <span style={{ color: "var(--color-bt-accent)", fontWeight: 600 }}>
        {perMatch.toFixed(2)}
      </span>
      {hasOverrides && " for the ones without their own value"}
      {worthNothing && (
        <span style={{ color: "var(--color-bt-warning)", fontWeight: 600 }}>
          {" "}
          — set a total, or the game decides nothing.
        </span>
      )}
    </span>
  );
}

/**
 * The two scoring formats, as cards.
 *
 * A card each rather than a segmented control or a radio list, because the
 * choice is not a value on an axis — the two produce different SCREENS, and the
 * sentence under each is what a runner is actually choosing between. That
 * sentence is also why the group needs no heading.
 */
function FormatCards({
  value,
  disabled,
  onChange,
  }: {
  value: PickemSettingsDraft["rollUp"];
  disabled: boolean;
  onChange: (next: PickemSettingsDraft["rollUp"]) => void;
}) {
  const cards = [
    {
      key: "individual_matches" as const,
      title: "Individual matches",
      body: "One person per side. Points split across the matches.",
    },
    {
      key: "team_totals" as const,
      title: "Team totals",
      body: "Every sheet sums into its side. Higher total takes the points.",
    },
  ];

  return (
    <div className="grid gap-2" style={{ gridTemplateColumns: "1fr 1fr" }} data-testid="pickem-format-cards">
      {cards.map((c) => {
        const selected = value === c.key;
        return (
          <button
            key={c.key}
            type="button"
            disabled={disabled}
            onClick={() => onChange(c.key)}
            data-testid={`pickem-format-${c.key}`}
            data-selected={selected ? "true" : "false"}
            className="flex flex-col gap-1 text-left disabled:opacity-50"
            style={{
              borderRadius: 12,
              padding: "11px 11px 12px",
              background: selected ? "var(--color-bt-accent-faint)" : "var(--color-bt-card)",
              border: `1px solid ${selected ? "var(--color-bt-accent-border)" : "var(--color-bt-border)"}`,
            }}
          >
            <span className="flex items-center gap-1.5">
              <Users
                size={15}
                style={{
                  color: selected ? "var(--color-bt-accent)" : "var(--color-bt-text-dim)",
                  flexShrink: 0,
                }}
              />
              {selected && (
                <span
                  className="ml-auto"
                  style={{ fontSize: 11, fontWeight: 700, color: "var(--color-bt-accent)" }}
                >
                  ✓
                </span>
              )}
            </span>
            <span
              style={{
                fontSize: 13.5,
                fontWeight: 600,
                color: selected ? "var(--color-bt-accent)" : "var(--color-bt-text)",
              }}
            >
              {c.title}
            </span>
            <span
              style={{ fontSize: 11.5, lineHeight: 1.4, color: "var(--color-bt-text-dim)" }}
            >
              {c.body}
            </span>
          </button>
        );
      })}
    </div>
  );
}
