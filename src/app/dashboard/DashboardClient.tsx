"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronDown, ChevronRight, Zap } from "lucide-react";
import { readQuickGameState, quickGameSubtitle } from "@/lib/quickGame";
import { HelperCards } from "@/components/HelperCards";
import { trpc } from "@/lib/trpc-client";
import { AppShell } from "@/components/shell/AppShell";
import { TopNav } from "@/components/TopNav";
import { useMyTeamColor } from "@/hooks/useMyTeamColor";
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
  locked_destination_at?: string | null;
  updated_at?: string | null;
  myRole?: TripRole | null;
  myStatus?: string | null;
  created_at?: string | null;
}

function partitionTrips(trips: TripRow[]): Record<TripStatus, TripRow[]> {
  const sections: Record<TripStatus, TripRow[]> = {
    idea: [],
    upcoming: [],
    now: [],
    past: [],
  };
  for (const trip of trips) {
    sections[getTripStatus(trip)].push(trip);
  }
  // now: soonest-ending first; upcoming: soonest-starting first
  sections.now.sort((a, b) =>
    (a.end_date ?? "").localeCompare(b.end_date ?? "")
  );
  sections.upcoming.sort((a, b) =>
    (a.start_date ?? "").localeCompare(b.start_date ?? "")
  );
  // idea: most recently updated first
  sections.idea.sort((a, b) =>
    (b.updated_at ?? b.created_at ?? "").localeCompare(a.updated_at ?? a.created_at ?? "")
  );
  sections.past.sort((a, b) =>
    (b.end_date ?? "").localeCompare(a.end_date ?? "")
  );
  return sections;
}

export default function DashboardClient({ lastTripId }: { lastTripId: string | null }) {
  const router = useRouter();
  const [pastExpanded, setPastExpanded] = useState(false);

  /**
   * Quick Stroke Play card subtitle (#879 item 1c) — read from local storage,
   * the ONLY place this game's state lives (no DB, no tRPC). Initialized to the
   * no-saved-game default (`quickGameSubtitle(null)`) and corrected in an
   * effect, not a `useState` initializer — `localStorage` is undefined during
   * SSR, and reading it synchronously on the client's first render would
   * mismatch whatever the server sent. Same reasoning `/quick-game` itself
   * documents for its own resume-from-storage read.
   */
  const [quickGameCardSubtitle, setQuickGameCardSubtitle] = useState(() => quickGameSubtitle(null));
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setQuickGameCardSubtitle(quickGameSubtitle(readQuickGameState()));
  }, []);

  // ── Current user ──────────────────────────────────────────────────────────
  const { data: me } = trpc.users.getMe.useQuery();

  /**
   * ── Trips ────────────────────────────────────────────────────────────────
   *
   * This observer DELIBERATELY inherits the global 60s `staleTime` while
   * `ContextRail` overrides the same key with `STRUCTURE_QUERY`
   * (`staleTime: Infinity`). That difference is intentional and load-bearing,
   * not drift left behind (#764) — the two are a pair, and this is the half
   * that keeps the shared cache moving.
   *
   * All three `trips.list` observers resolve to ONE React Query key, so the
   * effective freshness of the key is set by whichever mounted observer has the
   * shortest `staleTime`. Under `staleTime: Infinity` nothing is ever stale and
   * `refetchOnMount` is gated on staleness, so the rail alone would never
   * refetch inside a session — and the ways this list actually goes stale
   * (being added to or removed from a trip, a role change, another Organizer
   * renaming a trip) are all done by ANOTHER user's client, with no
   * invalidation and no Realtime path to carry them.
   *
   * This observer is what closes that. It is mounted on every Home visit at
   * EVERY width — at `lg+` `AppShell` keeps this tree under `lg:hidden` rather
   * than unmounting it — so returning to Home refreshes the shared cache and
   * the rail reads the result.
   *
   * So: do NOT "converge" this onto `STRUCTURE_QUERY` to make the key
   * consistent. Consistency here would delete the only in-session refresh path
   * the key has. If a long cache is wanted on both, the membership mutations
   * need invalidation FIRST.
   */
  const {
    data: trips = [],
    isLoading: tripsLoading,
    isError: tripsError,
    refetch: refetchTrips,
  } = trpc.trips.list.useQuery();

  // ── Partition ──────────────────────────────────────────────────────────────
  const sections = partitionTrips(trips as TripRow[]);

  /**
   * The context the shell's Trip/Cup/Chat tabs point at while the user is on
   * Home. Home is context-free, but "the trip you were just in" is not — so the
   * tabs stay live and go back to it rather than greying out. Locked is then a
   * genuine first-run state (an account with no trips), not something you hit
   * every time you glance at your trip list.
   *
   * `lastTripId` comes from the server (the same `bt-last-trip-id` cookie the
   * root route redirects on, IA-2) so there's no hydration mismatch and no
   * effect. It is VALIDATED against the user's actual trips here: a pointer at a
   * deleted or revoked trip must not offer tabs that lead nowhere — the same
   * staleness the root route has its own recovery for.
   *
   * No cookie (new device) falls back to the top of the priority sort, which is
   * what this page already surfaces as most relevant.
   */
  const tripRows = trips as TripRow[];
  const priorityOrder = [...sections.now, ...sections.upcoming, ...sections.idea, ...sections.past];
  const remoteTripId =
    (lastTripId && tripRows.some((t) => t.id === lastTripId) ? lastTripId : null) ??
    priorityOrder[0]?.id ??
    null;

  /**
   * The account avatar carries the viewer's TEAM colour on Home too, whenever a
   * current trip is still valid — `remoteTripId` is already exactly that test
   * (validated against the user's real trips just above, so a pointer at a
   * deleted or revoked trip resolves to null and the avatar stays teal).
   *
   * Called before the loading early-return below, so hook order stays stable.
   */
  const myTeamColor = useMyTeamColor(remoteTripId);

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
  const showHelperCards =
    trips.length <= 3 && !(trips as TripRow[]).some((t) => t.myRole === "Owner");

  return (
    /**
     * The dashboard is the HOME tab's host. It is context-free itself, but it
     * passes the last trip as `remoteTripId` so Trip/Cup/Chat stay live and point
     * back at it — Home reads as "switch context", not "leave context". Locked
     * tabs are reserved for a genuinely context-free account (no trips at all).
     */
    <AppShell
      tripId={null}
      remoteTripId={remoteTripId}
      topBar={({ activeView, hasContext, onSelectView }) => (
        <TopNav
          title="BuddyTrip"
          avatarTeamColor={myTeamColor}
          activeView={activeView}
          hasContext={hasContext}
          onSelectView={onSelectView}
        />
      )}
      home={

      <main
        className="mx-auto max-w-[896px] px-4 pb-24 pt-4"
      >
        {/* Quick Stroke Play — a user-level scratch game, relocated here from
            the app header (which is trip/competition-scoped). Always
            available on the dashboard, regardless of trip context and ABOVE
            the "My Trips" heading (#879 item 1d) — it isn't a trip, and
            sitting inside that section read as one. Opens the local
            stroke-play game; a format picker is deferred to the
            standalone-game work (renamed from "Quick Game" in #879 item 1a —
            that name promised a picker this doesn't have). The subtitle
            reflects what's actually saved in local storage (item 1c). */}
        <button
          onClick={() => router.push("/quick-game")}
          data-testid="quick-game-strip"
          className="mb-6 flex w-full items-center gap-3 rounded-xl px-4 py-3.5 text-left transition-opacity hover:opacity-90"
          style={{ background: "var(--color-bt-card)", border: "1px solid var(--color-bt-border)" }}
        >
          <span
            className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl"
            style={{ background: "var(--color-bt-accent-faint)", color: "var(--color-bt-accent)" }}
          >
            <Zap size={20} />
          </span>
          <div className="min-w-0 flex-1">
            <div className="text-[15px] font-semibold" style={{ color: "var(--color-bt-text)" }}>
              Quick Stroke Play
            </div>
            <div className="truncate text-[13px]" style={{ color: "var(--color-bt-text-dim)" }}>
              {quickGameCardSubtitle}
            </div>
          </div>
          <ChevronRight size={18} style={{ color: "var(--color-bt-text-dim)", flexShrink: 0 }} />
        </button>

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

        {tripsError ? (
          /* ── Load failure ────────────────────────────────────────────────
             Checked BEFORE the empty state, and that order is the point
             (#764). `data` is `undefined` on error and this component
             defaults it to `[]`, so a failed fetch used to fall straight
             through to `AuthenticatedEmptyState` — telling a user with trips
             that they have none, complete with the first-run onboarding
             pitch. The two states are now distinguishable. */
          <div role="alert" data-testid="trips-load-error" className="py-16 text-center">
            <p
              className="text-base font-semibold"
              style={{ color: "var(--color-bt-danger)" }}
            >
              Couldn&apos;t load your trips.
            </p>
            <p className="mt-1 text-sm" style={{ color: "var(--color-bt-text-dim)" }}>
              This is a connection problem, not a change to your trips.
            </p>
            <button
              type="button"
              onClick={() => void refetchTrips()}
              className="mt-4 rounded-xl px-4 py-2.5 text-sm font-semibold transition-opacity hover:opacity-90"
              style={{ background: "var(--color-bt-accent)", color: "var(--color-bt-base)" }}
            >
              Try again
            </button>
          </div>
        ) : !hasAnyTrips ? (
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

            {/* Active — upcoming trips (idea trips have their own "Ideas"
                section below so they don't disappear into the main flow). */}
            <TripSection
              label="Active"
              trips={sections.upcoming}
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

        {/* Helper cards — progressive disclosure, deliberately: no trips means you
            need to know what the app does; a few trips you don't own means you were
            invited to things and have never run one, so you still don't; by the
            third you're on your own. The gate is aimed at the right person.

            What is GONE from here is the marketing: a "See how BuddyTrip works →"
            link inside a `min-height: 100vh` spacer, with the full `FeaturesSection`
            below it. Both were gated `hasAnyTrips` — so the pitch appeared ONLY once
            you had trips, and a returning user scrolled past their list into a
            viewport of whitespace and then a marketing page. That is the inverse of
            what the helper cards do one line above, and there is no state in which
            an existing user wants it. */}
        {hasAnyTrips && showHelperCards && (
          <div className="mt-10">
            <HelperCards />
          </div>
        )}
      </main>
      }
    />
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
