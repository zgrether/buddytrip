"use client";

import { Lock, PlayCircle } from "lucide-react";

/**
 * GameManagementPanel (A2-ux) — the canonical **Setup / Scoring** toggle, the
 * keystone game-mode control. It lives on the ONE settings page (the correction:
 * never on the scoreboard pass-through — flipping there would be a self-destroying
 * control), in BOTH modes, so it's bidirectional:
 *
 *   Game Play:  [ Setup | Scoring ]
 *
 *  - **Setup mode** (status pending): Setup is the active segment; the **Scoring**
 *    segment is the action — tapping it enables scoring (A2-core's reconciled enable,
 *    status:'active' + publish), gated by `ready` (the client mirror of the server
 *    readiness guard — locked until the minimum requirements are met).
 *  - **Scoring mode** (live): Scoring is the active segment; the **Setup** segment is
 *    the action — tapping it disables scoring (back to setup, scores kept).
 *
 * One control, one vocabulary (Setup|Scoring) — it retired the old Enabled|Disabled
 * segmented control on the settings page.
 */
export function GameManagementPanel({
  mode,
  ready,
  onEnable,
  onDisable,
  pending = false,
}: {
  /** Current game mode — `scoring` once scoring is enabled, else `setup`. */
  mode: "setup" | "scoring";
  /** Minimum requirements met — the Scoring segment is enabled only when true.
   *  Formats with no hard readiness gate (stroke/rack) pass `true`. */
  ready: boolean;
  onEnable: () => void;
  onDisable: () => void;
  pending?: boolean;
}) {
  const isScoring = mode === "scoring";
  const scoringLocked = !isScoring && !ready;

  // A segment is the ACTIVE indicator when it matches the current mode; otherwise
  // it's the action button that switches TO that mode.
  return (
    <div
      className="rounded-2xl p-4 text-left"
      style={{ background: "var(--color-bt-card)", border: "1px solid var(--color-bt-border)" }}
      data-testid="game-management-panel"
    >
      <div className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: "var(--color-bt-text-dim)" }}>
        Game Play
      </div>

      <div className="mt-2 flex gap-1.5 rounded-xl p-1" style={{ background: "var(--color-bt-card-raised)" }}>
        {/* Setup segment — active in setup mode; the disable action in scoring mode. */}
        <Segment
          testId="mode-setup"
          label={pending && isScoring ? "Switching…" : "Setup"}
          active={!isScoring}
          // In scoring mode this is the action (disable → back to setup).
          onClick={isScoring && !pending ? onDisable : undefined}
          disabled={pending}
        />
        {/* Scoring segment — active in scoring mode; the enable action in setup mode
            (gated by `ready`, lock-styled until met). */}
        <Segment
          testId="mode-scoring"
          label={pending && !isScoring ? "Switching…" : "Scoring"}
          active={isScoring}
          accent
          locked={scoringLocked}
          onClick={!isScoring && ready && !pending ? onEnable : undefined}
          disabled={scoringLocked || pending}
        />
      </div>

      <p className="mt-2.5 flex items-start gap-1.5 text-[12px] leading-snug" style={{ color: "var(--color-bt-text-dim)" }}>
        <PlayCircle size={14} style={{ color: "var(--color-bt-accent)", flexShrink: 0, marginTop: 1 }} />
        <span>
          {isScoring
            ? "The game is live and open to the crew. Switch back to setup to close it — any entered scores are kept."
            : "Players can’t access the game while it’s being set up. Switch to scoring when you’ve completed the minimum requirements."}
        </span>
      </p>
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
  // Teal = "go / live" in the system, reserved for the LIVE state:
  //  - Scoring active  → teal FILL, dark text (this game is LIVE / in scoring).
  //  - Setup active    → a quiet/neutral fill (base surface + primary text) — Setup
  //    is "in progress, not live", so it must NOT borrow the teal that means live.
  //  - Scoring as the enable ACTION (setup mode) → teal text/outline (the "go" CTA),
  //    lock-dimmed until ready.
  //  - Setup as the disable action (scoring mode) → quiet/dim (not a "go" state).
  const style: React.CSSProperties = active
    ? accent
      ? { background: "var(--color-bt-accent)", color: "#0d1f1a", border: "1px solid transparent" }
      : { background: "var(--color-bt-base)", color: "var(--color-bt-text)", border: "1px solid var(--color-bt-border)" }
    : accent
      ? {
          background: "transparent",
          color: locked ? "var(--color-bt-text-dim)" : "var(--color-bt-accent)",
          border: `1px solid ${locked ? "transparent" : "var(--color-bt-accent-border)"}`,
          opacity: locked ? 0.6 : 1,
        }
      : { background: "transparent", color: "var(--color-bt-text-dim)", border: "1px solid transparent" };
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled || !onClick}
      aria-disabled={disabled || !onClick}
      className="flex flex-1 items-center justify-center gap-1.5 rounded-lg py-2 text-sm font-semibold disabled:cursor-not-allowed"
      style={style}
      data-testid={testId}
    >
      {locked && <Lock size={13} />}
      {label}
    </button>
  );
}
