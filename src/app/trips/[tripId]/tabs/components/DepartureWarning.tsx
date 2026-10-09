"use client";

import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "@/server/router";

/** What someone leaves behind — `tripMembers.departureSummary`'s `history`. */
export type DepartureHistory = inferRouterOutputs<AppRouter>["tripMembers"]["departureSummary"]["history"];

/**
 * What a departure means, said BEFORE it happens (PR 8d-3, ruling 2: warn,
 * never block).
 *
 * ONE component for both doors — someone removing a member, and a member
 * leaving — because the archive behind them is one function and does the same
 * thing either way. Two copies of this copy would agree only until somebody
 * changed one (CLAUDE.md #24).
 *
 * What it says is what `archive_trip_member` does, no more:
 *   - finished games keep their results, and a decided match stays decided;
 *   - anything not yet decided loses them — a seat, a pick on a game not yet
 *     played, a bracket entry with nobody left on it;
 *   - expenses are untouched — and for the person LEAVING, out of sight, which
 *     is ruling 2's sentence, word for word.
 *
 * The games and the expenses are LISTED, not counted into a sentence: a list
 * per line with its own marker cannot say "1 game" and then name two, which is
 * the bug the old refusal sentence once shipped.
 */
export function DepartureWarning({
  who,
  history,
}: {
  /** "self" is the person leaving; "them" is someone being removed. */
  who: "self" | "them";
  history: DepartureHistory;
}) {
  const self = who === "self";
  const hasGames = history.games.length > 0;
  const hasMoney = history.expensesPaid > 0 || history.expenseSplits > 0;

  return (
    <div data-testid={`departure-warning-${who}`}>
      <p className="text-sm font-semibold" style={{ color: "var(--color-bt-text)" }}>
        {self ? "Leave this trip?" : "Their history stays"}
      </p>
      <p className="mt-1.5 text-xs" style={{ color: "var(--color-bt-text-dim)" }}>
        {self
          ? "It leaves your trips, and someone running it would have to add you back."
          : "They leave the trip, and what they've already done stays on it."}
      </p>

      {hasGames && (
        <>
          <p className="mt-2.5 text-xs" style={{ color: "var(--color-bt-text-dim)" }}>
            {self
              ? "Your results in finished games stay. You're taken out of anything not yet decided."
              : "Their results in finished games stay. They're taken out of anything not yet decided."}
          </p>
          <ul className="mt-1.5 flex flex-col gap-1">
            {history.games.map((g) => (
              <li key={g.gameId} className="text-xs" style={{ color: "var(--color-bt-text-dim)" }}>
                <span style={{ color: "var(--color-bt-text)" }}>{g.gameName}</span>
                {g.hasScores ? " — has scores" : " — has a result"}
              </li>
            ))}
          </ul>
        </>
      )}

      {hasMoney && (
        <>
          <p className="mt-2.5 text-xs" style={{ color: "var(--color-bt-text-dim)" }}>
            {self
              ? "You have expenses on this trip — you won't be able to see them after you leave."
              : "Their expenses stay as they are."}
          </p>
          <ul className="mt-1.5 flex flex-col gap-1">
            {history.expensesPaid > 0 && (
              <li className="text-xs" style={{ color: "var(--color-bt-text-dim)" }}>
                <span style={{ color: "var(--color-bt-text)" }}>
                  {history.expensesPaid === 1 ? "1 expense" : `${history.expensesPaid} expenses`}
                </span>
                {self ? " — you paid" : " — they paid"}
              </li>
            )}
            {history.expenseSplits > 0 && (
              <li className="text-xs" style={{ color: "var(--color-bt-text-dim)" }}>
                <span style={{ color: "var(--color-bt-text)" }}>
                  {history.expenseSplits === 1 ? "1 expense" : `${history.expenseSplits} expenses`}
                </span>
                {self ? " — you're split into" : " — they're split into"}
              </li>
            )}
          </ul>
        </>
      )}
    </div>
  );
}
