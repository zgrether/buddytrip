/**
 * The avatar for someone on no team of the cup: an outlined, dashed circle with
 * their initial, and no team colour, because there is no team for it to show.
 * ONE look wherever that state is drawn (Zach's look on #1691): the board's
 * Needs attention card and the Rosters screen's "Not on a team" list.
 */
export function NoTeamAvatar({ name, size = 30, style }: { name: string; size?: number; style?: React.CSSProperties }) {
  return (
    <span
      aria-hidden="true"
      className="flex shrink-0 items-center justify-center rounded-full"
      style={{
        width: size,
        height: size,
        border: "1.5px dashed var(--color-bt-text-dim)",
        background: "var(--color-bt-base)",
        color: "var(--color-bt-text-dim)",
        fontSize: Math.round(size * 0.42),
        fontWeight: 600,
        ...style,
      }}
      data-testid="no-team-avatar"
    >
      {name.trim().charAt(0).toUpperCase()}
    </span>
  );
}
