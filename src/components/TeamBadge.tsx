"use client";

import { teamTextColor } from "@/lib/teamTextColor";
import { teamInitial } from "@/lib/teamInitial";
import { useTeamBadgeLabel } from "@/components/TeamBadgeLabels";

/**
 * THE TEAM BADGE — a rounded square in the team's colour with its initial.
 *
 * The shape carries the kind (Zach, 2026-10-20): **squares are always teams,
 * circles are always people.** Every place a TEAM's identity is drawn — boards,
 * standings, finalize summaries, match setup, rosters — draws it through this,
 * so the rule holds by construction rather than by each site remembering it.
 * A person stays a circle (`Avatar`); a person on no team stays the outlined
 * grey circle.
 *
 * The LETTER is the competition's: one letter, or two when another team in the
 * same competition would show the same one (`TeamBadgeLabels`, mounted once per
 * trip). Pass `teamId` where the site has it; the name is the fallback key.
 * Outside a trip the badge shows its plain initial.
 *
 * The letter's colour comes from `teamTextColor`, the one contrast helper, so it
 * reads on any team colour. The team NAME is the caller's to render, in
 * semibold (player names are regular); the badge labels itself with it for
 * screen readers.
 */
export function TeamBadge({
  teamId,
  name,
  shortName,
  color,
  size = 18,
}: {
  teamId?: string;
  name: string;
  shortName?: string | null;
  color: string;
  /** Edge length in px. 16–18 inline with a line of text, 24 on a roster card. */
  size?: number;
}) {
  const shared = useTeamBadgeLabel(teamId, name);
  const label = shared ?? teamInitial({ name, shortName });
  const two = label.length > 1;
  return (
    <span
      role="img"
      aria-label={name}
      data-testid="team-badge"
      className="inline-flex shrink-0 select-none items-center justify-center"
      style={{
        width: size,
        height: size,
        borderRadius: Math.max(3, Math.round(size * 0.28)),
        background: color,
        color: teamTextColor(color),
        // Two letters fit the same square by stepping the type down.
        fontSize: Math.round(size * (two ? 0.42 : 0.56)),
        fontWeight: 800,
        letterSpacing: two ? "-0.02em" : undefined,
        lineHeight: 1,
      }}
    >
      {label}
    </span>
  );
}
