"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, ChevronDown, ChevronRight, Plane } from "lucide-react";
import { trpc } from "@/lib/trpc-client";
import { TopNav } from "@/components/TopNav";
import { TripCard } from "@/components/TripCard";
import { getTripStatus, type TripStatus } from "@/components/StatusBadge";
import type { TripRole } from "@/server/middleware";

interface TripRow {
  id: string;
  title: string;
  location?: string | null;
  start_date?: string | null;
  end_date?: string | null;
  locked_destination_title?: string | null;
  myRole?: TripRole | null;
  myStatus?: string | null;
  created_at?: string | null;
}

type NotificationItem = {
  id: string;
  type: string;
  trip_id: string;
  created_at: string;
  read: boolean;
  payload?: Record<string, unknown>;
};

function partitionTrips(trips: TripRow[]): Record<TripStatus, TripRow[]> {
  const sections: Record<TripStatus, TripRow[]> = {
    live: [],
    ready: [],
    upcoming: [],
    past: [],
  };
  for (const trip of trips) {
    sections[getTripStatus(trip)].push(trip);
  }
  return sections;
}

export default function DashboardPage() {
  const router = useRouter();
  const [pastExpanded, setPastExpanded] = useState(false);

  // ── Trips ──────────────────────────────────────────────────────────────────
  const { data: trips = [], isLoading: tripsLoading } =
    trpc.trips.list.useQuery();

  const tripIds = trips.map((t) => t.id);

  // ── Notifications (parallel per-trip) ─────────────────────────────────────
  const notifResults = trpc.useQueries((t) =>
    tripIds.map((id) => t.notifications.list({ tripId: id, limit: 20 }))
  );

  const allNotifications: NotificationItem[] = notifResults
    .flatMap((r) => r.data ?? [])
    .sort(
      (a, b) =>
        new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    );

  const unreadByTrip = new Map<string, number>();
  for (const n of allNotifications) {
    if (!n.read) {
      unreadByTrip.set(n.trip_id, (unreadByTrip.get(n.trip_id) ?? 0) + 1);
    }
  }
  const totalUnread = allNotifications.filter((n) => !n.read).length;

  // ── Mark all read ──────────────────────────────────────────────────────────
  const utils = trpc.useUtils();
  const markAllReadMutations = tripIds.map((id) =>
    trpc.notifications.markAllRead.useMutation({
      onSuccess: () => {
        utils.notifications.list.invalidate({ tripId: id });
      },
    })
  );

  const handleMarkAllRead = () => {
    markAllReadMutations.forEach((m, i) => {
      if ((unreadByTrip.get(tripIds[i]) ?? 0) > 0) {
        m.mutate({ tripId: tripIds[i] });
      }
    });
  };

  // ── Partition ──────────────────────────────────────────────────────────────
  const sections = partitionTrips(trips as TripRow[]);

  if (tripsLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div
          className="h-8 w-8 animate-spin rounded-full border-2 border-t-transparent"
          style={{ borderColor: "#00d4aa", borderTopColor: "transparent" }}
        />
      </div>
    );
  }

  const hasAnyTrips = trips.length > 0;

  return (
    <div
      className="min-h-screen"
      style={{ background: "#0d1117", color: "#e6edf3" }}
    >
      <TopNav
        title="BuddyTrip"
        showAdd
        notifications={allNotifications}
        unreadCount={totalUnread}
        onMarkAllRead={handleMarkAllRead}
      />

      <main className="mx-auto max-w-lg px-4 pb-24 pt-4">
        {!hasAnyTrips ? (
          /* ── Empty state ─────────────────────────────────────────────────── */
          <div
            data-testid="empty-state"
            className="mt-16 flex flex-col items-center gap-4 text-center"
          >
            <div
              className="flex h-20 w-20 items-center justify-center rounded-full"
              style={{ background: "#161b22" }}
            >
              <Plane size={36} style={{ color: "#00d4aa" }} />
            </div>
            <h2
              className="text-xl font-semibold"
              style={{ color: "#e6edf3" }}
            >
              No trips yet
            </h2>
            <p className="max-w-xs text-sm" style={{ color: "#8b949e" }}>
              Create your first group trip and start planning together.
            </p>
            <button
              data-testid="create-first-trip"
              onClick={() => router.push("/trips/new")}
              className="mt-2 flex items-center gap-2 rounded-xl px-6 py-3 text-sm font-semibold transition-opacity hover:opacity-90"
              style={{ background: "#00d4aa", color: "#0d1117" }}
            >
              <Plus size={18} />
              Create a Trip
            </button>
          </div>
        ) : (
          /* ── Trip sections ───────────────────────────────────────────────── */
          <div className="space-y-6">
            <TripSection
              label="Live"
              trips={sections.live}
              unreadByTrip={unreadByTrip}
            />
            <TripSection
              label="Ready"
              trips={sections.ready}
              unreadByTrip={unreadByTrip}
            />
            <TripSection
              label="Upcoming"
              trips={sections.upcoming}
              unreadByTrip={unreadByTrip}
            />

            {/* Past — collapsible */}
            {sections.past.length > 0 && (
              <div>
                <button
                  data-testid="past-toggle"
                  onClick={() => setPastExpanded((p) => !p)}
                  className="flex w-full items-center justify-between py-2"
                >
                  <span
                    className="text-sm font-semibold uppercase tracking-wider"
                    style={{ color: "#8b949e" }}
                  >
                    Past ({sections.past.length})
                  </span>
                  {pastExpanded ? (
                    <ChevronDown size={16} style={{ color: "#8b949e" }} />
                  ) : (
                    <ChevronRight size={16} style={{ color: "#8b949e" }} />
                  )}
                </button>
                {pastExpanded && (
                  <div className="mt-2 space-y-3">
                    {sections.past.map((trip) => (
                      <TripCard
                        key={trip.id}
                        trip={trip}
                        unreadCount={unreadByTrip.get(trip.id) ?? 0}
                      />
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </main>

      {/* FAB — create new trip */}
      {hasAnyTrips && (
        <button
          data-testid="fab-new-trip"
          onClick={() => router.push("/trips/new")}
          className="fixed bottom-6 right-4 flex h-14 w-14 items-center justify-center rounded-full shadow-lg transition-opacity hover:opacity-90"
          style={{ background: "#00d4aa" }}
          aria-label="New trip"
        >
          <Plus size={24} style={{ color: "#0d1117" }} />
        </button>
      )}
    </div>
  );
}

// ── Section component ──────────────────────────────────────────────────────
function TripSection({
  label,
  trips,
  unreadByTrip,
}: {
  label: string;
  trips: TripRow[];
  unreadByTrip: Map<string, number>;
}) {
  if (trips.length === 0) return null;
  return (
    <section>
      <h2
        data-testid={`section-${label.toLowerCase()}`}
        className="mb-3 text-sm font-semibold uppercase tracking-wider"
        style={{ color: "#8b949e" }}
      >
        {label}
      </h2>
      <div className="space-y-3">
        {trips.map((trip) => (
          <TripCard
            key={trip.id}
            trip={trip}
            unreadCount={unreadByTrip.get(trip.id) ?? 0}
          />
        ))}
      </div>
    </section>
  );
}
