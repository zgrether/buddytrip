"use client";

import { Lock } from "lucide-react";

/**
 * #501: shown at the top of a game's settings surface when the game is LIVE
 * (scoring mode). Game-altering settings are frozen mid-game — changing them
 * alters a game in progress, which must be intentional, not casual. The sanctioned
 * path is the Setup/Scoring toggle (rendered below): switch back to Setup to edit
 * (scores are kept), then re-enable. Rules of the Day stays editable in both modes
 * (it's notes, not game-altering), so it is NOT covered by this lock.
 *
 * Friction, not prohibition — the edit path exists, it's just deliberate.
 */
export function ScoringLockBanner() {
  return (
    <div
      className="mb-3 flex items-start gap-2.5 rounded-xl px-3.5 py-3"
      style={{ background: "var(--color-bt-accent-faint)", border: "1px solid var(--color-bt-accent-border)" }}
      data-testid="scoring-lock-banner"
    >
      <Lock size={16} style={{ color: "var(--color-bt-accent)", flexShrink: 0, marginTop: 1 }} />
      <div>
        <p className="text-sm font-semibold" style={{ color: "var(--color-bt-accent)" }}>
          This game is live
        </p>
        <p className="mt-0.5 text-[12px] leading-snug" style={{ color: "var(--color-bt-text-dim)" }}>
          Settings are locked while it’s being scored. Switch back to Setup (the Game Play toggle) to change
          them — any scores entered are kept. Rules of the day can still be edited.
        </p>
      </div>
    </div>
  );
}
