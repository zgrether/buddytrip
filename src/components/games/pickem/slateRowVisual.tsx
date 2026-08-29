"use client";

import type { CSSProperties, ReactNode } from "react";
import { TYPE_SCALE } from "@/lib/typeScale";

/**
 * The visual language of one contest, shared by the slate modal and the sheet.
 *
 * ── Why this is a module and not a copy ────────────────────────────────────
 *
 * HANDOFF §3: "echo the slate row's visual language — same games, same
 * treatment, a picker shouldn't have to re-parse them." Two sixteen-row lists
 * showing the same sixteen contests, built ninety minutes apart, is the exact
 * setup CLAUDE.md #24 describes: the copies agree at first and then one of them
 * gets a tweak.
 *
 * And the specific thing most likely to drift here is the one that matters
 * most. The multiplier stripe is not decoration — spec §11 says multipliers
 * must be visible BEFORE picking, because a 2× game changes where you spend
 * confidence. A sheet whose stripe quietly stopped matching the slate's would
 * still look fine.
 *
 * So both surfaces call `pickemRowSurface` for the stripe and `MatchupLine` for
 * the text. Neither owns the other; the slate modal was here first and this is
 * its markup, lifted.
 */

/**
 * A row's border and background, including the weighted stripe.
 *
 * PER-SIDE LONGHANDS, never the `border` shorthand plus a `borderLeft`
 * override. React warns on that combination — "updating a style property during
 * rerender (border) when a conflicting property is set (borderLeft)" — and it
 * is right: which wins depends on property order across a re-render, so the
 * stripe can be silently clobbered when a row toggles state. Caught in the dev
 * console during Phase 2, not in review.
 *
 * The stripe is a SOLID LEFT RULE rather than a background wash. The wash was
 * tried and never read, which defeated the point: finding weighted games in a
 * sixteen-row list is a vertical eye movement down the left edge, so that edge
 * is where the mark belongs.
 */
export function pickemRowSurface(opts: {
  weighted: boolean;
  /** Selected / being edited — accent tint and accent border. */
  active?: boolean;
  /** Override the resting background (the sheet's read-only rows sit flatter). */
  background?: string;
  /**
   * No fill, subtle edge — a row for something that has not happened yet.
   *
   * Two changes rather than one because they say the same thing twice: an
   * unplayed row should not read as a record. The weighted stripe survives, so
   * a 2x game still announces itself before it is played, which is when that
   * matters most.
   */
  quiet?: boolean;
}): CSSProperties {
  const { weighted, active = false, background, quiet = false } = opts;
  const edge = active
    ? "var(--color-bt-accent-border)"
    : quiet
      ? "var(--color-bt-subtle-border)"
      : "var(--color-bt-border)";
  return {
    background:
      background ??
      (active
        ? "var(--color-bt-accent-faint)"
        : quiet
          ? "transparent"
          : "var(--color-bt-card)"),
    borderStyle: "solid",
    borderTopWidth: 1,
    borderRightWidth: 1,
    borderBottomWidth: 1,
    borderLeftWidth: weighted ? 3 : 1,
    borderTopColor: edge,
    borderRightColor: edge,
    borderBottomColor: edge,
    borderLeftColor: weighted ? "var(--color-bt-glorious)" : edge,
  };
}

export interface MatchupLineGame {
  awayTeam: string;
  homeTeam: string;
  spread?: string | null;
  kickoff?: string | null;
  note?: string | null;
  multiplier?: number;
}

/** The badge a weighted game carries. Colour says "worth more", number says how
 *  much — the stripe alone cannot carry the value. */
export function MultiplierBadge({ multiplier }: { multiplier: number }) {
  return (
    <span
      data-testid="pickem-multiplier-badge"
      className="rounded px-1.5"
      style={{
        fontSize: TYPE_SCALE.caption,
        fontWeight: 700,
        color: "var(--color-bt-glorious)",
        background: "color-mix(in srgb, var(--color-bt-glorious) 22%, transparent)",
        border: "1px solid var(--color-bt-glorious-border)",
      }}
    >
      {multiplier}×
    </span>
  );
}

export function SpreadBadge({ spread }: { spread: string }) {
  return (
    <span
      className="rounded px-1.5"
      style={{
        fontSize: TYPE_SCALE.caption,
        fontWeight: 700,
        background: "var(--color-bt-planning-faint)",
        color: "var(--color-bt-planning)",
      }}
    >
      {spread}
    </span>
  );
}

/**
 * "Alabama at Georgia  −3.5  2×" over "Sat Nov 8, 7:30p · Night game".
 *
 * `leading` is whatever sits to the left — the slate's ordinal, the sheet's
 * rank chip. It is a slot rather than a prop the component interprets, because
 * the two lists number their rows for opposite reasons and neither should have
 * to explain itself to this file.
 *
 * ── The sub-line truncates, and that is a known open issue ─────────────────
 * Kickoff and note share one line with `truncate`, and since Phase 2b the
 * kickoff carries a date, so the note loses more of itself at 390px than it
 * used to. Raised at the Phase 2 look and still open; kept identical in both
 * surfaces on purpose, so whatever fixes it fixes both at once.
 */
export function MatchupLine({
  game,
  leading,
  trailing,
}: {
  game: MatchupLineGame;
  leading?: ReactNode;
  trailing?: ReactNode;
}) {
  const meta = [game.kickoff, game.note].filter(Boolean).join(" · ");
  return (
    <div className="flex min-w-0 flex-1 items-start gap-2.5">
      {leading}
      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-center gap-x-1.5 gap-y-1">
          <span style={{ fontSize: TYPE_SCALE.body, fontWeight: 600 }}>
            {game.awayTeam}{" "}
            <span style={{ color: "var(--color-bt-text-dim)", fontWeight: 500 }}>at</span>{" "}
            {game.homeTeam}
          </span>
          {game.spread && <SpreadBadge spread={game.spread} />}
          {(game.multiplier ?? 1) > 1 && <MultiplierBadge multiplier={game.multiplier as number} />}
        </span>
        {meta && (
          <span
            className="mt-0.5 block truncate"
            style={{ fontSize: TYPE_SCALE.caption, color: "var(--color-bt-text-dim)" }}
          >
            {meta}
          </span>
        )}
      </span>
      {trailing}
    </div>
  );
}

/** The slate's ordinal / the sheet's position marker. */
export function RowOrdinal({ children }: { children: ReactNode }) {
  return (
    <span
      style={{
        fontSize: TYPE_SCALE.caption,
        fontWeight: 700,
        color: "var(--color-bt-text-dim)",
        fontVariantNumeric: "tabular-nums",
        minWidth: 16,
        paddingTop: 1,
      }}
    >
      {children}
    </span>
  );
}
