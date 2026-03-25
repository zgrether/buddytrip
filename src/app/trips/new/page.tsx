"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, Loader2, MapPin, Sparkles } from "lucide-react";
import { trpc } from "@/lib/trpc-client";
import { UserMenu } from "@/components/UserMenu";

export default function TripNewPage() {
  const router = useRouter();
  const utils = trpc.useUtils();

  const [tripName, setTripName] = useState("");
  const [nameError, setNameError] = useState("");
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [destinationMode, setDestinationMode] = useState<null | "known" | "exploring">(null);
  const [destinationText, setDestinationText] = useState("");

  const createTrip = trpc.trips.create.useMutation({
    onSuccess: () => utils.trips.list.invalidate(),
  });

  const handleCreate = async () => {
    if (!tripName.trim()) {
      setNameError("Trip needs a name");
      return;
    }
    setNameError("");
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

      if (isExploring) {
        router.replace(`/trips/${tripId}/compare`);
      } else {
        router.replace(`/trips/${tripId}`);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create trip");
      setIsSubmitting(false);
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

      <main className="mx-auto max-w-[896px] space-y-6 px-4 pb-16 pt-6">
        <h2 className="text-xl font-bold" style={{ color: "var(--color-bt-text)" }}>
          Let&apos;s get started
        </h2>

        {/* Trip name */}
        <div>
          <label
            htmlFor="trip-name"
            className="mb-1.5 block text-sm font-medium"
            style={{ color: "var(--color-bt-text)" }}
          >
            Trip name *
          </label>
          <input
            id="trip-name"
            data-testid="trip-name-input"
            type="text"
            required
            autoFocus
            value={tripName}
            onChange={(e) => {
              setTripName(e.target.value);
              if (e.target.value.trim()) setNameError("");
            }}
            onBlur={() => {
              if (!tripName.trim()) setNameError("Trip needs a name");
              else setNameError("");
            }}
            onKeyDown={(e) => e.key === "Enter" && handleCreate()}
            placeholder="BBMI 2027, Tyler's Bachelor Party..."
            maxLength={200}
            className="w-full rounded-lg border px-3 py-2.5 text-sm outline-none transition-all focus:ring-1"
            style={{
              background: "var(--color-bt-card)",
              borderColor: nameError
                ? "var(--color-bt-danger)"
                : "var(--color-bt-border)",
              color: "var(--color-bt-text)",
            }}
          />
          {nameError && (
            <p className="mt-1 text-xs" style={{ color: "var(--color-bt-danger)" }}>
              {nameError}
            </p>
          )}
        </div>

        {/* Optional destination decision */}
        <div>
          <label
            className="mb-1.5 block text-sm font-medium"
            style={{ color: "var(--color-bt-text)" }}
          >
            Where are you headed?{" "}
            <span style={{ color: "var(--color-bt-text-dim)" }}>(optional)</span>
          </label>

          <div className="flex flex-col gap-2">
            {/* Known destination */}
            <button
              type="button"
              onClick={() => setDestinationMode((m) => m === "known" ? null : "known")}
              className="flex items-center gap-3 rounded-xl border px-4 py-3 text-left transition-all"
              style={{
                background: destinationMode === "known" ? "var(--color-bt-tag-bg)" : "var(--color-bt-card)",
                borderColor: destinationMode === "known" ? "var(--color-bt-accent)" : "var(--color-bt-border)",
              }}
            >
              <MapPin size={18} style={{ color: destinationMode === "known" ? "var(--color-bt-accent)" : "var(--color-bt-text-dim)", flexShrink: 0 }} />
              <div>
                <p className="text-sm font-medium" style={{ color: "var(--color-bt-text)" }}>
                  I know where we&apos;re going
                </p>
                <p className="text-xs" style={{ color: "var(--color-bt-text-dim)" }}>
                  Lock in a destination now
                </p>
              </div>
            </button>

            {destinationMode === "known" && (
              <input
                autoFocus
                type="text"
                value={destinationText}
                onChange={(e) => setDestinationText(e.target.value)}
                placeholder="Bandon Dunes, OR"
                className="w-full rounded-lg border px-3 py-2.5 text-sm outline-none transition-all focus:ring-1"
                style={{
                  background: "var(--color-bt-card)",
                  borderColor: "var(--color-bt-border)",
                  color: "var(--color-bt-text)",
                }}
              />
            )}

            {/* Exploring */}
            <button
              type="button"
              onClick={() => setDestinationMode((m) => m === "exploring" ? null : "exploring")}
              className="flex items-center gap-3 rounded-xl border px-4 py-3 text-left transition-all"
              style={{
                background: destinationMode === "exploring" ? "var(--color-bt-tag-bg)" : "var(--color-bt-card)",
                borderColor: destinationMode === "exploring" ? "var(--color-bt-accent)" : "var(--color-bt-border)",
              }}
            >
              <Sparkles size={18} style={{ color: destinationMode === "exploring" ? "var(--color-bt-accent)" : "var(--color-bt-text-dim)", flexShrink: 0 }} />
              <div>
                <p className="text-sm font-medium" style={{ color: "var(--color-bt-text)" }}>
                  Not sure yet — let&apos;s figure it out
                </p>
                <p className="text-xs" style={{ color: "var(--color-bt-text-dim)" }}>
                  Browse ideas and vote with the crew
                </p>
              </div>
            </button>
          </div>
        </div>

        {/* Create */}
        <button
          data-testid="create-trip-btn"
          onClick={handleCreate}
          disabled={isSubmitting || !tripName.trim()}
          className="flex w-full items-center justify-center gap-2 rounded-xl py-3 text-sm font-semibold transition-opacity disabled:opacity-40"
          style={{
            background: "var(--color-bt-accent)",
            color: "var(--color-bt-base)",
          }}
        >
          {isSubmitting ? (
            <>
              <Loader2 size={16} className="animate-spin" />
              Creating trip...
            </>
          ) : (
            "Create Trip"
          )}
        </button>
      </main>
    </div>
  );
}
