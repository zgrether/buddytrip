"use client";

import { Lock, Radio } from "lucide-react";
import { SegmentedToggle } from "@/components/games/SegmentedToggle";

/**
 * GameManagementPanel (A2-ux) — the canonical **Setup / Scoring** toggle, the
 * keystone game-mode control. It lives on the ONE settings page (the correction:
 * never on the scoreboard pass-through — flipping there would be a self-destroying
 * control), in BOTH modes, so it's bidirectional:
 *
 *   [icon] Game State                     [ Setup | Scoring ]
 *          <subtitle: current state / what Save will do>
 *
 *  - **Setup mode** (status pending): Setup is the active segment; the **Scoring**
 *    segment is the action — tapping it enables scoring (A2-core's reconciled enable,
 *    status:'active' + publish), gated by `ready` (the client mirror of the server
 *    readiness guard — locked until the minimum requirements are met).
 *  - **Scoring mode** (live): Scoring is the active segment; the **Setup** segment is
 *    the action — tapping it disables scoring (back to setup, scores kept).
 *
 * Freeze-redesign polish (item B): this row carries the icon-tile + title + subtitle
 * grammar every OTHER settings row has (it was the one bare toggle). The toggle is the
 * SHARED `SegmentedToggle` — the same neutral segmented control Entry Mode uses, NOT a
 * teal-fill lookalike (teal is the Primary-button CTA per STYLE_GUIDE §5, which a state
 * toggle must not borrow). The subtitle has THREE states and MUST NEVER assert a server
 * state the server doesn't hold — this row has produced two lies before
 * (ScoringLockBanner, the old copy):
 *   - on / on   → "Game is live — scoring enabled"
 *   - off / off → "Not live — scoring disabled"
 *   - staged (draft ≠ server) → what's still true AND what Save will do.
 * The toggle POSITION follows the draft (it must answer the tap); the SUBTITLE tells
 * the truth about the server + the pending Save.
 */
export function GameManagementPanel({
  mode,
  ready,
  onEnable,
  onDisable,
  pending = false,
  staged = false,
}: {
  /** Current game mode — `scoring` once scoring is enabled, else `setup`. */
  mode: "setup" | "scoring";
  /** Minimum requirements met — the Scoring segment is enabled only when true.
   *  Formats with no hard readiness gate (stroke/rack) pass `true`. */
  ready: boolean;
  onEnable: () => void;
  onDisable: () => void;
  pending?: boolean;
  /** Draft-then-save: `mode` reflects the DRAFT and hasn't been committed yet, so the
   *  subtitle must not claim a live game that isn't live (or a closed one still open).
   *  The toggle position still follows the draft — it has to answer the tap — but the
   *  subtitle says what's actually true and what Save will do. Self-persisting hosts
   *  (stroke/rack/non-golf) omit this → never staged → the plain on/off subtitle. */
  staged?: boolean;
}) {
  const isScoring = mode === "scoring";
  const scoringLocked = !isScoring && !ready;

  // THREE-state subtitle — the lie class, kept SHORT. The plain states describe SERVER
  // truth (safe because !staged ⟹ draft === server); the staged state names both
  // what's still true on the server AND the pending Save.
  const subtitle = staged
    ? isScoring
      ? "Not live — Save to enable scoring"
      : "Live now — Save to disable scoring"
    : isScoring
      ? "Game is live — scoring enabled"
      : "Not live — scoring disabled";

  return (
    <div
      className="flex items-center gap-3 rounded-2xl px-3.5 py-3 text-left"
      style={{ background: "var(--color-bt-card)", border: "1px solid var(--color-bt-border)" }}
      data-testid="game-management-panel"
    >
      {/* Icon tile — matches ChecklistRow's 38px tile so the row lines up with its peers. */}
      <span
        className="relative flex shrink-0 items-center justify-center"
        style={{ width: 38, height: 38, borderRadius: 10, background: "var(--color-bt-card-raised)" }}
      >
        <Radio size={18} style={{ color: isScoring ? "var(--color-bt-accent)" : "var(--color-bt-text)" }} strokeWidth={1.75} />
      </span>

      <div className="flex min-w-0 flex-1 flex-col">
        <span style={{ fontSize: 16.5, fontWeight: 500, color: "var(--color-bt-text)", lineHeight: 1.25 }}>Game State</span>
        <span style={{ fontSize: 12.5, color: "var(--color-bt-text-dim)", marginTop: 1, lineHeight: 1.35 }} data-testid="game-state-subtitle">
          {subtitle}
        </span>
      </div>

      {/* The shared neutral segmented control — same component + treatment as Entry
          Mode. Clicking the INACTIVE segment is the action: Scoring → enable (gated by
          `ready`; a lock shows until met), Setup → disable. Pending freezes both. */}
      <SegmentedToggle
        value={mode}
        options={[
          { value: "setup", label: pending && isScoring ? "…" : "Setup", testId: "mode-setup" },
          {
            value: "scoring",
            label: pending && !isScoring ? "…" : "Scoring",
            disabled: scoringLocked,
            icon: scoringLocked ? Lock : undefined,
            testId: "mode-scoring",
          },
        ]}
        onChange={(v) => (v === "scoring" ? onEnable() : onDisable())}
        disabled={pending}
        testId="game-state-toggle"
      />
    </div>
  );
}
