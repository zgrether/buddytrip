"use client";

import { useMemo } from "react";
import { useParams } from "next/navigation";
import { Trophy, Share2 } from "lucide-react";
import { trpc } from "@/lib/trpc-client";
import { computeScores, computeRemaining, type RoundResult, type SideEventScore, type RoundInfo, type SideEventInfo } from "@/lib/scoring";

const FORMAT_LABEL: Record<string, string> = {
  scramble: "Scramble",
  stableford: "Stableford",
  sabotage: "Sabotage",
  skins: "Skins",
  match_play: "Match Play",
  singles: "Singles",
};

export default function PublicScoreboardPage() {
  const params = useParams();
  const shareCode = params.shareCode as string;

  const { data, isLoading, error } = trpc.scoreboardShares.getScoreboard.useQuery(
    { shareCode },
    { refetchInterval: 30_000 } // Light polling for public page
  );

  // ── Computed scores ─────────────────────────────────────────────────────

  const teams = useMemo(() => data?.teams ?? [], [data?.teams]);
  const rounds = useMemo(() => data?.rounds ?? [], [data?.rounds]);
  const sideEvents = useMemo(() => data?.sideEvents ?? [], [data?.sideEvents]);
  const roundScores = useMemo(() => data?.roundScores ?? [], [data?.roundScores]);

  const teamIds = useMemo(() => teams.map((t) => t.id), [teams]);

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

  const teamById = useMemo(() => {
    const map = new Map<string, (typeof teams)[0]>();
    for (const t of teams) map.set(t.id, t);
    return map;
  }, [teams]);

  const leader = useMemo(() => {
    if (teamScores.length < 2) return null;
    const sorted = [...teamScores].sort((a, b) => b.totalPoints - a.totalPoints);
    if (sorted[0].totalPoints === sorted[1].totalPoints) return null;
    return sorted[0];
  }, [teamScores]);

  const totalPoints = useMemo(
    () =>
      rounds.reduce((sum, r) => sum + Number(r.points_available), 0) +
      sideEvents.reduce((sum, s) => sum + Number(s.points_available), 0),
    [rounds, sideEvents]
  );

  // ── Loading / error ─────────────────────────────────────────────────────

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center" style={{ background: "var(--color-bt-base)" }}>
        <div
          className="h-6 w-6 animate-spin rounded-full border-2"
          style={{ borderColor: "var(--color-bt-accent)", borderTopColor: "transparent" }}
        />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-3" style={{ background: "var(--color-bt-base)", color: "var(--color-bt-text)" }}>
        <Trophy size={32} style={{ color: "var(--color-bt-border)" }} />
        <p className="text-sm" style={{ color: "var(--color-bt-text-dim)" }}>
          Scoreboard not found or link has expired.
        </p>
      </div>
    );
  }

  const roundPointsMap = new Map<string, Record<string, number>>();
  for (const r of roundResults) {
    roundPointsMap.set(r.roundId, r.teamPoints);
  }

  // ── Render ──────────────────────────────────────────────────────────────

  return (
    <div
      className="mx-auto min-h-screen max-w-xl pb-8"
      style={{ background: "var(--color-bt-base)", color: "var(--color-bt-text)" }}
      data-testid="public-scoreboard"
    >
      {/* Header */}
      <header className="flex items-center gap-3 px-4 py-4">
        <Trophy size={20} style={{ color: "var(--color-bt-accent)" }} />
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-lg font-bold">{data.event.title}</h1>
          {data.event.subtitle && (
            <p className="truncate text-xs" style={{ color: "var(--color-bt-text-dim)" }}>
              {data.event.subtitle}
            </p>
          )}
        </div>
        <div
          className="flex items-center gap-1 rounded-full px-2 py-1 text-[10px] font-medium"
          style={{ background: "var(--color-bt-accent-faint)", color: "var(--color-bt-accent)" }}
        >
          <Share2 size={10} />
          LIVE
        </div>
      </header>

      <div className="px-4 space-y-5">
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
                  <p className="text-3xl font-bold" style={{ color: team?.color ?? "var(--color-bt-text)" }}>
                    {ts.totalPoints}
                  </p>
                </div>
              );
            })}
          </div>

          {totalPoints > 0 && (
            <div className="mt-3 flex h-2 overflow-hidden rounded-full" style={{ background: "var(--color-bt-border)" }}>
              {teamScores.map((ts) => {
                const team = teamById.get(ts.teamId);
                const pct = totalPoints > 0 ? (ts.totalPoints / totalPoints) * 100 : 0;
                return (
                  <div key={ts.teamId} style={{ width: `${pct}%`, background: team?.color ?? "var(--color-bt-text-dim)" }} />
                );
              })}
            </div>
          )}

          <p className="mt-2 text-center text-xs" style={{ color: "var(--color-bt-text-dim)" }}>
            {remaining > 0
              ? leader
                ? `${teamById.get(leader.teamId)?.short_name} leads \u00b7 ${remaining} pts remaining`
                : `Tied \u00b7 ${remaining} pts remaining`
              : leader
                ? `${teamById.get(leader.teamId)?.short_name} wins!`
                : "Tied!"}
          </p>
        </div>

        {/* Rounds table */}
        <section>
          <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider" style={{ color: "var(--color-bt-text-dim)" }}>
            Rounds
          </h2>
          <div className="overflow-hidden rounded-xl" style={{ background: "var(--color-bt-card)", border: "1px solid var(--color-bt-border)" }}>
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
              return (
                <div
                  key={round.id}
                  className="grid items-center gap-2 border-b px-3 py-2 last:border-b-0"
                  style={{
                    gridTemplateColumns: `1fr ${teams.map(() => "60px").join(" ")}`,
                    borderColor: "var(--color-bt-subtle-border)",
                  }}
                >
                  <div className="min-w-0">
                    <p className="truncate text-xs font-medium" style={{ color: "var(--color-bt-text)" }}>
                      Day {round.day} — {round.title}
                    </p>
                    <p className="text-[10px]" style={{ color: "var(--color-bt-text-dim)" }}>
                      {round.course} \u00b7 {FORMAT_LABEL[round.format] ?? round.format} \u00b7 {round.points_available} pts
                    </p>
                  </div>
                  {teams.map((t) => (
                    <span
                      key={t.id}
                      className="text-center text-sm font-bold"
                      style={{ color: hasResult ? t.color : "var(--color-bt-text-dim)" }}
                    >
                      {hasResult ? (pts![t.id] ?? 0) : "\u2014"}
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
            <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider" style={{ color: "var(--color-bt-text-dim)" }}>
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
                    <span className="text-sm" style={{ color: "var(--color-bt-text)" }}>{se.name}</span>
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

        {/* Powered by BuddyTrip */}
        <p className="pt-4 text-center text-xs" style={{ color: "var(--color-bt-text-dim)" }}>
          Powered by BuddyTrip
        </p>
      </div>
    </div>
  );
}
