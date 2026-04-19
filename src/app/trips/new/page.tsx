"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, Loader2 } from "lucide-react";
import { trpc } from "@/lib/trpc-client";
import { UserMenu } from "@/components/UserMenu";
import { DestinationPicker, type DestinationMode } from "@/components/DestinationPicker";
import { EmptyStateOnboarding, type LocalIdea } from "@/app/trips/[tripId]/components/IdeaZonePanel";

export default function TripNewPage() {
  const router = useRouter();
  const utils = trpc.useUtils();

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

  const handleCreate = async () => {
    if (!hasName) return;
    setError("");
    setIsSubmitting(true);
    const tripId = crypto.randomUUID();

    const isKnown = destinationMode === "known" && destinationText.trim();
    const isExploring = destinationMode === "exploring";

    try {
      await createTrip.mutateAsync({
        id: tripId,
        title: tripName.trim(),
        ...(isKnown && {
          lockedDestination: {
            title: destinationText.trim(),
            location: destinationText.trim(),
          },
        }),
        comparisonMode: isExploring,
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
      {/* Header */}
      <header
        className="sticky top-0 z-40 flex h-14 items-center gap-3 px-4"
        style={{
          background: "var(--color-bt-base)",
          borderBottom: "1px solid var(--color-bt-border)",
        }}
      >
        <button
          onClick={() => router.back()}
          className="flex h-9 w-9 items-center justify-center rounded-full transition-colors hover:bg-[var(--color-bt-hover)]"
          style={{ color: "var(--color-bt-text)" }}
          aria-label="Back"
        >
          <ArrowLeft size={20} />
        </button>
        <h1 className="text-base font-semibold">New Trip</h1>
        <div className="ml-auto">
          <UserMenu />
        </div>
      </header>

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

      <main className="mx-auto max-w-[896px] space-y-10 px-4 pb-16 pt-6">
        {/* Trip name */}
        <div>
          <label
            htmlFor="trip-name"
            className="mb-1.5 block text-xl font-bold"
            style={{ color: "var(--color-bt-text)" }}
          >
            Name your trip:
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
