"use client";

import { Mail } from "lucide-react";
import { AVATAR_ICON_COMPONENTS } from "@/lib/avatarIconComponents";
import { initialsFor } from "@/lib/initials";
import { teamTextColor } from "@/lib/teamTextColor";

/**
 * Avatar — renders a user's chosen Tabler icon (if `avatarIcon` is set)
 * or their initials, on either a neutral surface or their team color.
 *
 * Rendering matrix:
 *
 *                    │ no teamColor             │ teamColor set
 *   ─────────────────┼──────────────────────────┼────────────────────────
 *    avatarIcon set  │ teal icon on bt-raised   │ white icon on team bg
 *    no avatarIcon   │ teal initials on raised  │ white initials on team bg
 *
 * This is the only avatar component in the app: avatars are profile-scoped
 * (the Tabler icon chosen in /profile) with a name-initials fallback. There
 * is no per-trip uploaded-photo avatar.
 */

interface AvatarProps {
  /** Used for initials when `avatarIcon` is not set. */
  name: string;
  /** Tabler icon id (e.g. "flag-2", "trophy"). Null = use initials. */
  avatarIcon?: string | null;
  /** Hex string (e.g. "#3b82f6"). When set, switches to competition-team palette. */
  teamColor?: string | null;
  /** sm=24px, md=36px, lg=72px */
  size?: "sm" | "md" | "lg";
  /**
   * Exact pixel size — overrides `size` when provided. Lets Avatar cover
   * the arbitrary dimensions older call sites needed (20, 22, 32, …)
   * without adding bespoke presets. Icon + initials scale proportionally.
   */
  sizePx?: number;
  /**
   * Renders the initials/icon in muted grey instead of teal. Use for
   * placeholder identities (e.g. crew with no email yet) so the teal
   * foreground stays reserved for "real"/actionable members.
   */
  muted?: boolean;
  /**
   * Inverted "filled" treatment: solid accent (teal) circle with a dark
   * foreground, instead of the default teal-on-raised. Used for the
   * top-nav account avatar so it reads as a distinct identity affordance.
   * Ignored in competition mode (teamColor wins).
   */
  accent?: boolean;
  className?: string;
}

/**
 * Fixed-size presets (numeric). md and lg use these directly; sm is
 * responsive (30px mobile / 34px desktop) so it's handled with Tailwind
 * classes below instead of these numbers.
 */
const SIZE_MAP = {
  sm: { circle: 30, icon: 20, initials: 11 }, // mobile values (used only as a hint for the Tabler `size` prop ceiling)
  md: { circle: 36, icon: 23, initials: 13 },
  lg: { circle: 72, icon: 44, initials: 24 },
} as const;

/**
 * Responsive Tailwind classes for `size="sm"` only. Spec calls for
 *   container: 30px mobile / 34px desktop
 *   icon:      20px mobile / 22px desktop (filled — icons read clearly small)
 *   initials:  11px mobile / 12px desktop
 * The icon-size class targets the SVG that Tabler renders inside the
 * circle (Tailwind v4 arbitrary descendant selectors).
 */
const SM_RESPONSIVE_CLASSES =
  "h-[30px] w-[30px] md:h-[34px] md:w-[34px] " +
  "[&_svg]:h-[20px] [&_svg]:w-[20px] md:[&_svg]:h-[22px] md:[&_svg]:w-[22px] " +
  "[&_span]:text-[11px] md:[&_span]:text-[12px]";

export function Avatar({
  name,
  avatarIcon,
  teamColor,
  size = "md",
  sizePx,
  muted = false,
  accent = false,
  className,
}: AvatarProps) {
  // An explicit sizePx wins over the named preset and disables the
  // responsive sm behavior (which only applies to the bare size="sm").
  const fixedPx = typeof sizePx === "number" ? sizePx : null;
  const { circle, icon: iconSize, initials: initialsSize } = fixedPx
    ? {
        circle: fixedPx,
        // Icons fill ~62% of the circle so they stay legible at small
        // sizes; initials stay smaller (text needs more breathing room).
        icon: Math.round(fixedPx * 0.62),
        initials: Math.max(9, Math.round(fixedPx * 0.4)),
      }
    : SIZE_MAP[size];
  const isResponsive = size === "sm" && fixedPx === null;

  // Competition context (team color set) → readable foreground computed for the
  // team color (dark on light team colors, light on dark — teamTextColor is the
  // one shared contrast helper). Accent ("filled") → dark foreground on a solid
  // teal circle. Default → teal (or muted grey) foreground on a neutral raised surface.
  const competitionMode = !!teamColor;
  const background = competitionMode
    ? (teamColor as string)
    : accent
      ? "var(--color-bt-accent)"
      : "var(--color-bt-card-raised)";
  const foreground = competitionMode
    ? teamTextColor(teamColor)
    : accent
      ? "#0d1f1a"
      : muted
        ? "var(--color-bt-text-dim)"
        : "var(--color-bt-accent)";
  const border =
    competitionMode || accent ? "none" : "1.5px solid var(--color-bt-border)";

  // Look up the icon component. If avatarIcon is set but unknown (e.g. an
  // old value from before we curated the list), fall back to initials.
  const IconComponent = avatarIcon ? AVATAR_ICON_COMPONENTS[avatarIcon] : null;

  // sm uses responsive Tailwind classes for width/height; md & lg use the
  // numeric SIZE_MAP values inline.
  const sizeStyle: React.CSSProperties = isResponsive
    ? {}
    : { width: circle, height: circle };

  return (
    <div
      className={`inline-flex flex-shrink-0 items-center justify-center rounded-full ${
        isResponsive ? SM_RESPONSIVE_CLASSES : ""
      } ${className ?? ""}`}
      style={{
        ...sizeStyle,
        background,
        border,
        color: foreground,
        fontWeight: 500,
      }}
      aria-label={avatarIcon ? `${name} avatar` : `${name} initials`}
    >
      {IconComponent ? (
        // For sm we pass the larger (desktop) icon size so the rendered
        // SVG has enough resolution; Tailwind classes scale the SVG down
        // to 14px on mobile via the [&_svg]:h-[14px] selector above.
        <IconComponent
          size={isResponsive ? 22 : iconSize}
          stroke={1.75}
          aria-hidden="true"
        />
      ) : (
        <span style={isResponsive ? { lineHeight: 1 } : { fontSize: initialsSize, lineHeight: 1 }}>
          {initialsFor(name)}
        </span>
      )}
    </div>
  );
}

// ── Named wrappers that COMPOSE the primitive (never a fresh implementation) ──
// These live with Avatar so identity rendering has one known home.

/**
 * InvitedAvatar — Avatar + the amber ✉ corner badge for a pending (invited)
 * member. `size` and `ringColor` (the badge's cutout ring, matched to the
 * surface behind it) are the only things callers vary.
 */
export function InvitedAvatar({
  name,
  avatarIcon,
  size = "md",
  ringColor = "var(--color-bt-card)",
}: {
  name: string;
  avatarIcon?: string | null;
  size?: "sm" | "md";
  ringColor?: string;
}) {
  return (
    <span className="relative inline-flex flex-shrink-0">
      <Avatar name={name} avatarIcon={avatarIcon ?? null} size={size} />
      <span
        className="absolute -bottom-0.5 -right-0.5 flex h-3.5 w-3.5 items-center justify-center rounded-full"
        style={{
          // Amber (--color-bt-warning) reads as "needs your attention", which is
          // what Pending means (Task 61 tried planning-blue, Task 62 reverted).
          background: "var(--color-bt-warning)",
          color: "var(--color-bt-on-accent)",
          border: `1.5px solid ${ringColor}`,
        }}
        aria-label="Invited"
      >
        <Mail size={7} strokeWidth={3} />
      </span>
    </span>
  );
}

/** PlaceholderAvatar — a muted (grey) Avatar IS the placeholder treatment. */
export function PlaceholderAvatar({ name }: { name: string }) {
  return <Avatar name={name} muted sizePx={32} />;
}
