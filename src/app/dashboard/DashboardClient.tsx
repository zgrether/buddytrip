"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronDown, ChevronRight } from "lucide-react";
import { trpc } from "@/lib/trpc-client";
import { TopNav } from "@/components/TopNav";
import { TripCard } from "@/components/TripCard";
import { AuthenticatedEmptyState } from "@/components/AuthenticatedEmptyState";
import { getTripStatus, type TripStatus } from "@/components/StatusBadge";
import type { TripRole } from "@/server/middleware";

interface TripRow {
  id: string;
  title: string;
  location?: string | null;
  start_date?: string | null;
  end_date?: string | null;
  /** Real-world location string ("Bandon, OR"); preferred over the cute idea title. */
  locked_destination_location?: string | null;
  locked_destination_title?: string | null;
  trip_status_override?: string | null;
  stage?: string | null;
  saved_at?: string | null;
  updated_at?: string | null;
  myRole?: TripRole | null;
  myStatus?: string | null;
  created_at?: string | null;
}

function partitionTrips(trips: TripRow[]): Record<TripStatus, TripRow[]> {
  const sections: Record<TripStatus, TripRow[]> = {
    idea: [],
    planning: [],
    going: [],
    now: [],
    past: [],
    saved: [],
  };
  for (const trip of trips) {
    sections[getTripStatus(trip)].push(trip);
  }
  // now: soonest-ending first; going: soonest-starting first
  sections.now.sort((a, b) =>
    (a.end_date ?? "").localeCompare(b.end_date ?? "")
  );
  sections.going.sort((a, b) =>
    (a.start_date ?? "").localeCompare(b.start_date ?? "")
  );
  // planning + idea: most recently updated first
  sections.planning.sort((a, b) =>
    (b.updated_at ?? b.created_at ?? "").localeCompare(a.updated_at ?? a.created_at ?? "")
  );
  sections.idea.sort((a, b) =>
    (b.updated_at ?? b.created_at ?? "").localeCompare(a.updated_at ?? a.created_at ?? "")
  );
  sections.past.sort((a, b) =>
    (b.end_date ?? "").localeCompare(a.end_date ?? "")
  );
  sections.saved.sort((a, b) =>
    (b.saved_at ?? "").localeCompare(a.saved_at ?? "")
  );
  return sections;
}

export default function DashboardClient() {
  const router = useRouter();
  const [pastExpanded, setPastExpanded] = useState(false);

  // ── Current user ──────────────────────────────────────────────────────────
  const { data: me } = trpc.users.getMe.useQuery();

  // ── Trips ──────────────────────────────────────────────────────────────────
  const { data: trips = [], isLoading: tripsLoading } =
    trpc.trips.list.useQuery();

  // ── Partition ──────────────────────────────────────────────────────────────
  const sections = partitionTrips(trips as TripRow[]);

  if (tripsLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div
          className="h-8 w-8 animate-spin rounded-full border-2 border-t-transparent"
          style={{ borderColor: "var(--color-bt-accent)", borderTopColor: "transparent" }}
        />
      </div>
    );
  }

  const hasAnyTrips = trips.length > 0;

  return (
    <div
      className="min-h-screen"
      style={{ background: "var(--color-bt-base)", color: "var(--color-bt-text)" }}
    >
      {/* News is a trip-scoped broadcast surface — hide it on the
          dashboard, which spans all trips and has no single trip context. */}
      <TopNav title="BuddyTrip" hideNews />

      <main
        className={`mx-auto max-w-[896px] px-4 pb-24 ${hasAnyTrips ? "pt-4" : ""}`}
      >
        {/* ── Header — hidden when the user has no trips. The empty
            state has its own centered "New trip" CTA, so the welcome
            line + header button would just be redundant chrome. */}
        {hasAnyTrips && (
          <div className="mb-6 flex items-end justify-between">
            <div>
              <p className="text-sm" style={{ color: "var(--color-bt-text-dim)" }}>
                Welcome back{me?.name ? `, ${me.name.split(" ")[0]}` : ""}
              </p>
              <h1 className="text-2xl font-bold" style={{ color: "var(--color-bt-text)" }}>
                My Trips
              </h1>
            </div>
            <button
              onClick={() => router.push("/trips/new")}
              className="flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold transition-opacity hover:opacity-90"
              style={{ background: "var(--color-bt-accent)", color: "var(--color-bt-base)" }}
            >
              New trip
            </button>
          </div>
        )}

        {!hasAnyTrips ? (
          /* ── Empty state ─────────────────────────────────────────────────
             Single source of truth — root `/` redirects here when authed
             with no trips, and a direct `/dashboard` visit shows the
             same body. */
          <div data-testid="empty-state">
            <AuthenticatedEmptyState />
          </div>
        ) : (
          /* ── Trip sections ───────────────────────────────────────────────── */
          <div className="space-y-6">
            {/* NOW — pinned at top when trips are happening */}
            {sections.now.length > 0 && (
              <TripSection
                label="Now"
                trips={sections.now}
                labelColor="var(--color-bt-warning)"
              />
            )}

            {/* Active — groups PLANNING + GOING (idea trips have their own
                "Ideas" section below so they don't disappear into the main flow). */}
            <TripSection
              label="Active"
              trips={[...sections.going, ...sections.planning]}
            />

            {/* Ideas — trips still in the idea/comparison phase */}
            {sections.idea.length > 0 && (
              <TripSection
                label="Ideas"
                trips={sections.idea}
              />
            )}

            {/* Past — collapsible */}
            {sections.past.length > 0 && (
              <div>
                <button
                  data-testid="past-toggle"
                  onClick={() => setPastExpanded((p) => !p)}
                  className="flex w-full items-center justify-between py-2"
                >
                  <span
                    className="text-sm font-semibold uppercase tracking-widest"
                    style={{ color: "var(--color-bt-text-dim)" }}
                  >
                    Past ({sections.past.length})
                  </span>
                  {pastExpanded ? (
                    <ChevronDown size={16} style={{ color: "var(--color-bt-text-dim)" }} />
                  ) : (
                    <ChevronRight size={16} style={{ color: "var(--color-bt-text-dim)" }} />
                  )}
                </button>
                {pastExpanded && (
                  <div className="mt-2 space-y-3">
                    {sections.past.map((trip) => (
                      <TripCard key={trip.id} trip={trip} />
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </main>


    </div>
  );
}

// ── Section component ──────────────────────────────────────────────────────
function TripSection({
  label,
  trips,
  labelColor,
}: {
  label: string;
  trips: TripRow[];
  labelColor?: string;
}) {
  if (trips.length === 0) return null;
  return (
    <section>
      <h2
        data-testid={`section-${label.toLowerCase()}`}
        className="mb-3 text-sm font-semibold uppercase tracking-widest"
        style={{ color: labelColor ?? "var(--color-bt-text-dim)" }}
      >
        {label}
      </h2>
      <div className="space-y-3">
        {trips.map((trip) => (
          <TripCard key={trip.id} trip={trip} />
        ))}
      </div>
    </section>
  );
}
