"use client";

import type { ReactNode } from "react";

/**
 * "Matt Facchine def. JD Shumpert · 3&2" — the green band under a decided match.
 *
 * ── It was never a component, and pick'em would have been the third copy ───
 *
 * `MatchEntryView` and `MatchOutcomeEntryView` each rendered this inline,
 * character-identical in every value: `marginTop: 6`, `padding: "7px 12px"`,
 * `borderRadius: 10`, the place-1 fill, the same 13/600 text. They agreed only
 * because nobody had changed one of them — CLAUDE.md #24's shape, where the
 * OUTPUT is shared and re-rendered privately by each caller.
 *
 * The pick'em head-to-head wants the same band for "JohnnyD takes it · Taj
 * submitted no picks", and the instruction was to reuse rather than build a
 * second. There was no *it* to reuse, so this is the extraction that makes the
 * instruction executable — and the third caller is now free rather than being a
 * third copy.
 *
 * ── The border is a token now ─────────────────────────────────────────────
 *
 * Both copies carried `border: 1px solid rgba(34,197,94,0.25)`, which the code
 * conventions forbid. The reason it was hardcoded is that `place-1` was the one
 * colour family with no `-border` member (accent, danger, warning, glorious and
 * ready all have one). `--color-bt-place-1-border` now exists at exactly that
 * value, so this is a rename rather than a restyle: nothing moves on screen.
 *
 * ── Deliberately NOT "the winner is green" ────────────────────────────────
 *
 * The band takes a composed `text` rather than a winner and a loser, because
 * the two formats say different things: golf names a defeat and a margin,
 * pick'em names who takes it and WHY. `matchDefeatText` below keeps golf's two
 * callers sharing one sentence; pick'em composes its own, and there is no
 * shared template pretending the two are the same statement.
 */
export function MatchResultBanner({
  text,
  children,
  testId,
}: {
  /** The whole sentence. See the note above on why this is not (winner, loser). */
  text: string;
  /**
   * The right-hand slot — `MatchEntryView`'s "play it out" toggle, which is the
   * only thing that has ever sat here. A slot rather than a prop this file
   * interprets: it belongs to the surface's own lifecycle, not to the result.
   */
  children?: ReactNode;
  testId?: string;
}) {
  return (
    <div
      data-testid={testId ?? "match-result-banner"}
      className="flex items-center justify-between"
      style={{
        marginTop: 6,
        padding: "7px 12px",
        borderRadius: 10,
        background: "var(--color-bt-place-1-bg)",
        border: "1px solid var(--color-bt-place-1-border)",
      }}
    >
      <span style={{ fontSize: 13, fontWeight: 600, color: "var(--color-bt-place-1-text)" }}>
        {text}
      </span>
      {children}
    </div>
  );
}

/**
 * Golf's sentence, shared by the two entry views so they cannot drift.
 *
 * A halved match names no winner — "Match halved · AS" — which is why this is a
 * function over an optional pair rather than a template with a winner in it.
 */
export function matchDefeatText(
  winner: { name: string } | null | undefined,
  loser: { name: string } | null | undefined,
  margin: string | null
): string {
  return winner && loser
    ? `${winner.name} def. ${loser.name} · ${margin}`
    : `Match halved · ${margin}`;
}
