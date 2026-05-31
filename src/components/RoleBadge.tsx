import type { FC } from "react";
import type { TripRole } from "@/server/middleware";

interface RoleBadgeProps {
  role: TripRole;
  className?: string;
}

// Owner amber · Organizer teal · Member: no badge.
// DB stores 'Planner'; displays as 'Organizer' per CLAUDE.md rule 7.
// Matches the canonical RolePill in CrewTab.tsx (plain text, no crown).
const CONFIG: Record<Exclude<TripRole, "Member">, { label: string; bg: string; color: string; border: string }> = {
  Owner: {
    label: "Owner",
    bg: "var(--color-bt-warning-faint)",
    color: "var(--color-bt-owner)",
    border: "var(--color-bt-warning-border)",
  },
  Planner: {
    label: "Organizer",
    bg: "var(--color-bt-accent-faint)",
    color: "var(--color-bt-accent)",
    border: "var(--color-bt-accent-border)",
  },
};

export const RoleBadge: FC<RoleBadgeProps> = ({ role, className }) => {
  if (role === "Member") return null;
  const { label, bg, color, border } = CONFIG[role];
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${className ?? ""}`}
      style={{ background: bg, color, border: `1px solid ${border}` }}
    >
      {label}
    </span>
  );
};
