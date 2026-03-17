"use client";

import { useState, useMemo } from "react";
import { useParams } from "next/navigation";
import {
  Trophy,
  Users,
  Info,
  History,
  Flag,
  Calendar,
  Clock,
  Share2,
  Check,
} from "lucide-react";
import { trpc } from "@/lib/trpc-client";
import { useTripRole } from "@/hooks/useTripRole";
import { TripBottomNav } from "@/components/BottomNav";
import { TopNav } from "@/components/TopNav";
import { TripBreadcrumb } from "@/components/TripBreadcrumb";
import {
  computeScores,
  computeRemaining,
  type RoundResult,
  type SideEventScore,
  type RoundInfo,
  type SideEventInfo,
} from "@/lib/scoring";
import { ScoreEntry, type TeamInfo } from "@/components/ScoreEntry";
import { useRealtimeLeaderboard } from "@/hooks/useRealtimeLeaderboard";

// ── Types ─────────────────────────────────────────────────────────────────

type TabId = "overview" | "groups" | "trip-info" | "history";

const TABS: { id: TabId; label: string; icon: typeof Trophy }[] = [
  { id: "overview", label: "Overview", icon: Trophy },
  { id: "groups", label: "Groups", icon: Users },
  { id: "trip-info", label: "Trip Info", icon: Info },
  { id: "history", label: "History", icon: History },
];

const FORMAT_LABEL: Record<string, string> = {
  scramble: "Scramble",
  stableford: "Stableford",
  sabotage: "Sabotage",
  skins: "Skins",
  match_play: "Match Play",
  singles: "Singles",
};

// ── Page ──────────────────────────────────────────────────────────────────

export default function LeaderboardPage() {
  const params = useParams();
  const tripId = params.tripId as string;
  const [tab, setTab] = useState<TabId>("overview");

  const { canEdit } = useTripRole(tripId);

  // Score entry bottom sheet state
  const [scoreEntry, setScoreEntry] = useState<{
    roundId: string;
    groupId: string;
    groupName: string;
    format: string;
  } | null>(null);

  const utils = trpc.useUtils();

  // Share link state
  const [shareCopied, setShareCopied] = useState(false);
  const [shareError, setShareError] = useState(false);
  const shareLink = trpc.scoreboardShares.create.useMutation({
    onSuccess: async (data) => {
      const url = `${window.location.origin}/scoreboard/${data.shareCode}`;
      try {
        await navigator.clipboard.writeText(url);
        setShareCopied(true);
        setTimeout(() => setShareCopied(false), 2500);
      } catch {
        // Clipboard API unavailable (non-HTTPS, permissions denied, etc.)
        // Fall back: prompt the user to copy manually
        window.prompt("Copy the scoreboard link:", url);
        setShareError(true);
        setTimeout(() => setShareError(false), 3000);
      }
    },
  });

  // ── Data queries ────────────────────────────────────────────────────────

  const { data: trip } = trpc.trips.getById.useQuery({ tripId });

  const { data: event, isLoading: eventLoading } =
    trpc.events.getByTrip.useQuery({ tripId });

  const eventId = event?.id ?? "";

  const { data: teams = [] } = trpc.teams.list.useQuery(
    { tripId, eventId },
    { enabled: !!eventId }
  );

  const { data: rounds = [] } = trpc.rounds.list.useQuery(
    { tripId, eventId },
    { enabled: !!eventId }
  );

  const { data: playGroups = [] } = trpc.playGroups.list.useQuery(
    { tripId, eventId },
    { enabled: !!eventId }
  );

  const { data: roundScores = [] } =
    trpc.groupResults.listScoresByEvent.useQuery(
      { tripId, eventId },
      { enabled: !!eventId }
    );

  // Fetch per-group scores for the round being edited so ScoreEntry can
  // pre-fill existing values when a scored group is re-opened.
  const { data: activeGroupScores = [] } =
    trpc.groupResults.listScoresForRound.useQuery(
      { tripId, roundId: scoreEntry?.roundId ?? "" },
      { enabled: !!scoreEntry?.roundId }
    );

  const { data: sideEvents = [] } = trpc.sideEvents.list.useQuery(
    { tripId, eventId },
    { enabled: !!eventId }
  );

  // ── Realtime subscription ─────────────────────────────────────────────
  useRealtimeLeaderboard(tripId, eventId);

  const { data: quickTiles = [] } = trpc.quickInfoTiles.list.useQuery({
    tripId,
  });

  const { data: reservations = [] } = trpc.reservations.list.useQuery({
    tripId,
  });

  // ── Computed scores ─────────────────────────────────────────────────────

  const teamIds = useMemo(() => teams.map((t) => t.id), [teams]);

  // Build RoundResult[] from round_results view data
  const roundResults: RoundResult[] = useMemo(() => {
    const byRound = new Map<string, Record<string, number>>();
    for (const s of roundScores) {
      if (!byRound.has(s.round_id)) byRound.set(s.round_id, {});
      byRound.get(s.round_id)![s.team_id] = Number(s.total_points);
    }

    return rounds
      .filter((r) => byRound.has(r.id))
      .map((r) => ({
        roundId: r.id,
        pointsAvailable: Number(r.points_available),
        teamPoints: byRound.get(r.id) ?? {},
      }));
  }, [roundScores, rounds]);

  // Build round IDs that have results
  const roundsWithResults = useMemo(
    () => new Set(roundResults.map((r) => r.roundId)),
    [roundResults]
  );

  const sideEventScores: SideEventScore[] = useMemo(
    () =>
      sideEvents
        .filter((s) => s.status === "complete" && s.result)
        .map((s) => ({
          sideEventId: s.id,
          pointsAvailable: Number(s.points_available),
          result: (s.result ?? {}) as Record<string, number>,
        })),
    [sideEvents]
  );

  const teamScores = useMemo(
    () => computeScores(teamIds, roundResults, sideEventScores),
    [teamIds, roundResults, sideEventScores]
  );

  const remaining = useMemo(() => {
    const roundInfos: RoundInfo[] = rounds.map((r) => ({
      roundId: r.id,
      pointsAvailable: Number(r.points_available),
      hasResults: roundsWithResults.has(r.id),
    }));
    const sideInfos: SideEventInfo[] = sideEvents.map((s) => ({
      sideEventId: s.id,
      pointsAvailable: Number(s.points_available),
      isComplete: s.status === "complete",
    }));
    return computeRemaining(roundInfos, sideInfos);
  }, [rounds, sideEvents, roundsWithResults]);

  // ── Helpers ─────────────────────────────────────────────────────────────

  const teamById = useMemo(() => {
    const map = new Map<string, (typeof teams)[0]>();
    for (const t of teams) map.set(t.id, t);
    return map;
  }, [teams]);

  const teamInfos: TeamInfo[] = useMemo(
    () => teams.map((t) => ({ id: t.id, name: t.name, shortName: t.short_name, color: t.color })),
    [teams]
  );

  const leader = useMemo(() => {
    if (teamScores.length < 2) return null;
    const sorted = [...teamScores].sort(
      (a, b) => b.totalPoints - a.totalPoints
    );
    if (sorted[0].totalPoints === sorted[1].totalPoints) return null; // tied
    return sorted[0];
  }, [teamScores]);

  const totalPoints = useMemo(
    () =>
      rounds.reduce((sum, r) => sum + Number(r.points_available), 0) +
      sideEvents.reduce((sum, s) => sum + Number(s.points_available), 0),
    [rounds, sideEvents]
  );

  // ── Loading / no event ──────────────────────────────────────────────────

  if (eventLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center" style={{ background: "var(--color-bt-base)" }}>
        <div
          className="h-6 w-6 animate-spin rounded-full border-2"
          style={{ borderColor: "var(--color-bt-accent)", borderTopColor: "transparent" }}
        />
      </div>
    );
  }

  if (!event) {
    return (
      <div className="min-h-screen" style={{ background: "var(--color-bt-base)", color: "var(--color-bt-text)" }}>
        <TopNav />
        <TripBreadcrumb tripId={tripId} tripTitle={trip?.title ?? "…"} pageName="Competition" />
        <p className="px-4 pt-4 text-sm" style={{ color: "var(--color-bt-text-dim)" }}>
          No competition set up yet.
        </p>
        <TripBottomNav tripId={tripId} />
      </div>
    );
  }

  const shareButton = (
    <button
      data-testid="share-btn"
      onClick={() => shareLink.mutate({ tripId, eventId })}
      disabled={shareLink.isPending}
      className="flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium transition-all"
      style={{
        background: shareCopied ? "var(--color-bt-accent-faint)" : shareError ? "var(--color-bt-danger-bg)" : "var(--color-bt-subtle-border)",
        color: shareCopied ? "var(--color-bt-accent)" : shareError ? "var(--color-bt-danger)" : "var(--color-bt-text-dim)",
      }}
      aria-label="Share scoreboard"
    >
      {shareCopied ? <Check size={12} /> : <Share2 size={12} />}
      {shareCopied ? "Copied!" : shareError ? "Copy failed" : "Share"}
    </button>
  );

  // ── Render ──────────────────────────────────────────────────────────────

  return (
    <div
      className="mx-auto min-h-screen max-w-2xl pb-24"
      style={{ background: "var(--color-bt-base)", color: "var(--color-bt-text)" }}
    >
      {/* Top nav + breadcrumb */}
      <TopNav />
      <TripBreadcrumb
        tripId={tripId}
        tripTitle={trip?.title ?? "…"}
        pageName="Competition"
        rightSlot={shareButton}
      />

      {/* Tab bar */}
      <div
        className="flex border-b px-2"
        style={{ borderColor: "var(--color-bt-border)" }}
        data-testid="leaderboard-tabs"
      >
        {TABS.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            data-testid={`tab-${id}`}
            onClick={() => setTab(id)}
            className="flex flex-1 items-center justify-center gap-1.5 py-2.5 text-xs font-medium transition-colors"
            style={{
              color: tab === id ? "var(--color-bt-accent)" : "var(--color-bt-text-dim)",
              borderBottom: tab === id ? "2px solid var(--color-bt-accent)" : "2px solid transparent",
            }}
          >
            <Icon size={14} />
            {label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div className="px-4 pt-4">
        {tab === "overview" && (
          <OverviewTab
            teams={teams}
            teamScores={teamScores}
            rounds={rounds}
            roundResults={roundResults}
            sideEvents={sideEvents}
            sideEventScores={sideEventScores}
            remaining={remaining}
            leader={leader}
            totalPoints={totalPoints}
            teamById={teamById}
            canEdit={canEdit}
          />
        )}
        {tab === "groups" && (
          <GroupsTab
            rounds={rounds}
            playGroups={playGroups}
            teamById={teamById}
            roundsWithResults={roundsWithResults}
            canEdit={canEdit}
            onScoreEntry={(roundId, groupId, groupName, format) =>
              setScoreEntry({ roundId, groupId, groupName, format })
            }
          />
        )}
        {tab === "trip-info" && (
          <TripInfoTab
            trip={trip}
            quickTiles={quickTiles}
            reservations={reservations}
          />
        )}
        {tab === "history" && (
          <HistoryTab
            rounds={rounds}
            roundResults={roundResults}
            teamById={teamById}
          />
        )}
      </div>

      {/* Bottom navigation */}
      <TripBottomNav tripId={tripId} eventId={eventId} />

      {/* Score entry bottom sheet */}
      {scoreEntry && (
        <ScoreEntry
          tripId={tripId}
          eventId={eventId}
          roundId={scoreEntry.roundId}
          groupId={scoreEntry.groupId}
          groupName={scoreEntry.groupName}
          format={scoreEntry.format}
          teams={teamInfos}
          existingScores={activeGroupScores
            .filter((s) => s.group_id === scoreEntry.groupId)
            .map((s) => ({ teamId: s.team_id, points: Number(s.points) }))}
          onClose={() => setScoreEntry(null)}
          onSubmitted={() => {
            setScoreEntry(null);
            // Invalidate scores to refetch
            utils.groupResults.listScoresByEvent.invalidate({ tripId, eventId });
            utils.groupResults.list.invalidate();
            utils.groupResults.listScoresForRound.invalidate({ tripId, roundId: scoreEntry.roundId });
          }}
        />
      )}
    </div>
  );
}

// ═════════════════════════════════════════════════════════════════════════════
// Overview Tab
// ═════════════════════════════════════════════════════════════════════════════

interface OverviewProps {
  teams: { id: string; name: string; short_name: string; color: string; color_dim: string }[];
  teamScores: ReturnType<typeof computeScores>;
  rounds: { id: string; day: number; title: string; course: string; format: string; points_available: number; status: string }[];
  roundResults: RoundResult[];
  sideEvents: { id: string; name: string; icon: string; points_available: number; status: string }[];
  sideEventScores: SideEventScore[];
  remaining: number;
  leader: { teamId: string; totalPoints: number } | null;
  totalPoints: number;
  teamById: Map<string, { id: string; name: string; short_name: string; color: string }>;
  canEdit: boolean;
}

function OverviewTab({
  teams,
  teamScores,
  rounds,
  roundResults,
  sideEvents,
  remaining,
  leader,
  totalPoints,
  teamById,
}: OverviewProps) {
  // Build a map from roundId → teamPoints
  const roundPointsMap = useMemo(() => {
    const map = new Map<string, Record<string, number>>();
    for (const r of roundResults) {
      map.set(r.roundId, r.teamPoints);
    }
    return map;
  }, [roundResults]);

  return (
    <div className="space-y-5" data-testid="overview-tab">
      {/* Score hero */}
      <div
        className="rounded-xl p-4"
        style={{ background: "var(--color-bt-card)", border: "1px solid var(--color-bt-border)" }}
      >
        <div className="flex items-center justify-between">
          {teamScores.map((ts) => {
            const team = teamById.get(ts.teamId);
            return (
              <div key={ts.teamId} className="flex-1 text-center">
                <p className="text-xs font-medium" style={{ color: team?.color ?? "var(--color-bt-text-dim)" }}>
                  {team?.short_name ?? ts.teamId}
                </p>
                <p
                  className="text-3xl font-bold"
                  style={{ color: team?.color ?? "var(--color-bt-text)" }}
                  data-testid={`score-${ts.teamId}`}
                >
                  {ts.totalPoints}
                </p>
              </div>
            );
          })}
        </div>

        {/* Lead bar */}
        {totalPoints > 0 && (
          <div className="mt-3 flex h-2 overflow-hidden rounded-full" style={{ background: "var(--color-bt-border)" }}>
            {teamScores.map((ts) => {
              const team = teamById.get(ts.teamId);
              const pct = totalPoints > 0 ? (ts.totalPoints / totalPoints) * 100 : 0;
              return (
                <div
                  key={ts.teamId}
                  style={{ width: `${pct}%`, background: team?.color ?? "var(--color-bt-text-dim)" }}
                />
              );
            })}
          </div>
        )}

        {/* Status line */}
        <p className="mt-2 text-center text-xs" style={{ color: "var(--color-bt-text-dim)" }}>
          {remaining > 0
            ? leader
              ? `${teamById.get(leader.teamId)?.short_name} leads · ${remaining} pts remaining`
              : `Tied · ${remaining} pts remaining`
            : leader
              ? `${teamById.get(leader.teamId)?.short_name} wins!`
              : "Tied!"}
        </p>
      </div>

      {/* Rounds accordion */}
      <section>
        <h2
          className="mb-3 text-xs font-semibold uppercase tracking-wider"
          style={{ color: "var(--color-bt-text-dim)" }}
        >
          Rounds
        </h2>
        <div
          className="overflow-hidden rounded-xl"
          style={{ background: "var(--color-bt-card)", border: "1px solid var(--color-bt-border)" }}
        >
          {/* Header row */}
          <div
            className="grid gap-2 border-b px-3 py-2 text-[10px] font-semibold uppercase"
            style={{
              gridTemplateColumns: `1fr ${teams.map(() => "60px").join(" ")}`,
              color: "var(--color-bt-text-dim)",
              borderColor: "var(--color-bt-border)",
            }}
          >
            <span>Round</span>
            {teams.map((t) => (
              <span key={t.id} className="text-center" style={{ color: t.color }}>
                {t.short_name}
              </span>
            ))}
          </div>

          {rounds.map((round) => {
            const pts = roundPointsMap.get(round.id);
            const hasResult = !!pts;
            const statusColor =
              round.status === "active"
                ? "var(--color-bt-accent)"
                : round.status === "submitted"
                  ? "var(--color-bt-warning)"
                  : round.status === "closed"
                    ? "var(--color-bt-text-dim)"
                    : "var(--color-bt-text-dim)";

            return (
              <div
                key={round.id}
                data-testid={`round-row-${round.id}`}
                className="grid items-center gap-2 border-b px-3 py-2 last:border-b-0"
                style={{
                  gridTemplateColumns: `1fr ${teams.map(() => "60px").join(" ")}`,
                  borderColor: "var(--color-bt-subtle-border)",
                  borderLeft: `3px solid ${statusColor}`,
                }}
              >
                <div className="min-w-0">
                  <p className="truncate text-xs font-medium" style={{ color: "var(--color-bt-text)" }}>
                    {round.title}
                  </p>
                  <p className="text-[10px]" style={{ color: "var(--color-bt-text-dim)" }}>
                    {round.course} · {FORMAT_LABEL[round.format] ?? round.format} ·{" "}
                    {round.points_available} pts
                  </p>
                </div>
                {teams.map((t) => (
                  <span
                    key={t.id}
                    className="text-center text-sm font-bold"
                    style={{ color: hasResult ? t.color : "var(--color-bt-text-dim)" }}
                  >
                    {hasResult ? (pts![t.id] ?? 0) : "—"}
                  </span>
                ))}
              </div>
            );
          })}

          {/* Total row */}
          <div
            className="grid gap-2 px-3 py-2 text-sm font-bold"
            style={{
              gridTemplateColumns: `1fr ${teams.map(() => "60px").join(" ")}`,
              background: "var(--color-bt-base)",
            }}
          >
            <span style={{ color: "var(--color-bt-text)" }}>TOTAL</span>
            {teamScores.map((ts) => {
              const team = teamById.get(ts.teamId);
              return (
                <span key={ts.teamId} className="text-center" style={{ color: team?.color ?? "var(--color-bt-text)" }}>
                  {ts.roundPoints}
                </span>
              );
            })}
          </div>
        </div>
      </section>

      {/* Side events */}
      {sideEvents.length > 0 && (
        <section>
          <h2
            className="mb-3 text-xs font-semibold uppercase tracking-wider"
            style={{ color: "var(--color-bt-text-dim)" }}
          >
            Side Events
          </h2>
          <div className="space-y-2">
            {sideEvents.map((se) => (
              <div
                key={se.id}
                className="flex items-center justify-between rounded-xl px-4 py-3"
                style={{ background: "var(--color-bt-card)", border: "1px solid var(--color-bt-border)" }}
              >
                <div className="flex items-center gap-2">
                  <span>{se.icon}</span>
                  <span className="text-sm" style={{ color: "var(--color-bt-text)" }}>
                    {se.name}
                  </span>
                </div>
                <span
                  className="text-xs font-medium"
                  style={{ color: se.status === "complete" ? "var(--color-bt-accent)" : "var(--color-bt-text-dim)" }}
                >
                  {se.status === "complete" ? "Complete" : `${se.points_available} pts`}
                </span>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Team rosters */}
      <section>
        <h2
          className="mb-3 text-xs font-semibold uppercase tracking-wider"
          style={{ color: "var(--color-bt-text-dim)" }}
        >
          Teams
        </h2>
        <div className="space-y-3">
          {teams.map((team) => {
            const score = teamScores.find((ts) => ts.teamId === team.id);
            return (
              <div
                key={team.id}
                className="rounded-xl p-4"
                style={{ background: "var(--color-bt-card)", border: `1px solid ${team.color}44` }}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div
                      className="h-3 w-3 rounded-full"
                      style={{ background: team.color }}
                    />
                    <p className="text-sm font-semibold" style={{ color: team.color }}>
                      {team.name}
                    </p>
                  </div>
                  <p className="text-lg font-bold" style={{ color: team.color }}>
                    {score?.totalPoints ?? 0}
                  </p>
                </div>
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}

// ═════════════════════════════════════════════════════════════════════════════
// Groups Tab
// ═════════════════════════════════════════════════════════════════════════════

interface GroupsProps {
  rounds: { id: string; day: number; title: string; course: string; format: string; status: string }[];
  playGroups: { id: string; name: string; tee_time: string; player_ids: string[] }[];
  teamById: Map<string, { id: string; name: string; short_name: string; color: string }>;
  roundsWithResults: Set<string>;
  canEdit: boolean;
  onScoreEntry: (roundId: string, groupId: string, groupName: string, format: string) => void;
}

function GroupsTab({ rounds, playGroups, roundsWithResults, canEdit, onScoreEntry }: GroupsProps) {
  const activeRounds = rounds.filter((r) => r.status === "active" || r.status === "submitted");

  if (activeRounds.length === 0) {
    return (
      <div className="flex flex-col items-center py-12 text-center" data-testid="groups-tab">
        <Flag size={28} className="mb-3" style={{ color: "var(--color-bt-text-dim)" }} />
        <p className="text-sm font-medium" style={{ color: "var(--color-bt-text)" }}>
          No round in progress
        </p>
        <p className="mt-1 text-xs" style={{ color: "var(--color-bt-text-dim)" }}>
          The competition owner can start a round from the Competition tab.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-5" data-testid="groups-tab">
      {activeRounds.map((round) => {
        const isClosed = round.status === "closed";
        const isSubmitted = round.status === "submitted";

        return (
          <section key={round.id}>
          <div className="mb-3 flex items-center gap-2">
            <h2 className="text-sm font-semibold" style={{ color: "var(--color-bt-text)" }}>
              Day {round.day} — {round.course}
            </h2>
            {round.status === "active" && (
              <span
                className="rounded-full px-2 py-0.5 text-[10px] font-semibold"
                style={{ background: "var(--color-bt-accent-faint)", color: "var(--color-bt-accent)" }}
              >
                LIVE
              </span>
            )}
            {isSubmitted && (
              <span
                className="rounded-full px-2 py-0.5 text-[10px] font-semibold"
                style={{ background: "var(--color-bt-warning-faint)", color: "var(--color-bt-warning)" }}
              >
                Pending close
              </span>
            )}
            {isClosed && (
              <span
                className="rounded-full px-2 py-0.5 text-[10px] font-semibold"
                style={{ background: "var(--color-bt-dim-faint)", color: "var(--color-bt-text-dim)" }}
              >
                Closed
              </span>
            )}
          </div>

          {playGroups.length === 0 ? (
            <p className="text-sm" style={{ color: "var(--color-bt-text-dim)" }}>
              No groups set up yet.
            </p>
          ) : (
            <div className="space-y-2">
              {playGroups.map((group) => {
                const hasScore = roundsWithResults.has(round.id);
                // Active: anyone can score. Submitted: only owners/planners can correct.
                const canEnterScore =
                  round.status === "active" ||
                  (round.status === "submitted" && canEdit);
                return (
                  <button
                    key={group.id}
                    data-testid={`group-card-${group.id}`}
                    className="w-full rounded-xl px-4 py-3 text-left transition-opacity"
                    style={{
                      background: "var(--color-bt-card)",
                      border: "1px solid var(--color-bt-border)",
                      opacity: canEnterScore ? 1 : isClosed ? 0.5 : 0.7,
                    }}
                    disabled={!canEnterScore}
                    onClick={() => onScoreEntry(round.id, group.id, group.name, round.format)}
                  >
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-sm font-medium" style={{ color: "var(--color-bt-text)" }}>
                          {group.name}
                        </p>
                        <p className="flex items-center gap-1 text-xs" style={{ color: "var(--color-bt-text-dim)" }}>
                          <Clock size={10} />
                          {group.tee_time}
                        </p>
                      </div>
                      {isClosed && hasScore ? (
                        <span
                          className="rounded-full px-2 py-0.5 text-[10px] font-semibold"
                          style={{ background: "var(--color-bt-dim-faint)", color: "var(--color-bt-text-dim)" }}
                        >
                          Final
                        </span>
                      ) : hasScore ? (
                        <span
                          className="rounded-full px-2 py-0.5 text-[10px] font-semibold"
                          style={{ background: "var(--color-bt-accent-faint)", color: "var(--color-bt-accent)" }}
                        >
                          {isSubmitted && canEdit ? "Edit Score" : "Scored"}
                        </span>
                      ) : canEnterScore ? (
                        <span
                          className="rounded-full px-2 py-0.5 text-[10px] font-semibold"
                          style={{ background: "var(--color-bt-accent-faint)", color: "var(--color-bt-accent)" }}
                        >
                          Enter Score
                        </span>
                      ) : (
                        <span
                          className="text-xs"
                          style={{ color: "var(--color-bt-text-dim)" }}
                        >
                          {group.player_ids.length} players
                        </span>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </section>
        );
      })}

    </div>
  );
}

// ═════════════════════════════════════════════════════════════════════════════
// Trip Info Tab
// ═════════════════════════════════════════════════════════════════════════════

interface TripInfoProps {
  trip: { id: string; title: string; location?: string | null; start_date?: string | null; end_date?: string | null } | undefined | null;
  quickTiles: { id: string; label: string; value: string }[];
  reservations: { id: string; title: string; type: string; date: string; start_time: string }[];
}

function TripInfoTab({ trip, quickTiles, reservations }: TripInfoProps) {
  // Filter to today's or upcoming reservations
  const today = new Date().toISOString().split("T")[0];
  const upcoming = reservations
    .filter((r) => r.date >= today)
    .sort((a, b) => a.date.localeCompare(b.date) || a.start_time.localeCompare(b.start_time))
    .slice(0, 5);

  return (
    <div className="space-y-5" data-testid="trip-info-tab">
      {/* Quick tiles */}
      {quickTiles.length > 0 && (
        <section>
          <h2
            className="mb-3 text-xs font-semibold uppercase tracking-wider"
            style={{ color: "var(--color-bt-text-dim)" }}
          >
            Quick Info
          </h2>
          <div className="grid grid-cols-2 gap-2">
            {quickTiles.map((tile) => (
              <div
                key={tile.id}
                className="rounded-xl px-3 py-2"
                style={{ background: "var(--color-bt-card)", border: "1px solid var(--color-bt-border)" }}
              >
                <p className="text-[10px] uppercase" style={{ color: "var(--color-bt-text-dim)" }}>
                  {tile.label}
                </p>
                <p className="text-sm font-medium" style={{ color: "var(--color-bt-text)" }}>
                  {tile.value}
                </p>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Trip details */}
      {trip && (
        <section>
          <h2
            className="mb-3 text-xs font-semibold uppercase tracking-wider"
            style={{ color: "var(--color-bt-text-dim)" }}
          >
            Trip Details
          </h2>
          <div
            className="space-y-2 rounded-xl p-4"
            style={{ background: "var(--color-bt-card)", border: "1px solid var(--color-bt-border)" }}
          >
            {trip.location && (
              <div className="flex items-center gap-2 text-sm">
                <Flag size={12} style={{ color: "var(--color-bt-text-dim)" }} />
                <span style={{ color: "var(--color-bt-text)" }}>{trip.location}</span>
              </div>
            )}
            {trip.start_date && (
              <div className="flex items-center gap-2 text-sm">
                <Calendar size={12} style={{ color: "var(--color-bt-text-dim)" }} />
                <span style={{ color: "var(--color-bt-text)" }}>
                  {trip.start_date}
                  {trip.end_date && ` — ${trip.end_date}`}
                </span>
              </div>
            )}
          </div>
        </section>
      )}

      {/* Upcoming reservations */}
      {upcoming.length > 0 && (
        <section>
          <h2
            className="mb-3 text-xs font-semibold uppercase tracking-wider"
            style={{ color: "var(--color-bt-text-dim)" }}
          >
            Schedule
          </h2>
          <div className="space-y-2">
            {upcoming.map((r) => (
              <div
                key={r.id}
                className="flex items-center justify-between rounded-xl px-4 py-3"
                style={{ background: "var(--color-bt-card)", border: "1px solid var(--color-bt-border)" }}
              >
                <div>
                  <p className="text-sm font-medium" style={{ color: "var(--color-bt-text)" }}>
                    {r.title}
                  </p>
                  <p className="text-xs" style={{ color: "var(--color-bt-text-dim)" }}>
                    {r.date} {r.start_time && `· ${r.start_time}`}
                  </p>
                </div>
                <span
                  className="rounded-full px-2 py-0.5 text-[10px] capitalize"
                  style={{ background: "var(--color-bt-border)", color: "var(--color-bt-text-dim)" }}
                >
                  {r.type}
                </span>
              </div>
            ))}
          </div>
        </section>
      )}

      {quickTiles.length === 0 && upcoming.length === 0 && !trip?.location && (
        <p className="text-sm" style={{ color: "var(--color-bt-text-dim)" }}>
          No trip info available yet.
        </p>
      )}
    </div>
  );
}

// ═════════════════════════════════════════════════════════════════════════════
// History Tab
// ═════════════════════════════════════════════════════════════════════════════

interface HistoryProps {
  rounds: { id: string; day: number; title: string; course: string; format: string; points_available: number; status: string }[];
  roundResults: RoundResult[];
  teamById: Map<string, { id: string; name: string; short_name: string; color: string }>;
}

function HistoryTab({ rounds, roundResults, teamById }: HistoryProps) {
  const closedRounds = rounds.filter(
    (r) => r.status === "closed" || r.status === "submitted"
  );

  const resultMap = useMemo(() => {
    const map = new Map<string, Record<string, number>>();
    for (const r of roundResults) {
      map.set(r.roundId, r.teamPoints);
    }
    return map;
  }, [roundResults]);

  if (closedRounds.length === 0) {
    return (
      <div data-testid="history-tab">
        <p className="text-sm" style={{ color: "var(--color-bt-text-dim)" }}>
          No completed rounds yet.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3" data-testid="history-tab">
      {closedRounds.map((round) => {
        const pts = resultMap.get(round.id);
        // Find winner
        let winnerTeamId: string | null = null;
        let maxPts = -1;
        let tied = false;
        if (pts) {
          for (const [teamId, p] of Object.entries(pts)) {
            if (p > maxPts) {
              maxPts = p;
              winnerTeamId = teamId;
              tied = false;
            } else if (p === maxPts) {
              tied = true;
            }
          }
        }

        const winner = !tied && winnerTeamId ? teamById.get(winnerTeamId) : null;

        return (
          <div
            key={round.id}
            data-testid={`history-${round.id}`}
            className="rounded-xl p-4"
            style={{ background: "var(--color-bt-card)", border: "1px solid var(--color-bt-border)" }}
          >
            <div className="mb-2 flex items-center justify-between">
              <p className="text-sm font-semibold" style={{ color: "var(--color-bt-text)" }}>
                Day {round.day} — {round.title}
              </p>
              {winner ? (
                <span
                  className="rounded-full px-2 py-0.5 text-[10px] font-semibold"
                  style={{ background: `${winner.color}22`, color: winner.color }}
                >
                  {winner.short_name} wins
                </span>
              ) : pts ? (
                <span
                  className="rounded-full px-2 py-0.5 text-[10px] font-semibold"
                  style={{ background: "var(--color-bt-warning-faint)", color: "var(--color-bt-warning)" }}
                >
                  Tied
                </span>
              ) : null}
            </div>
            <p className="text-xs" style={{ color: "var(--color-bt-text-dim)" }}>
              {round.course} · {FORMAT_LABEL[round.format] ?? round.format} ·{" "}
              {round.points_available} pts
            </p>
            {pts && (
              <div className="mt-2 flex gap-4">
                {Object.entries(pts).map(([teamId, p]) => {
                  const team = teamById.get(teamId);
                  return (
                    <span key={teamId} className="text-sm font-bold" style={{ color: team?.color ?? "var(--color-bt-text)" }}>
                      {team?.short_name ?? teamId}: {p}
                    </span>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
