"use client";

import { Lock, Radio } from "lucide-react";

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
 * Freeze-redesign polish (item B): this row now carries the icon-tile + title +
 * subtitle grammar every OTHER settings row has (it was the one bare toggle). The
 * subtitle has THREE states and MUST NEVER assert a server state the server doesn't
 * hold — this row has produced two lies before (ScoringLockBanner, the old copy):
 *   - on / on   → "Scoring has been enabled"
 *   - off / off → "Players can't access scorekeeping"
 *   - staged (draft ≠ server) → what's true AND what Save will do.
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

  // THREE-state subtitle — the lie class. The plain states describe SERVER truth
  // (safe because !staged ⟹ draft === server); the staged state names both what's
  // still true on the server AND the pending Save.
  const subtitle = staged
    ? isScoring
      ? "Not live yet — Save to switch this game to scoring and open it to the crew."
      : "Still live for the crew — Save to switch this game back to setup. Any entered scores are kept."
    : isScoring
      ? "Scoring has been enabled"
      : "Players can’t access scorekeeping";

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

      {/* Content-width toggle (item B: no longer full-width — it dropped in importance). */}
      <div className="inline-flex shrink-0 gap-1 rounded-xl p-1" style={{ background: "var(--color-bt-card-raised)" }}>
        {/* Setup segment — active in setup mode; the disable action in scoring mode. */}
        <Segment
          testId="mode-setup"
          label={pending && isScoring ? "…" : "Setup"}
          active={!isScoring}
          onClick={isScoring && !pending ? onDisable : undefined}
          disabled={pending}
        />
        {/* Scoring segment — active in scoring mode; the enable action in setup mode
            (gated by `ready`, lock-styled until met). */}
        <Segment
          testId="mode-scoring"
          label={pending && !isScoring ? "…" : "Scoring"}
          active={isScoring}
          accent
          locked={scoringLocked}
          onClick={!isScoring && ready && !pending ? onEnable : undefined}
          disabled={scoringLocked || pending}
        />
      </div>
    </div>
  );
}

function Segment({
  testId,
  label,
  active,
  accent = false,
  locked = false,
  onClick,
  disabled,
}: {
  testId: string;
  label: string;
  active: boolean;
  /** The accent (Scoring) segment renders teal when it's the live/enable action. */
  accent?: boolean;
  locked?: boolean;
  onClick?: () => void;
  disabled?: boolean;
}) {
  // One signal, never two (#512 correction): teal = "go / live" and appears ONLY on
  // the ACTIVE segment in scoring mode. The inactive segment is ALWAYS plain muted
  // grey — never teal — so setup mode can't read as "scoring active".
  //  - Scoring active  → teal FILL, dark text (this game is LIVE / in scoring).
  //  - Setup active    → a quiet/neutral fill (base surface + primary text) — Setup
  //    is "in progress, not live", so it must NOT borrow the teal that means live.
  //  - Either segment inactive → muted grey, transparent (the enable/disable action is
  //    the SAME quiet treatment in both directions; lock icon + dim when not ready).
  const style: React.CSSProperties = active
    ? accent
      ? { background: "var(--color-bt-accent)", color: "#0d1f1a", border: "1px solid transparent" }
      : { background: "var(--color-bt-base)", color: "var(--color-bt-text)", border: "1px solid var(--color-bt-border)" }
    : { background: "transparent", color: "var(--color-bt-text-dim)", border: "1px solid transparent", opacity: locked ? 0.6 : 1 };
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled || !onClick}
      aria-disabled={disabled || !onClick}
      className="flex items-center justify-center gap-1.5 rounded-lg px-3.5 py-1.5 text-sm font-semibold disabled:cursor-not-allowed"
      style={style}
      data-testid={testId}
    >
      {locked && <Lock size={13} />}
      {label}
    </button>
  );
}
