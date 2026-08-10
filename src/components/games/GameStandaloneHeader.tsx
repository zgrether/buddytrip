"use client";

import { ChevronLeft } from "lucide-react";
import type { GameChromeData } from "@/components/games/GameChrome";
import { GameChromeActions } from "@/components/games/GameChromeActions";

/**
 * The header a game surface draws on its OWN route — the deep-link / refresh
 * path, where there is no `TopNav` and so no `GameActionRow` to carry back,
 * title and actions.
 *
 * ── What this replaces ──────────────────────────────────────────────────────
 * Four copies of the same markup, one per format: rack's `Shell` header,
 * match's `SetupHeader`, and inline headers in stroke and non-golf. They were
 * identical to the character — 52px tall, 8px padding, `--color-bt-nav-bg`, a
 * blurred backdrop, a 20px back chevron, a centred 17/600 title over a 13px dim
 * subtitle — except stroke's, which had silently lost the `backdrop-filter`.
 *
 * That is four places a fifth format would have had to copy from, and four
 * places an action could be added to three of.
 *
 * ── Actions come from the chrome object, not a slot ─────────────────────────
 * The old headers took a `right` ReactNode, so each view decided for itself
 * what to put there — and in two formats that decision drifted from what the
 * panel showed (divergence #12: the gear was gated on `status !== "complete"`
 * here long after the panel's gate was removed).
 *
 * Now both hosts render `GameChromeActions` from the SAME `GameChromeData` the
 * view publishes, so the two paths cannot carry different actions. The
 * presentation still differs — this bar is taller and centres its title, the
 * panel's is compact and left-aligns — because the two live under different
 * chrome. Only the action SET is shared, which is the part that was wrong.
 *
 * `backdrop-filter` is kept from the three headers that had it. It is a no-op
 * in every current layout (the header is `shrink-0` in normal flow, so nothing
 * scrolls behind it) — which is why stroke's losing it was never noticed, and
 * why restoring it here changes no pixels.
 */
export function GameStandaloneHeader({
  title,
  subtitle,
  onBack,
  chrome,
}: {
  /** The screen's own title. Deliberately NOT `chrome.title`: this header names
   *  the FORMAT or the screen ("Rack-n-Stack", "Game Setup") while the panel's
   *  row names the GAME, and both are right for their host. */
  title: string;
  subtitle?: string;
  onBack: () => void;
  /** Drives the actions. Null while the view has nothing to publish yet (still
   *  loading) — the bar renders with back + title and no action cluster. */
  chrome: GameChromeData | null;
}) {
  return (
    <header
      className="flex shrink-0 items-center justify-between"
      style={{
        height: 52,
        padding: "0 8px",
        background: "var(--color-bt-nav-bg)",
        backdropFilter: "blur(14px)",
        WebkitBackdropFilter: "blur(14px)",
        borderBottom: "1px solid var(--color-bt-subtle-border)",
      }}
      data-testid="game-standalone-header"
    >
      <button
        onClick={onBack}
        aria-label="Back"
        className="flex h-9 w-9 shrink-0 items-center justify-center"
      >
        <ChevronLeft size={20} style={{ color: "var(--color-bt-text)" }} />
      </button>

      <div className="min-w-0 text-center">
        <div className="truncate" style={{ fontSize: 17, fontWeight: 600, color: "var(--color-bt-text)" }}>
          {title}
        </div>
        {subtitle && (
          <div style={{ fontSize: 13, color: "var(--color-bt-text-dim)" }}>{subtitle}</div>
        )}
      </div>

      {/* Fixed-width tail so the centred title stays centred whether or not the
          viewer has any actions — the old headers each did this with their own
          `<div className="h-9 w-9" />` spacer, inconsistently. */}
      <div className="flex h-9 min-w-9 shrink-0 items-center justify-end pr-1">
        {chrome && <GameChromeActions chrome={chrome} size="standalone" />}
      </div>
    </header>
  );
}
