"use client";

import { ChevronRight, Loader2 } from "lucide-react";
import { Avatar } from "@/components/Avatar";
import { TeamBadge } from "@/components/TeamBadge";
import { NoTeamAvatar } from "@/components/NoTeamAvatar";
import { needsAttentionCount, unevenTeamsWhy, type NeedsAttention } from "@/lib/needsAttention";
import { EYEBROW, EYEBROW_SEPARATOR, TYPE_SCALE } from "@/lib/typeScale";
import {
  CLINCH_STORY_WORD as WORD,
  emptyTeamLine,
  NEEDS_ATTENTION_TITLE,
  notOnATeamLine,
  ordinalShort,
  unevenTeamsLine,
  wontCountLine,
} from "@/lib/vocabulary";

/**
 * The organizer's Needs attention card (Zach's rulings, 2026-10-21; the
 * "Organizer's board: needs attention" artboard). The cup-wide problems no one
 * game owns: people playing on no team, empty teams, and uneven teams where a
 * summed format makes it count. A game's own problems are on its row.
 *
 * Owners and Organizers only (the caller passes nothing otherwise), gone when
 * empty. Every item is advisory, so it is MUTED: the warning colour is for what
 * blocks something, and that is on the game rows. Each item is one row that
 * opens where it is fixed: Rosters for people and sizes, and an empty team's
 * own Edit Team sheet (Zach's look on #1691).
 *
 * A points cup adds two (docs/CLINCH_AND_PODIUM.md §5). The empty board's ask opens
 * itself as a sheet (v2.8); this is where it waits once that sheet is closed
 * undecided, so it carries its two answers rather than opening anywhere. A tie
 * still shared at Final is an optional follow-up and opens the tie sheet.
 */
export function NeedsAttentionCard({
  attention,
  onOpenRosters,
  onEditTeam,
  onFinishCup,
  onAddGame,
  finishing = false,
  finishError,
  onBreakTie,
}: {
  attention: NeedsAttention;
  onOpenRosters: () => void;
  /** Opens a team's Edit Team sheet; without it an empty team opens Rosters. */
  onEditTeam?: (teamId: string) => void;
  onFinishCup?: () => void;
  onAddGame?: () => void;
  /** The finish is saving, so its button holds. */
  finishing?: boolean;
  finishError?: string | null;
  onBreakTie?: () => void;
}) {
  const count = needsAttentionCount(attention);
  if (count === 0) return null;
  const { offTeam, emptyTeams, uneven, finishCup, ties } = attention;

  return (
    <section
      aria-labelledby="needs-attention-title"
      className="overflow-hidden rounded-xl"
      style={{ background: "var(--color-bt-card)", border: "1px solid var(--color-bt-border)" }}
      data-testid="needs-attention"
    >
      <h2 id="needs-attention-title" className="m-0 px-4 pb-1.5 pt-3" style={EYEBROW}>
        {NEEDS_ATTENTION_TITLE}
        {EYEBROW_SEPARATOR}
        {count}
      </h2>

      {finishCup && (
        <div className="px-4 py-3" style={{ borderTop: "1px solid var(--color-bt-subtle-border)" }} data-testid="needs-attention-finish">
          <p style={{ fontSize: TYPE_SCALE.emphasis, fontWeight: 500, color: "var(--color-bt-text)" }}>{WORD.finishQuestion}</p>
          {finishError && (
            <p className="mt-1" style={{ fontSize: TYPE_SCALE.captionPlus, color: "var(--color-bt-danger)" }} data-testid="needs-attention-finish-error">
              {finishError}
            </p>
          )}
          <div className="mt-2.5 flex flex-wrap gap-2">
            <button
              type="button"
              disabled={finishing}
              onClick={onFinishCup}
              className="flex min-h-[44px] flex-1 items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold disabled:opacity-40"
              style={{ background: "var(--color-bt-accent)", color: "var(--color-bt-on-accent)" }}
              data-testid="finish-cup"
              aria-busy={finishing || undefined}
            >
              {finishing && <Loader2 size={16} className="animate-spin" aria-hidden="true" />}
              {WORD.finishCup}
            </button>
            <button
              type="button"
              onClick={onAddGame}
              className="min-h-[44px] flex-1 rounded-lg px-4 py-2 text-sm font-semibold"
              style={{ background: "var(--color-bt-card-raised)", color: "var(--color-bt-text)" }}
              data-testid="finish-add-game"
            >
              {WORD.addAnotherGame}
            </button>
          </div>
        </div>
      )}

      {ties.map((tie) => (
        <Item key={tie.place} onClick={() => onBreakTie?.()} testId={`needs-attention-tie-${tie.place}`} title={WORD.tiedShared(ordinalShort(tie.place))}>
          <span className="flex" aria-hidden="true">
            {tie.units.slice(0, 3).map((u, i) => (
              <span key={u.id} style={{ marginLeft: i === 0 ? 0 : -8, display: "inline-flex" }}>
                {u.color ? <TeamBadge teamId={u.id} name={u.name} shortName={u.shortName} color={u.color} size={24} /> : <Avatar name={u.name} sizePx={24} />}
              </span>
            ))}
          </span>
        </Item>
      ))}

      {offTeam && (
        <Item onClick={onOpenRosters} testId="needs-attention-off-team" title={notOnATeamLine(offTeam.names)} detail={wontCountLine(offTeam.games)}>
          <span className="flex" aria-hidden="true">
            {offTeam.names.slice(0, 3).map((name, i) => (
              <NoTeamAvatar key={`${name}-${i}`} name={name} size={26} style={{ marginLeft: i === 0 ? 0 : -8 }} />
            ))}
          </span>
        </Item>
      )}

      {emptyTeams.map((t) => (
        <Item
          key={t.id}
          onClick={onEditTeam ? () => onEditTeam(t.id) : onOpenRosters}
          testId={`needs-attention-empty-team-${t.id}`}
          title={emptyTeamLine(t.name)}
        >
          <TeamBadge teamId={t.id} name={t.name} color={t.color} size={24} />
        </Item>
      ))}

      {uneven && (
        <Item
          onClick={onOpenRosters}
          testId="needs-attention-uneven"
          title={unevenTeamsLine(uneven.teams.map((t) => t.size))}
          detail={unevenTeamsWhy(uneven.scorings)}
        >
          <MiniBars teams={uneven.teams} />
        </Item>
      )}
    </section>
  );
}

function Item({
  onClick,
  testId,
  title,
  detail,
  children,
}: {
  onClick: () => void;
  testId: string;
  title: string;
  detail?: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center gap-3 py-2 pl-4 pr-3 text-left"
      style={{ minHeight: 56, borderTop: "1px solid var(--color-bt-subtle-border)", color: "var(--color-bt-text)" }}
      data-testid={testId}
    >
      <span className="flex w-[44px] shrink-0 items-center">{children}</span>
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span style={{ fontSize: TYPE_SCALE.emphasis, fontWeight: 500 }}>{title}</span>
        {detail && (
          <span style={{ fontSize: TYPE_SCALE.captionPlus, lineHeight: 1.35, color: "var(--color-bt-text-dim)" }}>{detail}</span>
        )}
      </span>
      <ChevronRight size={16} aria-hidden="true" style={{ color: "var(--color-bt-text-dim)", flexShrink: 0 }} />
    </button>
  );
}

/** A bar per team, its height the team's size against the biggest. */
function MiniBars({ teams }: { teams: ReadonlyArray<{ id: string; color: string; size: number }> }) {
  const max = Math.max(1, ...teams.map((t) => t.size));
  return (
    <span className="flex items-end gap-[3px]" style={{ height: 26 }} aria-hidden="true">
      {teams.map((t) => (
        <span
          key={t.id}
          className="rounded-[3px]"
          style={{ width: 10, height: Math.max(4, Math.round((26 * t.size) / max)), background: t.color || "var(--color-bt-text-dim)" }}
        />
      ))}
    </span>
  );
}
