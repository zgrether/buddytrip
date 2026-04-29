"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, Loader2 } from "lucide-react";
import { trpc } from "@/lib/trpc-client";
import { TopNav } from "@/components/TopNav";
import { useGlobalNotifications } from "@/hooks/useGlobalNotifications";
import { DestinationPicker, type DestinationMode } from "@/components/DestinationPicker";
import { EmptyStateOnboarding, type LocalIdea } from "@/app/trips/[tripId]/components/IdeaZonePanel";

export default function TripNewPage() {
  const router = useRouter();
  const utils = trpc.useUtils();
  const { notifications, unreadCount, markAllRead } = useGlobalNotifications();

  const [tripName, setTripName] = useState("");
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [destinationMode, setDestinationMode] = useState<DestinationMode>("known");
  const [destinationText, setDestinationText] = useState("");

  const hasName = tripName.trim().length > 0;

  const createTrip = trpc.trips.create.useMutation({
    onSuccess: () => utils.trips.list.invalidate(),
  });
  const createIdea = trpc.ideas.create.useMutation();

  // "I Know Where" path — wired to the inline Create Trip button (only
  // rendered in known mode) and Enter-key on the name input. The exploring
  // path goes through handleExploringSubmit below, not here.
  const handleCreate = async () => {
    if (destinationMode !== "known") return;
    const destination = destinationText.trim();
    if (!hasName || !destination) return;
    setError("");
    setIsSubmitting(true);
    const tripId = crypto.randomUUID();

    try {
      await createTrip.mutateAsync({
        id: tripId,
        title: tripName.trim(),
        lockedDestination: { title: destination, location: destination },
      });

      router.replace(`/trips/${tripId}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create trip");
      setIsSubmitting(false);
    }
  };

  // "Not sure yet" path — EmptyStateOnboarding hands us the staged list; we
  // create the trip with comparisonMode, seed the ideas into it, and land the
  // user on the trip page already populated. Rethrow on failure so the
  // component's `isSubmitting` resets and the user can retry.
  const handleExploringSubmit = async (ideas: LocalIdea[]) => {
    if (!hasName) {
      throw new Error("Trip needs a name");
    }
    setError("");
    const tripId = crypto.randomUUID();
    try {
      await createTrip.mutateAsync({
        id: tripId,
        title: tripName.trim(),
        comparisonMode: true,
      });
      await Promise.all(
        ideas.map((idea) =>
          createIdea.mutateAsync({
            tripId,
            id: crypto.randomUUID(),
            title: idea.title,
            location: idea.location,
            description: idea.description,
            costTier: idea.costTier,
            imageUrl: idea.imageUrl,
            golfCourses: idea.golfCourses,
            activities: idea.activities,
            accommodation: idea.accommodation,
            notes: idea.tips,
            source: idea.source,
          })
        )
      );
      router.replace(`/trips/${tripId}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create trip");
      throw err;
    }
  };

  return (
    <div
      className="min-h-screen"
      style={{ background: "var(--color-bt-base)", color: "var(--color-bt-text)" }}
    >
      {/* App-wide top nav — matches dashboard, profile, and trip pages so
          the new-trip flow doesn't feel like a separate surface. The
          in-body "Back" link below replaces the old header back button. */}
      <TopNav
        notifications={notifications}
        unreadCount={unreadCount}
        onMarkAllRead={markAllRead}
      />

      {error && (
        <div
          className="mx-auto mt-4 max-w-[896px] rounded-lg border px-4 py-3 text-sm"
          style={{
            background: "var(--color-bt-danger-bg)",
            borderColor: "var(--color-bt-danger-border)",
            color: "var(--color-bt-danger)",
          }}
        >
          {error}
        </div>
      )}

      <main className="mx-auto max-w-4xl space-y-10 px-6 py-8">
        <button
          onClick={() => router.back()}
          className="-mt-2 inline-flex items-center gap-1.5 text-sm transition-opacity hover:opacity-70"
          style={{ color: "var(--color-bt-text-dim)" }}
        >
          <ArrowLeft size={14} /> Back
        </button>

        {/* Trip name — narrow form column, left-aligned with main */}
        <div className="max-w-2xl">
          <label
            htmlFor="trip-name"
            className="mb-1.5 block text-xl font-bold"
            style={{ color: "var(--color-bt-text)" }}
          >
            Trip Name
          </label>
          <input
            id="trip-name"
            data-testid="trip-name-input"
            type="text"
            required
            autoFocus
            value={tripName}
            onChange={(e) => setTripName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleCreate()}
            placeholder="BBMI 2027, Tyler's Bachelor Party..."
            maxLength={200}
            className="w-full rounded-lg border px-3 py-2.5 text-sm outline-none transition-all focus:ring-1"
            style={{
              background: "var(--color-bt-card)",
              borderColor: "var(--color-bt-border)",
              color: "var(--color-bt-text)",
            }}
          />
        </div>

        <DestinationPicker
          mode={destinationMode}
          onModeChange={setDestinationMode}
          destinationText={destinationText}
          onDestinationTextChange={setDestinationText}
          knownTrailing={
            <button
              data-testid="create-trip-btn"
              onClick={handleCreate}
              disabled={isSubmitting || !hasName || !destinationText.trim()}
              className="flex shrink-0 items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-sm font-semibold transition-opacity disabled:opacity-40"
              style={{
                background: "var(--color-bt-accent)",
                color: "var(--color-bt-base)",
              }}
            >
              {isSubmitting ? (
                <>
                  <Loader2 size={16} className="animate-spin" />
                  Creating...
                </>
              ) : (
                "Create Trip"
              )}
            </button>
          }
          exploringContent={
            <EmptyStateOnboarding
              onSubmit={handleExploringSubmit}
              submitDisabled={!hasName}
              className="mt-3"
            />
          }
        />
      </main>
    </div>
  );
}
