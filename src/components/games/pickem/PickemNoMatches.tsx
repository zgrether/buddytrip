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
 * ── It says the same thing to everyone ─────────────────────────────────────
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
export function PickemNoMatches() {
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
        <span style={{ fontSize: TYPE_SCALE.bodyDense, color: "var(--color-bt-text-dim)" }}>
          Check back later to see who your opponent is.
        </span>
      </div>
    </div>
  );
}
