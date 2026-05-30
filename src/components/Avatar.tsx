"use client";

import { AVATAR_ICON_COMPONENTS } from "@/lib/avatarIconComponents";

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
 * For uploaded photos (avatar_url) use `<UserAvatar>` instead — that
 * component handles `next/image` and the ghost-guest fallback.
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
   * Renders the initials/icon in muted grey instead of teal. Use for
   * placeholder identities (e.g. crew with no email yet) so the teal
   * foreground stays reserved for "real"/actionable members.
   */
  muted?: boolean;
  className?: string;
}

/**
 * Fixed-size presets (numeric). md and lg use these directly; sm is
 * responsive (30px mobile / 34px desktop) so it's handled with Tailwind
 * classes below instead of these numbers.
 */
const SIZE_MAP = {
  sm: { circle: 30, icon: 14, initials: 11 }, // mobile values (used only as a hint for the Tabler `size` prop ceiling)
  md: { circle: 36, icon: 18, initials: 13 },
  lg: { circle: 72, icon: 28, initials: 24 },
} as const;

/**
 * Responsive Tailwind classes for `size="sm"` only. Spec calls for
 *   container: 30px mobile / 34px desktop
 *   icon:      14px mobile / 16px desktop
 *   initials:  11px mobile / 12px desktop
 * The icon-size class targets the SVG that Tabler renders inside the
 * circle (Tailwind v4 arbitrary descendant selectors).
 */
const SM_RESPONSIVE_CLASSES =
  "h-[30px] w-[30px] md:h-[34px] md:w-[34px] " +
  "[&_svg]:h-[14px] [&_svg]:w-[14px] md:[&_svg]:h-[16px] md:[&_svg]:w-[16px] " +
  "[&_span]:text-[11px] md:[&_span]:text-[12px]";

/** "Zach Grether" → "ZG"; "Llama" → "L"; "" → "?" */
export function initialsFor(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  return parts
    .map((w) => w[0] ?? "")
    .join("")
    .toUpperCase()
    .slice(0, 2);
}

export function Avatar({
  name,
  avatarIcon,
  teamColor,
  size = "md",
  muted = false,
  className,
}: AvatarProps) {
  const { circle, icon: iconSize, initials: initialsSize } = SIZE_MAP[size];
  const isResponsive = size === "sm";

  // Competition context (team color set) → white foreground on team-color bg
  const competitionMode = !!teamColor;
  const background = competitionMode ? (teamColor as string) : "var(--color-bt-card-raised)";
  const foreground = competitionMode
    ? "#ffffff"
    : muted
      ? "var(--color-bt-text-dim)"
      : "var(--color-bt-accent)";
  const border = competitionMode ? "none" : "1.5px solid var(--color-bt-border)";

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
          size={isResponsive ? 16 : iconSize}
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
