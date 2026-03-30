"use client";

import { useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { ArrowLeft, Loader2 } from "lucide-react";
import { trpc } from "@/lib/trpc-client";
import { useTripRole } from "@/hooks/useTripRole";
import { DestinationPicker, type DestinationMode } from "@/components/DestinationPicker";

export default function ChangeDestinationPage() {
  const { tripId } = useParams<{ tripId: string }>();
  const router = useRouter();
  const utils = trpc.useUtils();
  const { canEdit, loading: roleLoading } = useTripRole(tripId);

  const { data: trip, isLoading: tripLoading } = trpc.trips.getById.useQuery(
    { tripId },
    { enabled: !!tripId }
  );

  const [mode, setMode] = useState<DestinationMode>(null);
  const [destinationText, setDestinationText] = useState("");
  const [error, setError] = useState("");

  const lockDestination = trpc.trips.lockDestination.useMutation({
    onSuccess() {
      utils.trips.getById.invalidate({ tripId });
      router.replace(`/trips/${tripId}`);
    },
    onError(e) {
      setError(e.message ?? "Failed to set destination");
    },
  });

  const unlockDestination = trpc.trips.unlockDestination.useMutation({
    onSuccess() {
      utils.trips.getById.invalidate({ tripId });
      router.replace(`/trips/${tripId}/compare`);
    },
    onError(e) {
      setError(e.message ?? "Failed to open idea zone");
    },
  });

  const isSubmitting = lockDestination.isPending || unlockDestination.isPending;

  const handleSave = () => {
    setError("");
    if (mode === "known") {
      const dest = destinationText.trim();
      if (!dest) return;
      lockDestination.mutate({ tripId, title: dest, location: dest });
    } else if (mode === "exploring") {
      unlockDestination.mutate({ tripId });
    }
  };

  if (tripLoading || roleLoading) {
    return (
      <div
        className="flex min-h-screen items-center justify-center"
        style={{ background: "var(--color-bt-base)" }}
      >
        <Loader2 size={24} className="animate-spin" style={{ color: "var(--color-bt-text-dim)" }} />
      </div>
    );
  }

  if (!canEdit) {
    router.replace(`/trips/${tripId}`);
    return null;
  }

  return (
    <div
      className="min-h-screen"
      style={{ background: "var(--color-bt-base)", color: "var(--color-bt-text)" }}
    >
      {/* Header */}
      <header
        className="sticky top-0 z-40 flex h-14 items-center gap-3 px-4"
        style={{
          background: "var(--color-bt-card)",
          borderBottom: "1px solid var(--color-bt-border)",
        }}
      >
        <button
          onClick={() => router.push(`/trips/${tripId}`)}
          className="flex h-9 w-9 items-center justify-center rounded-full transition-colors hover:bg-[var(--color-bt-hover)]"
          style={{ color: "var(--color-bt-text)" }}
          aria-label="Back to trip"
        >
          <ArrowLeft size={20} />
        </button>
        <h1 className="text-base font-semibold">Change Destination</h1>
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

      <main className="mx-auto max-w-[896px] space-y-6 px-4 pb-16 pt-6">
        {/* Trip name — read-only context */}
        <div>
          <p
            className="text-xs font-medium uppercase tracking-wider"
            style={{ color: "var(--color-bt-text-dim)" }}
          >
            Trip
          </p>
          <p className="text-lg font-bold" style={{ color: "var(--color-bt-text)" }}>
            {trip?.title}
          </p>
        </div>

        <DestinationPicker
          required
          mode={mode}
          onModeChange={setMode}
          destinationText={destinationText}
          onDestinationTextChange={setDestinationText}
        />

        {/* Action buttons */}
        <div className="flex flex-col gap-2">
          <button
            onClick={handleSave}
            disabled={isSubmitting || !mode || (mode === "known" && !destinationText.trim())}
            className="flex w-full items-center justify-center gap-2 rounded-xl py-3 text-sm font-semibold transition-opacity disabled:opacity-40"
            style={{
              background: "var(--color-bt-accent)",
              color: "var(--color-bt-base)",
            }}
          >
            {isSubmitting ? (
              <>
                <Loader2 size={16} className="animate-spin" />
                Saving...
              </>
            ) : mode === "exploring" ? (
              "Open Idea Zone"
            ) : (
              "Set Destination"
            )}
          </button>

          <button
            onClick={() => router.push(`/trips/${tripId}`)}
            disabled={isSubmitting}
            className="w-full rounded-xl py-2.5 text-sm font-medium transition-opacity disabled:opacity-40"
            style={{ color: "var(--color-bt-text-dim)" }}
          >
            Cancel
          </button>
        </div>
      </main>
    </div>
  );
}
