"use client";

import { Avatar } from "@/components/Avatar";

/**
 * PlayerChip — the shared player chip (Matches/Handicaps row pattern, Phase 1): the
 * team-colored `Avatar` (§11 — the team-colored INITIAL, never `avatarIcon`) at the
 * reconciled size **30** + the name, **left-aligned** (avatar then name, flush left).
 *
 * Presentational ONLY — owns no tap/selection state. Wrappers add interaction:
 * Matches' `Slot` makes it tap-to-pick, the handicap segment makes it select-a-side.
 * (That's what lets ONE chip serve both.) Pass `onClick`/`style`/`className` through
 * to make it interactive or restyle the surface (e.g. the handicap segment's selected
 * outline). It must look identical wherever wrapped — that consistency is the point.
 */
export function PlayerChip({
  name,
  teamColor,
  collapse = true,
  className = "",
  style,
  ...rest
}: {
  name: string;
  /** Drives the team-colored initial. Omit/null → Avatar's neutral fallback. */
  teamColor?: string | null;
  /** Progressive avatar degradation under width pressure (#657). Default ON for the
   *  tight match 2-col slot. Set `false` where the chip is nested inside a padded,
   *  surface-stripped wrapper (the Handicaps segments) — there the chip-tier DROP
   *  threshold collapses the avatar to nothing and leaves an empty box (the b1
   *  regression). Off → the disk always renders. */
  collapse?: boolean;
} & React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={`@container flex min-w-0 items-center gap-2 ${className}`}
      style={{
        width: "100%",
        height: 44,
        padding: "0 10px",
        borderRadius: 10,
        background: "var(--color-bt-card-raised)",
        border: "1px solid var(--color-bt-border)",
        ...style,
      }}
      {...rest}
    >
      {/* §11 team-colored initial — no avatarIcon. Degrades disk→dot→drop under
          space pressure (chip tier) so the name yields last, not first. */}
      <Avatar name={name} teamColor={teamColor} sizePx={30} collapse={collapse} collapseAt="chip" />
      <span
        className="min-w-0 truncate"
        style={{ fontSize: 15, fontWeight: 500, color: "var(--color-bt-text)" }}
      >
        {name}
      </span>
    </div>
  );
}
