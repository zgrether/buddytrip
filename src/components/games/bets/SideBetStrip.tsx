"use client";

import { ChevronRight } from "lucide-react";
import { formatMoney, formatSignedMoney, type PlayerBetLine } from "@/lib/sideBets";

/**
 * The live side-bet strip — the thing you glance at walking to the next tee.
 *
 * ONE COLUMN PER PLAYER, evenly spaced: their name, their net for the round,
 * and the bets they are actually in with what each is worth per hole.
 *
 * ── What this replaced, and why ────────────────────────────────────────────
 * Three stacked lines: one player's net, a round-wide "$35/hole across 4 bets",
 * and what the viewed hole was worth.
 *
 * All three assume the round is ONE bet among everyone. The moment it is not —
 * separate bets between separate people, which is the normal case once a press
 * or a two-player side bet exists — the first named one player and left the
 * rest unaccounted, while the other two aggregated across bets the reader is
 * not in. "$35/hole" was nobody's risk: not the round's, not yours, just a sum.
 * The one thing everyone wanted — what am I in, and for how much — was the one
 * thing not shown.
 *
 * The viewed-hole line went for the same reason and is not replaced here: its
 * pot has the identical aggregation problem, and per-hole history now lives
 * behind the tap where a table can be a table.
 *
 * Presses still announce below the columns. A number that jumps with nothing
 * saying why reads as a bug.
 *
 * Persistence-agnostic (CLAUDE.md #7) and computation-free: every figure
 * arrives already derived by `playerBetLines`. A number computed in a component
 * can only be tested as "a number was displayed".
 */
export function SideBetStrip({
  lines,
  nameOf,
  presses,
  onOpen,
}: {
  /** One per player, in roster order. */
  lines: PlayerBetLine[];
  nameOf: (playerId: string) => string;
  /** Presses that fired at the hole being viewed, with the exposure each
   *  created — the announcement §6 asks for. */
  presses: { level: number; exposureAfter: number }[];
  onOpen: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onOpen}
      data-testid="side-bet-strip"
      className="flex w-full shrink-0 items-start gap-2 text-left"
      style={{
        padding: "8px 12px",
        background: "var(--color-bt-card)",
        borderBottom: "1px solid var(--color-bt-subtle-border)",
      }}
    >
      <span className="min-w-0 flex-1">
        <span
          className="grid gap-2"
          style={{ gridTemplateColumns: `repeat(${Math.max(lines.length, 1)}, minmax(0, 1fr))` }}
        >
          {lines.map((l) => (
            <span key={l.playerId} className="block min-w-0" data-testid="side-bet-player-column">
              <span
                className="block truncate"
                style={{ fontSize: 12, fontWeight: 500, color: "var(--color-bt-text-dim)" }}
              >
                {nameOf(l.playerId)}
              </span>
              <span
                className="block"
                data-testid="side-bet-player-total"
                style={{
                  fontSize: 19,
                  fontWeight: 700,
                  letterSpacing: "-0.02em",
                  fontVariantNumeric: "tabular-nums",
                  color:
                    l.total > 0.004
                      ? "var(--color-bt-place-1-text)"
                      : l.total < -0.004
                        ? "var(--color-bt-danger)"
                        : "var(--color-bt-text-dim)",
                }}
              >
                {formatSignedMoney(l.total)}
              </span>

              {/* Their OWN live bets — the listing that replaced the aggregate.
                  Nothing at all when they are in none: an empty column says
                  "not in this" more clearly than a $0 would. */}
              {/* The RATE is the line — `$5/hole`, `$5/skin`. It used to read
                  "Head to Head" beside a bare `$5`, which named the wrong thing
                  twice: every row here is a bet, and the figure did not say
                  what it bought. The qualifier survives only where the rate
                  does not already say it (a Nassau leg, a press level), since
                  three identical `$5/hole` rows would be unreadable. */}
              {l.bets.map((b) => (
                <span
                  key={b.betId}
                  className="mt-0.5 flex items-baseline gap-1"
                  data-testid="side-bet-player-bet"
                  style={{ fontSize: 11, color: "var(--color-bt-text-dim)" }}
                >
                  <span style={{ fontWeight: 600, fontVariantNumeric: "tabular-nums" }}>{b.rate}</span>
                  {b.qualifier && <span className="min-w-0 flex-1 truncate">{b.qualifier}</span>}
                </span>
              ))}
            </span>
          ))}
        </span>

        {presses.map((p) => (
          <span
            key={p.level}
            data-testid="side-bet-press-note"
            className="mt-1.5 inline-block"
            style={{
              fontSize: 11,
              fontWeight: 700,
              letterSpacing: "0.04em",
              color: "var(--color-bt-warning)",
              background: "var(--color-bt-warning-faint)",
              border: "1px solid var(--color-bt-warning-border)",
              borderRadius: 5,
              padding: "1px 6px",
              marginRight: 4,
            }}
          >
            PRESS {p.level} · NOW {formatMoney(p.exposureAfter)}/HOLE
          </span>
        ))}
      </span>
      <ChevronRight size={18} className="mt-1 shrink-0" style={{ color: "var(--color-bt-text-dim)" }} />
    </button>
  );
}
