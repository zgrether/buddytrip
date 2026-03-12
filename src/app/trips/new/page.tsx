"use client";

import { useState, useRef } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, ArrowRight, X, Search, Plus, Check } from "lucide-react";
import { trpc } from "@/lib/trpc-client";

// ── Types ────────────────────────────────────────────────────────────────────

interface PendingInvite {
  userId: string;
  name: string;
  email: string;
  role: "Planner" | "Member";
}

// ── Step 1 — Trip name + co-planner invites ───────────────────────────────

function Step1({
  tripName,
  onTripNameChange,
  description,
  onDescriptionChange,
  invites,
  onAddInvite,
  onRemoveInvite,
  onRoleChange,
  onNext,
}: {
  tripName: string;
  onTripNameChange: (v: string) => void;
  description: string;
  onDescriptionChange: (v: string) => void;
  invites: PendingInvite[];
  onAddInvite: (u: PendingInvite) => void;
  onRemoveInvite: (userId: string) => void;
  onRoleChange: (userId: string, role: "Planner" | "Member") => void;
  onNext: () => void;
}) {
  const [query, setQuery] = useState("");
  const [showResults, setShowResults] = useState(false);
  const searchRef = useRef<HTMLDivElement>(null);

  const { data: searchResults = [], isFetching } = trpc.users.search.useQuery(
    { query },
    { enabled: query.length >= 2 }
  );

  const filteredResults = searchResults.filter(
    (r) => !invites.some((i) => i.userId === r.id)
  );

  return (
    <div className="space-y-6">
      {/* Trip name */}
      <div>
        <label
          htmlFor="trip-name"
          className="mb-1.5 block text-sm font-medium"
          style={{ color: "#e6edf3" }}
        >
          Trip name *
        </label>
        <input
          id="trip-name"
          data-testid="trip-name-input"
          type="text"
          required
          value={tripName}
          onChange={(e) => onTripNameChange(e.target.value)}
          placeholder="e.g. Augusta Golf Weekend"
          maxLength={200}
          className="w-full rounded-lg border px-3 py-2.5 text-sm outline-none transition-all focus:ring-1"
          style={{
            background: "#161b22",
            borderColor: "#30363d",
            color: "#e6edf3",
          }}
        />
      </div>

      {/* Description */}
      <div>
        <label
          htmlFor="trip-desc"
          className="mb-1.5 block text-sm font-medium"
          style={{ color: "#e6edf3" }}
        >
          Description{" "}
          <span style={{ color: "#8b949e" }}>(optional)</span>
        </label>
        <textarea
          id="trip-desc"
          value={description}
          onChange={(e) => onDescriptionChange(e.target.value)}
          placeholder="Add a brief description…"
          maxLength={2000}
          rows={3}
          className="w-full resize-none rounded-lg border px-3 py-2.5 text-sm outline-none transition-all focus:ring-1"
          style={{
            background: "#161b22",
            borderColor: "#30363d",
            color: "#e6edf3",
          }}
        />
      </div>

      {/* Invite co-planners */}
      <div>
        <label className="mb-1.5 block text-sm font-medium" style={{ color: "#e6edf3" }}>
          Invite people{" "}
          <span style={{ color: "#8b949e" }}>(optional)</span>
        </label>

        <div ref={searchRef} className="relative">
          <div
            className="flex items-center gap-2 rounded-lg border px-3 py-2"
            style={{ background: "#161b22", borderColor: "#30363d" }}
          >
            <Search size={16} style={{ color: "#8b949e", flexShrink: 0 }} />
            <input
              data-testid="invite-search"
              type="email"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setShowResults(true);
              }}
              onFocus={() => setShowResults(true)}
              placeholder="Search by email…"
              className="flex-1 bg-transparent text-sm outline-none"
              style={{ color: "#e6edf3" }}
            />
            {isFetching && (
              <div
                className="h-4 w-4 animate-spin rounded-full border-2 border-t-transparent"
                style={{ borderColor: "#00d4aa", borderTopColor: "transparent" }}
              />
            )}
          </div>

          {/* Search results dropdown */}
          {showResults && query.length >= 2 && (
            <div
              className="absolute z-20 mt-1 w-full overflow-hidden rounded-lg shadow-xl"
              style={{ background: "#161b22", border: "1px solid #30363d" }}
            >
              {filteredResults.length === 0 ? (
                <div className="px-4 py-3 text-sm" style={{ color: "#8b949e" }}>
                  {isFetching ? "Searching…" : "No users found"}
                </div>
              ) : (
                filteredResults.map((user) => (
                  <button
                    key={user.id}
                    data-testid={`search-result-${user.id}`}
                    onClick={() => {
                      onAddInvite({
                        userId: user.id,
                        name: user.name ?? user.email,
                        email: user.email,
                        role: "Member",
                      });
                      setQuery("");
                      setShowResults(false);
                    }}
                    className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-white/5"
                  >
                    <div
                      className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full text-sm font-semibold"
                      style={{ background: "#0d2a22", color: "#00d4aa" }}
                    >
                      {(user.name ?? user.email).charAt(0).toUpperCase()}
                    </div>
                    <div>
                      <p className="text-sm font-medium" style={{ color: "#e6edf3" }}>
                        {user.name ?? "—"}
                      </p>
                      <p className="text-xs" style={{ color: "#8b949e" }}>
                        {user.email}
                      </p>
                    </div>
                    <Plus size={16} className="ml-auto" style={{ color: "#00d4aa" }} />
                  </button>
                ))
              )}
            </div>
          )}
        </div>

        {/* Pending invites */}
        {invites.length > 0 && (
          <ul className="mt-3 space-y-2">
            {invites.map((invite) => (
              <li
                key={invite.userId}
                data-testid={`invite-${invite.userId}`}
                className="flex items-center gap-3 rounded-lg border px-3 py-2"
                style={{ background: "#0d2a22", borderColor: "#00d4aa33" }}
              >
                <div
                  className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full text-sm font-semibold"
                  style={{ background: "#161b22", color: "#00d4aa" }}
                >
                  {invite.name.charAt(0).toUpperCase()}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium" style={{ color: "#e6edf3" }}>
                    {invite.name}
                  </p>
                  <p className="truncate text-xs" style={{ color: "#8b949e" }}>
                    {invite.email}
                  </p>
                </div>
                {/* Role selector */}
                <select
                  value={invite.role}
                  onChange={(e) =>
                    onRoleChange(invite.userId, e.target.value as "Planner" | "Member")
                  }
                  className="rounded border px-2 py-1 text-xs outline-none"
                  style={{
                    background: "#161b22",
                    borderColor: "#30363d",
                    color: "#e6edf3",
                  }}
                >
                  <option value="Planner">Planner</option>
                  <option value="Member">Member</option>
                </select>
                <button
                  onClick={() => onRemoveInvite(invite.userId)}
                  className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full transition-colors hover:bg-white/10"
                  style={{ color: "#8b949e" }}
                >
                  <X size={14} />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Next */}
      <button
        data-testid="step1-next"
        onClick={onNext}
        disabled={!tripName.trim()}
        className="flex w-full items-center justify-center gap-2 rounded-xl py-3 text-sm font-semibold transition-opacity disabled:opacity-40"
        style={{ background: "#00d4aa", color: "#0d1117" }}
      >
        Next
        <ArrowRight size={16} />
      </button>
    </div>
  );
}

// ── Step 2 — Destination ──────────────────────────────────────────────────

function Step2({
  location,
  onLocationChange,
  startDate,
  onStartDateChange,
  endDate,
  onEndDateChange,
  onBack,
  onSubmit,
  isSubmitting,
}: {
  location: string;
  onLocationChange: (v: string) => void;
  startDate: string;
  onStartDateChange: (v: string) => void;
  endDate: string;
  onEndDateChange: (v: string) => void;
  onBack: () => void;
  onSubmit: () => void;
  isSubmitting: boolean;
}) {
  return (
    <div className="space-y-6">
      {/* Location */}
      <div>
        <label
          htmlFor="trip-location"
          className="mb-1.5 block text-sm font-medium"
          style={{ color: "#e6edf3" }}
        >
          Destination{" "}
          <span style={{ color: "#8b949e" }}>(optional)</span>
        </label>
        <input
          id="trip-location"
          data-testid="trip-location-input"
          type="text"
          value={location}
          onChange={(e) => onLocationChange(e.target.value)}
          placeholder="e.g. Pebble Beach, CA"
          maxLength={500}
          className="w-full rounded-lg border px-3 py-2.5 text-sm outline-none"
          style={{
            background: "#161b22",
            borderColor: "#30363d",
            color: "#e6edf3",
          }}
        />
        <p className="mt-1.5 text-xs" style={{ color: "#8b949e" }}>
          You can also let members vote on a destination — skip this if you&apos;re
          still deciding.
        </p>
      </div>

      {/* Dates */}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label
            htmlFor="start-date"
            className="mb-1.5 block text-sm font-medium"
            style={{ color: "#e6edf3" }}
          >
            Start date
          </label>
          <input
            id="start-date"
            data-testid="trip-start-date"
            type="date"
            value={startDate}
            onChange={(e) => onStartDateChange(e.target.value)}
            className="w-full rounded-lg border px-3 py-2.5 text-sm outline-none"
            style={{
              background: "#161b22",
              borderColor: "#30363d",
              color: "#e6edf3",
              colorScheme: "dark",
            }}
          />
        </div>
        <div>
          <label
            htmlFor="end-date"
            className="mb-1.5 block text-sm font-medium"
            style={{ color: "#e6edf3" }}
          >
            End date
          </label>
          <input
            id="end-date"
            data-testid="trip-end-date"
            type="date"
            value={endDate}
            min={startDate || undefined}
            onChange={(e) => onEndDateChange(e.target.value)}
            className="w-full rounded-lg border px-3 py-2.5 text-sm outline-none"
            style={{
              background: "#161b22",
              borderColor: "#30363d",
              color: "#e6edf3",
              colorScheme: "dark",
            }}
          />
        </div>
      </div>

      {/* Buttons */}
      <div className="flex gap-3">
        <button
          data-testid="step2-back"
          onClick={onBack}
          className="flex items-center gap-2 rounded-xl border px-5 py-3 text-sm font-medium transition-colors hover:bg-white/5"
          style={{ borderColor: "#30363d", color: "#e6edf3" }}
        >
          <ArrowLeft size={16} />
          Back
        </button>
        <button
          data-testid="step2-create"
          onClick={onSubmit}
          disabled={isSubmitting}
          className="flex flex-1 items-center justify-center gap-2 rounded-xl py-3 text-sm font-semibold transition-opacity disabled:opacity-40"
          style={{ background: "#00d4aa", color: "#0d1117" }}
        >
          {isSubmitting ? (
            <>
              <span
                className="h-4 w-4 animate-spin rounded-full border-2 border-t-transparent"
                style={{ borderColor: "#0d1117", borderTopColor: "transparent" }}
              />
              Creating…
            </>
          ) : (
            <>
              <Check size={16} />
              Create Trip
            </>
          )}
        </button>
      </div>
    </div>
  );
}

// ── Wizard shell ──────────────────────────────────────────────────────────

export default function TripNewPage() {
  const router = useRouter();
  const utils = trpc.useUtils();

  const [step, setStep] = useState(1);
  const [tripName, setTripName] = useState("");
  const [description, setDescription] = useState("");
  const [invites, setInvites] = useState<PendingInvite[]>([]);
  const [location, setLocation] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [error, setError] = useState("");

  const createTrip = trpc.trips.create.useMutation({
    onSuccess: () => utils.trips.list.invalidate(),
  });

  const addMember = trpc.tripMembers.add.useMutation();

  const isSubmitting = createTrip.isPending || addMember.isPending;

  const handleSubmit = async () => {
    setError("");
    const tripId = crypto.randomUUID();
    try {
      await createTrip.mutateAsync({
        id: tripId,
        title: tripName.trim(),
        description: description.trim() || undefined,
        location: location.trim() || null,
        startDate: startDate || null,
        endDate: endDate || null,
      });

      // Add invited members (fail-soft per member)
      for (const invite of invites) {
        try {
          await addMember.mutateAsync({
            tripId,
            userId: invite.userId,
            role: invite.role,
          });
        } catch {
          // Non-fatal: trip still created
        }
      }

      router.push(`/trips/${tripId}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create trip");
    }
  };

  return (
    <div
      className="min-h-screen"
      style={{ background: "#0d1117", color: "#e6edf3" }}
    >
      {/* Header */}
      <header
        className="sticky top-0 z-40 flex h-14 items-center gap-3 px-4"
        style={{ background: "#0d1117", borderBottom: "1px solid #30363d" }}
      >
        <button
          onClick={() => (step === 1 ? router.back() : setStep(1))}
          className="flex h-9 w-9 items-center justify-center rounded-full transition-colors hover:bg-white/10"
          style={{ color: "#e6edf3" }}
          aria-label="Back"
        >
          <ArrowLeft size={20} />
        </button>
        <h1 className="text-base font-semibold">New Trip</h1>

        {/* Step indicator */}
        <div className="ml-auto flex items-center gap-1.5">
          {[1, 2].map((s) => (
            <span
              key={s}
              className="h-2 w-2 rounded-full transition-all"
              style={{
                background: s === step ? "#00d4aa" : "#30363d",
                width: s === step ? "20px" : "8px",
              }}
            />
          ))}
        </div>
      </header>

      <main className="mx-auto max-w-lg px-4 pt-6 pb-16">
        {/* Step label */}
        <p className="mb-1 text-xs font-semibold uppercase tracking-wider" style={{ color: "#8b949e" }}>
          Step {step} of 2
        </p>
        <h2 className="mb-6 text-xl font-bold" style={{ color: "#e6edf3" }}>
          {step === 1 ? "Name your trip" : "Where are you going?"}
        </h2>

        {error && (
          <div
            className="mb-4 rounded-lg border px-4 py-3 text-sm"
            style={{ background: "#1f1010", borderColor: "#ef444488", color: "#ef4444" }}
          >
            {error}
          </div>
        )}

        {step === 1 ? (
          <Step1
            tripName={tripName}
            onTripNameChange={setTripName}
            description={description}
            onDescriptionChange={setDescription}
            invites={invites}
            onAddInvite={(u) => setInvites((prev) => [...prev, u])}
            onRemoveInvite={(id) =>
              setInvites((prev) => prev.filter((i) => i.userId !== id))
            }
            onRoleChange={(id, role) =>
              setInvites((prev) =>
                prev.map((i) => (i.userId === id ? { ...i, role } : i))
              )
            }
            onNext={() => setStep(2)}
          />
        ) : (
          <Step2
            location={location}
            onLocationChange={setLocation}
            startDate={startDate}
            onStartDateChange={setStartDate}
            endDate={endDate}
            onEndDateChange={setEndDate}
            onBack={() => setStep(1)}
            onSubmit={handleSubmit}
            isSubmitting={isSubmitting}
          />
        )}
      </main>
    </div>
  );
}
