"use client";

import Image from "next/image";
import { Ghost } from "lucide-react";

interface UserAvatarProps {
  name: string | null;
  avatarUrl: string | null;
  /**
   * True for ghost/guest crew who have no BT account.
   * When true and avatarUrl is absent → Ghost icon.
   * When false/undefined and avatarUrl is absent → initial letter.
   */
  isGuest?: boolean;
  /** Preset sizes: sm=24px, md=32px, lg=44px */
  size?: "sm" | "md" | "lg";
  /** Custom pixel size — overrides the preset if provided */
  sizePx?: number;
}

const SIZE_MAP = {
  sm: { px: 24, text: "text-[10px]", iconPx: 12 },
  md: { px: 32, text: "text-xs",    iconPx: 14 },
  lg: { px: 44, text: "text-base",  iconPx: 20 },
} as const;

export function UserAvatar({ name, avatarUrl, isGuest = false, size = "md", sizePx }: UserAvatarProps) {
  const preset = SIZE_MAP[size];
  const px = sizePx ?? preset.px;

  if (avatarUrl) {
    return (
      <Image
        src={avatarUrl}
        alt={name ?? "User avatar"}
        width={px}
        height={px}
        className="flex-shrink-0 rounded-full object-cover"
        unoptimized
      />
    );
  }

  // Guest / no BT account → ghost icon
  if (isGuest) {
    const iconPx = sizePx ? Math.round(px * 0.45) : preset.iconPx;
    return (
      <div
        className="flex flex-shrink-0 items-center justify-center rounded-full"
        style={{
          width: px,
          height: px,
          background: "var(--color-bt-border)",
          color: "var(--color-bt-text-dim)",
        }}
      >
        <Ghost size={iconPx} />
      </div>
    );
  }

  // Real BT user with no photo → initial letter
  const text = sizePx && sizePx >= 64 ? "text-3xl" : sizePx && sizePx >= 36 ? "text-lg" : preset.text;
  const initial = ((name ?? "?").charAt(0) || "?").toUpperCase();
  return (
    <div
      className={`flex flex-shrink-0 items-center justify-center rounded-full font-semibold ${text}`}
      style={{
        width: px,
        height: px,
        background: "var(--color-bt-card-raised)",
        color: "var(--color-bt-accent)",
      }}
    >
      {initial}
    </div>
  );
}
