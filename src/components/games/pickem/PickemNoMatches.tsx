"use client";

import { Users } from "lucide-react";
import { TYPE_SCALE } from "@/lib/typeScale";

/**
 * Locked, scoring, and nobody paired yet.
 *
 * ── Waiting is a legitimate state, and has to look like one ────────────────
 *
 * A runner is under no pressure to pair before the deadline — they may well
 * draw the matches after seeing who actually submitted, which is a better
 * workflow than guessing on Friday. So this is not an error, an empty state, or
 * a nag: a DASHED panel says "there will be something here", where a solid card
 * would say "here is the thing" and a warning would say "somebody has failed".
 *
 * ── It says the same thing to everyone — EXCEPT the one instruction ────────
 *
 * "Check back later to see who your opponent is" is right for a member and
 * wrong for the runner: it tells the one person everyone is waiting on to wait.
 * So a viewer who can draw the matches (`canDraw`, the same `canEdit` that
 * mounts the runner's strip) gets the headline alone. The strip above already
 * says "draw the matches", so the runner's version needs no sentence of its
 * own — least of all a route (Zach's look, 2026-09-23).
 *
 * There was a second card under this one for the runner — a teal badge reading
 * "Matches can be set in the game settings" with a chevron into settings. It is
 * gone, and nothing replaced it.
 *
 * Two reasons. It duplicated a route the header gear already provides on every
 * format, which is where a runner looks for settings. And it sat inside the
 * MATCHES tab, so it was a signpost to somewhere else printed on the surface a
 * runner had just chosen to open — the tab is the answer to "where are the
 * matches", and a card explaining that they are configured elsewhere is the
 * screen apologising for itself.
 */
/**
 * Individual matches, and nobody drawn yet.
 *
 * Read by the Matches tab (this file's panel) and the runner's phase strip,
 * which says it sharper once picks lock (results-first PR). It used to gate a
 * scrim over the RESULTS panel too, on the claim that "the first result freezes
 * the pairings". That claim was 157's behaviour, which 162 reverted, and the
 * app no longer saves pairings through `save_pickem_matches` at all — it uses
 * `save_game_config`, whose only pairing freeze is a MATCH with a recorded
 * result, and pick'em never records one (every standing is derived from sheets
 * plus results on each read). So results are entered whenever they happen, and
 * a match drawn later is scored from what is already on record.
 *
 * TAKES THE RESOLVED FLAG, NOT THE RAW COLUMN: `PickemGameView.individualMatches`
 * already folds points mode in, and it is on `pickemRollUpOverride.test.ts`'s
 * allowlist for doing so. A second raw comparison here is how that list stops
 * meaning anything.
 */
export function noMatchesDrawn(input: {
  /** The RESOLVED flag — points mode already folded in. */
  individualMatches: boolean;
  matchCount: number;
}): boolean {
  return input.individualMatches && input.matchCount === 0;
}

export function PickemNoMatches({
  canDraw,
}: {
  /** Can this viewer draw the matches — the runner. Drops the "check back later". */
  canDraw: boolean;
}) {
  return (
    <div className="flex flex-col gap-2" data-testid="pickem-no-matches">
      <div
        className="flex flex-col items-center gap-1.5 text-center"
        style={{
          padding: "26px 20px",
          borderRadius: 14,
          border: "1px dashed var(--color-bt-border)",
        }}
      >
        <Users size={30} style={{ color: "var(--color-bt-text-dim)", opacity: 0.7 }} />
        <span style={{ fontSize: TYPE_SCALE.name, fontWeight: 700 }}>No matches drawn yet</span>
        {!canDraw && (
          <span style={{ fontSize: TYPE_SCALE.bodyDense, color: "var(--color-bt-text-dim)" }}>
            Check back later to see who your opponent is.
          </span>
        )}
      </div>
    </div>
  );
}
