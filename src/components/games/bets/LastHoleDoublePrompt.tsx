"use client";

import { Sheet } from "@/components/Sheet";
import { betLabel, formatMoney, type DoubleOffer } from "@/lib/sideBets";

/**
 * The last-hole double (§3.2) — what "double or nothing" usually means in golf:
 * a press on the last hole, one bet, one hole, doubled stakes.
 *
 * **A PROMPT, never automatic** (§9). Automatic press was agreed to when the bet
 * was made; this was not, and the app doing it to you is precisely how a round
 * gets away from someone. Declining is a real answer and is remembered, so it
 * asks once.
 *
 * Offered to the side that is DOWN — the one it is for. It is shown as the
 * money it creates rather than as a rule, for the same reason the ☠️ toggle is.
 */
export function LastHoleDoublePrompt({
  offer,
  trailingName,
  leadingName,
  lastHole,
  onAccept,
  onDecline,
}: {
  offer: DoubleOffer;
  trailingName: string;
  leadingName: string;
  lastHole: number;
  onAccept: () => void;
  onDecline: () => void;
}) {
  return (
    <Sheet
      title="Double it on the last?"
      subtitle={`${betLabel(offer.bet)} · ${trailingName} is down`}
      onClose={onDecline}
      testId="last-hole-double-prompt"
      maxWidthClass="max-w-sm"
      footer={
        <div className="flex gap-2 p-3">
          <button
            type="button"
            onClick={onDecline}
            data-testid="last-hole-double-decline"
            className="flex-1 rounded-[10px] py-2.5"
            style={{
              background: "var(--color-bt-card-raised)",
              border: "1px solid var(--color-bt-border)",
              color: "var(--color-bt-text-dim)",
              fontSize: 14,
              fontWeight: 600,
            }}
          >
            No thanks
          </button>
          <button
            type="button"
            onClick={onAccept}
            data-testid="last-hole-double-accept"
            className="flex-1 rounded-[10px] py-2.5"
            style={{
              background: "var(--color-bt-accent)",
              color: "var(--color-bt-on-accent)",
              fontSize: 14,
              fontWeight: 700,
            }}
          >
            Double it
          </button>
        </div>
      }
    >
      <p style={{ fontSize: 14, lineHeight: 1.5, color: "var(--color-bt-text)" }}>
        {trailingName} is down to {leadingName} on this one. Doubling adds a separate bet on hole {lastHole}{" "}
        alone, at <strong>{formatMoney(offer.amount)}</strong> — twice the {formatMoney(offer.bet.amount)} the
        original is running at.
      </p>
      <p className="mt-2" style={{ fontSize: 12, lineHeight: 1.5, color: "var(--color-bt-text-dim)" }}>
        The original keeps running either way. Nothing is settled by saying yes — it just puts more on the
        last hole.
      </p>
    </Sheet>
  );
}
