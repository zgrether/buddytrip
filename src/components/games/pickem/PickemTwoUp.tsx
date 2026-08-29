"use client";

import { ChevronDown, ChevronRight } from "lucide-react";
import { TYPE_SCALE } from "@/lib/typeScale";

/**
 * The two-up row — the locked page's whole navigation.
 *
 * ── Why the page changes shape at the lock ─────────────────────────────────
 *
 * While picks are open the page IS the sheet: one job, no navigation. The
 * moment it locks the sheet stops being a task and becomes a record, and the
 * question changes to "how am I doing" — which the matches answer. So the two
 * things that were the page collapse into two buttons and the matches take
 * their place.
 *
 * Both buttons carry a DERIVED subtitle rather than a label. "Your picks" alone
 * is a place; "Your picks · 34 pts · 3 of 16" is an answer, and often the only
 * one somebody wanted — which is the point of putting it on the button rather
 * than behind it.
 *
 * ── ...which is also what made them read as a readout ──────────────────────
 *
 * A stat under a heading is a stat card, and the first look said so. The fix is
 * a chevron rather than quieter numbers, because the numbers are the reason the
 * row is worth its space — and it points DOWN when the panel is open, which is
 * more honest than a navigation arrow: these expand in place, they do not take
 * you anywhere.
 *
 * ── The runner's half is amber, and only when there is something to do ─────
 *
 * A runner with unmarked games is the one person this page needs something
 * from, so their right-hand button says "Enter results" in amber. Once
 * everything is marked they are a reader like everyone else and it goes back to
 * "Game results" — an amber "0 to mark" would be a standing instruction to do
 * nothing.
 */

export type PickemPanel = "picks" | "results";

export function PickemTwoUp({
  myPoints,
  myRank,
  sheetCount,
  resolved,
  total,
  canEdit,
  open,
  onOpen,
}: {
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
  open: PickemPanel | null;
  onOpen: (panel: PickemPanel) => void;
}) {
  const toMark = total - resolved;
  const runnerHasWork = canEdit && toMark > 0;

  return (
    <div className="mx-1 flex gap-2" data-testid="pickem-two-up">
      <Half
        testId="pickem-two-up-picks"
        title="Your picks"
        sub={
          myPoints == null
            ? "You didn’t pick"
            : `${myPoints} pts · ${myRank} of ${sheetCount}`
        }
        selected={open === "picks"}
        onClick={() => onOpen("picks")}
      />
      <Half
        testId="pickem-two-up-results"
        title={runnerHasWork ? "Enter results" : "Game results"}
        sub={runnerHasWork ? `${toMark} to mark` : `${resolved} of ${total} in`}
        selected={open === "results"}
        warn={runnerHasWork}
        onClick={() => onOpen("results")}
      />
    </div>
  );
}

function Half({
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
  // Selection reads as accent whatever the button's resting colour, so the open
  // panel is visibly attached to the button that opened it. The amber survives
  // in the title, because "there is work here" does not stop being true because
  // the panel is on screen.
  const border = selected
    ? "var(--color-bt-accent-border)"
    : warn
      ? "var(--color-bt-warning-border)"
      : "var(--color-bt-border)";
  const background = selected
    ? "var(--color-bt-accent-faint)"
    : warn
      ? "var(--color-bt-warning-faint)"
      : "var(--color-bt-card)";

  return (
    <button
      type="button"
      onClick={onClick}
      data-testid={testId}
      data-selected={selected ? "true" : "false"}
      className="flex flex-1 items-center gap-1.5 px-3 text-left active:scale-[0.98]"
      style={{
        minHeight: 46,
        borderRadius: 12,
        paddingTop: 6,
        paddingBottom: 6,
        background,
        border: `1px solid ${border}`,
      }}
    >
      <span className="min-w-0 flex-1">
        <span
          className="block truncate"
          style={{
            fontSize: TYPE_SCALE.body,
            fontWeight: 600,
            color: warn ? "var(--color-bt-owner)" : "var(--color-bt-text)",
          }}
        >
          {title}
        </span>
        <span
          className="block truncate"
          style={{ fontSize: 10.5, color: "var(--color-bt-text-dim)" }}
        >
          {sub}
        </span>
      </span>
      {/* Down when open, right when closed — the shape of the interaction, not
          a decoration. Accent while open so the button and the panel it
          revealed read as one thing. */}
      {selected ? (
        <ChevronDown
          size={14}
          style={{ color: "var(--color-bt-accent)", flexShrink: 0 }}
        />
      ) : (
        <ChevronRight
          size={14}
          style={{ color: "var(--color-bt-text-dim)", flexShrink: 0 }}
        />
      )}
    </button>
  );
}
