"use client";

import { useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { MoreHorizontal, Save, X } from "lucide-react";
import { trpc } from "@/lib/trpc-client";
import { useTripRole } from "@/hooks/useTripRole";
import { TripBottomNav, type TabId } from "@/components/BottomNav";
import { TripTabBar } from "@/components/TripTabBar";
import { getTripStatus } from "@/components/StatusBadge";
import { TripHeader } from "@/components/TripHeader";
import { TripSettingsModal } from "@/components/TripSettingsModal";
import { TopNav } from "@/components/TopNav";
import { TripBreadcrumb } from "@/components/TripBreadcrumb";
import { HomeTab } from "./tabs/HomeTab";
import { ScheduleTab } from "./tabs/ScheduleTab";
import { CrewTab } from "./tabs/CrewTab";
import { CompTab } from "./tabs/CompTab";
import { formatDateRange } from "@/lib/dates";

// ── EditTripDetailsModal ──────────────────────────────────────────────────

function EditTripDetailsModal({
  trip,
  onClose,
}: {
  trip: { id: string; title: string; description?: string | null };
  onClose: () => void;
}) {
  const utils = trpc.useUtils();
  const [title, setTitle] = useState(trip.title);
  const [description, setDescription] = useState(trip.description ?? "");

  const updateTrip = trpc.trips.update.useMutation({
    onSuccess: () => {
      utils.trips.getById.invalidate({ tripId: trip.id });
      utils.trips.list.invalidate();
      onClose();
    },
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div
        className="absolute inset-0"
        style={{ background: "var(--color-bt-overlay)" }}
        onClick={onClose}
      />
      <div
        className="relative w-full max-w-sm rounded-2xl p-5 space-y-4"
        style={{ background: "var(--color-bt-card)", border: "1px solid var(--color-bt-border)" }}
      >
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold" style={{ color: "var(--color-bt-text)" }}>
            Edit Trip
          </h2>
          <button
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-full transition-colors hover:bg-[var(--color-bt-hover)]"
            style={{ color: "var(--color-bt-text-dim)" }}
          >
            <X size={18} />
          </button>
        </div>

        <div>
          <label className="mb-1 block text-xs" style={{ color: "var(--color-bt-text-dim)" }}>Name</label>
          <input
            data-testid="edit-title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="w-full rounded-lg border px-3 py-2 text-sm outline-none"
            style={{ background: "var(--color-bt-base)", borderColor: "var(--color-bt-border)", color: "var(--color-bt-text)" }}
          />
        </div>

        <div>
          <label className="mb-1 block text-xs" style={{ color: "var(--color-bt-text-dim)" }}>Description</label>
          <textarea
            data-testid="edit-description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={3}
            className="w-full rounded-lg border px-3 py-2 text-sm outline-none"
            style={{ background: "var(--color-bt-base)", borderColor: "var(--color-bt-border)", color: "var(--color-bt-text)", resize: "none" }}
          />
        </div>

        <div className="flex gap-3 pt-1">
          <button
            onClick={onClose}
            className="flex-1 rounded-xl border py-2.5 text-sm"
            style={{ borderColor: "var(--color-bt-border)", color: "var(--color-bt-text-dim)" }}
          >
            Cancel
          </button>
          <button
            data-testid="save-trip-btn"
            disabled={!title.trim() || updateTrip.isPending}
            onClick={() => updateTrip.mutate({
              tripId: trip.id,
              title: title.trim(),
              description: description.trim() || undefined,
            })}
            className="flex flex-1 items-center justify-center gap-2 rounded-xl py-2.5 text-sm font-semibold disabled:opacity-40"
            style={{ background: "var(--color-bt-accent)", color: "var(--color-bt-base)" }}
          >
            <Save size={14} />
            {updateTrip.isPending ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── TripDetailPage ────────────────────────────────────────────────────────

export default function TripDetailPage() {
  const { tripId } = useParams<{ tripId: string }>();
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<TabId>("home");
  const [showSettings, setShowSettings] = useState(false);
  const [showEditDetails, setShowEditDetails] = useState(false);
  const [compUnlocked, setCompUnlocked] = useState(false);

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

  const utils = trpc.useUtils();
  const status = getTripStatus(trip);
  const destLocation = trip.locked_destination_location ?? trip.location;
  const showComp = !!trip.event_id || compUnlocked;
  const isLocked = !!trip.locked_destination_title;

  const lockDestination = trpc.trips.lockDestination.useMutation({
    onSuccess: () => {
      utils.trips.getById.invalidate({ tripId: trip.id });
      utils.trips.list.invalidate();
    },
  });

  const settingsButton = isOwner ? (
    <button
      data-testid="trip-settings-btn"
      onClick={() => setShowSettings(true)}
      className="flex h-8 w-8 items-center justify-center rounded-full transition-colors hover:bg-[var(--color-bt-hover)]"
      style={{ color: "var(--color-bt-text-dim)" }}
      aria-label="Trip settings"
    >
      <MoreHorizontal size={18} />
    </button>
  ) : null;

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div
      className="min-h-screen"
      style={{ background: "var(--color-bt-base)", color: "var(--color-bt-text)" }}
    >
      {/* ── Top nav + breadcrumb ──────────────────────────────────────────── */}
      <TopNav />
      <TripBreadcrumb
        tripId={tripId}
        tripTitle={trip.title}
        rightSlot={settingsButton}
      />

      {/* ── Trip header card ──────────────────────────────────────────────── */}
      <div className="mx-auto max-w-2xl px-4 pt-4">
        <TripHeader
          tripName={trip.title}
          status={status}
          location={destLocation || trip.location}
          lockedTitle={trip.locked_destination_title}
          dateRange={formatDateRange(trip.start_date, trip.end_date)}
          isLocked={isLocked}
          canEdit={canEdit}
          settingsSlot={settingsButton}
          onDestinationChange={(value) => {
            lockDestination.mutate({
              tripId: trip.id,
              title: value,
              location: value,
            });
          }}
          onDatesTap={() => setActiveTab("schedule")}
        />

        {/* ── Tab bar ───────────────────────────────────────────────────── */}
        <div className="mt-4">
          <TripTabBar activeTab={activeTab} onTabChange={setActiveTab} showComp={showComp} />
        </div>
      </div>

      {/* ── Tab content ──────────────────────────────────────────────────── */}
      <main className="mx-auto max-w-2xl pb-24 pt-4">
        {activeTab === "home" && (
          <HomeTab
            trip={trip}
            role={role}
            canEdit={canEdit}
            isOwner={isOwner}
            onTabChange={(tab) => setActiveTab(tab as TabId)}
            onEdit={canEdit ? () => setShowEditDetails(true) : undefined}
            onEnableComp={canEdit ? () => { setCompUnlocked(true); setActiveTab("comp"); } : undefined}
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

      {/* ── Bottom navigation ─────────────────────────────────────────────── */}
      <TripBottomNav tripId={tripId} eventId={trip.event_id} showComp={showComp} />

      {/* ── Edit trip details modal ───────────────────────────────────────── */}
      {showEditDetails && (
        <EditTripDetailsModal
          trip={trip}
          onClose={() => setShowEditDetails(false)}
        />
      )}

      {/* ── Settings modal ────────────────────────────────────────────────── */}
      {showSettings && (
        <TripSettingsModal
          trip={trip}
          isOwner={isOwner}
          onClose={() => setShowSettings(false)}
        />
      )}
    </div>
  );
}
