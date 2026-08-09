"use client";

import { useState } from "react";
import { ChevronLeft, ScrollText, Settings, Table2 } from "lucide-react";
import { useGameChrome } from "@/components/games/GameChrome";
import { GameRulesSheet } from "@/components/games/GameRulesSheet";

/**
 * GameActionRow — the contextual row that appears ONLY at game depth (Phase 6):
 * back · game title · scorecard · settings.
 *
 * ── Not chrome ───────────────────────────────────────────────────────────────
 * Per STYLE_GUIDE §1, only the top bar and the tab bar are chrome (the
 * persistent app frame, on `--color-bt-card`, separated by a border). This row
 * comes and goes with a game, so it is contextual PAGE STRUCTURE and takes the
 * page background — the same treatment `TripTabBar` gets, and what
 * `TripBreadcrumb` got before it was deleted. A subtle bottom border separates
 * it from the content without reading as a second chrome band.
 *
 * ── Why the actions moved off the top bar ────────────────────────────────────
 * They used to live IN `TopNav`: opening a game swapped the bar's left zone to
 * back+title and grew two buttons on the right. That made one persistent element
 * mean two different things depending on depth — the brand anchor disappeared,
 * and the bar's contents changed under the user. Splitting them out lets the top
 * bar stay exactly one thing (brand + avatar) at every depth, and puts the game's
 * controls next to the game they act on.
 *
 * ── Back is still `history.back()` ───────────────────────────────────────────
 * Unchanged, and it has to stay that way: the panel, the in-page screen stack
 * (`useScreenHistory`) and the settings overlay each own a history entry, and
 * Phase 1's depth markers make each listener claim only its own. A bespoke
 * "close the panel" handler here would jump over whatever is stacked above it.
 *
 * Test ids are preserved from the TopNav implementation (`game-back`,
 * `game-title`, `game-scorecard`, `game-settings-gear`) so the merge-blocking
 * specs keep pointing at the same affordances.
 */
export function GameActionRow() {
  const chrome = useGameChrome();
  if (!chrome) return null;
  return <ActionRow chrome={chrome} />;
}

function ActionRow({ chrome }: { chrome: NonNullable<ReturnType<typeof useGameChrome>> }) {
    // The rules sheet is hosted HERE, not in the four game views. Three of them
    // return from several branches (config / entry / board), so a view-owned
    // sheet would have to be mounted in each — four copies of one overlay. This
    // row already renders on exactly the surfaces the affordance belongs on.
    const [rulesOpen, setRulesOpen] = useState(false);
    return (
    <div
      /**
       * Deliberately NOT `sticky`. A sticky row here fought Playwright's
       * scroll-into-view — the element it was offsetting never settled, and the
       * merge-blocking stroke spine timed out on "element is not stable". It
       * sits at the top of the game surface anyway, so stickiness bought little
       * and cost determinism.
       */
      className="z-20 flex shrink-0 items-center gap-2.5 px-4 py-2"
      style={{
        background: "var(--color-bt-base)",
        borderBottom: "1px solid var(--color-bt-subtle-border)",
      }}
      data-testid="game-action-row"
    >
      <button
        type="button"
        onClick={() => window.history.back()}
        aria-label="Back"
        data-testid="game-back"
        className="grid h-8 w-8 shrink-0 place-items-center rounded-lg transition-colors hover:bg-[var(--color-bt-hover)]"
        style={{ color: "var(--color-bt-text-dim)" }}
      >
        <ChevronLeft size={19} />
      </button>

      {/**
       * `game name — Match 1`, as TWO elements with opposite shrink behaviour.
       *
       * The game name takes `min-w-0 truncate` and gives up width first; the
       * suffix is `shrink-0` and is never clipped. That ordering is the whole
       * point: one truncated string clips from the right, so at 375px "Match Play
       * 2v2 Test 33 — Match 1" would lose "— Match 1" — the only part that
       * distinguishes this screen from its siblings. Losing the head of the game
       * name is recoverable (it's on the scoreboard one tap back, and the trip
       * has few games); losing which match you're scoring is not.
       *
       * The testid stays on the WRAPPER so `textContent` still returns the whole
       * title and the merge-blocking specs keep reading what they always read.
       */}
      <span
        className="flex min-w-0 flex-1 items-baseline gap-1 text-[14.5px] font-semibold"
        style={{ color: "var(--color-bt-text)" }}
        data-testid="game-title"
      >
        <span className="min-w-0 truncate">{chrome.title}</span>
        {chrome.titleSuffix && (
          <span
            className="shrink-0"
            style={{ color: "var(--color-bt-text-dim)" }}
            data-testid="game-title-suffix"
          >
            — {chrome.titleSuffix}
          </span>
        )}
      </span>

      <div className="flex shrink-0 gap-1">
        {/* Rules of the day — the other thing you look up mid-round without
            wanting to change anything, so it sits beside the scorecard and
            reads the same way. Before this there was NO path to the rules once
            a game went into scoring: they live on the settings page, which is
            behind the owner/delegate gear, and the people who need to check
            them are the ones playing. */}
        {chrome.rules && (
          <button
            type="button"
            onClick={() => setRulesOpen(true)}
            aria-label="Rules of the day"
            data-testid="game-rules"
            className="grid h-8 w-8 place-items-center rounded-lg transition-colors hover:bg-[var(--color-bt-card-raised)]"
            style={{ color: "var(--color-bt-text-dim)" }}
          >
            <ScrollText size={18} />
          </button>
        )}
        {chrome.onScorecard && (
          <button
            type="button"
            onClick={chrome.onScorecard}
            aria-label="Scorecard"
            data-testid="game-scorecard"
            className="grid h-8 w-8 place-items-center rounded-lg transition-colors hover:bg-[var(--color-bt-card-raised)]"
            style={{ color: "var(--color-bt-text-dim)" }}
          >
            <Table2 size={18} />
          </button>
        )}
        {chrome.onSettings && (
          <button
            type="button"
            onClick={chrome.onSettings}
            aria-label="Settings"
            data-testid="game-settings-gear"
            className="grid h-8 w-8 place-items-center rounded-lg transition-colors hover:bg-[var(--color-bt-card-raised)]"
            style={{ color: "var(--color-bt-text-dim)" }}
          >
            <Settings size={18} />
          </button>
        )}
      </div>

      {chrome.rules && (
        <GameRulesSheet
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
