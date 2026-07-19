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
  /**
   * Progressive degradation (opt-in): under horizontal space pressure the
   * avatar steps down disk → team-color/muted dot → nothing, so the player
   * NAME never has to truncate first (Zach's design intent). Driven purely by
   * CSS container queries against the nearest `@container` ancestor — the
   * PARENT ROW must declare `@container` (a Tailwind class) for this to fire;
   * with no container ancestor the query never matches and the full disk shows
   * (safe default). No JS, no ResizeObserver — everywhere it's used inherits it.
   */
  collapse?: boolean;
  /**
   * Which container-width tier drives `collapse` (default `"row"`). The default
   * ("row") suits a full-width list row; override per surface:
   *   - `"row"`   disk→dot ≤280px, dot→drop ≤220px  (full-width list rows)
   *   - `"dense"` disk→dot ≤300px, dot→drop ≤240px  (rows with heavy fixed
   *               stat columns eating the name's width — stroke board, grid)
   *   - `"chip"`  disk→dot ≤130px, dot→drop ≤92px   (chips, grid cells, pills)
   * Thresholds are the CONTAINER'S width (the `@container` row), not name length
   * — tuned so the disk yields before names get tight. Ignored unless `collapse`.
   */
  collapseAt?: AvatarCollapse;
  className?: string;
}

/** Container-width tier for {@link Avatar}'s `collapse` degradation. */
export type AvatarCollapse = "row" | "dense" | "chip";

/**
 * Literal container-query variant classes per tier (Tailwind scans these
 * statically, so the px values MUST stay literal here — they can't be built
 * from a runtime prop). The disk hides at/below the dot threshold; the dot is
 * hidden by default (so with no `@container` ancestor only the disk shows),
 * revealed in the band via `@max-[dot]:inline-flex`, then hidden again below
 * the drop threshold via `@max-[drop]:hidden` (narrower `@max` wins the cascade
 * — verified in-browser). Below the drop threshold both are hidden = nothing.
 */
const COLLAPSE_CLASSES: Record<AvatarCollapse, { disk: string; dot: string }> = {
  row: {
    disk: "@max-[280px]:hidden",
    dot: "hidden @max-[280px]:inline-flex @max-[220px]:hidden",
  },
  dense: {
    disk: "@max-[300px]:hidden",
    dot: "hidden @max-[300px]:inline-flex @max-[240px]:hidden",
  },
  chip: {
    disk: "@max-[130px]:hidden",
    dot: "hidden @max-[130px]:inline-flex @max-[92px]:hidden",
  },
};

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
  collapse = false,
  collapseAt = "row",
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

  // Collapse tier classes (only applied when `collapse`): the disk gets a
  // `@max-[…]:hidden` so it drops out under the dot threshold; the dot sibling
  // (below) fills the band, then drops too. Empty otherwise → zero effect on
  // the 39 non-opted call sites (byte-identical render).
  const collapseClasses = collapse ? COLLAPSE_CLASSES[collapseAt] : null;

  const disk = (
    <div
      className={`inline-flex flex-shrink-0 items-center justify-center rounded-full ${
        isResponsive ? SM_RESPONSIVE_CLASSES : ""
      } ${collapseClasses?.disk ?? ""} ${
        // In collapse mode the caller's className goes on the outer wrapper (the
        // element the parent lays out); the bare disk keeps it otherwise.
        collapseClasses ? "" : className ?? ""
      }`}
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

  if (!collapseClasses) return disk;

  // Degradation mode: disk + a dot sibling, one visible at a time via the tier's
  // container-query classes. The dot carries the team color (competition) or a
  // muted neutral (--color-bt-text-dim). It's aria-hidden — the disk owns the
  // accessible name, and when the disk is hidden the name text beside it (which
  // this whole feature exists to protect) still identifies the row.
  const dotColor = competitionMode ? (teamColor as string) : "var(--color-bt-text-dim)";
  // ~1/3 of the circle, clamped legible — the dot's smaller footprint is what
  // frees horizontal room for the name.
  const dotPx = Math.min(12, Math.max(8, Math.round(circle * 0.32)));
  return (
    <span className={`inline-flex flex-shrink-0 items-center justify-center ${className ?? ""}`}>
      {disk}
      <span
        aria-hidden="true"
        className={`flex-shrink-0 rounded-full ${collapseClasses.dot}`}
        style={{ width: dotPx, height: dotPx, background: dotColor }}
      />
    </span>
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

/** PlaceholderAvatar — a muted (grey) Avatar IS the placeholder treatment.
 *  Forwards `collapse`/`collapseAt` so a placeholder row degrades in lockstep
 *  with the real-member rows beside it. (InvitedAvatar deliberately does NOT
 *  forward it — its corner ✉ badge would float over a collapsed dot.) */
export function PlaceholderAvatar({
  name,
  collapse,
  collapseAt,
}: {
  name: string;
  collapse?: boolean;
  collapseAt?: AvatarCollapse;
}) {
  return <Avatar name={name} muted sizePx={32} collapse={collapse} collapseAt={collapseAt} />;
}
