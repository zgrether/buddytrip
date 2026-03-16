"use client";

import { useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { ArrowLeft, MapPin, Calendar, MoreHorizontal } from "lucide-react";
import { trpc } from "@/lib/trpc-client";
import { useTripRole } from "@/hooks/useTripRole";
import { TripBottomNav, type TabId } from "@/components/BottomNav";
import { TripTabBar } from "@/components/TripTabBar";
import { StatusBadge, getTripStatus } from "@/components/StatusBadge";
import { LocationHero } from "@/components/LocationHero";
import { TripSettingsModal } from "@/components/TripSettingsModal";
import { HomeTab } from "./tabs/HomeTab";
import { ScheduleTab } from "./tabs/ScheduleTab";
import { CrewTab } from "./tabs/CrewTab";
import { CompTab } from "./tabs/CompTab";
import { formatDateRange } from "@/lib/dates";

export default function TripDetailPage() {
  const { tripId } = useParams<{ tripId: string }>();
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<TabId>("home");
  const [showSettings, setShowSettings] = useState(false);

  // ── Data ──────────────────────────────────────────────────────────────────
  const {
    data: trip,
    isLoading,
    error,
  } = trpc.trips.getById.useQuery({ tripId });

  const { role, isOwner, canEdit } = useTripRole(tripId);

  // ── Loading ───────────────────────────────────────────────────────────────
  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div
          className="h-8 w-8 animate-spin rounded-full border-2"
          style={{ borderColor: "var(--color-bt-accent)", borderTopColor: "transparent" }}
        />
      </div>
    );
  }

  if (error || !trip) {
    return (
      <div className="flex min-h-screen items-center justify-center px-4">
        <div className="text-center">
          <p className="text-lg font-semibold" style={{ color: "var(--color-bt-text)" }}>
            Trip not found
          </p>
          <button
            onClick={() => router.push("/dashboard")}
            className="mt-4 text-sm"
            style={{ color: "var(--color-bt-accent)" }}
          >
            Back to Dashboard
          </button>
        </div>
      </div>
    );
  }

  const status = getTripStatus(trip);
  const isLocked = !!trip.locked_destination_title;
  const destLocation = trip.locked_destination_location ?? trip.location;
  const hasDates = !!(trip.start_date || trip.end_date);

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div
      className="min-h-screen"
      style={{ background: "var(--color-bt-base)", color: "var(--color-bt-text)" }}
    >
      {/* ── Top bar (back button) ─────────────────────────────────────────── */}
      <div
        className="sticky top-0 z-40"
        style={{ background: "var(--color-bt-base)" }}
      >
        <div className="flex h-12 items-center justify-between px-4">
          <button
            onClick={() => router.push("/dashboard")}
            className="flex h-9 w-9 items-center justify-center rounded-full transition-colors hover:bg-[var(--color-bt-hover)]"
            style={{ color: "var(--color-bt-text)" }}
            aria-label="Back to dashboard"
          >
            <ArrowLeft size={20} />
          </button>

          {isOwner && (
            <button
              data-testid="trip-settings-btn"
              onClick={() => setShowSettings(true)}
              className="flex h-9 w-9 items-center justify-center rounded-full transition-colors hover:bg-[var(--color-bt-hover)]"
              style={{ color: "var(--color-bt-text-dim)" }}
              aria-label="Trip settings"
            >
              <MoreHorizontal size={20} />
            </button>
          )}
        </div>
      </div>

      {/* ── Trip header card ──────────────────────────────────────────────── */}
      <div className="mx-auto max-w-lg px-4">
        {/* LocationHero when locked */}
        {isLocked && destLocation && (
          <LocationHero
            location={destLocation}
            tripName={trip.title}
          />
        )}

        {/* Trip info */}
        <div className={isLocked && destLocation ? "mt-3" : ""}>
          <div className="flex items-center gap-2">
            <h1
              data-testid="trip-title"
              className="text-lg font-bold"
              style={{ color: "var(--color-bt-text)" }}
            >
              {trip.title}
            </h1>
            <StatusBadge status={status} />
          </div>

          {/* Destination + dates sub-line */}
          <div
            className="mt-1 flex flex-wrap items-center gap-3 text-xs"
            style={{ color: "var(--color-bt-text-dim)" }}
          >
            {isLocked ? (
              <span className="flex items-center gap-1">
                <MapPin size={11} />
                {trip.locked_destination_title}
                {destLocation && destLocation !== trip.locked_destination_title && `, ${destLocation}`}
              </span>
            ) : trip.location ? (
              <span className="flex items-center gap-1">
                <MapPin size={11} />
                {trip.location}
              </span>
            ) : (
              <span style={{ color: "var(--color-bt-text-dim)" }}>
                Destination: TBD
              </span>
            )}

            {hasDates ? (
              <span className="flex items-center gap-1">
                <Calendar size={11} />
                {formatDateRange(trip.start_date, trip.end_date)}
              </span>
            ) : (
              <span style={{ color: "var(--color-bt-text-dim)" }}>
                Dates: TBD
              </span>
            )}
          </div>

          {/* Description */}
          {trip.description && (
            <p className="mt-2 text-xs" style={{ color: "var(--color-bt-text-dim)" }}>
              {trip.description}
            </p>
          )}
        </div>

        {/* ── Tab bar (inline, in body) ────────────────────────────────────── */}
        <div className="mt-4">
          <TripTabBar activeTab={activeTab} onTabChange={setActiveTab} />
        </div>
      </div>

      {/* ── Tab content ──────────────────────────────────────────────────── */}
      <main className="mx-auto max-w-lg pb-24 pt-4">
        {activeTab === "home" && (
          <HomeTab
            trip={trip}
            role={role}
            canEdit={canEdit}
            isOwner={isOwner}
            onTabChange={(tab) => setActiveTab(tab as TabId)}
          />
        )}
        {activeTab === "schedule" && (
          <ScheduleTab trip={trip} role={role} canEdit={canEdit} isOwner={isOwner} />
        )}
        {activeTab === "crew" && (
          <CrewTab trip={trip} role={role} canEdit={canEdit} isOwner={isOwner} />
        )}
        {activeTab === "comp" && (
          <CompTab trip={trip} role={role} canEdit={canEdit} isOwner={isOwner} />
        )}
      </main>

      {/* ── Bottom navigation (Trip context) ──────────────────────────────── */}
      <TripBottomNav tripId={tripId} eventId={trip.event_id} />

      {/* ── Settings modal ─────────────────────────────────────────────────── */}
      {showSettings && (
        <TripSettingsModal
          trip={trip}
          isOwner={isOwner}
          canEdit={canEdit}
          onClose={() => setShowSettings(false)}
        />
      )}
    </div>
  );
}
