import type { FC } from "react";
import type { TripRole } from "@/server/middleware";

interface RoleBadgeProps {
  role: TripRole;
  className?: string;
}

const CONFIG: Record<TripRole, { label: string; color: string }> = {
  Owner: { label: "Owner", color: "#f0a84a" },
  Planner: { label: "Planner", color: "#00d4aa" },
  Member: { label: "Member", color: "#8b949e" },
};

export const RoleBadge: FC<RoleBadgeProps> = ({ role, className }) => {
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
