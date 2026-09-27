"use client";

import { useMemo } from "react";
import { Trophy } from "lucide-react";
import { trpc } from "@/lib/trpc-client";
import { LEADERBOARD_QUERY } from "@/lib/queryConfig";
import { useVisibleEnabled } from "@/lib/surfaceVisibility";
import { GamesSection, useGameRowContext, type LBGame, type LBCell } from "./CompetitionLeaderboard";

/**
 * The GAMES page on a trip with no competition (PR 6b, ruling 24: the tab is the
 * trip's games page "present whether or not a competition exists").
 *
 * The same lifecycle sections, reorder and add-game the cup's board has — it is
 * the SAME `GamesSection` — listing the trip's side games. Above them, for the
 * people who can create one, the invitation to start a competition. Everyone
 * else sees the games; there is nothing about a competition to show them.
 */
export function SideGamesBoard({
  tripId,
  canEdit,
  isOwner,
  onAddGame,
  onStartCompetition,
}: {
  tripId: string;
  /** Owner or Organizer — the roles `competitions.create` admits. */
  canEdit: boolean;
  isOwner: boolean;
  onAddGame: () => void;
  onStartCompetition: () => void;
}) {
  const { data: rows, isLoading, isError, refetch } = trpc.games.sideBoard.useQuery(
    { tripId },
    { ...LEADERBOARD_QUERY, enabled: useVisibleEnabled(true) }
  );
  const { mineSet, viewer, delegateOfByGame, prefetchGame } = useGameRowContext({
    tripId,
    teams: undefined,
    isOwner,
  });
  const noCells = useMemo(() => new Map<string, Map<string, LBCell>>(), []);

  return (
    <div className="space-y-3" data-testid="games-page">
      {canEdit && <StartCompetitionCard onStart={onStartCompetition} />}
      {!rows && isError ? (
        <GamesLoadError onRetry={() => void refetch()} />
      ) : !rows && isLoading ? (
        <GamesLoading />
      ) : (
        <GamesSection
          games={(rows ?? []) as LBGame[]}
          teams={[]}
          cellsByGame={noCells}
          projections={{}}
          cannotProject={{}}
          // Irrelevant to a side game's row (no points, no team columns); a value
          // is required by the shared section.
          scoringModel="points"
          tripId={tripId}
          mineSet={mineSet}
          viewer={viewer}
          delegateOfByGame={delegateOfByGame}
          onPrefetch={prefetchGame}
          canEdit={canEdit}
          onAddGame={onAddGame}
        />
      )}
    </div>
  );
}

/**
 * The invitation to start a competition, where the hero sits on a trip that has
 * one. The setup guide's version of this was retired; this is its persistent
 * home, the place the intent to compete comes up later in a trip (PR 6 plan).
 * Opens the existing create flow — `CompetitionSetupPanel` — rather than a new
 * one.
 */
function StartCompetitionCard({ onStart }: { onStart: () => void }) {
  return (
    <div
      className="flex items-center gap-3 rounded-xl px-4 py-3"
      style={{ background: "var(--color-bt-card)", border: "1px solid var(--color-bt-border)" }}
      data-testid="start-competition-card"
    >
      <div
        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl"
        style={{ background: "var(--color-bt-accent-faint)", color: "var(--color-bt-accent)" }}
      >
        <Trophy size={18} />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-[14px] font-semibold" style={{ color: "var(--color-bt-text)" }}>
          Turn this into a competition
        </p>
        <p className="text-[12px] leading-snug" style={{ color: "var(--color-bt-text-dim)" }}>
          Create teams and compete for points.
        </p>
      </div>
      <button
        type="button"
        onClick={onStart}
        className="shrink-0 rounded-lg px-3 py-2 text-[13px] font-semibold"
        style={{ background: "var(--color-bt-accent)", color: "var(--color-bt-base)" }}
        data-testid="start-competition"
      >
        Start one
      </button>
    </div>
  );
}

function GamesLoading() {
  return (
    <div className="flex min-h-[20vh] items-center justify-center" data-testid="games-loading">
      <div
        className="h-8 w-8 animate-spin rounded-full border-2"
        style={{ borderColor: "var(--color-bt-accent)", borderTopColor: "transparent" }}
      />
    </div>
  );
}

/** Never a blank page on a failed first load — the same rule as the board's. */
function GamesLoadError({ onRetry }: { onRetry: () => void }) {
  return (
    <div
      className="rounded-xl px-4 py-5 text-center"
      style={{ background: "var(--color-bt-card)", border: "1px solid var(--color-bt-border)" }}
      data-testid="games-load-error"
    >
      <p className="text-sm font-semibold" style={{ color: "var(--color-bt-text)" }}>
        Couldn&apos;t load the games
      </p>
      <button
        type="button"
        onClick={onRetry}
        className="mt-3 rounded-lg px-4 py-2 text-[13px] font-semibold"
        style={{ background: "var(--color-bt-card-raised)", color: "var(--color-bt-text)", border: "1px solid var(--color-bt-border)" }}
      >
        Try again
      </button>
    </div>
  );
}
