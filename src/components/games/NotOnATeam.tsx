"use client";

import { useState } from "react";
import Link from "next/link";
import { Avatar } from "@/components/Avatar";
import { TeamBadge } from "@/components/TeamBadge";
import {
  NOT_ON_A_TEAM_NOTE,
  NOT_ON_A_TEAM_ROSTERS_LEAD,
  NOT_ON_A_TEAM_ROSTERS_LINK,
  type BuilderTeam,
  type NotOnATeamNote,
} from "@/lib/builderPool";
import { EYEBROW } from "@/lib/typeScale";
import { NOT_ON_A_TEAM_WORD } from "@/lib/vocabulary";

/**
 * PEOPLE ON NO TEAM OF THIS CUP, and the one thing to do about it: add them
 * to a team. Shared by every builder that can meet one (PR 9b's match
 * builders, and the stroke and skins groupings since the #1668 look), so the
 * row, its rights and its note are one component everywhere.
 *
 * Match play cannot pair someone on no team, so there they are only an add.
 * Stroke and skins CAN play them: their result counts for no team and teams
 * place as if they were not there (`computeStrokeTeamStandings` skips them).
 * So the groupings list them under their own heading, with the add.
 */
/** What a viewer with no add is told — exported so its copy and link are
 *  testable by static render (the selector itself portals to `document`). */
export function NotOnATeamNoteLine({ note, rostersHref }: { note: NotOnATeamNote; rostersHref: string }) {
  if (!note) return null;
  return (
    <p style={{ fontSize: 12, color: "var(--color-bt-text-dim)", marginTop: 6 }} data-testid="not-on-a-team-note">
      {note === "rosters" ? (
        <>
          {NOT_ON_A_TEAM_ROSTERS_LEAD}{" "}
          <Link href={rostersHref} data-testid="not-on-a-team-rosters-link" style={{ color: "var(--color-bt-accent)", fontWeight: 600 }}>
            {NOT_ON_A_TEAM_ROSTERS_LINK}
          </Link>
          .
        </>
      ) : (
        NOT_ON_A_TEAM_NOTE
      )}
    </p>
  );
}

/**
 * A crew member on no team, and ONE control (9b look):
 *  - one team they could go to (head to head: the slot's own) → "Add to {team}";
 *  - several (a points race) → "Add to team…", which opens the choice in place;
 *  - none (this viewer cannot add) → no control; the section's note says who can.
 * Adding places them in the slot the picker was opened from. After results the
 * preview comes first, and the slot fills only once it is confirmed.
 */
export function NotOnATeamRow({ userId, name, targets, onAdd }: { userId: string; name: string; targets: BuilderTeam[]; onAdd: (userId: string, teamId: string) => void }) {
  const [choosing, setChoosing] = useState(false);
  const pill = { padding: "5px 10px", borderRadius: 999, background: "var(--color-bt-card-raised)", border: "1px solid var(--color-bt-border)", fontSize: 13, fontWeight: 600, color: "var(--color-bt-text)" } as const;
  return (
    <div style={{ padding: "9px 12px", borderRadius: 10, background: "var(--color-bt-card)", border: "1px solid var(--color-bt-border)" }} data-testid={`not-on-a-team-${userId}`}>
      <div className="flex items-center justify-between gap-2">
        <span className="flex min-w-0 items-center gap-2.5">
          <Avatar name={name} sizePx={30} collapse />
          <span style={{ fontSize: 15, color: "var(--color-bt-text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{name}</span>
        </span>
        {targets.length === 1 && (
          <button type="button" onClick={() => onAdd(userId, targets[0].id)} data-testid={`add-to-team-${userId}`} className="flex shrink-0 items-center gap-1.5" style={pill}>
            <TeamBadge name={targets[0].name} color={targets[0].color} size={16} />
            Add to {targets[0].name}
          </button>
        )}
        {targets.length > 1 && (
          <button type="button" onClick={() => setChoosing((c) => !c)} aria-expanded={choosing} data-testid={`add-to-team-${userId}`} className="shrink-0" style={pill}>
            Add to team…
          </button>
        )}
      </div>
      {choosing && targets.length > 1 && (
        <div className="mt-2 flex flex-col gap-1.5" data-testid={`add-to-team-choice-${userId}`}>
          {targets.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => onAdd(userId, t.id)}
              data-testid={`add-to-team-${userId}-${t.id}`}
              className="flex w-full items-center gap-2 text-left"
              style={{ padding: "8px 10px", borderRadius: 8, background: "var(--color-bt-card-raised)", border: "1px solid var(--color-bt-border)", fontSize: 14, fontWeight: 600, color: "var(--color-bt-text)" }}
            >
              <TeamBadge name={t.name} color={t.color} size={18} />
              {t.name}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * The groupings' "Not on a team" section (stroke, skins): everyone in this
 * game's groups who is on no team of its cup, each with the add. Renders
 * nothing when there is nobody, which is every side game and every teamless
 * race (`notOnATeamIds` is empty there).
 */
export function NotOnATeamSection({
  people,
  targets,
  note,
  rostersHref,
  onAdd,
}: {
  people: { id: string; name: string }[];
  targets: BuilderTeam[];
  note: NotOnATeamNote;
  rostersHref: string;
  onAdd: (userId: string, teamId: string) => void;
}) {
  if (people.length === 0) return null;
  return (
    <div className="mt-4" data-testid="groupings-not-on-a-team">
      <div style={EYEBROW}>{NOT_ON_A_TEAM_WORD}</div>
      <NotOnATeamNoteLine note={note} rostersHref={rostersHref} />
      <div className="mt-2 flex flex-col gap-1.5">
        {people.map((p) => (
          <NotOnATeamRow key={p.id} userId={p.id} name={p.name} targets={targets} onAdd={onAdd} />
        ))}
      </div>
    </div>
  );
}
