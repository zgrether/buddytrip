"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { trpc } from "@/lib/trpc-client";
import { DestinationPicker, type DestinationMode } from "@/components/DestinationPicker";
import { EmptyStateOnboarding, type LocalIdea } from "@/app/trips/[tripId]/components/IdeaZonePanel";

/**
 * The create-a-trip flow, extracted from `/trips/new`'s page so it can be shown
 * in two places without being written twice — the route (which has to survive:
 * `auth/callback` redirects every organic signup with no trip memberships
 * straight to it) and the modal every in-app entry point opens.
 *
 * ── The path is PRE-SELECTED from where you came in ─────────────────────────
 * This used to start with neither path chosen, and the reason was written down:
 * "so the user actually reads the two options before picking". That is a good
 * reason when the app genuinely doesn't know. It usually does. Someone who
 * clicked + on the TRIPS list has a destination in mind; someone who clicked +
 * on the IDEAS list does not. Making them answer a question their own click
 * already answered is the cost, and it is paid on every trip anyone creates.
 *
 * It stays a TOGGLE — a pre-selection, not a branch. Flipping it is one tap and
 * loses nothing, which is what makes guessing safe: the failure mode of a wrong
 * guess is one tap, and the failure mode of not guessing is a question every
 * time.
 *
 * Entry points that genuinely don't know (the dashboard's "New trip", the
 * mobile bottom nav, the empty state, the post-signup redirect) still pass
 * `null` and still show the unselected pair. The pre-selection is not a new
 * default; it is a signal being carried that was already being thrown away.
 */
export function CreateTripFlow({
  initialMode = null,
  onCreated,
  onError,
}: {
  /** Pre-selected path. `null` — the pre-existing behaviour — for entry points
   *  that have no idea which the user wants. */
  initialMode?: DestinationMode;
  /** Where to go once the trip exists. Defaults to the trip page. */
  onCreated?: (tripId: string) => void;
  /** Lets a host (the modal) render the failure banner in its own chrome.
   *  Without one, the flow renders its own. */
  onError?: (message: string) => void;
}) {
  const router = useRouter();
  const utils = trpc.useUtils();

  const [tripName, setTripName] = useState("");
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [destinationMode, setDestinationMode] = useState<DestinationMode>(initialMode);
  const [destinationText, setDestinationText] = useState("");
  /**
   * Whether the user picked the path themselves.
   *
   * This exists for focus, and the bug it prevents is specific: the destination
   * input carries `autoFocus`, which is right when the mode was just CHOSEN
   * (the field appears, the cursor should be in it) and wrong when it was
   * pre-selected (the field is present on mount and steals focus from the trip
   * NAME field, which is the one thing you always have to fill in). A
   * pre-selection that moves the cursor past the required field would make the
   * feature a net loss.
   */
  const [modeChosen, setModeChosen] = useState(false);

  const hasName = tripName.trim().length > 0;

  const fail = (message: string) => {
    setError(message);
    onError?.(message);
  };

  const createTrip = trpc.trips.create.useMutation({
    onSuccess: () => utils.trips.list.invalidate(),
  });
  const createIdea = trpc.ideas.create.useMutation();

  const land = (tripId: string) => {
    if (onCreated) onCreated(tripId);
    else router.replace(`/trips/${tripId}`);
  };

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

      land(tripId);
    } catch (err) {
      fail(err instanceof Error ? err.message : "Failed to create trip");
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
      land(tripId);
    } catch (err) {
      fail(err instanceof Error ? err.message : "Failed to create trip");
      throw err;
    }
  };

  return (
    <>
      {error && !onError && (
        <div
          className="mb-6 rounded-lg border px-4 py-3 text-sm"
          style={{
            background: "var(--color-bt-danger-bg)",
            borderColor: "var(--color-bt-danger-border)",
            color: "var(--color-bt-danger)",
          }}
        >
          {error}
        </div>
      )}

      <div className="space-y-10">
        {/* Trip name — narrow form column, left-aligned with main */}
        <div className="max-w-2xl">
          <label
            htmlFor="trip-name"
            className="mb-1.5 block text-xl font-bold"
            style={{ color: "var(--color-bt-text)" }}
          >
            Trip Name{" "}
            <span aria-hidden="true" style={{ color: "var(--color-bt-danger)", fontWeight: 400 }}>
              *
            </span>
            <span className="sr-only"> (required)</span>
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
          onModeChange={(next) => {
            setModeChosen(true);
            setDestinationMode(next);
          }}
          autoFocusDestination={modeChosen}
          destinationText={destinationText}
          onDestinationTextChange={setDestinationText}
          knownTrailing={
            <button
              data-testid="create-trip-btn"
              onClick={handleCreate}
              disabled={isSubmitting || !hasName || !destinationText.trim()}
              className="flex shrink-0 items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-sm font-semibold transition-opacity disabled:opacity-40"
              style={{ background: "var(--color-bt-accent)", color: "var(--color-bt-base)" }}
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
      </div>
    </>
  );
}
