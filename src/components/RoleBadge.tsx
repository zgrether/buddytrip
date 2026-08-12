import type { FC } from "react";
import type { TripRole } from "@/server/middleware";
import { ROLE_COLOR, badgedRole } from "@/lib/roleColor";

/**
 * Owner amber · Organizer blue · Member: no badge.
 *
 * Colours come from `@/lib/roleColor`, which the crew roster's `RolePill` and
 * the rail's role edge also read — the three used to be independent copies that
 * agreed by coincidence. DB stores 'Organizer'; displays as 'Organizer' per
 * CLAUDE.md rule 7.
 */
interface RoleBadgeProps {
  role: TripRole;
  className?: string;
}

export const RoleBadge: FC<RoleBadgeProps> = ({ role, className }) => {
  const badged = badgedRole(role);
  if (!badged) return null;
  const { text, faint, border } = ROLE_COLOR[badged];
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${className ?? ""}`}
      style={{ background: faint, color: text, border: `1px solid ${border}` }}
    >
      {badged}
    </span>
  );
};
