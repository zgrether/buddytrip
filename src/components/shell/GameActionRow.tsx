"use client";

import { ChevronLeft, Settings, Table2 } from "lucide-react";
import { useGameChrome } from "@/components/games/GameChrome";

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

      <span
        className="min-w-0 flex-1 truncate text-[14.5px] font-semibold"
        style={{ color: "var(--color-bt-text)" }}
        data-testid="game-title"
      >
        {chrome.title}
      </span>

      <div className="flex shrink-0 gap-1">
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
    </div>
  );
}
