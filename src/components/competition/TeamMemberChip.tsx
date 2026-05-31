"use client";

import { X } from "lucide-react";
import { Avatar } from "@/components/Avatar";

interface TeamMemberChipProps {
  displayName: string;
  avatarIcon?: string | null;
  isGuest?: boolean;
  /** Hex team color — drives the color-mix tint on the chip */
  teamColor: string;
  /** When provided, renders a small × remove button */
  onRemove?: () => void;
  removeAriaLabel?: string;
  /** HTML5 drag props — omit for static (read-only) chips */
  draggable?: boolean;
  onDragStart?: (e: React.DragEvent) => void;
}

/**
 * TeamMemberChip
 *
 * A pill-shaped chip showing a crew member's avatar + name, tinted by their
 * team color. Used on the Players & Teams panel and (eventually) the leaderboard.
 *
 * Color approach mirrors TeamCard — a 12 % color-mix tint on card-raised for
 * the background, 40 % blend into bt-border for the outline. This keeps chips
 * legible in both light and dark modes while still clearly communicating team
 * identity without being visually heavy.
 */
export function TeamMemberChip({
  displayName,
  avatarIcon,
  teamColor,
  onRemove,
  removeAriaLabel,
  draggable,
  onDragStart,
}: TeamMemberChipProps) {
  return (
    <div
      draggable={draggable}
      onDragStart={onDragStart}
      className={`flex items-center gap-1.5 rounded-full py-1 pl-2 pr-1 ${
        draggable ? "cursor-grab active:cursor-grabbing" : ""
      }`}
      style={{
        background: `color-mix(in srgb, ${teamColor} 12%, var(--color-bt-card-raised))`,
        border: `1px solid color-mix(in srgb, ${teamColor} 40%, var(--color-bt-border))`,
      }}
    >
      <Avatar
        name={displayName}
        avatarIcon={avatarIcon ?? null}
        teamColor={teamColor}
        size="sm"
      />
      <span className="text-xs" style={{ color: "var(--color-bt-text)" }}>
        {displayName}
      </span>
      {onRemove && (
        <button
          type="button"
          onClick={onRemove}
          aria-label={removeAriaLabel ?? `Remove ${displayName}`}
          className="ml-0.5 flex h-5 w-5 items-center justify-center rounded-full"
          style={{ color: "var(--color-bt-text-dim)" }}
        >
          <X size={10} />
        </button>
      )}
    </div>
  );
}
