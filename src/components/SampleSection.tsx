"use client";

import type { ReactNode } from "react";
import { Info } from "lucide-react";

/**
 * Empty-state primitives for tabs that show "what this'll look like
 * once populated." Used by Lodging, Receipts (and eventually Agenda
 * once the rewrite lands).
 *
 * The pattern replaces the older dim/ghost-row treatment which read
 * as broken half-data: the example is rendered at FULL opacity inside
 * an explicitly-framed EXAMPLE callout, so users understand it's
 * illustrative without it looking like a loading skeleton.
 */

// ── SampleHeader ──────────────────────────────────────────────────────────

/**
 * Eyebrow pill that introduces a Sample callout — "HOW A PROPERTY WILL
 * LOOK", "HOW A RECEIPT WILL LOOK". Planning-blue tinted so it reads
 * as "informational" without competing with the teal primary action.
 */
export function SampleHeader({ label }: { label: string }) {
  return (
    <div
      className="inline-flex items-center gap-2 self-start rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.12em]"
      style={{
        background: "var(--color-bt-planning-faint)",
        border: "1px solid var(--color-bt-planning-border)",
        color: "var(--color-bt-planning)",
      }}
    >
      <Info size={11} strokeWidth={2} />
      {label}
    </div>
  );
}

// ── SampleCard ────────────────────────────────────────────────────────────

/**
 * Wraps a populated-example child in a dashed planning-blue frame with
 * an EXAMPLE notch tag at top-left. The example inside renders at full
 * opacity (do NOT dim or ghost it).
 */
export function SampleCard({ children }: { children: ReactNode }) {
  return (
    <div
      className="relative rounded-2xl p-1.5"
      style={{
        background: "var(--color-bt-card)",
        border: "1px dashed var(--color-bt-planning-border)",
      }}
    >
      <span
        className="absolute left-3 top-0 -translate-y-1/2 px-1.5 text-[9px] font-bold uppercase tracking-[0.12em]"
        style={{
          background: "var(--color-bt-base)",
          color: "var(--color-bt-planning)",
        }}
      >
        Example
      </span>
      {children}
    </div>
  );
}

// ── RailComposer ──────────────────────────────────────────────────────────

interface RailComposerProps {
  /** UPPERCASE eyebrow text: "ADD YOUR FIRST PROPERTY" etc. */
  title: string;
  /** Primary CTA label: "Add property", "Add receipt", "Add". */
  primary: string;
  /** Click handler on the primary CTA. */
  onPrimary: () => void;
  /** Optional helper text below the CTA (1–2 sentences). */
  hint?: ReactNode;
  /** Optional input(s) shown between the title and the primary CTA. */
  children?: ReactNode;
  /**
   * Boosted = empty-state primary CTA. Gets the accent-tinted outline,
   * shadow-raised elevation, and accent-colored eyebrow so it pulls the
   * eye over the SampleCard. Unboosted = standard rail composer (used
   * in populated states where the composer is one of several panels).
   */
  boosted?: boolean;
  /**
   * "rail" (default) — full chrome: card background, border, optional
   *   raised shadow when boosted, rounded corners, internal padding,
   *   uppercase eyebrow row. Canonical right-rail presentation.
   * "sheet" — chrome stripped so the composer can be dropped into the
   *   mobile bottom-sheet modal without reading as a nested card. The
   *   sheet supplies the surface, elevation, radius, padding, and a
   *   title bar above the form, so the eyebrow + frame are suppressed.
   */
  variant?: "rail" | "sheet";
}

/**
 * Desktop-only right-rail composer. The boosted variant is the canonical
 * empty-state primary CTA on tabs that follow the Sample pattern
 * (Lodging, Receipts).
 *
 * The primary CTA is wired through `onPrimary` rather than rendering its
 * own form — callers decide whether clicking opens the existing modal
 * (current behavior) or commits an inline form (future enhancement).
 */
export function RailComposer({
  title,
  primary,
  onPrimary,
  hint,
  children,
  boosted,
  variant = "rail",
}: RailComposerProps) {
  const isSheet = variant === "sheet";
  return (
    <div
      className={
        isSheet
          ? "flex flex-col gap-2.5"
          : "flex flex-col gap-2.5 rounded-xl p-4"
      }
      style={
        isSheet
          ? undefined
          : {
              background: "var(--color-bt-card)",
              border: boosted
                ? "1px solid var(--color-bt-accent-border)"
                : "1px solid var(--color-bt-border)",
              boxShadow: boosted ? "var(--shadow-raised)" : undefined,
            }
      }
    >
      {!isSheet && (
        <div
          className="text-[11px] font-bold uppercase tracking-[0.12em]"
          style={{
            color: boosted
              ? "var(--color-bt-accent)"
              : "var(--color-bt-text-dim)",
          }}
        >
          {title}
        </div>
      )}
      {children}
      <button
        type="button"
        onClick={onPrimary}
        className="mt-1 rounded-lg py-2.5 text-sm font-semibold transition-opacity hover:opacity-90 active:scale-[0.98]"
        style={{
          background: "var(--color-bt-accent)",
          color: "var(--color-bt-on-accent)",
        }}
      >
        {primary}
      </button>
      {hint && (
        <div
          className="text-[11px] leading-snug"
          style={{ color: "var(--color-bt-text-dim)" }}
        >
          {hint}
        </div>
      )}
    </div>
  );
}
