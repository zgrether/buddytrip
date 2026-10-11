"use client";

import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "@/server/router";

/** `tripMembers.departureSummary` — what the confirm reads. */
export type DepartureSummary = inferRouterOutputs<AppRouter>["tripMembers"]["departureSummary"];

/** "1 expense", "3 expenses". */
const expenses = (n: number) => `${n} expense${n === 1 ? "" : "s"}`;

/**
 * The confirm for a departure (PR 8d-3): what is being confirmed, plus the one
 * thing the reader can act on — and nothing else.
 *
 * Zach's look cut it to this. The first version also explained that history
 * stays, that undecided games lose them, and listed every game; the app
 * handles all of that for them, so none of it was something to act on
 * (CLAUDE.md, "Copy").
 *
 * The one line that stays is money, and only when they are in an expense:
 * an expense ledger is the one thing the archive keeps that a PERSON still has
 * to settle (ruling 2). Paid and split-into are disjoint counts, so their sum
 * is how many expenses they are part of.
 *
 * ONE component for both doors — someone removing a member, and a member
 * leaving — because one archive is behind both.
 */
export function DepartureWarning({
  who,
  summary,
}: {
  /** "self" is the person leaving; "them" is someone being removed. */
  who: "self" | "them";
  summary: DepartureSummary;
}) {
  const n = summary.history.expensesPaid + summary.history.expenseSplits;
  const self = who === "self";

  return (
    <div data-testid={`departure-warning-${who}`}>
      <p className="text-sm font-semibold" style={{ color: "var(--color-bt-text)" }}>
        {self
          ? `Leave ${summary.tripTitle}?`
          : `Remove ${summary.displayName ?? "them"} from ${summary.tripTitle}?`}
      </p>
      {n > 0 && (
        <p className="mt-1.5 text-xs" style={{ color: "var(--color-bt-text-dim)" }}>
          {self
            ? `You’re part of ${expenses(n)} here — check back with ${summary.ownerName ?? "the Owner"} to settle up.`
            : `They’re part of ${expenses(n)} here — settle up with them.`}
        </p>
      )}
    </div>
  );
}
