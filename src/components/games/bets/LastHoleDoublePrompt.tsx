"use client";

import { useState } from "react";
import { Check } from "lucide-react";
import { Sheet } from "@/components/Sheet";
import { betLabel, betQualifier, formatMoney, type BetSide, type DoubleOffer } from "@/lib/sideBets";

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
 *
 * ── ONE SHEET FOR EVERY OFFER, and that is a fix rather than a nicety ───────
 *
 * It took an `offer` and the page rendered `offers[0]`, so a round with two
 * doubleable bets asked twice — and the second sheet mounted in the same frame
 * the first unmounted, identical in title, subtitle and buttons. The button
 * read as broken. A Nassau reaches the 17th with its back-nine and overall legs
 * both live, so this is the ordinary case for the most common bet in golf, not
 * an edge one.
 *
 * Standing on the 18th tee is ONE moment, so it is one question: every offer
 * is answered by the one tap, and `answerLastHoleDoubles` records all of them.
 * With a single offer — the common Quick Play case — this renders exactly what
 * it always did, no list and no ticking.
 */
export function LastHoleDoublePrompt({
  offers,
  sideName,
  lastHole,
  onAnswer,
}: {
  /** Every bet doubleable right now. Never empty — the caller gates on it. */
  offers: DoubleOffer[];
  sideName: (side: BetSide) => string;
  lastHole: number;
  /**
   * The one answer. `acceptedBetIds` are the parent ids to double; an empty
   * array is "No thanks", and either way every offer counts as asked.
   */
  onAnswer: (acceptedBetIds: string[]) => void;
}) {
  const single = offers.length === 1 ? offers[0] : null;

  /** Which are ticked. Multi-offer only; all on to start, because the sheet is
   *  opened by the round reaching the 18th rather than by a tap, and the
   *  CONFIRM is the consent — an empty default would make "Double it" a button
   *  that does nothing on first sight. */
  const [picked, setPicked] = useState<string[]>(() => offers.map((o) => o.bet.id));
  const toggle = (id: string) =>
    setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));

  const nameOf = (offer: DoubleOffer, sideId: string) => {
    const side = offer.bet.sides.find((s) => s.id === sideId) ?? offer.bet.sides[0];
    return side ? sideName(side) : "Side";
  };

  const accepted = single ? [single.bet.id] : picked;

  return (
    <Sheet
      title={single ? "Double it on the last?" : "Double them on the last?"}
      subtitle={
        single
          ? `${betLabel(single.bet)} · ${nameOf(single, single.trailingSideId)} is down`
          : `${offers.length} bets are still live on hole ${lastHole}`
      }
      // Dismissing IS an answer — "no" to everything — and is recorded, so the
      // sheet cannot re-open for the same bets on the next render.
      onClose={() => onAnswer([])}
      testId="last-hole-double-prompt"
      maxWidthClass="max-w-sm"
      footer={
        <div className="flex gap-2 p-3">
          <button
            type="button"
            onClick={() => onAnswer([])}
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
            onClick={() => onAnswer(accepted)}
            disabled={accepted.length === 0}
            data-testid="last-hole-double-accept"
            className="flex-1 rounded-[10px] py-2.5 disabled:opacity-40"
            style={{
              background: "var(--color-bt-accent)",
              color: "var(--color-bt-on-accent)",
              fontSize: 14,
              fontWeight: 700,
            }}
          >
            {single || accepted.length === 1 ? "Double it" : `Double ${accepted.length}`}
          </button>
        </div>
      }
    >
      {single ? (
        <>
          <p style={{ fontSize: 14, lineHeight: 1.5, color: "var(--color-bt-text)" }}>
            {nameOf(single, single.trailingSideId)} is down to {nameOf(single, single.leadingSideId)} on this
            one. Doubling adds a separate bet on hole {lastHole} alone, at{" "}
            <strong>{formatMoney(single.amount)}</strong> — twice the {formatMoney(single.parentStake)} a
            side the original is running at.
          </p>
          <p className="mt-2" style={{ fontSize: 12, lineHeight: 1.5, color: "var(--color-bt-text-dim)" }}>
            The original keeps running either way. Nothing is settled by saying yes — it just puts more on
            the last hole.
          </p>
        </>
      ) : (
        <>
          <p style={{ fontSize: 13.5, lineHeight: 1.5, color: "var(--color-bt-text)" }}>
            Each one adds a separate bet on hole {lastHole} alone, at twice what its original is running at.
            Untick anything you would rather leave alone.
          </p>
          <div className="mt-3 flex flex-col gap-1.5">
            {offers.map((o) => {
              const on = picked.includes(o.bet.id);
              const qualifier = betQualifier(o.bet);
              return (
                <button
                  key={o.bet.id}
                  type="button"
                  onClick={() => toggle(o.bet.id)}
                  aria-pressed={on}
                  data-testid="last-hole-double-row"
                  className="flex items-center gap-3 rounded-[11px] px-3 py-2.5 text-left"
                  style={{
                    background: on ? "var(--color-bt-accent-faint)" : "var(--color-bt-card)",
                    border: `1px solid ${on ? "var(--color-bt-accent-border)" : "var(--color-bt-border)"}`,
                  }}
                >
                  <span
                    className="flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-[5px]"
                    style={{
                      background: on ? "var(--color-bt-accent)" : "transparent",
                      border: `1px solid ${on ? "var(--color-bt-accent)" : "var(--color-bt-border)"}`,
                    }}
                  >
                    {on && <Check size={12} strokeWidth={3} style={{ color: "var(--color-bt-on-accent)" }} />}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span
                      className="block truncate"
                      style={{ fontSize: 13.5, fontWeight: 650, color: "var(--color-bt-text)" }}
                    >
                      {betLabel(o.bet)}
                      {qualifier ? ` · ${qualifier}` : ""}
                    </span>
                    <span className="mt-0.5 block" style={{ fontSize: 11.5, color: "var(--color-bt-text-dim)" }}>
                      {nameOf(o, o.trailingSideId)} is down to {nameOf(o, o.leadingSideId)}
                    </span>
                  </span>
                  <span
                    className="shrink-0"
                    style={{
                      fontSize: 14,
                      fontWeight: 700,
                      fontVariantNumeric: "tabular-nums",
                      color: on ? "var(--color-bt-accent)" : "var(--color-bt-text-dim)",
                    }}
                  >
                    {formatMoney(o.amount)}
                  </span>
                </button>
              );
            })}
          </div>
          <p className="mt-2.5" style={{ fontSize: 12, lineHeight: 1.5, color: "var(--color-bt-text-dim)" }}>
            The originals keep running either way. Nothing is settled by saying yes — it just puts more on
            the last hole.
          </p>
        </>
      )}
    </Sheet>
  );
}
