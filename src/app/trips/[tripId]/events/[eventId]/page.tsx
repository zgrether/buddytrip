"use client";

import { useParams, useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  CheckCircle2,
  Flag,
  HardHat,
  Star,
} from "lucide-react";
import { trpc } from "@/lib/trpc-client";
import { useTripRole } from "@/hooks/useTripRole";
import {
  loadPlacements,
  savePlacements,
  fmtPts,
} from "@/components/competition/scoreboard-styles/mock-score";
import { ordinal } from "@/components/competition/scoreboard-styles/types";

interface Team {
  id: string;
  name: string;
  short_name: string;
  color: string;
}

interface EventDetail {
  id: string;
  competition_id: string;
  title: string;
  type: "GOLF" | "GENERIC";
  scoring_format: string | null;
  is_practice: boolean;
  points_available: number | null;
  point_distributions?: Array<{ position: number; label: string; points: number }>;
}

/**
 * Event detail page — placeholder while the real scoring backend is
 * still under construction. Renders:
 *   1. A "Full scoring coming soon" empty state with a hard-hat icon
 *   2. A manual placement selector (owner-only) — pick a finishing
 *      place for each team and the scoreboard mock data picks up the
 *      change via localStorage.
 *
 * The placement selector is intentionally minimal: no validation
 * against duplicates (ties are fine), points auto-derived from the
 * event's point_distributions. Persists to localStorage keyed by
 * event id, read by `buildMockData` on the comp tab.
 */
export default function EventDetailPage() {
  const params = useParams();
  const router = useRouter();
  const tripId = String(params.tripId);
  const eventId = String(params.eventId);

  const { isOwner } = useTripRole(tripId);

  const { data: competition } = trpc.competitions.getByTrip.useQuery({ tripId });
  const competitionId = competition?.id;

  const { data: events = [], isLoading: eventsLoading } = trpc.events.list.useQuery(
    { tripId, competitionId: competitionId ?? "" },
    { enabled: !!competitionId }
  );
  const { data: teams = [] } = trpc.teams.list.useQuery(
    { tripId, competitionId: competitionId ?? "" },
    { enabled: !!competitionId }
  );

  const event = (events as EventDetail[]).find((e) => e.id === eventId);
  const teamsTyped = teams as Team[];

  // ── Placement state — lazy-initialized from localStorage so we
  // don't need a setState-in-effect that the React Compiler rejects.
  // SSR/initial-hard-load returns {} (no window); client navigation
  // hydrates with the stored value because lazy init runs at mount.
  const [placements, setPlacements] = useState<Record<string, number>>(
    () => loadPlacements(eventId) ?? {}
  );
  const [savedFlash, setSavedFlash] = useState(false);

  const dists = useMemo(
    () => event?.point_distributions ?? [],
    [event]
  );
  // Number of selectable places — the larger of (team count, configured
  // distributions). Lets the owner assign 4 teams to 4 places even when
  // only 1st/2nd are point-eligible.
  const maxPlaces = Math.max(teamsTyped.length, dists.length, 1);

  const placeOptions = useMemo(
    () =>
      Array.from({ length: maxPlaces }, (_, i) => {
        const place = i + 1;
        const dist = dists.find((d) => d.position === place);
        return { place, points: dist?.points ?? 0 };
      }),
    [maxPlaces, dists]
  );

  // ── Loading / not-found states ─────────────────────────────────────────
  if (!competitionId || eventsLoading) {
    return <PageShell tripId={tripId}><LoadingState /></PageShell>;
  }
  if (!event) {
    return (
      <PageShell tripId={tripId}>
        <div className="px-4 py-8 text-center">
          <p style={{ color: "var(--color-bt-text-dim)" }}>
            That event doesn&rsquo;t exist or has been deleted.
          </p>
          <Link
            href={`/trips/${tripId}`}
            className="mt-4 inline-block text-sm font-semibold"
            style={{ color: "var(--color-bt-accent)" }}
          >
            Back to trip
          </Link>
        </div>
      </PageShell>
    );
  }

  const isGolf = event.type === "GOLF";
  const Icon = isGolf ? Flag : Star;

  function handleChange(teamId: string, place: number) {
    setPlacements((prev) => ({ ...prev, [teamId]: place }));
  }

  function handleSave() {
    savePlacements(eventId, placements);
    setSavedFlash(true);
    setTimeout(() => setSavedFlash(false), 1800);
  }

  function handleSaveAndBack() {
    savePlacements(eventId, placements);
    router.push(`/trips/${tripId}`);
  }

  return (
    <PageShell tripId={tripId}>
      <div className="space-y-6 px-4 pb-12 pt-2">
        {/* Event header */}
        <div>
          <div className="flex items-center gap-3">
            <div
              className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-xl"
              style={{
                background: "var(--color-bt-accent-faint)",
                color: "var(--color-bt-accent)",
              }}
            >
              <Icon size={18} />
            </div>
            <div className="min-w-0">
              <h1
                className="truncate text-xl font-bold"
                style={{ color: "var(--color-bt-text)" }}
              >
                {event.title}
              </h1>
              <p
                className="text-[12px]"
                style={{ color: "var(--color-bt-text-dim)" }}
              >
                {event.is_practice
                  ? "Practice round · not scored"
                  : `${fmtPts(event.points_available ?? 0)} pts available`}
                {event.scoring_format && ` · ${event.scoring_format}`}
              </p>
            </div>
          </div>
        </div>

        {/* Coming-soon empty state */}
        <div
          className="rounded-xl px-5 py-8 text-center"
          style={{
            background: "var(--color-bt-card)",
            border: "1px dashed var(--color-bt-border)",
          }}
        >
          <div
            className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl"
            style={{
              background: "var(--color-bt-card-raised)",
              color: "var(--color-bt-text-dim)",
            }}
          >
            <HardHat size={22} />
          </div>
          <p
            className="mt-3 text-sm font-semibold"
            style={{ color: "var(--color-bt-text)" }}
          >
            Coming soon&hellip;
          </p>
          <p
            className="mx-auto mt-1 max-w-xs text-[12px] leading-relaxed"
            style={{ color: "var(--color-bt-text-dim)" }}
          >
            Live scorecard entry, hole-by-hole tracking, and format-aware
            scoring are still under construction.
          </p>
        </div>

        {/* Placement selector */}
        {!event.is_practice && teamsTyped.length > 0 && (
          <div
            className="overflow-hidden rounded-xl"
            style={{ border: "1px solid var(--color-bt-border)" }}
          >
            <div className="px-4 py-3">
              <p
                className="text-sm font-semibold"
                style={{ color: "var(--color-bt-text)" }}
              >
                Manual placement
              </p>
              <p
                className="mt-0.5 text-[11px]"
                style={{ color: "var(--color-bt-text-dim)" }}
              >
                {isOwner
                  ? "Pick a finish for each team — points come from the event's distribution."
                  : "Only the trip owner can set placements right now."}
              </p>
            </div>

            <div
              className="divide-y"
              style={{ borderTopColor: "var(--color-bt-border)", borderTop: "1px solid var(--color-bt-border)" }}
            >
              {teamsTyped.map((team) => {
                const place = placements[team.id];
                const dist = dists.find((d) => d.position === place);
                const earned = dist?.points ?? 0;
                return (
                  <div
                    key={team.id}
                    className="flex items-center gap-3 px-4 py-2.5"
                    style={{ borderTopColor: "var(--color-bt-border)" }}
                  >
                    <span
                      className="h-3 w-3 flex-shrink-0 rounded-full"
                      style={{ background: team.color }}
                      aria-hidden
                    />
                    <span
                      className="flex-1 truncate text-sm font-medium"
                      style={{ color: "var(--color-bt-text)" }}
                    >
                      {team.name}
                    </span>
                    {place && place > 0 && (
                      <span
                        className="text-[11px] tabular-nums"
                        style={{ color: "var(--color-bt-text-dim)" }}
                      >
                        {fmtPts(earned)} pt{earned === 1 ? "" : "s"}
                      </span>
                    )}
                    <select
                      value={place ?? ""}
                      disabled={!isOwner}
                      onChange={(e) =>
                        handleChange(
                          team.id,
                          e.target.value ? parseInt(e.target.value, 10) : 0
                        )
                      }
                      className="rounded-md px-2 py-1 text-xs"
                      style={{
                        background: "var(--color-bt-card-raised)",
                        color: "var(--color-bt-text)",
                        border: "1px solid var(--color-bt-border)",
                      }}
                      aria-label={`Place for ${team.name}`}
                    >
                      <option value="">— place —</option>
                      {placeOptions.map((opt) => (
                        <option key={opt.place} value={opt.place}>
                          {ordinal(opt.place)} ({fmtPts(opt.points)} pts)
                        </option>
                      ))}
                    </select>
                  </div>
                );
              })}
            </div>

            {isOwner && (
              <div
                className="flex items-center justify-between gap-2 px-4 py-3"
                style={{ borderTop: "1px solid var(--color-bt-border)" }}
              >
                {savedFlash ? (
                  <span
                    className="flex items-center gap-1.5 text-[11px] font-semibold"
                    style={{ color: "var(--color-bt-accent)" }}
                  >
                    <CheckCircle2 size={12} />
                    Saved
                  </span>
                ) : (
                  <span
                    className="text-[11px]"
                    style={{ color: "var(--color-bt-text-dim)" }}
                  >
                    Saved locally — scoreboard updates next time you open the
                    competition tab.
                  </span>
                )}
                <div className="flex flex-shrink-0 gap-2">
                  <button
                    type="button"
                    onClick={handleSave}
                    className="rounded-lg px-3 py-1.5 text-xs font-semibold"
                    style={{
                      background: "var(--color-bt-card-raised)",
                      color: "var(--color-bt-text)",
                      border: "1px solid var(--color-bt-border)",
                    }}
                  >
                    Save
                  </button>
                  <button
                    type="button"
                    onClick={handleSaveAndBack}
                    className="rounded-lg px-3 py-1.5 text-xs font-semibold"
                    style={{
                      background: "var(--color-bt-accent)",
                      color: "var(--color-bt-base)",
                    }}
                  >
                    Save &amp; back
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </PageShell>
  );
}

function PageShell({
  tripId,
  children,
}: {
  tripId: string;
  children: React.ReactNode;
}) {
  return (
    <div
      className="min-h-screen"
      style={{ background: "var(--color-bt-base)" }}
    >
      <div
        className="sticky top-0 z-10 flex items-center gap-2 px-4 py-3"
        style={{
          background: "var(--color-bt-base)",
          borderBottom: "1px solid var(--color-bt-border)",
        }}
      >
        <Link
          href={`/trips/${tripId}`}
          aria-label="Back to trip"
          className="flex h-8 w-8 items-center justify-center rounded-lg"
          style={{ color: "var(--color-bt-text-dim)" }}
        >
          <ArrowLeft size={18} />
        </Link>
        <p
          className="text-xs font-semibold uppercase tracking-wider"
          style={{ color: "var(--color-bt-text-dim)" }}
        >
          Competition · Event
        </p>
      </div>
      {children}
    </div>
  );
}

function LoadingState() {
  return (
    <div className="flex min-h-[40vh] items-center justify-center">
      <div
        className="h-7 w-7 animate-spin rounded-full border-2"
        style={{
          borderColor: "var(--color-bt-accent)",
          borderTopColor: "transparent",
        }}
      />
    </div>
  );
}
