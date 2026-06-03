"use client";

import type { FC, ReactNode } from "react";
import { Check } from "lucide-react";
import { DOMAIN_COLORS, type Domain } from "@/lib/domainColors";

// ── StepCard ─────────────────────────────────────────────────────────────
//
// One of the four step cards in FreshTripGuide. Layout:
//   1. dark "preview" area at the top — owns the mini-UI thumbnail. The
//      thumbnail renders flush on this surface; no inner panel/border.
//   2. Number badge inline with the title (number-circle is faint-teal
//      background + teal numeral; the badge collapses to a check icon
//      when `done`).
//   3. One-line body or done-summary.
//   4. CTA at the bottom. Primary variant = solid accent (use for the
//      single "attention grabber" — Set dates), ghost variant = card-raised
//      bg + subtle border + leading icon (matches the "Add another item"
//      buttons under each tab).

export interface StepCardProps {
  /** Step number rendered as a small badge to the LEFT of the title. */
  number: number;
  /** Domain that drives the badge tint (and any future per-step
   *  accent). Maps to a `--color-bt-domain-*` token. */
  domain: Domain;
  /** Numbered title — short noun-phrase. */
  title: string;
  /** One-line description under the title. */
  body: string;
  /** Stylized mini-UI preview. Rendered into the dark preview area. */
  thumbnail: ReactNode;
  /** CTA button label, e.g. "Add lodging". */
  cta: string;
  /** Leading icon for the CTA, e.g. <Home size={14} />. */
  ctaIcon?: ReactNode;
  /** "primary" → solid teal attention-grabber.
   *  "ghost"   → translucent + bordered (matches add-another-item style).
   *  Default ghost; only set "primary" on the single attention step. */
  ctaVariant?: "primary" | "ghost";
  /** CTA click handler. */
  onCta: () => void;
  /** Optional "done" mode — when the step is satisfied. Currently
   *  flips the number badge to a check; the parent card may also swap
   *  its own background to accent-faint (see SetDatesFlipCard). */
  done?: boolean;
  /** Shown above the body when done — what the user actually picked,
   *  e.g. "May 22 – 26, 2026 · 5 days. These frame your whole itinerary." */
  doneSummary?: string;
  /** Test id for the CTA. */
  testId?: string;
}

export const StepCard: FC<StepCardProps> = ({
  number,
  domain,
  title,
  body,
  thumbnail,
  cta,
  ctaIcon,
  ctaVariant = "ghost",
  onCta,
  done = false,
  doneSummary,
  testId,
}) => {
  const tint = DOMAIN_COLORS[domain];
  // Done treatment — accent-faint vertical fade + accent-border outline.
  // Mirrors SetDatesFlipCard's done state so completed steps speak the
  // same visual language.
  const surface: React.CSSProperties = done
    ? {
        background:
          "linear-gradient(180deg, var(--color-bt-accent-faint), transparent 60%)",
        border: "1px solid var(--color-bt-accent-border)",
      }
    : {
        background: "var(--color-bt-card)",
        border: "1px solid var(--color-bt-border)",
      };
  return (
    <div
      className="flex flex-col gap-3 rounded-xl p-3"
      style={surface}
      data-testid={`step-card-${number}`}
    >
      {/* Preview area — dark surface that hosts the mini-UI thumbnail.
          Fixed 130px height so the thumbnail keeps the same proportions
          across cards. Any spare card height becomes empty space
          between the body text and the CTA (which mt-auto pins to the
          bottom). */}
      <div
        className="flex items-stretch justify-stretch overflow-hidden rounded-lg"
        style={{
          background: "var(--color-bt-base)",
          height: 130,
        }}
        aria-hidden="true"
      >
        {thumbnail}
      </div>

      {/* Title row — number badge inline */}
      <div className="flex items-center gap-2">
        <NumberBadge done={done} tint={tint.color} faint={tint.faint}>
          {number}
        </NumberBadge>
        <p
          className="text-[15px] font-semibold leading-tight"
          style={{ color: "var(--color-bt-text)" }}
        >
          {title}
        </p>
      </div>

      {/* Body / done-summary */}
      <p
        className="text-[13px] leading-snug"
        style={{ color: "var(--color-bt-text-dim)" }}
      >
        {done && doneSummary ? doneSummary : body}
      </p>

      {/* CTA — generous breathing room above (mt-6) separates the
          actionable button from the explanatory body so the card
          reads as "here's the pitch / here's the action" instead of
          one wall of content. When done, the CTA becomes an unfilled
          outline button (the tinted card surface already carries
          weight; a filled button would compete). */}
      <button
        type="button"
        onClick={onCta}
        data-testid={testId}
        className="mt-6 flex w-full items-center justify-center gap-2 rounded-lg py-2 text-[13px] font-semibold transition-colors hover:bg-[rgba(255,255,255,0.04)]"
        style={
          done
            ? {
                // Border stays the neutral border token (not accent) so
                // the button reads as a quiet control next to the
                // tinted card surface.
                background: "transparent",
                color: "var(--color-bt-text)",
                border: "1px solid var(--color-bt-border)",
              }
            : ctaVariant === "primary"
              ? {
                  background: tint.color,
                  color: "var(--color-bt-on-accent, #0d1f1a)",
                }
              : {
                  // Ghost — transparent so only Set dates carries a
                  // filled accent. Border keeps the row legible at a
                  // glance without competing for attention.
                  background: "transparent",
                  color: "var(--color-bt-text)",
                  border: "1px solid var(--color-bt-border)",
                }
        }
      >
        {ctaIcon}
        {cta}
      </button>
    </div>
  );
};

// ── NumberBadge ─────────────────────────────────────────────────────────
//
// 20px circle. Idle: faint-teal background + teal numeral (inverted from
// the previous "solid teal + dark numeral" treatment). Done: check icon
// in the same colors.

function NumberBadge({
  children,
  done,
  tint,
  faint,
}: {
  children: ReactNode;
  done: boolean;
  tint: string;
  faint: string;
}) {
  return (
    <span
      className="inline-flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full text-[11px] font-bold tabular-nums"
      style={
        done
          ? {
              // Inverted — solid accent fill with dark check ink.
              background: tint,
              color: "var(--color-bt-on-accent, #0d1f1a)",
            }
          : {
              background: faint,
              color: tint,
              border: `1px solid ${tint}`,
            }
      }
      aria-hidden="true"
    >
      {done ? <Check size={12} strokeWidth={2.8} /> : children}
    </span>
  );
}
