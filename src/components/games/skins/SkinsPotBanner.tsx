"use client";

import type { SkinsHoleLine } from "@/lib/skins";

/**
 * SkinsPotBanner — what this hole is worth, and where the pot went.
 *
 * ── It must be FORWARD-LOOKING, and that is the whole requirement ──────────
 *
 * On 17, after 16 was tied, this says the hole is worth 4 BEFORE anybody has
 * tapped anything. A pot sitting at 4 going into a hole is the most interesting
 * fact on the screen and it is a fact about a hole that has not been played, so
 * a banner that only reported settled holes would never show it. `sideBets.ts`
 * populates `pot` on undecided holes for exactly this reason, and its comment
 * says so: "what is this hole worth before it's played" is the question
 * carryover makes interesting.
 *
 * ── ONE banner, not two ───────────────────────────────────────────────────
 *
 * Glorious is folded in here rather than given its own strip above, which is
 * what match play's entry screen does. Two banners would print one fact twice —
 * "Glorious Finishing Hole · Worth Double" immediately above "this hole is worth
 * 2" — and that is the composition bug CLAUDE.md describes: two components each
 * correct on their own, and a screen saying the same thing twice. The glorious
 * treatment is carried by the ACCENT here, on the one line that already has to
 * name the number.
 *
 * ── The three states say different things because they mean different things ─
 *
 * A hole not yet played is a FORECAST ("worth 4"). A hole that was tied is a
 * REPORT with a consequence ("pushed — 4 carries to 18"). A tied FINAL hole is a
 * report with the opposite consequence, and the difference matters more than
 * anywhere else on this screen: the same number, 6, is either what the next hole
 * is playing for or what nobody will ever be paid. That distinction is not
 * visible in the value, so the sentence carries it.
 *
 * Presentation-only (CLAUDE.md #7): every input is a prop, there is no tRPC and
 * no DB here, and the same component serves the trip game and any future local
 * one.
 */
export function SkinsPotBanner({
  line,
  isFinalHole,
  nextHoleLabel,
}: {
  /** This hole's line from `tallyGrouping` — pot, carriedIn, ownValue, status. */
  line: SkinsHoleLine;
  /** Is this the last hole of the round? Decides what a tie MEANS. */
  isFinalHole: boolean;
  /** Display label of the next hole, for the carry sentence. Omitted on the last. */
  nextHoleLabel?: string;
}) {
  const glorious = line.ownValue > 1;
  const pushed = line.status === "tied";
  const dead = pushed && isFinalHole;

  // Skins are counted, so they are pluralised — "1 skin", "4 skins". A bare
  // number would read as a hole number on a screen full of them.
  const skins = (n: number) => `${n} skin${n === 1 ? "" : "s"}`;

  const { headline, detail, testId } = dead
    ? {
        headline: "Pushed",
        detail: `${skins(line.pot)} go unpaid — there is no hole left to carry to.`,
        testId: "skins-pot-dead",
      }
    : pushed
      ? {
          headline: "Pushed",
          detail: `${skins(line.pot)} carr${line.pot === 1 ? "ies" : "y"} over to hole ${nextHoleLabel ?? ""}.`.trim(),
          testId: "skins-pot-pushed",
        }
      : {
          headline: `This hole · ${skins(line.pot)}`,
          detail:
            line.carriedIn > 0
              ? `${skins(line.ownValue)} of its own, plus ${line.carriedIn} carried in.`
              : glorious
                ? "Glorious Finishing Hole — worth double."
                : null,
          testId: "skins-pot-live",
        };

  // A carried pot takes the accent whatever the hole's own weight, because the
  // carry is the thing worth noticing; an ordinary hole with nothing riding on
  // it is deliberately quiet.
  const hot = line.carriedIn > 0 || glorious;
  const tone = dead
    ? { fg: "var(--color-bt-text-dim)", bg: "transparent", border: "var(--color-bt-border)" }
    : hot
      ? {
          fg: "var(--color-bt-glorious)",
          bg: "var(--color-bt-glorious-faint)",
          border: "var(--color-bt-glorious-border)",
        }
      : {
          fg: "var(--color-bt-text)",
          bg: "var(--color-bt-card)",
          border: "var(--color-bt-border)",
        };

  return (
    <div
      data-testid="skins-pot-banner"
      data-skins-pot={line.pot}
      style={{
        margin: "0 16px 10px",
        padding: "8px 12px",
        borderRadius: 10,
        textAlign: "center",
        background: tone.bg,
        border: `1px solid ${tone.border}`,
      }}
    >
      <span data-testid={testId} style={{ fontSize: 13, fontWeight: 700, color: tone.fg }}>
        {headline}
      </span>
      {detail && (
        <div style={{ fontSize: 11.5, fontWeight: 600, color: "var(--color-bt-text-dim)", marginTop: 2 }}>
          {detail}
        </div>
      )}
    </div>
  );
}
