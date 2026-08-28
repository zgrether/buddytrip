"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronDown, ChevronRight, Zap, Swords } from "lucide-react";
import {
  readAllQuickGames,
  quickGameSubtitle,
  QUICK_GAME_LABEL,
  QUICK_GAME_TILE_FORMATS,
  type QuickGameFormat,
  type QuickGameState,
} from "@/lib/quickGame";
import { compareActive, comparePast, compareIdea } from "@/lib/tripSort";
import { HelperCards } from "@/components/HelperCards";
import { QuickGameSetupSheet } from "@/components/games/quick/QuickGameSetupSheet";
import { trpc } from "@/lib/trpc-client";
import { AppShell } from "@/components/shell/AppShell";
import { TopNav } from "@/components/TopNav";
import { useMyTeamColor } from "@/hooks/useMyTeamColor";
import { TripCard } from "@/components/TripCard";
import { AuthenticatedEmptyState } from "@/components/AuthenticatedEmptyState";
import { CreateTripModal } from "@/components/trips/CreateTripModal";
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
  // Ordering comes from `@/lib/tripSort`, shared with the desktop rail — the
  // two surfaces render the same trips and must not disagree about their order.
  // `now` and `upcoming` are separate SECTIONS here and one merged "Active"
  // section in the rail; that difference is in the partitioning, not in the
  // comparator, so both take `compareActive`.
  //
  // This changes `now` from soonest-ENDING to soonest-STARTING. "By date,
  // soonest first" is one rule across the whole Active set, and a two-key
  // ordering that flipped at the now/upcoming boundary could not be applied to
  // the rail's merged section at all.
  sections.now.sort(compareActive);
  sections.upcoming.sort(compareActive);
  sections.idea.sort(compareIdea);
  sections.past.sort(comparePast);
  return sections;
}

export default function DashboardClient({ lastTripId }: { lastTripId: string | null }) {
  const router = useRouter();
  const [pastExpanded, setPastExpanded] = useState(false);
  /**
   * The create flow, as a modal over Home. No pre-selected path (item 4): the
   * dashboard's "New trip" and the empty state are generic entry points — unlike
   * the rail's per-list "+", they carry no signal about which path the user
   * wants, so they still show the unselected pair.
   */
  const [creating, setCreating] = useState(false);
  /** Which format's setup sheet is open, if any (§3). Null = none. */
  const [setupFormat, setSetupFormat] = useState<QuickGameFormat | null>(null);

  /**
   * Quick Golf Games — one tile per format (§1 of the per-format-slots
   * redesign), read from local storage, the ONLY place this state lives (no
   * DB, no tRPC). `readAllQuickGames` returns whatever's saved for EACH format
   * in one call, so this and the rail's list can't enumerate "what's in
   * progress" two different, driftable ways.
   *
   * A tile's OWN label (`QUICK_GAME_LABEL[format]`) never depends on whether
   * anything is saved for it — that's the fix for the bug this redesign
   * replaces rather than patches: the single card used to announce whatever
   * format happened to be saved (or "Quick Stroke Play" by default when
   * nothing was), so an empty entry point promised a specific format behind
   * what was actually a picker. Two tiles, each always named for what it is,
   * removes the case where a label can be wrong.
   *
   * Initialized empty (not read synchronously) and corrected in an effect, not
   * a `useState` initializer — `localStorage` is undefined during SSR, and
   * reading it on the client's first render would mismatch whatever the server
   * sent. Same reasoning `/quick-game` itself documents for its own
   * resume-from-storage read.
   */
  const [quickGames, setQuickGames] = useState<Partial<Record<QuickGameFormat, QuickGameState>>>({});
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setQuickGames(readAllQuickGames());
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
      topBar={() => (
        <TopNav
          title="BuddyTrip"
          avatarTeamColor={myTeamColor}
        />
      )}
      home={

      <main
        className="mx-auto max-w-[896px] px-4 pb-24 pt-4"
      >
        {/* Quick Golf Games — a user-level scratch section, relocated here from
            the app header (which is trip/competition-scoped). Always
            available on the dashboard, regardless of trip context and ABOVE
            the "My Trips" heading (#879 item 1d) — it isn't a trip, and
            sitting inside that section read as one.
            ONE TILE PER FORMAT, not one slot behind a picker (the redesign
            this replaces): each tile IS its format, labeled by what it is
            whether or not a round is saved, and either starts one or resumes
            one. `data-testid="quick-game-strip"` stays on the SECTION
            wrapper (not either tile) so `e2e/slow-paths-latency.spec.ts`'s
            existing "dashboard has painted" marker keeps working — it only
            ever used this element's PRESENCE as a settle signal, never its
            content. */}
        {/* Welcome line, above everything (§1). Split from the "My Trips"
            header it used to sit on: it greets the PERSON, so it belongs at
            the top of their page rather than introducing one section of it.
            Still gated on having trips — the empty state has its own centered
            CTA and does not want a second greeting above it. */}
        {hasAnyTrips && (
          <p className="mb-4 text-sm" style={{ color: "var(--color-bt-text-dim)" }}>
            Welcome back{me?.name ? `, ${me.name.split(" ")[0]}` : ""}
          </p>
        )}

        {/* MOBILE ONLY (#1088). Quick Play is a phone-in-your-pocket surface:
            you are on a course, not at a laptop. Hidden from `lg` up rather
            than removed — the route still resolves, so a round started on a
            phone opens if its URL is pasted into a browser, and a tablet on a
            cart still gets it. `lg` is the same threshold `TopNav` treats as
            desktop, so "desktop" means one thing. */}
        <div className="mb-6 lg:hidden" data-testid="quick-game-strip">
          {/* Same treatment as "My Trips" (§1) — these are two peer sections of
              one page, and a small-caps eyebrow over one of them read as a
              subheading of whatever came before it. */}
          <h2 className="mb-2 text-2xl font-bold" style={{ color: "var(--color-bt-text)" }}>
            Quick Games
          </h2>
          <div className="grid grid-cols-2 gap-3">
            {QUICK_GAME_TILE_FORMATS.map((format) => {
              const Icon = format === "match" ? Swords : Zap;
              const saved = quickGames[format] ?? null;
              return (
                <button
                  key={format}
                  /* §3 — the tile opens the add/edit sheet over the dashboard
                     rather than navigating to a setup page. Add when this
                     format has no saved round, edit when it does; the sheet
                     reads which for itself. Starting or resuming is what
                     navigates. */
                  onClick={() => setSetupFormat(format)}
                  data-testid={`quick-game-tile-${format}`}
                  className="flex flex-col items-start gap-2 rounded-xl px-4 py-3.5 text-left transition-all duration-100 hover:opacity-90 active:scale-[0.98] active:opacity-80"
                  style={{ background: "var(--color-bt-card)", border: "1px solid var(--color-bt-border)" }}
                >
                  <span
                    className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl"
                    style={{ background: "var(--color-bt-accent-faint)", color: "var(--color-bt-accent)" }}
                  >
                    <Icon size={20} />
                  </span>
                  <div className="w-full min-w-0">
                    <div className="text-[14px] font-semibold" style={{ color: "var(--color-bt-text)" }}>
                      {QUICK_GAME_LABEL[format]}
                    </div>
                    {/* No second line at all when nothing's saved — the pitch
                        line ("Keep score right now…") added a row of text no
                        tile needed. When a round IS in progress, this WRAPS
                        (no `truncate`) rather than pushing past the tile: with
                        `items-start` on the button, a flex child sizes to its
                        OWN content unless explicitly given `w-full` (above) —
                        without it, a subtitle longer than the tile just grew
                        past the button's edge instead of clipping or wrapping
                        inside it. */}
                    {saved && (
                      <div className="mt-0.5 text-[12px] leading-snug" style={{ color: "var(--color-bt-text-dim)" }}>
                        {quickGameSubtitle(saved)}
                      </div>
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* ── Header — hidden when the user has no trips. The empty
            state has its own centered "New trip" CTA, so the welcome
            line + header button would just be redundant chrome. */}
        {hasAnyTrips && (
          <div className="mb-6 flex items-end justify-between">
            <h1 className="text-2xl font-bold" style={{ color: "var(--color-bt-text)" }}>
              My Trips
            </h1>
            <button
              onClick={() => setCreating(true)}
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
            <AuthenticatedEmptyState onNewTrip={() => setCreating(true)} />
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

        {/* The create flow, over Home rather than instead of it. */}
        {creating && <CreateTripModal onClose={() => setCreating(false)} />}
        {/* Quick Game setup — the add/edit sheet the tiles open (§3). Mounted
            here so the dashboard stays behind it: setting up a round is a task
            over the page you came from, not a place you navigate to. */}
        {setupFormat && (
          <QuickGameSetupSheet
            format={setupFormat}
            onClose={() => {
              setSetupFormat(null);
              // The sheet may have written a round (an edit that changed the
              // roster); re-read so the tiles show the truth on dismiss.
              setQuickGames(readAllQuickGames());
            }}
            navigatesOnCommit
            onStarted={(f) => {
              // REPLACE, and do NOT unmount the sheet first.
              //
              // Both halves matter. The sheet holds a phantom history entry so
              // Android back closes it; unmounting it runs a cleanup whose
              // `history.back()` raced this navigation and undid it, so Start /
              // Resume round read as doing nothing at all. `navigatesOnCommit`
              // hands that entry over instead of popping it, and `replace`
              // spends it on the round — so back from the round returns here
              // rather than to a dead entry. The route change is what unmounts
              // the sheet; nothing needs to close it by hand.
              router.replace(`/quick-game?format=${f}`);
            }}
          />
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
