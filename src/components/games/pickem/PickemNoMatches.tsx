"use client";

import { ChevronRight, Users } from "lucide-react";
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
 * The member's half explains what they are waiting for and stops. Naming an
 * action they cannot take would be the refusal-with-nowhere-to-go shape this
 * feature has already produced twice.
 *
 * ── The runner's half is a plain card, deliberately ────────────────────────
 *
 * Amber would make a normal workflow look like a mistake. The runner gets the
 * one fact they need — pairing lives in settings — as a statement with a way
 * through, and nothing that implies they are late.
 */
export function PickemNoMatches({
  canEdit,
  onOpenSettings,
}: {
  canEdit: boolean;
  onOpenSettings?: () => void;
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
        <span style={{ fontSize: TYPE_SCALE.bodyDense, color: "var(--color-bt-text-dim)" }}>
          Check back later to see who your opponent is.
        </span>
      </div>

      {canEdit && onOpenSettings && (
        <button
          type="button"
          onClick={onOpenSettings}
          data-testid="pickem-no-matches-settings"
          className="flex items-center gap-2.5 px-3 py-2.5 text-left active:scale-[0.98]"
          style={{
            borderRadius: 12,
            background: "var(--color-bt-card)",
            border: "1px solid var(--color-bt-border)",
          }}
        >
          <span
            className="flex shrink-0 items-center justify-center"
            style={{
              width: 30,
              height: 30,
              borderRadius: 9999,
              background: "var(--color-bt-accent-faint)",
              border: "1px solid var(--color-bt-accent-border)",
            }}
          >
            <Users size={15} style={{ color: "var(--color-bt-accent)" }} />
          </span>
          <span className="min-w-0 flex-1" style={{ fontSize: TYPE_SCALE.body, fontWeight: 600 }}>
            Matches can be set in the game settings
          </span>
          <ChevronRight
            size={16}
            style={{ color: "var(--color-bt-accent)", flexShrink: 0 }}
          />
        </button>
      )}
    </div>
  );
}
