"use client";

import { useState } from "react";
import { TYPE_SCALE } from "@/lib/typeScale";
import { TotalPoolRow } from "@/components/games/NonGolfSettingsRows";
import { liveMatchPointsPerMatch } from "@/lib/pointsDistribution";

/**
 * The two scoring settings — confidence on/off, and how points roll up.
 *
 * ── Why these live on the SETTINGS PAGE and not in the slate modal ─────────
 *
 * They started inside the slate modal, on the reasoning that spec §4 freezes
 * them at the same instant as the slate, so one frozen thing should be one
 * screen. That is true about the FREEZE and wrong about the JOB. Two different
 * jobs had been stacked behind one door:
 *
 *   * the slate is a LIST you build, edit and reorder — sixteen rows of work
 *   * these are two SWITCHES that decide what the whole game is
 *
 * Burying the switches under the list means the person setting up a game has to
 * open "The slate" to answer a question that has nothing to do with which games
 * are on it, then scroll past sixteen rows to reach it. It also put them behind
 * the modal's Save, so toggling confidence and closing the modal discarded the
 * change silently — draft-then-save behaving exactly as designed, on a control
 * nobody expected to be part of that draft.
 *
 * The slate modal is now for adding games. These are settings, and they sit
 * with the settings.
 *
 * ── They still share the freeze, and still commit through the same RPC ─────
 *
 * `editable` is `scoringSettingsEditable(clock)` — the same predicate, unmoved.
 * Save sends `{ settings }` with no `slate` key, which `save_pickem_config`
 * already supports and which `pickemSlateSave.test.ts` already pins ("an absent
 * key leaves that half alone"). Moving the UI changed no server contract.
 */

export interface PickemSettingsDraft {
  rollUp: "team_totals" | "individual_matches";
  useConfidence: boolean;
}

export function PickemScoringRows({
  settings,
  editable,
  showRollUp,
  saving,
  pointsTotal,
  canEditPoints,
  matches,
  onPointsChange,
  onSave,
}: {
  settings: PickemSettingsDraft;
  /** False once picks open — spec §4 freezes these with the slate. */
  editable: boolean;
  /** Roll-up only means something inside a competition. A standalone pick'em
   *  game has no sides to total, so the row is ABSENT rather than disabled. */
  showRollUp: boolean;
  saving: boolean;
  /** `games.points_total`. Null or 0 means every match is worth nothing. */
  pointsTotal: number | null;
  /** Points are NOT frozen with the slate — a runner can set them after picks
   *  open, which is the common case since nothing forces it earlier. */
  canEditPoints: boolean;
  /** The game's matches, for the divisor. Shape matches
   *  `liveMatchPointsPerMatch` exactly so nothing here re-derives "valid". */
  matches: { sideAId: string | null; sideBId: string | null; pointValue: number | null }[];
  onPointsChange: (total: number | null) => void;
  onSave: (next: PickemSettingsDraft) => void;
}) {
  const [draft, setDraft] = useState<PickemSettingsDraft>(settings);
  // Compared by value, not by a `touched` flag: toggling a switch and toggling
  // it back is not a change, and offering Save for it invites a write that does
  // nothing and an "unsaved changes" warning nobody caused.
  const dirty = draft.rollUp !== settings.rollUp || draft.useConfidence !== settings.useConfidence;

  /**
   * The per-match award, from the ONE shared divisor (#1068) — never
   * re-derived. It filters both-sides-filled and divides by that count, which
   * is exactly spec §4's "seven matches means X/7 each".
   */
  const perMatch = liveMatchPointsPerMatch(pointsTotal, matches);
  const validMatches = matches.filter((m) => m.sideAId != null && m.sideBId != null).length;
  const individual = settings.rollUp === "individual_matches";
  /** Matches are set up and the total still says nothing is at stake. The
   *  runner may legitimately set the total later — so this is SURFACED, never
   *  blocking (spec §2). */
  const worthNothing = validMatches > 0 && !pointsTotal;

  return (
    <div className="flex flex-col gap-2">
      {/* FIRST, because it is the setting that decides whether any of the rest
          matters. Nothing set it before Phase 4, so every pick'em game was
          quietly worth 0.00 a match. */}
      <TotalPoolRow value={pointsTotal} canEdit={canEditPoints} onChange={onPointsChange} />

      {/* The "each worth" line renders ONLY under individual matches: team
          totals awards the whole total to one side and points mode splits it
          across places, so a per-match figure would be a number about a
          mechanic neither of them has. */}
      {individual && (
        <p
          data-testid="pickem-per-match"
          style={{
            fontSize: TYPE_SCALE.caption,
            color: worthNothing ? "var(--color-bt-warning)" : "var(--color-bt-text-dim)",
            fontWeight: worthNothing ? 600 : 400,
            lineHeight: 1.5,
            margin: "-2px 2px 2px",
          }}
        >
          {validMatches === 0
            ? "Set the matches and each one's share appears here."
            : `Each of the ${validMatches} match${validMatches === 1 ? "" : "es"} is worth ${perMatch.toFixed(2)} pts.`}
          {worthNothing && " Set a total above, or the game decides nothing."}
        </p>
      )}

      {!editable && (
        <p
          style={{
            fontSize: TYPE_SCALE.caption,
            color: "var(--color-bt-text-dim)",
            lineHeight: 1.5,
          }}
        >
          Picks are open, so scoring is frozen — everyone has already filled in a sheet
          under these rules. Reopen the slate below to change them.
        </p>
      )}

      <ToggleRow
        title="Use confidence points"
        detail={
          draft.useConfidence
            ? "Everyone ranks their picks. A correct pick scores the rank it was given."
            : "No ranking. Every correct pick is worth one point."
        }
        on={draft.useConfidence}
        disabled={!editable}
        onToggle={() => setDraft((s) => ({ ...s, useConfidence: !s.useConfidence }))}
      />

      {showRollUp && (
        <ChoiceRow
          title="How points are awarded"
          options={[
            {
              value: "team_totals",
              label: "Team totals",
              detail: "Every sheet sums into its side's number. Higher total takes the points.",
            },
            {
              value: "individual_matches",
              label: "Individual matches",
              detail: "Each person plays one person on the other side. Points split across the matches.",
            },
          ]}
          value={draft.rollUp}
          disabled={!editable}
          onChange={(v) => setDraft((s) => ({ ...s, rollUp: v as PickemSettingsDraft["rollUp"] }))}
        />
      )}

      {editable && dirty && (
        <div className="flex items-center gap-3">
          <span style={{ fontSize: TYPE_SCALE.caption, color: "var(--color-bt-text-dim)", flex: 1 }}>
            Unsaved changes
          </span>
          <button
            type="button"
            onClick={() => onSave(draft)}
            disabled={saving}
            data-testid="pickem-save-scoring"
            className="rounded-xl px-4 py-2 disabled:opacity-40"
            style={{
              fontSize: TYPE_SCALE.bodyDense,
              fontWeight: 700,
              background: "var(--color-bt-accent)",
              color: "var(--color-bt-base)",
              minHeight: 40,
            }}
          >
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      )}
    </div>
  );
}

/** A settings row, the same weight as the rows beside it on the settings page —
 *  this IS a scoring setting, and smaller type read it as a footnote. */
function ToggleRow({
  title,
  detail,
  on,
  disabled,
  onToggle,
}: {
  title: string;
  detail: string;
  on: boolean;
  disabled: boolean;
  onToggle: () => void;
}) {
  return (
    <div
      className="flex items-center gap-3 rounded-xl px-3 py-2.5"
      style={{ background: "var(--color-bt-card)", border: "1px solid var(--color-bt-border)" }}
    >
      <div className="min-w-0 flex-1">
        <div style={{ fontSize: TYPE_SCALE.body, fontWeight: 600 }}>{title}</div>
        <div
          style={{ fontSize: TYPE_SCALE.caption, color: "var(--color-bt-text-dim)", marginTop: 2, lineHeight: 1.45 }}
        >
          {detail}
        </div>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={on}
        aria-label={title}
        disabled={disabled}
        onClick={onToggle}
        data-testid="pickem-confidence-toggle"
        className="relative shrink-0 rounded-full disabled:opacity-40"
        style={{
          width: 42,
          height: 24,
          background: on ? "var(--color-bt-accent-faint)" : "var(--color-bt-card-raised)",
          border: `1px solid ${on ? "var(--color-bt-accent-border)" : "var(--color-bt-border)"}`,
        }}
      >
        <span
          className="absolute rounded-full"
          style={{
            top: 2,
            left: on ? 20 : 2,
            width: 18,
            height: 18,
            background: on ? "var(--color-bt-accent)" : "var(--color-bt-text-dim)",
            transition: "left .14s",
          }}
        />
      </button>
    </div>
  );
}

function ChoiceRow({
  title,
  options,
  value,
  disabled,
  onChange,
}: {
  title: string;
  options: { value: string; label: string; detail: string }[];
  value: string;
  disabled: boolean;
  onChange: (v: string) => void;
}) {
  return (
    <div
      className="rounded-xl px-3 py-2.5"
      style={{ background: "var(--color-bt-card)", border: "1px solid var(--color-bt-border)" }}
    >
      <div style={{ fontSize: TYPE_SCALE.body, fontWeight: 600, marginBottom: 6 }}>{title}</div>
      <div className="flex flex-col gap-1.5">
        {options.map((o) => {
          const on = o.value === value;
          return (
            <button
              key={o.value}
              type="button"
              disabled={disabled}
              onClick={() => onChange(o.value)}
              aria-pressed={on}
              className="rounded-lg px-2.5 py-2 text-left disabled:opacity-40"
              style={{
                background: on ? "var(--color-bt-accent-faint)" : "transparent",
                border: `1px solid ${on ? "var(--color-bt-accent-border)" : "var(--color-bt-border)"}`,
              }}
            >
              <div
                style={{
                  fontSize: TYPE_SCALE.bodyDense,
                  fontWeight: 600,
                  color: on ? "var(--color-bt-accent)" : "var(--color-bt-text)",
                }}
              >
                {o.label}
              </div>
              <div
                style={{ fontSize: TYPE_SCALE.caption, color: "var(--color-bt-text-dim)", marginTop: 1 }}
              >
                {o.detail}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
