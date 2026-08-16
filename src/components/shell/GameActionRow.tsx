"use client";

import { ChevronLeft } from "lucide-react";
import { useGameChrome } from "@/components/games/GameChrome";
import { GameChromeActions } from "@/components/games/GameChromeActions";

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
      /**
       * `lg:-mt-6` — the row sits FLUSH under the top bar at every width.
       *
       * Below `lg` the panel is `fixed top-14`, so this row already begins
       * immediately under the 56px bar. At `lg+` the panel is a normal-flow
       * child of the shell's content area, which carries `CONTENT_INSET`
       * (`lg:p-6`, `CONTENT_INSET_PX` = 24) — so the row started 24px lower
       * than its mobile counterpart and left an empty band between the bar and
       * the game title. Cancelling the top inset here puts the game header in
       * the same place at both widths, so a viewport change doesn't redraw it.
       *
       * On the FIRST CHILD of the panel's scroll column, deliberately. A
       * negative margin on the panel BOX would push its bottom edge past the
       * `lg:overflow-hidden` content area and clip 24px of the game; pulling
       * the first child up moves the content and leaves the box alone.
       *
       * Only the TOP inset goes. The horizontal inset stays, because the row
       * should line up with the content beneath it and with the rail divider —
       * mobile's full-bleed has no rail to sit against.
       *
       * NOT moved to shell level to achieve this. That was tried and reverted
       * (see the note at the `GameActionRow` call site): a normal-flow row
       * coupled to a fixed panel moved the panel's top edge as it mounted, and
       * the merge-blocking stroke spine timed out on "element is not stable".
       * Inside the panel it is still just the first block of one scroll
       * context — nothing to oscillate.
       */
      className="z-20 flex shrink-0 items-center gap-2.5 px-4 py-2 lg:-mt-6"
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

      {/* Actions come from the SHARED cluster, which the standalone-route
          header also renders. #883 (divergence #12) was the two hosts carrying
          different actions; they now render one expression from one object. */}
      <GameChromeActions chrome={chrome} size="panel" />
    </div>
  );
}
