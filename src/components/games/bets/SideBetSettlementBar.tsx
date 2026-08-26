"use client";

import { ChevronRight } from "lucide-react";
import { formatMoney, type Settlement } from "@/lib/sideBets";

/**
 * The end-of-round line: who owes whom, how much (§6).
 *
 * One line per payment and nothing else — no ceremony, no settle action, no
 * "mark as paid". The tally was live all round and this is simply what it says
 * at the end; a step nobody would perform is worse than no step (§3.3).
 *
 * Tapping opens the same breakdown the strip does, so "how did that happen"
 * is one tap away without the number itself needing to explain.
 */
export function SideBetSettlementBar({
  settlement,
  nameOf,
  onOpen,
}: {
  settlement: Settlement[];
  nameOf: (playerId: string) => string;
  onOpen: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onOpen}
      data-testid="side-bet-settlement-bar"
      className="flex w-full shrink-0 items-center gap-3 text-left"
      style={{
        padding: "10px 16px",
        background: "var(--color-bt-card)",
        borderBottom: "1px solid var(--color-bt-border)",
      }}
    >
      <span className="min-w-0 flex-1">
        {settlement.length === 0 ? (
          <span style={{ fontSize: 14, fontWeight: 600, color: "var(--color-bt-text-dim)" }}>
            Side bets — all square
          </span>
        ) : (
          settlement.map((s) => (
            <span
              key={`${s.fromPlayerId}:${s.toPlayerId}`}
              className="block"
              style={{ fontSize: 15, fontWeight: 600, color: "var(--color-bt-text)" }}
            >
              {nameOf(s.fromPlayerId)} owes {nameOf(s.toPlayerId)}{" "}
              <span style={{ fontVariantNumeric: "tabular-nums" }}>{formatMoney(s.amount)}</span>
            </span>
          ))
        )}
      </span>
      <ChevronRight size={18} className="shrink-0" style={{ color: "var(--color-bt-text-dim)" }} />
    </button>
  );
}
