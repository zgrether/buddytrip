"use client";

import { useRouter } from "next/navigation";
import { Trophy, Users, Calendar, ChevronRight, Flag, BarChart3, CheckCircle, Lock } from "lucide-react";
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
      ? { label: "Active", color: "var(--color-bt-accent)" }
      : status === "submitted"
        ? { label: "Submitted", color: "var(--color-bt-warning)" }
        : status === "closed" || status === "completed"
          ? { label: "Closed", color: "var(--color-bt-text-dim)" }
          : { label: "Upcoming", color: "var(--color-bt-ready)" };

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
  const utils = trpc.useUtils();

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

  const closeRound = trpc.rounds.update.useMutation({
    onSuccess: () => {
      utils.rounds.list.invalidate({ tripId: trip.id, eventId: event?.id ?? "" });
    },
  });

  // ── Loading ─────────────────────────────────────────────────────────────
  if (eventLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div
          className="h-6 w-6 animate-spin rounded-full border-2"
          style={{ borderColor: "var(--color-bt-accent)", borderTopColor: "transparent" }}
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
          style={{ background: "var(--color-bt-card)", border: "1px solid var(--color-bt-border)" }}
        >
          <Trophy size={32} className="mx-auto mb-3" style={{ color: "var(--color-bt-accent)" }} />
          <p className="mb-1 text-sm font-medium" style={{ color: "var(--color-bt-text)" }}>
            No competition set up yet
          </p>
          <p className="text-xs" style={{ color: "var(--color-bt-text-dim)" }}>
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
              style={{ background: "var(--color-bt-accent)", color: "var(--color-bt-base)" }}
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
        style={{ background: "var(--color-bt-card)", border: "1px solid var(--color-bt-border)" }}
      >
        <div className="mb-2 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Trophy size={16} style={{ color: "var(--color-bt-accent)" }} />
            <p className="text-sm font-semibold" style={{ color: "var(--color-bt-text)" }}>
              {event.title}
            </p>
          </div>
          <StatusPill status={event.status ?? "upcoming"} />
        </div>
        {event.subtitle && (
          <p className="mb-1 text-xs" style={{ color: "var(--color-bt-text-dim)" }}>
            {event.subtitle}
          </p>
        )}
        {event.motto && (
          <p
            className="text-xs italic"
            style={{ color: "var(--color-bt-text-dim)" }}
          >
            &ldquo;{event.motto}&rdquo;
          </p>
        )}
        <div
          className="mt-2 flex flex-wrap gap-3 text-xs"
          style={{ color: "var(--color-bt-text-dim)" }}
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
          style={{ background: "var(--color-bt-accent)", color: "var(--color-bt-base)" }}
        >
          <BarChart3 size={14} />
          View Leaderboard
        </button>

        {canEdit && (
          <button
            data-testid="edit-competition-btn"
            onClick={() => router.push(`/trips/${trip.id}/competition/setup`)}
            className="mt-2 flex w-full items-center justify-center gap-1.5 rounded-lg border py-1.5 text-xs transition-colors hover:bg-[var(--color-bt-hover)]"
            style={{ borderColor: "var(--color-bt-border)", color: "var(--color-bt-accent)" }}
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
          style={{ color: "var(--color-bt-text-dim)" }}
        >
          Teams ({teams.length})
        </h2>

        {teams.length === 0 ? (
          <p className="text-sm" style={{ color: "var(--color-bt-text-dim)" }}>
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
                style={{ background: "var(--color-bt-card)", border: "1px solid var(--color-bt-border)" }}
              >
                <div
                  className="h-3 w-3 flex-shrink-0 rounded-full"
                  style={{ background: team.color ?? "var(--color-bt-text-dim)" }}
                />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium" style={{ color: "var(--color-bt-text)" }}>
                    {team.name}
                  </p>
                  <p className="text-xs" style={{ color: "var(--color-bt-text-dim)" }}>
                    {team.short_name}
                  </p>
                </div>
                <Users size={14} style={{ color: "var(--color-bt-text-dim)" }} />
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Rounds */}
      <section>
        <h2
          className="mb-3 text-sm font-semibold uppercase tracking-wider"
          style={{ color: "var(--color-bt-text-dim)" }}
        >
          Rounds ({rounds.length})
        </h2>

        {rounds.length === 0 ? (
          <p className="text-sm" style={{ color: "var(--color-bt-text-dim)" }}>
            No rounds yet.{" "}
            {canEdit && "Add rounds from the competition setup."}
          </p>
        ) : (
          <div className="space-y-2">
            {rounds.map((round) => {
              const statusColor =
                round.status === "active" ? "var(--color-bt-accent)"
                  : round.status === "submitted" ? "var(--color-bt-warning)"
                    : round.status === "closed" ? "var(--color-bt-text-dim)"
                      : "var(--color-bt-text-dim)";

              return (
                <div
                  key={round.id}
                  data-testid={`round-${round.id}`}
                  className="rounded-xl px-4 py-3"
                  style={{
                    background: "var(--color-bt-card)",
                    border: "1px solid var(--color-bt-border)",
                    borderLeft: `3px solid ${statusColor}`,
                  }}
                >
                  <div className="flex items-center justify-between">
                    <p className="text-sm font-medium" style={{ color: "var(--color-bt-text)" }}>
                      {round.title}
                    </p>
                    <StatusPill status={round.status} />
                  </div>
                  <div
                    className="mt-1 flex gap-3 text-xs"
                    style={{ color: "var(--color-bt-text-dim)" }}
                  >
                    <span>{round.course}</span>
                    <span>{FORMAT_LABEL[round.format] ?? round.format}</span>
                    {round.points_available > 0 && (
                      <span>{round.points_available} pts</span>
                    )}
                  </div>

                  {/* Close Round button for submitted rounds (owner/planner only) */}
                  {canEdit && round.status === "submitted" && (
                    <button
                      data-testid={`close-round-${round.id}`}
                      onClick={() =>
                        closeRound.mutate({
                          roundId: round.id,
                          tripId: trip.id,
                          status: "closed",
                        })
                      }
                      disabled={closeRound.isPending}
                      className="mt-2 flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-opacity disabled:opacity-50"
                      style={{ background: "var(--color-bt-accent-faint)", color: "var(--color-bt-accent)" }}
                    >
                      <CheckCircle size={12} />
                      Close Round
                    </button>
                  )}

                  {round.status === "closed" && (
                    <div className="mt-2 flex items-center gap-1 text-xs" style={{ color: "var(--color-bt-text-dim)" }}>
                      <Lock size={10} />
                      Officially closed
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
