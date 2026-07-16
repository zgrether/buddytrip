"use client";

import { Lock } from "lucide-react";

/**
 * #501: shown at the top of a game's settings surface when the game is LIVE
 * (scoring mode). Game-altering settings are frozen mid-game — changing them
 * alters a game in progress, which must be intentional, not casual. The sanctioned
 * path is the Setup/Scoring toggle (rendered below): switch back to Setup to edit
 * (scores are kept), then re-enable. The NAME, ASSIGNMENT (delegates) and RULES OF
 * THE DAY stay editable in both modes — they can't rescore a completed hole, and a
 * delegate is exactly the kind of thing you add mid-round — so they are NOT covered
 * by this lock (migration 083 lets a live save write just those fields).
 *
 * Friction, not prohibition — the edit path exists, it's just deliberate.
 *
 * Under draft-then-save the lock follows the DRAFT (in lockstep with the rows this
 * banner explains — it has to appear and clear exactly when they do, or it
 * contradicts them). That means it can show for a game that is only STAGED to go
 * live, so `staged` swaps the copy: an unsaved toggle must not claim the game is
 * live and being scored when it isn't yet.
 */
export function ScoringLockBanner({ staged = false }: { staged?: boolean }) {
  return (
    <div
      className="mb-3 flex items-start gap-2.5 rounded-xl px-3.5 py-3"
      style={{ background: "var(--color-bt-accent-faint)", border: "1px solid var(--color-bt-accent-border)" }}
      data-testid="scoring-lock-banner"
    >
      <Lock size={16} style={{ color: "var(--color-bt-accent)", flexShrink: 0, marginTop: 1 }} />
      <div>
        <p className="text-sm font-semibold" style={{ color: "var(--color-bt-accent)" }}>
          {staged ? "Going live when you save" : "This game is live"}
        </p>
        <p className="mt-0.5 text-[12px] leading-snug" style={{ color: "var(--color-bt-text-dim)" }}>
          {staged
            ? "Settings are locked while this is staged to scoring. Save to open it to the crew, or switch back to Setup to keep editing. The name, assignment, and rules of the day can still be edited."
            : "Settings are locked while it’s being scored. Switch back to Setup (the Game Play toggle) to change them — any scores entered are kept. The name, assignment, and rules of the day can still be edited."}
        </p>
      </div>
    </div>
  );
}
