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
  className?: string;
}

const SIZE_MAP = {
  sm: { circle: 24, icon: 12, initials: 10 },
  md: { circle: 36, icon: 18, initials: 13 },
  lg: { circle: 72, icon: 28, initials: 24 },
} as const;

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
  className,
}: AvatarProps) {
  const { circle, icon: iconSize, initials: initialsSize } = SIZE_MAP[size];

  // Competition context (team color set) → white foreground on team-color bg
  const competitionMode = !!teamColor;
  const background = competitionMode ? (teamColor as string) : "var(--color-bt-card-raised)";
  const foreground = competitionMode ? "#ffffff" : "var(--color-bt-accent)";
  const border = competitionMode ? "none" : "1.5px solid var(--color-bt-border)";

  // Look up the icon component. If avatarIcon is set but unknown (e.g. an
  // old value from before we curated the list), fall back to initials.
  const IconComponent = avatarIcon ? AVATAR_ICON_COMPONENTS[avatarIcon] : null;

  return (
    <div
      className={`inline-flex flex-shrink-0 items-center justify-center rounded-full ${className ?? ""}`}
      style={{
        width: circle,
        height: circle,
        background,
        border,
        color: foreground,
        fontWeight: 500,
      }}
      aria-label={avatarIcon ? `${name} avatar` : `${name} initials`}
    >
      {IconComponent ? (
        <IconComponent size={iconSize} stroke={1.75} aria-hidden="true" />
      ) : (
        <span style={{ fontSize: initialsSize, lineHeight: 1 }}>{initialsFor(name)}</span>
      )}
    </div>
  );
}
