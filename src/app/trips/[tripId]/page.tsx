"use client";

import { useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { ArrowLeft, MapPin, Calendar, Lock } from "lucide-react";
import { trpc } from "@/lib/trpc-client";
import { useTripRole } from "@/hooks/useTripRole";
import { BottomNav, type TabId } from "@/components/BottomNav";
import { StatusBadge, getTripStatus } from "@/components/StatusBadge";
// Tab content components (filled in tasks 2.4–2.8)
import { HomeTab } from "./tabs/HomeTab";
import { ScheduleTab } from "./tabs/ScheduleTab";
import { CrewTab } from "./tabs/CrewTab";
import { CompTab } from "./tabs/CompTab";
import { MoreTab } from "./tabs/MoreTab";
import { formatDateRange } from "@/lib/dates";

export default function TripDetailPage() {
  const { tripId } = useParams<{ tripId: string }>();
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<TabId>("home");

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

  const showComp = !!trip.event_id;
  const status = getTripStatus(trip);

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div
      className="min-h-screen"
      style={{ background: "var(--color-bt-base)", color: "var(--color-bt-text)" }}
    >
      {/* ── Top bar ─────────────────────────────────────────────────────── */}
      <header
        className="sticky top-0 z-40"
        style={{ background: "var(--color-bt-card)", borderBottom: "1px solid var(--color-bt-border)" }}
      >
        {/* Row 1: back + title */}
        <div className="flex h-14 items-center gap-3 px-4">
          <button
            onClick={() => router.push("/dashboard")}
            className="flex h-9 w-9 items-center justify-center rounded-full transition-colors hover:bg-[var(--color-bt-hover)]"
            style={{ color: "var(--color-bt-text)" }}
            aria-label="Back to dashboard"
          >
            <ArrowLeft size={20} />
          </button>

          <div className="flex min-w-0 flex-1 items-center gap-2">
            <h1
              data-testid="trip-title"
              className="truncate text-base font-semibold"
              style={{ color: "var(--color-bt-text)" }}
            >
              {trip.title}
            </h1>
            <StatusBadge status={status} />
          </div>

          {trip.locked_destination_title && (
            <Lock size={14} style={{ color: "var(--color-bt-accent)", flexShrink: 0 }} />
          )}
        </div>

        {/* Row 2: location + dates */}
        {(trip.location || trip.start_date || trip.end_date) && (
          <div
            className="flex items-center gap-4 px-4 pb-3"
            style={{ color: "var(--color-bt-text-dim)" }}
          >
            {trip.location && (
              <span className="flex items-center gap-1 text-xs">
                <MapPin size={12} />
                {trip.location}
              </span>
            )}
            {(trip.start_date || trip.end_date) && (
              <span className="flex items-center gap-1 text-xs">
                <Calendar size={12} />
                {formatDateRange(trip.start_date, trip.end_date)}
              </span>
            )}
          </div>
        )}
      </header>

      {/* ── Tab content ──────────────────────────────────────────────────── */}
      <main className="mx-auto max-w-lg pb-24 pt-4">
        {activeTab === "home" && (
          <HomeTab trip={trip} role={role} canEdit={canEdit} />
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
        {activeTab === "more" && (
          <MoreTab trip={trip} role={role} canEdit={canEdit} isOwner={isOwner} />
        )}
      </main>

      {/* ── Bottom navigation ────────────────────────────────────────────── */}
      <BottomNav
        activeTab={activeTab}
        onTabChange={setActiveTab}
        showComp={showComp}
      />
    </div>
  );
}
