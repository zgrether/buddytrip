"use client";

import { useRouter } from "next/navigation";
import { Trophy, Users, Calendar, ChevronRight, Flag, BarChart3 } from "lucide-react";
import { trpc } from "@/lib/trpc-client";
import type { TabProps } from "./types";

// ── Round format labels ───────────────────────────────────────────────────

const FORMAT_LABEL: Record<string, string> = {
  scramble: "Scramble",
  stableford: "Stableford",
  sabotage: "Sabotage",
  skins: "Skins",
  match_play: "Match Play",
  singles: "Singles",
};

// ── StatusPill ────────────────────────────────────────────────────────────

function StatusPill({ status }: { status: string }) {
  const cfg =
    status === "active"
      ? { label: "Active", color: "#00d4aa" }
      : status === "completed"
        ? { label: "Completed", color: "#8b949e" }
        : { label: "Upcoming", color: "#a78bfa" };

  return (
    <span
      className="inline-block rounded-full px-2 py-0.5 text-[10px] font-semibold"
      style={{ background: `${cfg.color}22`, color: cfg.color }}
    >
      {cfg.label}
    </span>
  );
}

// ── CompTab ───────────────────────────────────────────────────────────────

export function CompTab({ trip, canEdit }: TabProps) {
  const router = useRouter();

  const { data: event, isLoading: eventLoading } =
    trpc.events.getByTrip.useQuery({ tripId: trip.id });

  const { data: teams = [] } = trpc.teams.list.useQuery(
    { tripId: trip.id, eventId: event?.id ?? "" },
    { enabled: !!event?.id }
  );

  const { data: rounds = [] } = trpc.rounds.list.useQuery(
    { tripId: trip.id, eventId: event?.id ?? "" },
    { enabled: !!event?.id }
  );

  // ── Loading ─────────────────────────────────────────────────────────────
  if (eventLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div
          className="h-6 w-6 animate-spin rounded-full border-2"
          style={{ borderColor: "#00d4aa", borderTopColor: "transparent" }}
        />
      </div>
    );
  }

  // ── No event yet ─────────────────────────────────────────────────────────
  if (!event) {
    return (
      <div className="space-y-4 px-4">
        <div
          className="rounded-xl p-6 text-center"
          style={{ background: "#161b22", border: "1px solid #30363d" }}
        >
          <Trophy size={32} className="mx-auto mb-3" style={{ color: "#00d4aa" }} />
          <p className="mb-1 text-sm font-medium" style={{ color: "#e6edf3" }}>
            No competition set up yet
          </p>
          <p className="text-xs" style={{ color: "#8b949e" }}>
            {canEdit
              ? "Set up teams, rounds, and scoring from the Competition Setup screen."
              : "Waiting for a planner to set up the competition."}
          </p>
          {canEdit && (
            <button
              data-testid="setup-competition-btn"
              onClick={() =>
                router.push(`/trips/${trip.id}/competition/setup`)
              }
              className="mt-4 rounded-lg px-4 py-2 text-sm font-medium"
              style={{ background: "#00d4aa", color: "#0d1117" }}
            >
              Set Up Competition
            </button>
          )}
        </div>
      </div>
    );
  }

  // ── Event overview ───────────────────────────────────────────────────────
  return (
    <div className="space-y-5 px-4">
      {/* Event header card */}
      <div
        className="rounded-xl p-4"
        style={{ background: "#161b22", border: "1px solid #30363d" }}
      >
        <div className="mb-2 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Trophy size={16} style={{ color: "#00d4aa" }} />
            <p className="text-sm font-semibold" style={{ color: "#e6edf3" }}>
              {event.title}
            </p>
          </div>
          <StatusPill status={event.status ?? "upcoming"} />
        </div>
        {event.subtitle && (
          <p className="mb-1 text-xs" style={{ color: "#8b949e" }}>
            {event.subtitle}
          </p>
        )}
        {event.motto && (
          <p
            className="text-xs italic"
            style={{ color: "#8b949e" }}
          >
            &ldquo;{event.motto}&rdquo;
          </p>
        )}
        <div
          className="mt-2 flex flex-wrap gap-3 text-xs"
          style={{ color: "#8b949e" }}
        >
          {event.location && (
            <span className="flex items-center gap-1">
              <Flag size={10} />
              {event.location}
            </span>
          )}
          {event.dates && (
            <span className="flex items-center gap-1">
              <Calendar size={10} />
              {event.dates}
            </span>
          )}
        </div>

        <button
          data-testid="view-leaderboard-btn"
          onClick={() => router.push(`/trips/${trip.id}/leaderboard`)}
          className="mt-3 flex w-full items-center justify-center gap-1.5 rounded-lg py-2 text-sm font-medium"
          style={{ background: "#00d4aa", color: "#0d1117" }}
        >
          <BarChart3 size={14} />
          View Leaderboard
        </button>

        {canEdit && (
          <button
            data-testid="edit-competition-btn"
            onClick={() => router.push(`/trips/${trip.id}/competition/setup`)}
            className="mt-2 flex w-full items-center justify-center gap-1.5 rounded-lg border py-1.5 text-xs transition-colors hover:bg-white/5"
            style={{ borderColor: "#30363d", color: "#00d4aa" }}
          >
            Manage Competition
            <ChevronRight size={12} />
          </button>
        )}
      </div>

      {/* Teams */}
      <section>
        <h2
          className="mb-3 text-sm font-semibold uppercase tracking-wider"
          style={{ color: "#8b949e" }}
        >
          Teams ({teams.length})
        </h2>

        {teams.length === 0 ? (
          <p className="text-sm" style={{ color: "#8b949e" }}>
            No teams yet.{" "}
            {canEdit && "Add teams from the competition setup."}
          </p>
        ) : (
          <div className="space-y-2">
            {teams.map((team) => (
              <div
                key={team.id}
                data-testid={`team-${team.id}`}
                className="flex items-center gap-3 rounded-xl px-4 py-3"
                style={{ background: "#161b22", border: "1px solid #30363d" }}
              >
                <div
                  className="h-3 w-3 flex-shrink-0 rounded-full"
                  style={{ background: team.color ?? "#8b949e" }}
                />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium" style={{ color: "#e6edf3" }}>
                    {team.name}
                  </p>
                  <p className="text-xs" style={{ color: "#8b949e" }}>
                    {team.short_name}
                  </p>
                </div>
                <Users size={14} style={{ color: "#8b949e" }} />
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Rounds */}
      <section>
        <h2
          className="mb-3 text-sm font-semibold uppercase tracking-wider"
          style={{ color: "#8b949e" }}
        >
          Rounds ({rounds.length})
        </h2>

        {rounds.length === 0 ? (
          <p className="text-sm" style={{ color: "#8b949e" }}>
            No rounds yet.{" "}
            {canEdit && "Add rounds from the competition setup."}
          </p>
        ) : (
          <div className="space-y-2">
            {rounds.map((round) => (
              <div
                key={round.id}
                data-testid={`round-${round.id}`}
                className="rounded-xl px-4 py-3"
                style={{ background: "#161b22", border: "1px solid #30363d" }}
              >
                <div className="flex items-center justify-between">
                  <p className="text-sm font-medium" style={{ color: "#e6edf3" }}>
                    Day {round.day} — {round.title}
                  </p>
                  <span
                    className="text-xs"
                    style={{ color: round.is_closed ? "#8b949e" : "#00d4aa" }}
                  >
                    {round.is_closed ? "Closed" : "Open"}
                  </span>
                </div>
                <div
                  className="mt-1 flex gap-3 text-xs"
                  style={{ color: "#8b949e" }}
                >
                  <span>{round.course}</span>
                  <span>{FORMAT_LABEL[round.format] ?? round.format}</span>
                  {round.points_available > 0 && (
                    <span>{round.points_available} pts</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
