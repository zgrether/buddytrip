"use client";

import { useState, useRef } from "react";
import { useParams, useRouter } from "next/navigation";
import { ArrowLeft, MoreHorizontal } from "lucide-react";
import { trpc } from "@/lib/trpc-client";
import { useTripRole } from "@/hooks/useTripRole";
import { TripBottomNav, type TabId } from "@/components/BottomNav";
import { TripTabBar } from "@/components/TripTabBar";
import { getTripStatus } from "@/components/StatusBadge";
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

  const TABS: TabId[] = ["home", "schedule", "crew", "comp"];
  const touchStartX = useRef<number | null>(null);
  const touchStartY = useRef<number | null>(null);
  const gestureDir = useRef<"horizontal" | "vertical" | null>(null);
  const [dragOffset, setDragOffset] = useState(0);

  function handleTouchStart(e: React.TouchEvent) {
    touchStartX.current = e.touches[0].clientX;
    touchStartY.current = e.touches[0].clientY;
    gestureDir.current = null;
  }

  function handleTouchMove(e: React.TouchEvent) {
    if (touchStartX.current === null || touchStartY.current === null) return;
    const dx = e.touches[0].clientX - touchStartX.current;
    const dy = e.touches[0].clientY - touchStartY.current;

    // Lock gesture direction on first meaningful movement
    if (gestureDir.current === null && (Math.abs(dx) > 5 || Math.abs(dy) > 5)) {
      gestureDir.current = Math.abs(dx) > Math.abs(dy) ? "horizontal" : "vertical";
    }
    if (gestureDir.current !== "horizontal") return;

    const idx = TABS.indexOf(activeTab);
    const atEdge = (dx > 0 && idx === 0) || (dx < 0 && idx === TABS.length - 1);
    // Rubber-band at edges, clamp at 60px in the middle
    setDragOffset(atEdge ? dx * 0.15 : Math.max(-60, Math.min(60, dx)));
  }

  function handleTouchEnd(e: React.TouchEvent) {
    if (touchStartX.current === null) return;
    const delta = e.changedTouches[0].clientX - touchStartX.current;
    touchStartX.current = null;
    touchStartY.current = null;
    setDragOffset(0); // spring back (transition fires here)
    if (gestureDir.current !== "horizontal" || Math.abs(delta) < 50) return;
    const idx = TABS.indexOf(activeTab);
    if (delta < 0 && idx < TABS.length - 1) setActiveTab(TABS[idx + 1]);
    if (delta > 0 && idx > 0) setActiveTab(TABS[idx - 1]);
  }

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
  const destLocation = trip.locked_destination_location ?? trip.location;

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
            onClick={() => activeTab === "home" ? router.push("/dashboard") : setActiveTab("home")}
            className="flex h-9 w-9 items-center justify-center rounded-full transition-colors hover:bg-[var(--color-bt-hover)]"
            style={{ color: "var(--color-bt-text)" }}
            aria-label={activeTab === "home" ? "Back to dashboard" : "Back to home"}
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

      {/* ── Trip hero card ───────────────────────────────────────────────── */}
      <div className="mx-auto max-w-lg px-4">
        <LocationHero
          tripName={trip.title}
          status={status}
          location={destLocation || trip.location}
          lockedTitle={trip.locked_destination_title}
          dateRange={formatDateRange(trip.start_date, trip.end_date)}
        />

        {/* ── Tab bar (inline, in body) ────────────────────────────────────── */}
        <div className="mt-4">
          <TripTabBar activeTab={activeTab} onTabChange={setActiveTab} />
        </div>
      </div>

      {/* ── Tab content ──────────────────────────────────────────────────── */}
      <main
        className="mx-auto max-w-lg pb-24 pt-4"
        style={{
          transform: `translateX(${dragOffset}px)`,
          transition: dragOffset === 0 ? "transform 0.25s ease-out" : "none",
        }}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
      >
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
