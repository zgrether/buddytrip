"use client";

import { Table2 } from "lucide-react";
import { formatMoney, formatSignedMoney, type Settlement } from "@/lib/sideBets";
import type { SkinsStanding } from "@/lib/skins";
import type { Participant } from "@/components/games/types";

/**
 * The finish screen for a Quick Skins round.
 *
 * ── Why not `FinalStandings` ──────────────────────────────────────────────
 *
 * That component is a STROKE-PLAY shape: positions over a to-par figure, with a
 * unit count under it. A skins board ranks by skins WON, more is better, and
 * the number beside a name is a count of holes taken rather than a score — so
 * feeding it through a to-par renderer is the category error the reader sweep
 * kept finding (a match described in stroke vocabulary, an outcome round drawn
 * on a stroke grid). `QuickResultCard` is the other option and is the opposite
 * problem: a skins round's result is not one sentence, it is a table of who
 * took how many and who owes whom.
 *
 * ── The destroyed pot gets a line, because nothing else can say it ────────
 *
 * A tie on the last hole kills the pot: nobody is paid and nobody pays. Every
 * number on this screen is correct without mentioning it, and every one of them
 * is also consistent with the pot never having existed — which is the "empty is
 * not unknown" split (CLAUDE.md), and the reason `tallyGrouping` returns
 * `potIsDead` as its own flag rather than leaving it to be inferred from
 * `carried`.
 *
 * Presentation-only (CLAUDE.md #7): every figure is a prop already derived by
 * `quickSkinsStandings` / `quickSkinsMoney` / `quickSkinsTally`.
 */
export function QuickSkinsResult({
  players,
  standings,
  netByPlayer,
  settlement,
  stake,
  deadPot,
  subtitle,
  onScorecard,
  onPlayAgain,
  onDiscard,
}: {
  players: Participant[];
  standings: SkinsStanding[];
  netByPlayer: Record<string, number>;
  settlement: Settlement[];
  /** Dollars per skin. 0 ⇒ the round carried no money and none is shown. */
  stake: number;
  /** Skins destroyed by a tied final hole — 0 when the pot was collected. */
  deadPot: number;
  subtitle: string | null;
  onScorecard: () => void;
  onPlayAgain: () => void;
  onDiscard: () => void;
}) {
  const nameOf = (id: string) => players.find((p) => p.id === id)?.name.split(/\s+/)[0] ?? "Player";
  const playing = stake > 0;

  return (
    <div className="flex h-full flex-col" style={{ background: "var(--color-bt-base)" }}>
      <div className="min-h-0 flex-1 overflow-y-auto px-4 pt-6">
        <div className="text-center">
          <span style={{ fontSize: 40 }}>⛳️</span>
          <div
            className="mt-3"
            style={{ fontSize: 22, fontWeight: 700, color: "var(--color-bt-text)", lineHeight: 1.3 }}
          >
            Skins
          </div>
          {subtitle && (
            <div className="mt-1.5" style={{ fontSize: 13.5, color: "var(--color-bt-text-dim)" }}>
              {subtitle}
            </div>
          )}
        </div>

        {/* The board. Position, name, skins — and the money where there is
            money. Ties share a position (standard competition ranking), which
            `computeSkinsStandings` has already worked out. */}
        <div
          className="mt-5 overflow-hidden rounded-[12px]"
          style={{ background: "var(--color-bt-card)", border: "1px solid var(--color-bt-border)" }}
        >
          {standings.map((s, i) => (
            <div
              key={s.entityId}
              data-testid={`quick-skins-standing-${s.entityId}`}
              className="flex items-center gap-3 px-3"
              style={{
                height: 46,
                borderTop: i === 0 ? undefined : "1px solid var(--color-bt-subtle-border)",
              }}
            >
              <span
                className="shrink-0 text-center"
                style={{
                  width: 22,
                  fontSize: 13,
                  fontWeight: 700,
                  fontVariantNumeric: "tabular-nums",
                  color: s.position === 1 ? "var(--color-bt-place-1-text)" : "var(--color-bt-text-dim)",
                }}
              >
                {s.position}
              </span>
              <span
                className="min-w-0 flex-1 truncate"
                style={{ fontSize: 14.5, fontWeight: 600, color: "var(--color-bt-text)" }}
              >
                {players.find((p) => p.id === s.entityId)?.name ?? "Player"}
              </span>
              <span
                data-testid={`quick-skins-total-${s.entityId}`}
                style={{
                  fontSize: 14,
                  fontWeight: 700,
                  fontVariantNumeric: "tabular-nums",
                  color: "var(--color-bt-text)",
                }}
              >
                {s.skins} skin{s.skins === 1 ? "" : "s"}
              </span>
              {playing && (
                <span
                  className="shrink-0 text-right"
                  data-testid={`quick-skins-money-${s.entityId}`}
                  style={{
                    width: 62,
                    fontSize: 14,
                    fontWeight: 700,
                    fontVariantNumeric: "tabular-nums",
                    color:
                      (netByPlayer[s.entityId] ?? 0) > 0.004
                        ? "var(--color-bt-place-1-text)"
                        : (netByPlayer[s.entityId] ?? 0) < -0.004
                          ? "var(--color-bt-danger)"
                          : "var(--color-bt-text-dim)",
                  }}
                >
                  {formatSignedMoney(netByPlayer[s.entityId] ?? 0)}
                </span>
              )}
            </div>
          ))}
        </div>

        {/* Who owes whom — the same one-line-per-payment shape the side-bet
            settlement bar uses, so settling up reads identically whichever
            route the money came through. */}
        {playing && settlement.length > 0 && (
          <div
            className="mt-3 rounded-[12px] px-3 py-2.5"
            style={{ background: "var(--color-bt-card)", border: "1px solid var(--color-bt-border)" }}
          >
            {settlement.map((s) => (
              <div
                key={`${s.fromPlayerId}:${s.toPlayerId}`}
                data-testid="quick-skins-settlement"
                style={{ fontSize: 14, color: "var(--color-bt-text)" }}
              >
                <strong>{nameOf(s.fromPlayerId)}</strong> owes <strong>{nameOf(s.toPlayerId)}</strong>{" "}
                {formatMoney(s.amount)}
              </div>
            ))}
          </div>
        )}

        {deadPot > 0 && (
          <div
            className="mt-3 rounded-[12px] px-3 py-2.5"
            data-testid="quick-skins-dead-pot"
            style={{ fontSize: 12.5, color: "var(--color-bt-text-dim)", background: "var(--color-bt-card)", border: "1px solid var(--color-bt-border)" }}
          >
            The last hole was tied, so {deadPot} skin{deadPot === 1 ? "" : "s"} went unpaid — there was no
            hole left to carry to.
          </div>
        )}

        <div className="mt-5 flex justify-center">
          <button
            type="button"
            onClick={onScorecard}
            className="flex items-center gap-2 rounded-xl px-4 py-2.5"
            style={{
              background: "var(--color-bt-card-raised)",
              border: "1px solid var(--color-bt-border)",
              color: "var(--color-bt-text)",
              fontSize: 14,
              fontWeight: 600,
            }}
            data-testid="quick-result-scorecard"
          >
            <Table2 size={16} /> Scorecard
          </button>
        </div>
      </div>

      <div className="flex shrink-0 flex-col gap-2 px-4 pb-8 pt-4">
        <button
          type="button"
          onClick={onPlayAgain}
          className="w-full"
          style={{
            height: 50,
            borderRadius: 12,
            background: "var(--color-bt-accent)",
            color: "#0d1f1a",
            fontSize: 16,
            fontWeight: 600,
          }}
        >
          Play again
        </button>
        <button
          type="button"
          onClick={onDiscard}
          className="w-full"
          style={{
            height: 46,
            borderRadius: 12,
            background: "transparent",
            border: "1px solid var(--color-bt-border)",
            color: "var(--color-bt-text-dim)",
            fontSize: 14,
            fontWeight: 600,
          }}
        >
          Discard
        </button>
      </div>
    </div>
  );
}
