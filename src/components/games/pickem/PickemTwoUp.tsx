"use client";

import { TYPE_SCALE } from "@/lib/typeScale";

/**
 * The locked page's tab bar.
 *
 * ── Three tabs, and the first one is the page ──────────────────────────────
 *
 * This began as two buttons that expanded panels underneath, with the matches
 * always rendered below them. That gave the screen two navigation models at
 * once: the matches were a permanent backdrop, and the two buttons were
 * drawers over it — so the thing most people came to see had no control of its
 * own, while the two things they came for less often had one each.
 *
 * Matches is a TAB now, first and selected by default. One row, three
 * destinations, one showing at a time. The chevrons went with the drawers: a
 * tab bar selects, it does not disclose.
 *
 * ── The subtitles are still derived, and still answer the question ─────────
 *
 * "Your picks" alone is a place; "34 pts · 3 of 16" is an answer, and often the
 * only one somebody wanted. Keeping the numbers on the control rather than
 * behind it is what makes a tab worth its width here.
 */

export type PickemPanel = "matches" | "picks" | "results";

export function PickemTwoUp({
  matchesLabel,
  myPoints,
  myRank,
  sheetCount,
  resolved,
  total,
  canEdit,
  open,
  onOpen,
}: {
  /** What the first tab counts — "7 matches", or the standings' own word. */
  matchesLabel: string;
  /**
   * My running total, or null when I have no sheet at all.
   *
   * Null rather than zero, and the distinction is load-bearing: somebody who
   * never picked and somebody whose picks have all missed both score nothing,
   * and only one of them has a sheet to look at. "0 pts · 16 of 16" would read
   * as a bad result rather than as an absence.
   */
  myPoints: number | null;
  /** 1-based, ties sharing a place. Null exactly when `myPoints` is. */
  myRank: number | null;
  /** How many sheets are being ranked — not the roster, which is a different
   *  number the moment somebody does not pick. */
  sheetCount: number;
  resolved: number;
  total: number;
  canEdit: boolean;
  /** Never null: one tab is always selected, and Matches is the default. */
  open: PickemPanel;
  onOpen: (panel: PickemPanel) => void;
}) {
  const toMark = total - resolved;
  const runnerHasWork = canEdit && toMark > 0;

  return (
    <div
      className="flex gap-1"
      data-testid="pickem-two-up"
      role="tablist"
      style={{ background: "var(--color-bt-card-raised)", borderRadius: 12, padding: 3 }}
    >
      <Tab
        testId="pickem-two-up-matches"
        title="Matches"
        sub={matchesLabel}
        selected={open === "matches"}
        onClick={() => onOpen("matches")}
      />
      <Tab
        testId="pickem-two-up-picks"
        title="Your picks"
        sub={
          myPoints == null ? "You didn’t pick" : `${myPoints} pts · ${myRank} of ${sheetCount}`
        }
        selected={open === "picks"}
        onClick={() => onOpen("picks")}
      />
      <Tab
        testId="pickem-two-up-results"
        title={runnerHasWork ? "Enter results" : "Results"}
        sub={runnerHasWork ? `${toMark} to mark` : `${resolved} of ${total} in`}
        selected={open === "results"}
        /**
         * A runner with unmarked games is the one person this page needs
         * something from, so their tab says "Enter results" in amber. Once
         * everything is marked they are a reader like everyone else and it goes
         * back — an amber "0 to mark" is a standing instruction to do nothing.
         */
        warn={runnerHasWork}
        onClick={() => onOpen("results")}
      />
    </div>
  );
}

function Tab({
  testId,
  title,
  sub,
  selected,
  warn,
  onClick,
}: {
  testId: string;
  title: string;
  sub: string;
  selected: boolean;
  warn?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={selected}
      onClick={onClick}
      data-testid={testId}
      data-selected={selected ? "true" : "false"}
      className="flex flex-1 flex-col justify-center px-2 py-1.5 text-center"
      style={{
        minWidth: 0,
        minHeight: 44,
        borderRadius: 9,
        // The selected tab is a RAISED surface on the track, which is how this
        // app's other segmented controls read. No border: a border on one tab
        // of three makes the other two look disabled.
        background: selected ? "var(--color-bt-base)" : "transparent",
      }}
    >
      <span
        className="truncate"
        style={{
          fontSize: TYPE_SCALE.bodyDense,
          fontWeight: selected ? 700 : 600,
          color: warn
            ? "var(--color-bt-owner)"
            : selected
              ? "var(--color-bt-text)"
              : "var(--color-bt-text-dim)",
        }}
      >
        {title}
      </span>
      <span
        className="truncate"
        style={{
          fontSize: 10.5,
          color: warn ? "var(--color-bt-owner)" : "var(--color-bt-text-dim)",
        }}
      >
        {sub}
      </span>
    </button>
  );
}
