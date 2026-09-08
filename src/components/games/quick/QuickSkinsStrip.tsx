"use client";

import { formatMoney, formatSignedMoney } from "@/lib/sideBets";
import type { SkinsStanding } from "@/lib/skins";
import type { Participant } from "@/components/games/types";

/**
 * The live skins strip — one column per player, walking to the next tee.
 *
 * Deliberately the SAME grammar as `SideBetStrip`: a name, a big number, a
 * small line under it. That is not a coincidence to be tidied away later — a
 * skins round and a stroke round with a skins side bet are the same
 * conversation at the first tee, and if the two surfaces read differently the
 * choice between them starts looking like a choice between two apps.
 *
 * ── The big number is MONEY where there is money, and SKINS where there is not ─
 *
 * A $0 round is a real round — skins for bragging rights — and showing "$0" for
 * every player says the arithmetic broke rather than that nobody is betting.
 * So the strip shows what the round is actually about: dollars when a stake was
 * agreed, the count when it was not. The count is always on the line below, so
 * the money view never hides how somebody got there.
 *
 * Not a button. `SideBetStrip` opens the bet breakdown; there is no second
 * layer here — the scorecard already shows every hole, and a tap target that
 * leads nowhere is worse than none.
 *
 * Presentation-only (CLAUDE.md #7): every figure arrives derived
 * (`quickSkinsStandings` / `quickSkinsMoney`), and nothing is computed here.
 */
export function QuickSkinsStrip({
  players,
  standings,
  netByPlayer,
  stake,
}: {
  players: Participant[];
  /** From `quickSkinsStandings` — the ranked board, read here by player id. */
  standings: SkinsStanding[];
  /** From `quickSkinsMoney`. Ignored entirely at a zero stake. */
  netByPlayer: Record<string, number>;
  /** Dollars per skin. 0 ⇒ no money on this round, and none is shown. */
  stake: number;
}) {
  const skinsOf = new Map(standings.map((s) => [s.entityId, s.skins]));
  const playing = stake > 0;

  return (
    <div
      data-testid="quick-skins-strip"
      className="flex w-full shrink-0 items-start gap-2"
      style={{
        padding: "8px 12px",
        background: "var(--color-bt-card)",
        borderBottom: "1px solid var(--color-bt-subtle-border)",
      }}
    >
      <div
        className="grid min-w-0 flex-1 gap-2"
        style={{ gridTemplateColumns: `repeat(${Math.max(players.length, 1)}, minmax(0, 1fr))` }}
      >
        {players.map((p) => {
          const skins = skinsOf.get(p.id) ?? 0;
          const net = netByPlayer[p.id] ?? 0;
          return (
            <div key={p.id} className="block min-w-0" data-testid="quick-skins-player-column">
              <span
                className="block truncate"
                style={{ fontSize: 12, fontWeight: 500, color: "var(--color-bt-text-dim)" }}
              >
                {p.name.split(/\s+/)[0]}
              </span>
              <span
                className="block"
                data-testid={`quick-skins-headline-${p.id}`}
                style={{
                  fontSize: 19,
                  fontWeight: 700,
                  letterSpacing: "-0.02em",
                  fontVariantNumeric: "tabular-nums",
                  color: playing
                    ? net > 0.004
                      ? "var(--color-bt-place-1-text)"
                      : net < -0.004
                        ? "var(--color-bt-danger)"
                        : "var(--color-bt-text-dim)"
                    : skins > 0
                      ? "var(--color-bt-text)"
                      : "var(--color-bt-text-dim)",
                }}
              >
                {playing ? formatSignedMoney(net) : skins}
              </span>
              <span
                className="mt-0.5 block"
                data-testid={`quick-skins-count-${p.id}`}
                style={{ fontSize: 11, color: "var(--color-bt-text-dim)" }}
              >
                {/* Always the count, under whichever headline is showing — the
                    money view must never be the only place the round's actual
                    result lives. */}
                {skins} skin{skins === 1 ? "" : "s"}
              </span>
            </div>
          );
        })}
      </div>
      {playing && (
        <span
          className="mt-1 shrink-0"
          data-testid="quick-skins-stake"
          style={{ fontSize: 11, fontWeight: 600, color: "var(--color-bt-text-dim)" }}
        >
          {formatMoney(stake)}/skin
        </span>
      )}
    </div>
  );
}
