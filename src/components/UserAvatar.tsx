"use client";

interface UserAvatarProps {
  name: string | null;
  avatarUrl: string | null;
  /** Preset sizes: sm=24px, md=32px, lg=44px */
  size?: "sm" | "md" | "lg";
  /** Custom pixel size — overrides the preset if provided */
  sizePx?: number;
}

const SIZE_MAP = {
  sm: { px: 24, text: "text-[10px]" },
  md: { px: 32, text: "text-xs" },
  lg: { px: 44, text: "text-base" },
} as const;

export function UserAvatar({ name, avatarUrl, size = "md", sizePx }: UserAvatarProps) {
  const preset = SIZE_MAP[size];
  const px = sizePx ?? preset.px;
  const text = sizePx && sizePx >= 64 ? "text-3xl" : sizePx && sizePx >= 36 ? "text-lg" : preset.text;
  const initial = ((name ?? "?").charAt(0) || "?").toUpperCase();

  if (avatarUrl) {
    return (
      <img
        src={avatarUrl}
        alt={name ?? "User avatar"}
        className="flex-shrink-0 rounded-full object-cover"
        style={{ width: px, height: px }}
      />
    );
  }

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
