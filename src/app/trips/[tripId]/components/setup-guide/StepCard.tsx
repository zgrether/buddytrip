"use client";

import type { FC, ReactNode } from "react";
import { DOMAIN_COLORS, type Domain } from "@/lib/domainColors";

// ── StepCard ─────────────────────────────────────────────────────────────
//
// One of the four step cards in FreshTripGuide. Owns the layout shared by
// every step (number badge + thumbnail + title + body + CTA); the caller
// supplies the thumbnail SVG and the click handler. Domain-tinted via the
// shared DOMAIN_COLORS map so each step picks up its tab's color.

export interface StepCardProps {
  /** Step number rendered as a small badge in the top-left. */
  number: number;
  /** Domain that drives the accent tint of the number badge + thumbnail
   *  background + CTA. Maps to a `--color-bt-domain-*` token. */
  domain: Domain;
  /** Numbered title — short noun-phrase. */
  title: string;
  /** One-line description under the title. */
  body: string;
  /** Tiny stylized thumbnail rendered in the card's preview area. SVG or
   *  arbitrary JSX — caller controls sizing. */
  thumbnail: ReactNode;
  /** CTA button label, e.g. "Add a property". */
  cta: string;
  /** CTA click handler. */
  onCta: () => void;
  /** Optional "done" mode — collapsed visual state once the step is
   *  satisfied (e.g. dates set). The CTA becomes a quiet "Change" link;
   *  the thumbnail and body fade back. */
  done?: boolean;
  /** Shown above the body when done — what the user actually picked.
   *  E.g. "May 26 – Jun 14". */
  doneSummary?: string;
  /** Optional test id for the CTA. */
  testId?: string;
}

export const StepCard: FC<StepCardProps> = ({
  number,
  domain,
  title,
  body,
  thumbnail,
  cta,
  onCta,
  done = false,
  doneSummary,
  testId,
}) => {
  const tint = DOMAIN_COLORS[domain];
  return (
    <div
      className="relative flex flex-col rounded-xl p-4"
      style={{
        background: "var(--color-bt-card)",
        border: "1px solid var(--color-bt-border)",
      }}
      data-testid={`step-card-${number}`}
    >
      {/* Number badge */}
      <span
        className="absolute -top-2 left-3 inline-flex h-5 min-w-[20px] items-center justify-center rounded-full px-1 text-[10px] font-bold tabular-nums"
        style={{
          background: tint.color,
          color: "var(--color-bt-on-accent, #0d1f1a)",
        }}
        aria-hidden="true"
      >
        {number}
      </span>

      {/* Thumbnail — domain-tinted background */}
      <div
        className="mb-3 flex h-20 items-center justify-center overflow-hidden rounded-lg"
        style={{
          background: tint.faint,
          color: tint.color,
          opacity: done ? 0.55 : 1,
        }}
        aria-hidden="true"
      >
        {thumbnail}
      </div>

      {/* Title */}
      <p
        className="text-[13px] font-semibold leading-tight"
        style={{ color: "var(--color-bt-text)" }}
      >
        {title}
      </p>

      {/* Body / done-summary */}
      {done && doneSummary ? (
        <p
          className="mt-1 text-[12px]"
          style={{ color: tint.color }}
        >
          {doneSummary}
        </p>
      ) : (
        <p
          className="mt-1 text-[11px] leading-snug"
          style={{ color: "var(--color-bt-text-dim)" }}
        >
          {body}
        </p>
      )}

      {/* CTA */}
      <div className="mt-3">
        {done ? (
          <button
            type="button"
            onClick={onCta}
            data-testid={testId}
            className="text-[12px] font-medium transition-opacity hover:opacity-80"
            style={{ color: "var(--color-bt-text-dim)" }}
          >
            Change
          </button>
        ) : (
          <button
            type="button"
            onClick={onCta}
            data-testid={testId}
            className="w-full rounded-lg py-2 text-[12px] font-semibold transition-opacity hover:opacity-90"
            style={{
              background: tint.color,
              color: "var(--color-bt-on-accent, #0d1f1a)",
            }}
          >
            {cta}
          </button>
        )}
      </div>
    </div>
  );
};
