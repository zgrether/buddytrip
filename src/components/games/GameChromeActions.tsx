"use client";

import { useState } from "react";
import { ScrollText, Settings, Table2 } from "lucide-react";
import type { GameChromeData } from "@/components/games/GameChrome";
import { GameRulesSheet } from "@/components/games/GameRulesSheet";

/**
 * The game surface's action cluster — rules · scorecard · settings — rendered
 * from the chrome object, for BOTH hosts.
 *
 * ── Why this is one component and not two lists that happen to match ────────
 * A game surface renders in two places: as a panel over the board (chrome is
 * published to `GameChrome` and drawn by `GameActionRow`) and on its own route
 * (each view draws its own header, because there is no app bar there). Those
 * are genuinely different headers — a panel's sits under `TopNav` at 14.5px
 * left-aligned; a standalone route's is a 52px centred bar with a subtitle —
 * and that difference is deliberate.
 *
 * What was NOT deliberate is that they carried different ACTIONS. #883 found
 * the settings gear present on one and absent on the other in two formats
 * (divergence #12), created by a fix that only reached the panel path. The
 * actions are the part that must never differ, so they live here and both
 * headers render this.
 *
 * The presentation stays per-host (`size`), because the two bars are different
 * heights; the SET and its conditions do not.
 */
export function GameChromeActions({
  chrome,
  size = "panel",
}: {
  chrome: GameChromeData;
  /**
   * `panel` — 32px targets, for the compact row under `TopNav`.
   * `standalone` — 36px, matching the 52px route header's back button.
   * Sizing only. A host cannot use this to drop an action.
   */
  size?: "panel" | "standalone";
}) {
  const [rulesOpen, setRulesOpen] = useState(false);
  const box = size === "panel" ? "h-8 w-8" : "h-9 w-9";
  const icon = size === "panel" ? 18 : 19;

  return (
    <div className="flex shrink-0 items-center gap-1">
      {/* Rules of the day — the other thing you look up mid-round without
          wanting to change anything, so it sits beside the scorecard and reads
          the same way. Before #882 there was no path to the rules once a game
          went into scoring: they live on the settings page, which is behind the
          owner/delegate gear, and the people who need to check them are the
          ones playing. */}
      {chrome.rules && (
        <button
          type="button"
          onClick={() => setRulesOpen(true)}
          aria-label="Rules of the day"
          data-testid="game-rules"
          className={`grid ${box} place-items-center rounded-lg transition-colors hover:bg-[var(--color-bt-card-raised)]`}
          style={{ color: "var(--color-bt-text-dim)" }}
        >
          <ScrollText size={icon} />
        </button>
      )}
      {chrome.onScorecard && (
        <button
          type="button"
          onClick={chrome.onScorecard}
          aria-label="Scorecard"
          data-testid="game-scorecard"
          className={`grid ${box} place-items-center rounded-lg transition-colors hover:bg-[var(--color-bt-card-raised)]`}
          style={{ color: "var(--color-bt-text-dim)" }}
        >
          <Table2 size={icon} />
        </button>
      )}
      {chrome.onSettings && (
        <button
          type="button"
          onClick={chrome.onSettings}
          aria-label="Settings"
          data-testid="game-settings-gear"
          className={`grid ${box} place-items-center rounded-lg transition-colors hover:bg-[var(--color-bt-card-raised)]`}
          style={{ color: "var(--color-bt-text-dim)" }}
        >
          <Settings size={icon} />
        </button>
      )}

      {chrome.rules && (
        <GameRulesSheet
          starterText={chrome.rules.starterText}
          open={rulesOpen}
          onClose={() => setRulesOpen(false)}
          tripId={chrome.rules.tripId}
          gameId={chrome.rules.gameId}
          gameTypeId={chrome.rules.gameTypeId}
          rules={chrome.rules.text}
          canEdit={chrome.rules.canEdit}
        />
      )}
    </div>
  );
}
