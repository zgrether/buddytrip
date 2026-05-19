"use client";

import { useState } from "react";
import { ArrowRight, type LucideIcon } from "lucide-react";

// ── Types ────────────────────────────────────────────────────────────────

export interface InvitationCardProps {
  /** Lucide icon component shown in the left tile. */
  Icon: LucideIcon;
  /** Bold one-line headline. */
  title: string;
  /** Dim one-or-two-line sub-copy. */
  body: string;
  /** Tap handler — typically opens the panel's intro modal or activator. */
  onClick: () => void;
  /** Optional test ID for Playwright targeting. */
  testId?: string;
}

// ── Component ────────────────────────────────────────────────────────────

/**
 * InvitationCard — the canonical "enable this feature" CTA used by every
 * home-tab panel in its pre-activated state (Quick Info, Travel Plans,
 * Itinerary, Competition).
 *
 * Visual pattern:
 *   - 1.5px dashed border on the trip-card surface (no fill, so it reads as
 *     an opt-in affordance, not a populated panel).
 *   - 40×40 accent-faint icon tile on the left.
 *   - Bold title, dim sub-copy in a two-line block.
 *   - ArrowRight on the right, fades in on hover so the card reads as a
 *     button once the user moves over it.
 *   - On hover: surface shifts to accent-faint, border to accent-border.
 *
 * Owner-only gating, intro-modal wiring, and post-activation surfaces all
 * live in the calling panel — this component is purely the empty-state CTA.
 */
export function InvitationCard({
  Icon,
  title,
  body,
  onClick,
  testId,
}: InvitationCardProps) {
  const [hover, setHover] = useState(false);
  return (
    <button
      type="button"
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      data-testid={testId}
      className="w-full rounded-xl px-4 py-5 text-left transition-colors"
      style={{
        background: hover
          ? "var(--color-bt-accent-faint)"
          : "var(--color-bt-surface-invitation)",
        border: `1.5px dashed ${
          hover ? "var(--color-bt-accent-border)" : "var(--color-bt-border)"
        }`,
        cursor: "pointer",
      }}
    >
      <div className="flex items-start gap-3">
        <div
          className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl"
          style={{
            background: "var(--color-bt-accent-faint)",
            color: "var(--color-bt-accent)",
          }}
        >
          <Icon size={18} />
        </div>
        <div className="min-w-0 flex-1">
          <p
            className="text-sm font-bold"
            style={{ color: "var(--color-bt-text)" }}
          >
            {title}
          </p>
          <p
            className="mt-1 text-xs leading-snug"
            style={{ color: "var(--color-bt-text-dim)" }}
          >
            {body}
          </p>
        </div>
        <ArrowRight
          size={16}
          style={{
            color: "var(--color-bt-accent)",
            flexShrink: 0,
            opacity: hover ? 1 : 0,
            transition: "opacity 150ms",
          }}
        />
      </div>
    </button>
  );
}
