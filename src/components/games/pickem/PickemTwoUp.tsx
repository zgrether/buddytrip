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
 * ── The subtitles are derived, and each says ONE thing ────────────────────
 *
 * "Your picks" alone is a place; "34 pts" is an answer, and often the only one
 * somebody wanted. Keeping the number on the control rather than behind it is
 * what makes a tab worth its width here.
 *
 * The picks tab used to read "30 pts · 4 of 12" — a total and a RANK among the
 * sheets, unlabelled and jammed against each other. Read on a page whose other
 * two tabs count games, "4 of 12" reads as four games of twelve, and there is
 * nothing in ten characters to say otherwise.
 *
 * Dropped rather than labelled, because in `individual_matches` a rank across
 * every sheet is not the question this page is about: the reader's standing is
 * their MATCH, which the first tab shows in full. A field of twelve is a
 * team-totals idea, and the roll-up says it there with a heading and a column.
 */

export type PickemPanel = "matches" | "picks" | "results";

export function PickemTwoUp({
  matchesLabel,
  myPoints,
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
        /* "Picks", not "Your picks": the tab now holds everybody’s, and the
           sub-tab under it is what says whose. */
        title="Picks"
        sub={myPoints == null ? "You didn’t pick" : `${myPoints} pts`}
        selected={open === "picks"}
        onClick={() => onOpen("picks")}
      />
      <Tab
        testId="pickem-two-up-results"
        title={runnerHasWork ? "Enter results" : "Results"}
        sub={runnerHasWork ? `${toMark} still to play` : `${resolved} of ${total} in`}
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
