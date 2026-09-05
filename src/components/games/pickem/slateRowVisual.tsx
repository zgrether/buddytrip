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
   * No fill, subtle edge — the row RECEDES.
   *
   * Deliberately not "a row for something that has not happened yet", which is
   * what this said and was already only half true: the run view's ENTERED rows
   * use it for a COLLAPSED row, which has very much happened. The two callers
   * mean different things by it and both are right, because the argument is
   * about EMPHASIS and each screen decides what deserves it.
   *
   * The head-to-head now quiets its PLAYED rows, the exact inverse of what it
   * used to do — the unplayed contests are the only ones that can still move,
   * so they are what somebody scans a live match for.
   *
   * Two changes rather than one because they say the same thing twice. The
   * weighted stripe survives either way, so a 2x game still announces itself.
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

/**
 * What one side's NAME is saying, on whichever surface is asking.
 *
 * ── A shared vocabulary, so two surfaces cannot invent two teals ───────────
 *
 * The picks sheet marks the side you took; the results page marks the side
 * that won. Those are different facts and they get different treatments — but
 * both are "emphasise one of these two names", and the way to keep that from
 * becoming two private style tables is the way `segmentStyle` already did it:
 * the surface picks a STATE, this file decides what the state looks like.
 *
 * ── `level` and `struck` exist because absence is not a state ──────────────
 *
 * A push and a void both pay nobody, and it is tempting to render them the
 * same way as "nothing decided yet". They are not the same: a push HAPPENED
 * and nobody covered; a void means the stake is gone. And neither is a win, so
 * neither may borrow the winner's weight.
 *
 * `level` is the push: BOTH names at the loser's weight but the winner's
 * colour. The absence of contrast is the signal, and it cannot be mistaken for
 * a decided game because a decided game always has exactly one bold name and
 * one dim one.
 *
 * `struck` is the void, and it is the one distinction in this file that lives
 * ENTIRELY in a style property. Nothing about the value, the text or the
 * markup separates a voided row from a played one — only `textDecoration`. So
 * it is the case a value-level guard cannot see (CLAUDE.md's tenth instance),
 * and its test has to mutate the paint rather than the data.
 */
export type SideEmphasis =
  | "none"
  | "chosen"
  | "won"
  | "lost"
  | "level"
  | "struck";

export function sideEmphasisStyle(emphasis: SideEmphasis): CSSProperties {
  switch (emphasis) {
    case "chosen":
      return { color: "var(--color-bt-accent)", fontWeight: 500 };
    case "won":
      return { color: "var(--color-bt-text)", fontWeight: 700 };
    case "lost":
      return { color: "var(--color-bt-text-dim)", fontWeight: 500 };
    case "level":
      return { color: "var(--color-bt-text)", fontWeight: 500 };
    case "struck":
      return {
        color: "var(--color-bt-text-dim)",
        fontWeight: 500,
        textDecoration: "line-through",
        textDecorationColor: "var(--color-bt-text-dim)",
      };
    default:
      return { color: "var(--color-bt-text)", fontWeight: 500 };
  }
}

/**
 * The line that replaces the kickoff once a contest is settled.
 *
 * `tone` rather than a colour, for the same reason `SideEmphasis` is a state:
 * the results page should not be choosing hex values, and the three tones have
 * to stay distinguishable from each other rather than each being individually
 * reasonable.
 */
export type StatusTone = "final" | "push" | "cancelled";

export function statusToneColor(tone: StatusTone): string {
  return tone === "final"
    ? "var(--color-bt-accent)"
    : tone === "cancelled"
      ? "var(--color-bt-danger)"
      : "var(--color-bt-text-dim)";
}

export interface MatchupLineGame {
  awayTeam: string;
  homeTeam: string;
  spread?: string | null;
  kickoff?: string | null;
  note?: string | null;
  /** Null is 1. The column is nullable and several callers pass it through
   *  unmapped, so the type admits it rather than making each of them coalesce. */
  multiplier?: number | null;
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

/**
 * The line, beside the home team it belongs to.
 *
 * Sized UP and weighted DOWN against the version that sat on the old one-line
 * matchup (11px/700 → 12px/500). It shared that line with two truncating team
 * names and had to shout over them; on its own line beside a single name it
 * does not, and 700 next to a 500 team name read as the louder fact of the two.
 *
 * COLOURS ARE UNCHANGED — the mock's hexes are placeholder (its own banner says
 * so) and this keeps the `planning` tokens it already used. Only size and
 * weight, which the mock is authoritative for, move.
 */
export function SpreadBadge({ spread }: { spread: string }) {
  return (
    <span
      className="shrink-0 rounded px-1.5"
      style={{
        fontSize: TYPE_SCALE.bodyDense,
        fontWeight: 500,
        background: "var(--color-bt-planning-faint)",
        color: "var(--color-bt-planning)",
      }}
    >
      {spread}
    </span>
  );
}

/**
 * "Milwaukee Brewers" over "at Cincinnati Reds  −3.5", with the multiplier
 * pinned top-right, over "Fri Sep 4, 6:10p · Tyler".
 *
 * `leading` is whatever sits to the left — the slate's ordinal, the sheet's
 * rank chip. It is a slot rather than a prop the component interprets, because
 * the lists number their rows for different reasons and none of them should
 * have to explain itself to this file.
 *
 * ── ONE TEAM PER LINE, ALWAYS — AND THIS REVERSES r7 §12 ──────────────────
 *
 * §12 put both teams on ONE line and had it TRUNCATE, explicitly so that
 * "every row [is] the same height". The reasoning was sound and it was aimed at
 * a real problem: a `flex-wrap` run let a long matchup push the multiplier onto
 * a second line, so the same game occupied one line on one surface and two on
 * another. Uniformity across surfaces was the goal; a fixed single line was the
 * means.
 *
 * What that traded away is the thing this reverses. Real slates are college
 * football, where "Lebanon Valley Flying Dutchmen at Franklin & Marshall
 * Diplomats" is 61 characters — so the single line did not hold a matchup at
 * 390px, it held the first one and a half teams and an ellipsis. On the results
 * page, where four controls already compete for the row, that is the reported
 * truncation bug.
 *
 * Two lines ALWAYS — never conditional on length — keeps §12's actual goal
 * intact. Every row is still the same height and the same game still occupies
 * the same space on every surface; the constant is just two lines rather than
 * one. Each name gets its own line and truncates within it, so a pathological
 * name still cannot spill to a third.
 *
 * The multiplier keeps §12's other decision — it is pinned RIGHT so weighted
 * games line up in a column and the eye finds them in one pass down the edge —
 * but it is now ABSOLUTE rather than the end of a flex run, so its position no
 * longer depends on the names at all. The name block pads to clear it.
 *
 * ── The badge and the multiplier cannot collide ───────────────────────────
 *
 * The multiplier is absolute within THIS component's box, not the card's. Where
 * a surface puts something to the right of the matchup — the sheet's `NOT
 * PICKED` stamp, the head-to-head's result chip — that sibling takes its own
 * width and the matchup's box shrinks, so the badge lands just left of it
 * instead of underneath it. Where there is no sibling (the common case) this
 * component fills the row and its right edge IS the card's.
 *
 * ── The sub-line truncates, and that is a known open issue ─────────────────
 * Kickoff and note share one line with `truncate`, and since Phase 2b the
 * kickoff carries a date, so the note loses more of itself at 390px than it
 * used to. Raised at the Phase 2 look and still open; kept identical in every
 * surface on purpose, so whatever fixes it fixes them all at once. It is
 * deliberately NOT padded to clear the multiplier — the badge sits on line 1
 * only, and stealing 44px from the line that already truncates worst would pay
 * for clearance nothing needs.
 */

/**
 * How far the name lines pad to clear the pinned multiplier.
 *
 * Wide enough for a two-digit badge (`10×`) plus a gap, so the clearance does
 * not depend on which multipliers a slate happens to use.
 */
const MULTIPLIER_CLEARANCE = 44;

export function MatchupLine({
  game,
  leading,
  awayEmphasis = "none",
  homeEmphasis = "none",
  status,
}: {
  game: MatchupLineGame;
  leading?: ReactNode;
  /** What each NAME is saying on this surface — see `SideEmphasis`. */
  awayEmphasis?: SideEmphasis;
  homeEmphasis?: SideEmphasis;
  /**
   * Replaces the KICKOFF once a contest is settled, keeping the note.
   *
   * "Status replaces the date" literally: the date is spent the moment the
   * game is over, the runner's note ("Rob and Matt", "Most of the Golf Trip")
   * is not — so the note survives beside the status rather than being replaced
   * along with it.
   */
  status?: { text: string; tone: StatusTone };
}) {
  const meta = status
    ? game.note || null
    : [game.kickoff, game.note].filter(Boolean).join(" · ") || null;
  const multiplier = game.multiplier ?? 1;
  const weighted = multiplier > 1;
  const name = { fontSize: TYPE_SCALE.name, lineHeight: 1.3 } as const;
  const clearance = weighted ? MULTIPLIER_CLEARANCE : undefined;
  return (
    <div className="relative flex min-w-0 flex-1 items-start gap-2.5">
      {leading}
      <span className="min-w-0 flex-1">
        <span
          className="block truncate"
          data-testid="pickem-matchup-away"
          style={{ ...name, ...sideEmphasisStyle(awayEmphasis), paddingRight: clearance }}
        >
          {game.awayTeam}
        </span>
        <span className="flex min-w-0 items-baseline gap-x-1.5">
          <span
            className="min-w-0 truncate"
            data-testid="pickem-matchup-home"
            style={{ ...name, ...sideEmphasisStyle(homeEmphasis), paddingRight: clearance }}
          >
            {/* "at" is the CONNECTIVE and never takes the side's emphasis —
                striking it through or tealing it would make the preposition
                look like part of the claim about the team. */}
            <span
              style={{
                color: "var(--color-bt-text-dim)",
                fontWeight: 400,
                textDecoration: "none",
              }}
            >
              at{" "}
            </span>
            {game.homeTeam}
          </span>
          {/* WITH the home team, because the line is the home team's — the one
              badge whose position is meaningful rather than tidy. */}
          {game.spread && <SpreadBadge spread={game.spread} />}
        </span>
        {(status || meta) && (
          <span className="mt-0.5 flex min-w-0 items-baseline gap-x-1">
            {status && (
              <span
                className="shrink-0"
                data-testid="pickem-matchup-status"
                style={{
                  fontSize: TYPE_SCALE.bodyDense,
                  fontWeight: 600,
                  letterSpacing: "0.03em",
                  color: statusToneColor(status.tone),
                }}
              >
                {status.text}
              </span>
            )}
            {meta && (
              <span
                className="min-w-0 truncate"
                style={{ fontSize: TYPE_SCALE.caption, color: "var(--color-bt-text-dim)" }}
              >
                {status ? `· ${meta}` : meta}
              </span>
            )}
          </span>
        )}
      </span>
      {weighted && (
        <span
          className="absolute"
          data-testid="pickem-matchup-multiplier-slot"
          style={{ top: 0, right: 0 }}
        >
          <MultiplierBadge multiplier={multiplier} />
        </span>
      )}
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
