"use client";

import { Lock, PlayCircle } from "lucide-react";

/**
 * GameManagementPanel (A2-ux) — the owner/delegate Game-Play toggle on the
 * setup-mode scoreboard page (mounted in the shared GameIdentityHeader slot from
 * A2-precursor). The keystone control: it flips the game's MODE.
 *
 *   Game Play:  [ Setup | Scoring ]
 *
 * Here the game is in SETUP (status pending), so Setup is the active segment and
 * the **Scoring** segment is the action: tapping it enables scoring (A2-core's
 * reconciled enable, which sets status:'active' + publishes). It's gated by `ready`
 * (the client mirror of the server readiness guard) — until the minimum
 * requirements are met, Scoring is locked. The reverse (Scoring→Setup) lives on the
 * settings page once the game is live, so this panel is enable-only.
 */
export function GameManagementPanel({
  ready,
  onEnable,
  pending = false,
}: {
  /** Minimum requirements met — the Scoring segment is enabled only when true. */
  ready: boolean;
  onEnable: () => void;
  pending?: boolean;
}) {
  return (
    <div
      className="rounded-2xl p-4 text-left"
      style={{ background: "var(--color-bt-card)", border: "1px solid var(--color-bt-border)" }}
      data-testid="game-management-panel"
    >
      <div className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: "var(--color-bt-text-dim)" }}>
        Game Play
      </div>

      {/* Segmented [Setup | Scoring] — Setup active (we're in setup mode). */}
      <div className="mt-2 flex gap-1.5 rounded-xl p-1" style={{ background: "var(--color-bt-card-raised)" }}>
        <div
          className="flex flex-1 items-center justify-center gap-1.5 rounded-lg py-2 text-sm font-semibold"
          style={{ background: "var(--color-bt-base)", color: "var(--color-bt-text)", border: "1px solid var(--color-bt-border)" }}
          data-testid="mode-setup"
        >
          Setup
        </div>
        <button
          type="button"
          onClick={ready && !pending ? onEnable : undefined}
          disabled={!ready || pending}
          aria-disabled={!ready || pending}
          className="flex flex-1 items-center justify-center gap-1.5 rounded-lg py-2 text-sm font-semibold disabled:cursor-not-allowed"
          style={{
            background: "transparent",
            color: ready ? "var(--color-bt-accent)" : "var(--color-bt-text-dim)",
            border: `1px solid ${ready ? "var(--color-bt-accent-border)" : "transparent"}`,
            opacity: ready ? 1 : 0.6,
          }}
          data-testid="mode-scoring"
        >
          {!ready && <Lock size={13} />}
          {pending ? "Switching…" : "Scoring"}
        </button>
      </div>

      <p className="mt-2.5 flex items-start gap-1.5 text-[12px] leading-snug" style={{ color: "var(--color-bt-text-dim)" }}>
        <PlayCircle size={14} style={{ color: "var(--color-bt-accent)", flexShrink: 0, marginTop: 1 }} />
        <span>
          Players can&rsquo;t access the game while it&rsquo;s being set up. Switch to scoring mode when
          you&rsquo;ve completed the minimum requirements.
        </span>
      </p>
    </div>
  );
}
