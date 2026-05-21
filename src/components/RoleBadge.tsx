import type { FC } from "react";
import type { TripRole } from "@/server/middleware";

interface RoleBadgeProps {
  role: TripRole;
  className?: string;
}

// UI label vs DB value:
//   - The DB role column stores 'planner'. We don't rename the column.
//   - Every visible badge / button / heading reads "Organizer". The
//     identifier `Planner` survives only in type unions, role checks,
//     and middleware (CLAUDE.md Enforced Pattern: "Organizer display label").
const CONFIG: Record<TripRole, { label: string; color: string }> = {
  Owner: { label: "Owner", color: "var(--color-bt-owner)" },
  Planner: { label: "Organizer", color: "var(--color-bt-accent)" },
  Member: { label: "Member", color: "var(--color-bt-text-dim)" },
};

export const RoleBadge: FC<RoleBadgeProps> = ({ role, className }) => {
  if (role === "Member") return null;
  const { label, color } = CONFIG[role];
  return (
    <span
      className={`inline-block rounded border px-1.5 py-0.5 text-[10px] font-medium ${className ?? ""}`}
      style={{ borderColor: color, color }}
    >
      {label}
    </span>
  );
};
