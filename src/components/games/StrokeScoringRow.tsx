"use client";

import { Check, Lock, ListOrdered, Trophy, Minus, Plus } from "lucide-react";
import { TYPE_SCALE } from "@/lib/typeScale";
import {
  DEFAULT_PRESET,
  STABLEFORD_PRESETS,
  edgeLabel,
  matchesPreset,
  rubricBuckets,
  withBucketPoints,
  withEdge,
  type StablefordConfig,
  type StablefordPresetId,
  type StablefordRubric,
} from "@/lib/stableford";
import type { StrokeScoringDraft } from "@/lib/configDraft";

/**
 * SCORING TYPE — Traditional or Stableford — plus the rubric panel.
 *
 * Sits in GAME MANAGEMENT beside Golf Course, deliberately: the rubric scores a
 * hole against its PAR, so the course and the scoring type are the same tier of
 * decision, and reading one right after the other is how a runner discovers that
 * a Stableford game needs a real course.
 *
 * CONTROLLED — reports to the parent's draft; Save persists (#18). Nothing here
 * self-persists, so there is no collapse-timing window to lose an edit in.
 *
 * ── The lock ───────────────────────────────────────────────────────────────
 *
 * `locked` mirrors the server's `SCORING_TYPE_LOCKED` (migration 179): once a
 * game has produced results, the scoring type AND its rubric are fixed. Holes
 * already played were played under the incentives the rubric set — under
 * Stableford a blow-up stops costing past the floor — so rescoring them after
 * the fact judges a card by a rule it was never played to.
 *
 * The client lock is not the mechanism; the server is. It exists because a
 * server refusal with no client lock is the worse direction of the same gap
 * (#703's family): the runner changes the setting, taps Save, and gets an error
 * instead of seeing the control was unavailable.
 *
 * The message names the DANGER ZONE because that is where clearing scores lives,
 * and clearing scores is what actually lifts the condition. A refusal that names
 * an action the reader cannot take is worse than one that says nothing.
 */

const TYPE_TILES = [
  {
    key: "traditional" as const,
    label: "Traditional",
    desc: "Count strokes. Lowest total wins.",
    Icon: ListOrdered,
  },
  {
    key: "stableford" as const,
    label: "Stableford",
    desc: "Points per hole vs par. Highest total wins.",
    Icon: Trophy,
  },
];

/**
 * The presets the panel NAMES, in order. `bbmi_2024` is deliberately absent: its
 * numbers are still the CUSTOM tile's seed (below), but a scale named after one
 * trip is not a product preset, and the tile that offers it reads "Custom".
 *
 * Keeping the entry in `STABLEFORD_PRESETS` rather than deleting it preserves
 * what it is FOR — the values the 2024 card was scored under, pinned to that
 * card's printed legend by `stableford.test.ts`. The data is provenance; only
 * the naming moved.
 */
const NAMED_PRESETS: Exclude<StablefordPresetId, "custom" | "bbmi_2024">[] = ["standard", "modified"];

/**
 * What tapping CUSTOM applies — the wider scale, because that is what a custom
 * rubric is almost always reached for: with a standard floor at +2 and scores in
 * the high 90s, nearly every hole pays zero and the card stops being a game.
 * Landing on a usable wider spread beats landing on a copy of Standard.
 */
const CUSTOM_SEED = STABLEFORD_PRESETS.bbmi_2024.rubric;

export function StrokeScoringRow({
  value,
  canEdit,
  locked,
  onChange,
}: {
  value: StrokeScoringDraft;
  canEdit: boolean;
  /** Scores exist — the server will refuse a change (SCORING_TYPE_LOCKED). */
  locked: boolean;
  onChange: (next: StrokeScoringDraft) => void;
}) {
  const editable = canEdit && !locked;
  const cfg = value.stableford;

  const setType = (type: "traditional" | "stableford") => {
    if (type === value.type) return;
    if (type === "traditional") return onChange({ type: "traditional", stableford: null });
    // Opening Stableford seeds the DEFAULT preset rather than an empty rubric —
    // an unconfigured rubric would pay everyone zero, and `[]` is truthy.
    const preset = STABLEFORD_PRESETS[DEFAULT_PRESET as Exclude<StablefordPresetId, "custom">];
    onChange({ type: "stableford", stableford: { preset: DEFAULT_PRESET, ...preset.rubric } });
  };

  const setRubric = (rubric: StablefordRubric, preset?: StablefordPresetId) => {
    if (!cfg) return;
    // The preset LABEL is derived from the numbers on every edit, so it can
    // never claim a preset the values no longer match.
    const resolved =
      preset ?? (NAMED_PRESETS.find((p) => matchesPreset(rubric, p)) ?? "custom");
    onChange({ type: "stableford", stableford: { preset: resolved, ...rubric } });
  };

  return (
    // NO horizontal padding. The neighbouring settings rows are ChecklistRow
    // CARDS that span this container edge to edge, so an inset here made the
    // tiles 24px narrower than every card above and below them — measured at
    // 373px against their 397px, which reads as a misalignment rather than as a
    // deliberate inset. The label keeps `px-1` to sit over the tile's own
    // padding, matching how Competition Format labels its row.
    <div data-testid="row-scoring-type" style={{ padding: "12px 0 4px" }}>
      <div
        className="flex items-center gap-1.5 px-1 pb-2"
        style={{ fontSize: TYPE_SCALE.captionPlus, fontWeight: 600, color: "var(--color-bt-text-dim)" }}
      >
        Scoring Type
        {locked && <Lock size={12} style={{ color: "var(--color-bt-text-dim)" }} />}
      </div>

      <div className="grid grid-cols-2 gap-2" data-testid="scoring-type-options">
        {TYPE_TILES.map((t) => {
          const selected = value.type === t.key;
          return (
            <button
              key={t.key}
              type="button"
              disabled={!editable}
              onClick={() => setType(t.key)}
              aria-pressed={selected}
              className="flex flex-col gap-1 rounded-xl px-2.5 py-2.5 text-left disabled:cursor-not-allowed"
              style={{
                background: selected ? "var(--color-bt-accent-faint)" : "var(--color-bt-card-raised)",
                border: `1px solid ${selected ? "var(--color-bt-accent-border)" : "var(--color-bt-border)"}`,
                opacity: editable ? 1 : 0.6,
              }}
              data-testid={`scoring-type-tile-${t.key}`}
            >
              <div className="flex items-center gap-1.5">
                <t.Icon size={15} style={{ color: "var(--color-bt-accent)", flexShrink: 0 }} />
                {selected && <Check size={13} style={{ color: "var(--color-bt-accent)", marginLeft: "auto" }} />}
              </div>
              <span className="font-semibold" style={{ fontSize: TYPE_SCALE.body, color: "var(--color-bt-text)", lineHeight: 1.2 }}>
                {t.label}
              </span>
              <span style={{ fontSize: TYPE_SCALE.caption, color: "var(--color-bt-text-dim)", lineHeight: 1.3 }}>
                {t.desc}
              </span>
            </button>
          );
        })}
      </div>

      {locked && (
        <p
          className="px-1 pt-2"
          style={{ fontSize: TYPE_SCALE.caption, color: "var(--color-bt-text-dim)", lineHeight: 1.4 }}
          data-testid="scoring-type-locked-note"
        >
          Scores are in, so how this game scores is fixed — the holes already played were
          played under these rules. Reset scores in the Danger zone below to change it.
        </p>
      )}

      {value.type === "stableford" && cfg && (
        <RubricPanel config={cfg} editable={editable} onChange={setRubric} />
      )}
    </div>
  );
}

/**
 * The rubric panel — preset tiles plus every bucket the rubric defines.
 *
 * Buckets are DERIVED from the rubric (`rubricBuckets`), never a fixed list, so
 * the panel cannot show a bucket the scorer does not honour. The two ends read
 * as the catch-alls they are ("Triple bogey or worse"), because that is the
 * difference between a range and a map and it is invisible otherwise.
 */
function RubricPanel({
  config,
  editable,
  onChange,
}: {
  config: StablefordConfig;
  editable: boolean;
  onChange: (rubric: StablefordRubric, preset?: StablefordPresetId) => void;
}) {
  const rubric: StablefordRubric = { ceiling: config.ceiling, floor: config.floor, points: config.points };
  const buckets = rubricBuckets(rubric);

  return (
    <div
      className="mt-3 rounded-xl p-3"
      style={{ background: "var(--color-bt-card-raised)", border: "1px solid var(--color-bt-border)" }}
      data-testid="stableford-rubric-panel"
    >
      <div
        className="pb-2"
        style={{ fontSize: TYPE_SCALE.caption, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--color-bt-text-dim)" }}
      >
        Points per hole
      </div>

      {/* Standard · Modified · Custom. CUSTOM IS A REAL TILE, not a note beside
          the presets: it is the state any edited rubric lands in, so giving it a
          tile means one thing on screen says which scale is in force instead of
          a lit preset plus a caption contradicting it. */}
      <div className="grid grid-cols-3 gap-2 pb-3" data-testid="stableford-preset-options">
        {NAMED_PRESETS.map((id) => (
          <PresetTile
            key={id}
            id={id}
            label={STABLEFORD_PRESETS[id].label}
            selected={config.preset === id}
            editable={editable}
            onClick={() => onChange(STABLEFORD_PRESETS[id].rubric, id)}
          />
        ))}
        <PresetTile
          id="custom"
          label="Custom"
          // A rubric that matches no named scale IS custom, however it got there
          // — picked, edited, or read back from a row saved before this tile
          // existed (those carry `preset: "bbmi_2024"`).
          selected={config.preset === "custom" || config.preset === "bbmi_2024"}
          editable={editable}
          onClick={() => onChange(CUSTOM_SEED, "custom")}
        />
      </div>

      {/* One row per bucket, best first. The ends carry "or better" / "or worse"
          so the catch-all reads as a range rather than a single score. */}
      <div className="flex flex-col gap-1" data-testid="stableford-buckets">
        {buckets.map((b) => (
          <div
            key={b.differential}
            className="flex items-center gap-2"
            data-testid={`stableford-bucket-${b.differential}`}
          >
            <span
              className="flex-1"
              style={{ fontSize: TYPE_SCALE.bodyDense, color: b.isEdge ? "var(--color-bt-text-dim)" : "var(--color-bt-text)" }}
            >
              {b.label}
            </span>
            <PointStepper
              value={b.points}
              editable={editable}
              onChange={(next) => onChange(withBucketPoints(rubric, b.differential, next))}
              testId={`stableford-points-${b.differential}`}
            />
          </div>
        ))}
      </div>

      {/* The EDGES move, which is how the scale slides right. Without this the
          BBMI 2024 shape is not reachable by editing a preset. */}
      <div className="mt-3 flex items-center justify-between gap-2 pt-2" style={{ borderTop: "1px solid var(--color-bt-border)" }}>
        <EdgeControl
          label="Best"
          current={edgeLabel(rubric.ceiling, "ceiling")}
          editable={editable}
          onOut={() => onChange(withEdge(rubric, "ceiling", rubric.ceiling - 1))}
          onIn={() => onChange(withEdge(rubric, "ceiling", rubric.ceiling + 1))}
          canIn={rubric.ceiling < rubric.floor}
          testId="stableford-edge-ceiling"
        />
        <EdgeControl
          label="Worst"
          current={edgeLabel(rubric.floor, "floor")}
          editable={editable}
          onOut={() => onChange(withEdge(rubric, "floor", rubric.floor + 1))}
          onIn={() => onChange(withEdge(rubric, "floor", rubric.floor - 1))}
          canIn={rubric.floor > rubric.ceiling}
          testId="stableford-edge-floor"
        />
      </div>
    </div>
  );
}

function PresetTile({
  id, label, selected, editable, onClick,
}: {
  id: string;
  label: string;
  selected: boolean;
  editable: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      disabled={!editable}
      onClick={onClick}
      aria-pressed={selected}
      className="rounded-lg px-2 py-1.5 text-left disabled:cursor-not-allowed"
      style={{
        background: selected ? "var(--color-bt-accent-faint)" : "var(--color-bt-card)",
        border: `1px solid ${selected ? "var(--color-bt-accent-border)" : "var(--color-bt-border)"}`,
        opacity: editable ? 1 : 0.6,
      }}
      data-testid={`stableford-preset-${id}`}
    >
      <span className="font-semibold" style={{ fontSize: TYPE_SCALE.caption, color: "var(--color-bt-text)", lineHeight: 1.25 }}>
        {label}
      </span>
    </button>
  );
}

function PointStepper({
  value, editable, onChange, testId,
}: {
  value: number;
  editable: boolean;
  onChange: (next: number) => void;
  testId: string;
}) {
  return (
    <div className="flex items-center gap-1" data-testid={testId}>
      <StepButton icon={Minus} disabled={!editable} onClick={() => onChange(value - 1)} label="one less point" />
      <span
        className="text-center tabular-nums font-semibold"
        style={{ fontSize: TYPE_SCALE.body, color: "var(--color-bt-text)", minWidth: 26 }}
        data-testid={`${testId}-value`}
      >
        {value}
      </span>
      <StepButton icon={Plus} disabled={!editable} onClick={() => onChange(value + 1)} label="one more point" />
    </div>
  );
}

function EdgeControl({
  label, current, editable, onOut, onIn, canIn, testId,
}: {
  label: string;
  current: string;
  editable: boolean;
  onOut: () => void;
  onIn: () => void;
  canIn: boolean;
  testId: string;
}) {
  return (
    <div className="flex flex-1 flex-col gap-1" data-testid={testId}>
      <span style={{ fontSize: TYPE_SCALE.micro, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--color-bt-text-dim)" }}>
        {label}
      </span>
      <div className="flex items-center gap-1">
        <StepButton icon={Minus} disabled={!editable || !canIn} onClick={onIn} label={`fewer ${label} buckets`} />
        <span
          className="flex-1 text-center"
          style={{ fontSize: TYPE_SCALE.caption, color: "var(--color-bt-text-dim)", lineHeight: 1.2 }}
          data-testid={`${testId}-value`}
        >
          {current}
        </span>
        <StepButton icon={Plus} disabled={!editable} onClick={onOut} label={`more ${label} buckets`} />
      </div>
    </div>
  );
}

function StepButton({
  icon: Icon, disabled, onClick, label,
}: {
  icon: typeof Minus;
  disabled: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      aria-label={label}
      className="flex items-center justify-center rounded-lg disabled:opacity-40 disabled:cursor-not-allowed"
      style={{
        width: 28,
        height: 28,
        background: "var(--color-bt-card)",
        border: "1px solid var(--color-bt-border)",
        color: "var(--color-bt-text)",
        flexShrink: 0,
      }}
    >
      <Icon size={14} />
    </button>
  );
}
