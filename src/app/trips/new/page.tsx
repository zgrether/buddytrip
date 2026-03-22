"use client";

import { useState, useRef } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  X,
  Search,
  Plus,
  Loader2,
  MapPin,
  Sparkles,
} from "lucide-react";
import { trpc } from "@/lib/trpc-client";
import { UserMenu } from "@/components/UserMenu";

// ── Types ────────────────────────────────────────────────────────────────────

interface PendingInvite {
  userId: string;
  name: string;
  email: string;
  role: "Planner" | "Member";
}

// ── TripNewPage ───────────────────────────────────────────────────────────────

export default function TripNewPage() {
  const router = useRouter();
  const utils = trpc.useUtils();
  const searchRef = useRef<HTMLDivElement>(null);

  const [tripName, setTripName] = useState("");
  const [nameError, setNameError] = useState("");
  const [invites, setInvites] = useState<PendingInvite[]>([]);
  const [query, setQuery] = useState("");
  const [showResults, setShowResults] = useState(false);

  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const [destinationMode, setDestinationMode] = useState<null | "known" | "exploring">(null);
  const [destinationText, setDestinationText] = useState("");

  const { data: searchResults = [], isFetching } = trpc.users.search.useQuery(
    { query },
    { enabled: query.length >= 2 }
  );

  const filteredResults = searchResults.filter(
    (r) => !invites.some((i) => i.userId === r.id)
  );

  const hasNoMatch =
    !isFetching && query.length >= 2 && filteredResults.length === 0;

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
        coplanners: invites.map((i) => ({ userId: i.userId, role: i.role })),
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

        {/* Invite co-planners */}
        <div>
          <label
            className="mb-1.5 block text-sm font-medium"
            style={{ color: "var(--color-bt-text)" }}
          >
            Invite Co-planners{" "}
            <span style={{ color: "var(--color-bt-text-dim)" }}>(optional)</span>
          </label>

          <div ref={searchRef} className="relative">
            <div
              className="flex items-center gap-2 rounded-lg border px-3 py-2"
              style={{
                background: "var(--color-bt-card)",
                borderColor: "var(--color-bt-border)",
              }}
            >
              <Search
                size={16}
                style={{ color: "var(--color-bt-text-dim)", flexShrink: 0 }}
              />
              <input
                data-testid="invite-search"
                type="text"
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setShowResults(true);
                }}
                onFocus={() => setShowResults(true)}
                placeholder="Name, nickname, or email"
                className="flex-1 bg-transparent text-sm outline-none"
                style={{ color: "var(--color-bt-text)" }}
              />
              {isFetching && (
                <div
                  className="h-4 w-4 animate-spin rounded-full border-2 border-t-transparent"
                  style={{
                    borderColor: "var(--color-bt-accent)",
                    borderTopColor: "transparent",
                  }}
                />
              )}
            </div>

            {/* Search results dropdown */}
            {showResults && query.length >= 2 && (
              <div
                className="absolute z-20 mt-1 w-full overflow-hidden rounded-lg shadow-xl"
                style={{
                  background: "var(--color-bt-card)",
                  border: "1px solid var(--color-bt-border)",
                }}
              >
                {hasNoMatch ? (
                  <div
                    className="px-4 py-3 text-sm"
                    style={{ color: "var(--color-bt-danger)" }}
                  >
                    No BuddyTrip account found for that name or email
                  </div>
                ) : isFetching ? (
                  <div
                    className="px-4 py-3 text-sm"
                    style={{ color: "var(--color-bt-text-dim)" }}
                  >
                    Searching...
                  </div>
                ) : (
                  filteredResults.map((user) => (
                    <button
                      key={user.id}
                      data-testid={`search-result-${user.id}`}
                      onClick={() => {
                        setInvites((prev) => [
                          ...prev,
                          {
                            userId: user.id,
                            name: user.nickname ?? user.name ?? user.email,
                            email: user.email,
                            role: "Planner",
                          },
                        ]);
                        setQuery("");
                        setShowResults(false);
                      }}
                      className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-[var(--color-bt-hover)]"
                    >
                      <div
                        className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full text-sm font-semibold"
                        style={{
                          background: "var(--color-bt-tag-bg)",
                          color: "var(--color-bt-accent)",
                        }}
                      >
                        {(user.nickname ?? user.name ?? user.email)
                          .charAt(0)
                          .toUpperCase()}
                      </div>
                      <div>
                        <p
                          className="text-sm font-medium"
                          style={{ color: "var(--color-bt-text)" }}
                        >
                          {user.name ?? "—"}
                          {user.nickname && (
                            <span
                              className="ml-1 text-xs"
                              style={{ color: "var(--color-bt-text-dim)" }}
                            >
                              ({user.nickname})
                            </span>
                          )}
                        </p>
                        <p
                          className="text-xs"
                          style={{ color: "var(--color-bt-text-dim)" }}
                        >
                          {user.email}
                        </p>
                      </div>
                      <Plus
                        size={16}
                        className="ml-auto"
                        style={{ color: "var(--color-bt-accent)" }}
                      />
                    </button>
                  ))
                )}
              </div>
            )}
          </div>

          <p
            className="mt-1.5 text-xs"
            style={{ color: "var(--color-bt-text-dim)" }}
          >
            Co-planners can help manage the trip. You can invite the rest of
            the crew later.
          </p>

          {/* Pending invites as chips */}
          {invites.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-2">
              {invites.map((invite) => (
                <span
                  key={invite.userId}
                  data-testid={`invite-${invite.userId}`}
                  className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm"
                  style={{
                    background: "var(--color-bt-tag-bg)",
                    color: "var(--color-bt-accent)",
                  }}
                >
                  {invite.name}
                  <button
                    onClick={() =>
                      setInvites((prev) =>
                        prev.filter((i) => i.userId !== invite.userId)
                      )
                    }
                    className="flex h-4 w-4 items-center justify-center rounded-full transition-colors hover:bg-[var(--color-bt-hover)]"
                  >
                    <X size={12} />
                  </button>
                </span>
              ))}
            </div>
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
