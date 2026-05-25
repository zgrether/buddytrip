"use client";

import type { ReactNode } from "react";

// ── Types ────────────────────────────────────────────────────────────────

interface TabHeaderProps {
  /**
   * Small uppercase accent label — e.g. "RECEIPTS". Optional: leave it
   * off when a tab doesn't need a label above the headline (Home tab uses
   * this — the trip header above already makes context obvious).
   */
  eyebrow?: string;
  /**
   * Eyebrow color. "accent" (default) uses the brand teal — the
   * standard tab eyebrow treatment. "dim" uses bt-text-dim and is
   * reserved for empty-state pages where the eyebrow conveys
   * neutral context (trip name · location) rather than the tab
   * identity itself.
   */
  eyebrowTone?: "accent" | "dim";
  /** Bold display headline. */
  headline: string;
  /** Short paragraph of dim body copy below the headline. Accepts a
   *  string for plain copy, or a ReactNode when the body needs inline
   *  formatting (e.g. a bolded defined term like **placeholder**). */
  body: import("react").ReactNode;
  /**
   * Optional action(s) rendered on the right of the eyebrow row at sm+.
   * Hidden on mobile (per-tab TabFab takes over the add affordance there).
   * Requires `eyebrow` to be present — without it there's no row anchor.
   */
  desktopAction?: ReactNode;
  /** data-testid for E2E targeting. */
  testId?: string;
}

// ── Component ────────────────────────────────────────────────────────────

/**
 * TabHeader — shared header treatment for the four "entry" tabs (Crew,
 * Lodging, Agenda, Receipts).
 *
 * Visual cadence borrowed from the marketing page's feature blocks:
 *
 *   EYEBROW          11px uppercase, accent teal, letter-spaced
 *   Headline         clamp(20px,2.8vw,26px), semibold, white, tight line-height
 *   Body copy        15px, leading-1.65, text-dim, max-w-prose
 *
 * The marketing scale tops out at 36px for the H2; we cap at 26px here so
 * the in-app rhythm reads as "section intro" rather than "landing page".
 * The eyebrow stays in the marketing teal so the two surfaces feel like
 * the same product.
 *
 * desktopAction renders on the right of the eyebrow row at `sm` and up.
 * On mobile, it's hidden — each tab pairs this header with a TabFab.
 */
export function TabHeader({
  eyebrow,
  eyebrowTone = "accent",
  headline,
  body,
  desktopAction,
  testId,
}: TabHeaderProps) {
  return (
    <div className="mb-6" data-testid={testId}>
      {/* Eyebrow row — only renders when an eyebrow is supplied. The
          desktopAction also lives on this row, so an unsupplied eyebrow
          will skip the action too (the Home tab is the only consumer
          without an eyebrow and doesn't need an action). */}
      {eyebrow && (
        <div className="mb-3 flex items-center justify-between gap-3">
          <span
            className="text-[11px] font-semibold uppercase"
            style={{
              color:
                eyebrowTone === "dim"
                  ? "var(--color-bt-text-dim)"
                  : "var(--color-bt-accent)",
              letterSpacing: "0.1em",
            }}
          >
            {eyebrow}
          </span>
          {desktopAction && (
            <div className="hidden flex-shrink-0 sm:flex sm:items-center sm:gap-2">
              {desktopAction}
            </div>
          )}
        </div>
      )}

      {/* Headline — bold display H2 */}
      <h2
        className="mb-3 font-semibold"
        style={{
          color: "var(--color-bt-text)",
          fontSize: "clamp(20px, 2.8vw, 26px)",
          lineHeight: 1.15,
          letterSpacing: "-0.015em",
        }}
      >
        {headline}
      </h2>

      {/* Body — dim paragraph, capped to a comfortable measure */}
      <p
        className="max-w-prose"
        style={{
          color: "var(--color-bt-text-dim)",
          fontSize: 15,
          lineHeight: 1.65,
        }}
      >
        {body}
      </p>
    </div>
  );
}
