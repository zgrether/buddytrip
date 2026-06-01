"use client";

import type { ReactNode } from "react";
import { DOMAIN_COLORS, type Domain } from "@/lib/domainColors";

// ── Types ────────────────────────────────────────────────────────────────

interface TabHeaderProps {
  /**
   * Small uppercase accent label — e.g. "RECEIPTS". Optional: leave it
   * off when a tab doesn't need a label above the headline (Home tab uses
   * this — the trip header above already makes context obvious).
   */
  eyebrow?: string;
  /**
   * Eyebrow color. "accent" (default) takes the domain hue when `domain`
   * is supplied (the standard tab eyebrow treatment — it matches the
   * active tab), falling back to the brand teal otherwise. "dim" uses
   * bt-text-dim and is reserved for empty-state pages where the eyebrow
   * conveys neutral context (trip name · location) rather than the tab
   * identity itself.
   */
  eyebrowTone?: "accent" | "dim";
  /**
   * Trip area this header belongs to. When set (and tone is "accent"),
   * the eyebrow is painted in that area's domain color so it reinforces
   * the active tab. Omit on neutral/empty-state headers.
   */
  domain?: Domain;
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
  /**
   * When true, the action stays visible at every viewport instead of
   * hiding below md. Use this for non-add affordances (e.g. Crew's
   * "Email the crew" button) where the FAB doesn't substitute — the
   * FAB is the *add* CTA, secondary actions need their own real
   * estate on mobile.
   */
  actionAlwaysVisible?: boolean;
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
  domain,
  headline,
  body,
  desktopAction,
  actionAlwaysVisible = false,
  testId,
}: TabHeaderProps) {
  // Eyebrow color: "dim" stays neutral; otherwise pull the domain hue so
  // the eyebrow matches the active tab, falling back to accent teal when
  // no domain is supplied.
  const eyebrowColor =
    eyebrowTone === "dim"
      ? "var(--color-bt-text-dim)"
      : domain
        ? DOMAIN_COLORS[domain].color
        : "var(--color-bt-accent)";
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
            style={{ color: eyebrowColor, letterSpacing: "0.1em" }}
          >
            {eyebrow}
          </span>
          {desktopAction && (
            // Default behavior (round-3 narrow-tablet Option A): the
            // header action hides below md so the FAB is the sole add
            // affordance at narrow tablet + phone widths. Pairs with
            // TabFab's md:hidden (Task 14) so rail/FAB swap at the
            // same breakpoint.
            //
            // actionAlwaysVisible escape hatch: non-add affordances
            // (e.g. Crew's "Email the crew" button) stay visible at
            // every width — the FAB only substitutes for add, and a
            // secondary action shouldn't lose its real estate on
            // mobile.
            <div
              className={
                actionAlwaysVisible
                  ? "flex flex-shrink-0 items-center gap-2"
                  : "hidden flex-shrink-0 md:flex md:items-center md:gap-2"
              }
            >
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
