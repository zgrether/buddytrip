"use client";

import { createElement } from "react";
import Link from "next/link";
import { trpc } from "@/lib/trpc-client";
import { LEADERBOARD_QUERY, SIDE_BOARD_QUERY } from "@/lib/queryConfig";
import { useVisibleEnabled } from "@/lib/surfaceVisibility";
import { useRealtimeScoreEvents } from "@/hooks/useRealtimeScoreEvents";
import { gameHref, gamePanelHref, gamesPageHref, opensAsPanel } from "@/lib/gameRoutes";
import type { CannotProjectReason } from "@/lib/gameProjection";
import type { ScoringModel } from "@/lib/gameTypes";
import { formatIcon, liveSubtitle, sectionOf } from "./GameRow";
import { mergeByDisplayOrder, type LBGame } from "./CompetitionLeaderboard";

/**
 * LIVE NOW, on the trip's Home (PR 9d, ruling 5): every live game, the
 * viewer's first — games, not matches, so it stays short.
 *
 * NO NEW KIND OF QUERY (Zach, 9d): it reads the board's OWN two queries — the
 * cup's `competitions.leaderboard` and the trip's `games.sideBoard` — with the
 * board's keys and policies, and subscribes to the board's two topics. So Home
 * can never disagree with the board about what is live: it is the same rows,
 * the same `sectionOf`, the same subtitle (\`liveSubtitle\`). On a cold load
 * straight to Home that costs the requests the board itself would make; once the
 * Cup tab has been visited, the two screens share one cache and one socket.
 *
 * "Yours" is the server's per-viewer `yours` (playing in it or running it);
 * those rows come first and take the filled card, the same "your own one is
 * the filled one" as the standings. Hidden entirely when nothing is live.
 */

/** The live games, the viewer's first; otherwise the board's own order. */
export function liveNowGames(games: LBGame[]): LBGame[] {
  const live = games.filter((g) => sectionOf(g) === "on-tap");
  return [...live.filter((g) => g.yours), ...live.filter((g) => !g.yours)];
}

/** Where a row goes: the game's panel over the Games page (the board's own
 *  idiom), or the format's route for one that does not panel. */
export function liveNowHref(tripId: string, g: LBGame): string {
  if (opensAsPanel(g.gameTypeId ?? null)) return gamePanelHref(tripId, g.id);
  return gameHref(tripId, g.gameTypeId ?? null, g.id) ?? gamesPageHref(tripId);
}

export function LiveNow({ tripId }: { tripId: string }) {
  const { data: comp } = trpc.competitions.getByTrip.useQuery({ tripId });
  const competitionId = (comp?.id as string | undefined) ?? undefined;

  // The board's two topics (`CompetitionLeaderboard`): the cup's, and the trip's
  // for side games. Ref-counted, so with the board mounted this costs nothing.
  useRealtimeScoreEvents(tripId, competitionId);
  useRealtimeScoreEvents(tripId, null);

  const { data: lb } = trpc.competitions.leaderboard.useQuery(
    { tripId, competitionId: competitionId! },
    { ...LEADERBOARD_QUERY, enabled: useVisibleEnabled(!!competitionId) }
  );
  const { data: side } = trpc.games.sideBoard.useQuery({ tripId }, { ...SIDE_BOARD_QUERY, enabled: useVisibleEnabled(true) });

  const cupGames = ((lb?.games ?? []) as LBGame[]);
  const games = liveNowGames(mergeByDisplayOrder(cupGames, (side ?? []) as LBGame[]));
  if (games.length === 0) return null;

  const scoringModel = ((lb as { scoringModel?: ScoringModel } | undefined)?.scoringModel ?? "points") as ScoringModel;
  const cannotProject = ((lb as { cannotProject?: Record<string, CannotProjectReason> } | undefined)?.cannotProject ?? {});

  return (
    <section data-testid="live-now">
      <p className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider" style={{ color: "var(--color-bt-accent)" }}>
        <span className="h-1.5 w-1.5 rounded-full" style={{ background: "var(--color-bt-accent)" }} />
        Live now
        <span className="tabular-nums" style={{ color: "var(--color-bt-text)" }}>{games.length}</span>
      </p>
      <div className="space-y-2">
        {games.map((g) => (
          <Link
            key={g.id}
            href={liveNowHref(tripId, g)}
            className="flex items-center gap-3 rounded-xl px-4 py-3"
            style={{
              background: g.yours ? "var(--color-bt-accent-faint)" : "var(--color-bt-card)",
              border: g.yours ? "1px solid var(--color-bt-accent-border)" : "1px solid var(--color-bt-border)",
            }}
            data-testid={`live-now-${g.id}`}
            data-yours={g.yours ? "true" : "false"}
          >
            {createElement(formatIcon(g.gameTypeId ?? null), { size: 18, className: "shrink-0", style: { color: "var(--color-bt-accent)" } })}
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[15px] font-semibold" style={{ color: "var(--color-bt-text)" }}>
                {g.name}
              </span>
              <span className="block truncate text-[12.5px]" style={{ color: "var(--color-bt-text-dim)" }}>
                {liveSubtitle({
                  showProjectionPills: false,
                  // A side game has no competition: no projection reason applies.
                  scoringModel: g.sideGame ? "points" : scoringModel,
                  cannotProject: g.sideGame ? null : cannotProject[g.id] ?? null,
                })}
              </span>
            </span>
          </Link>
        ))}
      </div>
    </section>
  );
}
