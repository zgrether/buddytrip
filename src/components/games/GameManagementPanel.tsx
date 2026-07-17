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
  staged = false,
  explainer = true,
  hideLabel = false,
}: {
  /** Current game mode — `scoring` once scoring is enabled, else `setup`. */
  mode: "setup" | "scoring";
  /** Minimum requirements met — the Scoring segment is enabled only when true.
   *  Formats with no hard readiness gate (stroke/rack) pass `true`. */
  ready: boolean;
  onEnable: () => void;
  onDisable: () => void;
  pending?: boolean;
  /** Freeze redesign §3.5: the toggle is "just a visibility gate" — it doesn't get a
   *  panel EXPLAINING itself. Pass `explainer={false}` (the match page) to drop the
   *  descriptive paragraph; the STAGED save-affordance line ("Save to switch…") still
   *  shows, because that's an action prompt, not an explainer. Other hosts (P2 formats)
   *  default true and keep the paragraph until they're converted. */
  explainer?: boolean;
  /** Draft-then-save: `mode` reflects the DRAFT and hasn't been committed yet, so the
   *  copy must not claim a live game that isn't live (or a closed one still open).
   *  The toggle position still follows the draft — it has to answer the tap — but the
   *  sentence under it says what's actually true and what Save will do. Self-persisting
   *  hosts (stroke/rack/non-golf) omit this and read exactly as before. */
  staged?: boolean;
  /** #512: the match settings page renders a peer `GAME MANAGEMENT` section header
   *  (ZoneHeader) above the panel, so suppress the internal caption there to avoid a
   *  double label. Other hosts (stroke/rack/non-golf) have no section headers — they
   *  keep the internal caption as the panel's only label. */
  hideLabel?: boolean;
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
      {!hideLabel && (
        <div className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: "var(--color-bt-text-dim)" }}>
          Game Play
        </div>
      )}

      <div className={`${hideLabel ? "" : "mt-2 "}flex gap-1.5 rounded-xl p-1`} style={{ background: "var(--color-bt-card-raised)" }}>
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

      {/* The STAGED line is a save-affordance (what Save will do) and always shows;
          the NON-staged descriptive paragraph is the "explainer" the toggle doesn't
          need (§3.5) — suppressed when explainer=false (the match page). */}
      {(staged || explainer) && (
        <p className="mt-2.5 flex items-start gap-1.5 text-[12px] leading-snug" style={{ color: "var(--color-bt-text-dim)" }}>
          <PlayCircle size={14} style={{ color: "var(--color-bt-accent)", flexShrink: 0, marginTop: 1 }} />
          <span>
            {staged
              ? isScoring
                ? "Not live yet — Save to switch this game to scoring and open it to the crew."
                : "Still live for the crew — Save to switch this game back to setup. Any entered scores are kept."
              : isScoring
                ? "The game is live and open to the crew. Switch back to setup to close it — any entered scores are kept."
                : "Players can’t access the game while it’s being set up. Switch to scoring when you’ve completed the minimum requirements."}
          </span>
        </p>
      )}
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
      className="flex flex-1 items-center justify-center gap-1.5 rounded-lg py-2 text-sm font-semibold disabled:cursor-not-allowed"
      style={style}
      data-testid={testId}
    >
      {locked && <Lock size={13} />}
      {label}
    </button>
  );
}
