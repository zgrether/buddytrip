"use client";

import Image from "next/image";
import { Ghost } from "lucide-react";

interface UserAvatarProps {
  name: string | null;
  avatarUrl: string | null;
  /** Preset sizes: sm=24px, md=32px, lg=44px */
  size?: "sm" | "md" | "lg";
  /** Custom pixel size — overrides the preset if provided */
  sizePx?: number;
}

const SIZE_MAP = {
  sm: { px: 24, iconPx: 12 },
  md: { px: 32, iconPx: 14 },
  lg: { px: 44, iconPx: 20 },
} as const;

export function UserAvatar({ name, avatarUrl, size = "md", sizePx }: UserAvatarProps) {
  const preset = SIZE_MAP[size];
  const px = sizePx ?? preset.px;
  const iconPx = sizePx ? Math.round(px * 0.45) : preset.iconPx;

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
