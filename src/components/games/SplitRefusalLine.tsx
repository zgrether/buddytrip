"use client";

import { SPLIT_REFUSAL_FIX, type SplitRefusal } from "@/lib/gameConfig";

/**
 * Finalize's split refusal as the game screen shows it, under a disabled Save
 * results (#1679): the same words `games.finish` refuses with, with "settings"
 * opening the game's settings, the one place the split can be fixed (Zach).
 *
 * The words come from `finalizeSplitRefusal`, so this line and the server's
 * refusal are one sentence. With no way to open settings it renders that
 * sentence as plain text.
 */
export function SplitRefusalLine({ refusal, onSettings }: { refusal: SplitRefusal; onSettings?: () => void }) {
  if (!onSettings) return <>{refusal.text}</>;
  return (
    <>
      {refusal.reason} {SPLIT_REFUSAL_FIX.before}
      <button
        type="button"
        onClick={onSettings}
        className="underline underline-offset-2"
        style={{ color: "var(--color-bt-accent)" }}
        data-testid="split-refusal-settings"
      >
        {SPLIT_REFUSAL_FIX.link}
      </button>
      {SPLIT_REFUSAL_FIX.after}
    </>
  );
}
