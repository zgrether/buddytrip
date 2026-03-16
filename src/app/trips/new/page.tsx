"use client";

import { useState, useRef } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  ArrowRight,
  X,
  Search,
  Plus,
  Check,
  MapPin,
  Vote,
  Loader2,
  Sparkles,
  Trash2,
} from "lucide-react";
import { trpc } from "@/lib/trpc-client";

// ── Types ────────────────────────────────────────────────────────────────────

interface PendingInvite {
  userId: string;
  name: string;
  email: string;
  role: "Planner" | "Member";
}

interface SuggestedDestination {
  title: string;
  location: string;
  description: string;
  costTier: string;
}

// ── Step 1 — Trip name + co-planner invites ───────────────────────────────

function Step1({
  tripName,
  onTripNameChange,
  nameError,
  onNameBlur,
  invites,
  onAddInvite,
  onRemoveInvite,
  onNext,
}: {
  tripName: string;
  onTripNameChange: (v: string) => void;
  nameError: string;
  onNameBlur: () => void;
  invites: PendingInvite[];
  onAddInvite: (u: PendingInvite) => void;
  onRemoveInvite: (userId: string) => void;
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

  const hasNoMatch =
    !isFetching && query.length >= 2 && filteredResults.length === 0;

  return (
    <div className="space-y-6">
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
          onChange={(e) => onTripNameChange(e.target.value)}
          onBlur={onNameBlur}
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
          <p
            className="mt-1 text-xs"
            style={{ color: "var(--color-bt-danger)" }}
          >
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
                      onAddInvite({
                        userId: user.id,
                        name:
                          user.nickname ?? user.name ?? user.email,
                        email: user.email,
                        role: "Planner",
                      });
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
          Co-planners can help manage the trip. You can invite the rest of the
          crew later.
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
                  onClick={() => onRemoveInvite(invite.userId)}
                  className="flex h-4 w-4 items-center justify-center rounded-full transition-colors hover:bg-[var(--color-bt-hover)]"
                >
                  <X size={12} />
                </button>
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Next */}
      <button
        data-testid="step1-next"
        onClick={onNext}
        disabled={!tripName.trim()}
        className="flex w-full items-center justify-center gap-2 rounded-xl py-3 text-sm font-semibold transition-opacity disabled:opacity-40"
        style={{
          background: "var(--color-bt-accent)",
          color: "var(--color-bt-base)",
        }}
      >
        Next
        <ArrowRight size={16} />
      </button>

    </div>
  );
}

// ── Step 2 — Where are you headed? ────────────────────────────────────────

type DestinationChoice = null | "known" | "vote";

interface AiIdea {
  id: string;
  title: string;
  location: string;
  description: string;
  costTier: string;
  source: "ai";
}

function Step2({
  choice,
  onChoiceChange,
  destination,
  onDestinationChange,
  voteDests,
  onAddVoteDest,
  onRemoveVoteDest,
  crewDescription,
  onCrewDescriptionChange,
  aiIdeas,
  onAiIdeasChange,
  onBack,
  onSubmit,
  isSubmitting,
  validationError,
}: {
  choice: DestinationChoice;
  onChoiceChange: (c: DestinationChoice) => void;
  destination: string;
  onDestinationChange: (v: string) => void;
  voteDests: string[];
  onAddVoteDest: (d: string) => void;
  onRemoveVoteDest: (idx: number) => void;
  crewDescription: string;
  onCrewDescriptionChange: (v: string) => void;
  aiIdeas: AiIdea[];
  onAiIdeasChange: (ideas: AiIdea[]) => void;
  onBack: () => void;
  onSubmit: () => void;
  isSubmitting: boolean;
  validationError: string;
}) {
  const [destInput, setDestInput] = useState("");
  const [isFetchingAi, setIsFetchingAi] = useState(false);
  const [aiError, setAiError] = useState("");

  const handleAddDest = () => {
    const trimmed = destInput.trim();
    if (trimmed) {
      onAddVoteDest(trimmed);
      setDestInput("");
    }
  };

  const handleRequestAiIdeas = async () => {
    setAiError("");
    setIsFetchingAi(true);
    try {
      const res = await fetch("/api/ai/suggest-destinations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          crewDescription: crewDescription.trim(),
        }),
      });

      if (!res.ok) {
        setAiError("Failed to get AI suggestions. Please try again.");
        return;
      }

      const data = await res.json();
      const ideas: AiIdea[] = (data.suggestions ?? []).map(
        (s: SuggestedDestination, i: number) => ({
          id: `idea-ai-${Date.now()}-${i}`,
          title: s.title,
          location: s.location,
          description: s.description,
          costTier: s.costTier,
          source: "ai" as const,
        })
      );
      onAiIdeasChange(ideas);
    } catch {
      setAiError("Failed to get AI suggestions. Please try again.");
    } finally {
      setIsFetchingAi(false);
    }
  };

  const handleRemoveAiIdea = (id: string) => {
    onAiIdeasChange(aiIdeas.filter((idea) => idea.id !== id));
  };

  // For vote mode: need at least one dest (manual or AI) to create
  const hasAnyIdeas = voteDests.length > 0 || aiIdeas.length > 0;

  return (
    <div className="space-y-4">
      {/* Back button */}
      <button
        data-testid="step2-back"
        onClick={onBack}
        className="flex items-center gap-1 text-sm transition-colors"
        style={{ color: "var(--color-bt-text-dim)" }}
      >
        <ArrowLeft size={16} />
        Back
      </button>

      {/* Choice cards — always visible */}
      <div className="space-y-3">
        {/* Choice A — Known destination */}
        <div>
          <button
            data-testid="choice-known"
            onClick={() => onChoiceChange(choice === "known" ? null : "known")}
            className="flex w-full items-center gap-4 rounded-xl border-2 p-5 text-left transition-all hover:border-[var(--color-bt-accent)]"
            style={{
              background: "var(--color-bt-card)",
              borderColor:
                choice === "known"
                  ? "var(--color-bt-accent)"
                  : "var(--color-bt-border)",
            }}
          >
            <div
              className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-xl"
              style={{ background: "var(--color-bt-tag-bg)" }}
            >
              <MapPin
                size={24}
                style={{ color: "var(--color-bt-accent)" }}
              />
            </div>
            <div>
              <p
                className="text-base font-semibold"
                style={{ color: "var(--color-bt-text)" }}
              >
                Yes, we&apos;re going to...
              </p>
              <p
                className="text-sm"
                style={{ color: "var(--color-bt-text-dim)" }}
              >
                I know the destination
              </p>
            </div>
          </button>

          {/* Known destination form — revealed inline */}
          {choice === "known" && (
            <div className="mt-3 space-y-4 pl-4 border-l-2" style={{ borderColor: "var(--color-bt-accent)" }}>
              <div>
                <label
                  htmlFor="dest-known"
                  className="mb-1.5 block text-sm font-medium"
                  style={{ color: "var(--color-bt-text)" }}
                >
                  Where are you going?
                </label>
                <input
                  id="dest-known"
                  data-testid="destination-input"
                  type="text"
                  autoFocus
                  value={destination}
                  onChange={(e) => onDestinationChange(e.target.value)}
                  placeholder="Bandon Dunes, OR"
                  maxLength={500}
                  className="w-full rounded-lg border px-3 py-2.5 text-sm outline-none focus:ring-1"
                  style={{
                    background: "var(--color-bt-card)",
                    borderColor: "var(--color-bt-border)",
                    color: "var(--color-bt-text)",
                  }}
                />
              </div>

              <button
                data-testid="create-trip-known"
                onClick={onSubmit}
                disabled={isSubmitting || !destination.trim()}
                className="flex w-full items-center justify-center gap-2 rounded-xl py-3 text-sm font-semibold transition-opacity disabled:opacity-40"
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
                  <>
                    <Check size={16} />
                    Create Trip
                  </>
                )}
              </button>
            </div>
          )}
        </div>

        {/* Choice B — Vote */}
        <div>
          <button
            data-testid="choice-vote"
            onClick={() => onChoiceChange(choice === "vote" ? null : "vote")}
            className="flex w-full items-center gap-4 rounded-xl border-2 p-5 text-left transition-all hover:border-[var(--color-bt-accent)]"
            style={{
              background: "var(--color-bt-card)",
              borderColor:
                choice === "vote"
                  ? "var(--color-bt-accent)"
                  : "var(--color-bt-border)",
            }}
          >
            <div
              className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-xl"
              style={{ background: "var(--color-bt-tag-bg)" }}
            >
              <Vote
                size={24}
                style={{ color: "var(--color-bt-accent)" }}
              />
            </div>
            <div>
              <p
                className="text-base font-semibold"
                style={{ color: "var(--color-bt-text)" }}
              >
                Let&apos;s put it to a vote
              </p>
              <p
                className="text-sm"
                style={{ color: "var(--color-bt-text-dim)" }}
              >
                Compare destinations and let the crew decide
              </p>
            </div>
          </button>

          {/* Vote form — revealed inline */}
          {choice === "vote" && (
            <div className="mt-3 space-y-5 pl-4 border-l-2" style={{ borderColor: "var(--color-bt-accent)" }}>
              {/* Sub-section 1: Add destinations to compare */}
              <div>
                <p
                  className="mb-2 text-sm font-semibold"
                  style={{ color: "var(--color-bt-text)" }}
                >
                  Add destinations to compare
                </p>

                <div className="flex gap-2">
                  <input
                    data-testid="vote-dest-input"
                    type="text"
                    value={destInput}
                    onChange={(e) => setDestInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        handleAddDest();
                      }
                    }}
                    placeholder="Enter a destination"
                    maxLength={500}
                    className="flex-1 rounded-lg border px-3 py-2.5 text-sm outline-none focus:ring-1"
                    style={{
                      background: "var(--color-bt-card)",
                      borderColor: "var(--color-bt-border)",
                      color: "var(--color-bt-text)",
                    }}
                  />
                  <button
                    data-testid="add-vote-dest"
                    onClick={handleAddDest}
                    disabled={!destInput.trim()}
                    className="rounded-lg px-4 py-2.5 text-sm font-medium transition-opacity disabled:opacity-40"
                    style={{
                      background: "var(--color-bt-accent)",
                      color: "var(--color-bt-base)",
                    }}
                  >
                    Add
                  </button>
                </div>

                {/* Destination chips */}
                {voteDests.length > 0 && (
                  <div className="mt-3 flex flex-wrap gap-2">
                    {voteDests.map((d, i) => (
                      <span
                        key={i}
                        data-testid={`vote-dest-chip-${i}`}
                        className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm"
                        style={{
                          background: "var(--color-bt-tag-bg)",
                          color: "var(--color-bt-accent)",
                        }}
                      >
                        {d}
                        <button
                          onClick={() => onRemoveVoteDest(i)}
                          className="flex h-4 w-4 items-center justify-center rounded-full transition-colors hover:bg-[var(--color-bt-hover)]"
                        >
                          <X size={12} />
                        </button>
                      </span>
                    ))}
                  </div>
                )}
              </div>

              {/* Sub-section 2: Tell us about your trip and crew */}
              <div>
                <p
                  className="mb-2 text-sm font-semibold"
                  style={{ color: "var(--color-bt-text)" }}
                >
                  Tell us about your trip and crew
                </p>
                <textarea
                  data-testid="crew-description"
                  value={crewDescription}
                  onChange={(e) => onCrewDescriptionChange(e.target.value)}
                  placeholder="e.g. 6 guys, links lovers, mid-range budget, did Bandon last year..."
                  rows={3}
                  maxLength={2000}
                  className="w-full resize-none rounded-lg border px-3 py-2.5 text-sm outline-none focus:ring-1"
                  style={{
                    background: "var(--color-bt-card)",
                    borderColor: "var(--color-bt-border)",
                    color: "var(--color-bt-text)",
                  }}
                />

                {/* Get AI Ideas button */}
                <button
                  data-testid="get-ai-ideas"
                  onClick={handleRequestAiIdeas}
                  disabled={!crewDescription.trim() || isFetchingAi}
                  className="mt-2 flex w-full items-center justify-center gap-2 rounded-lg py-2.5 text-sm font-medium transition-opacity disabled:opacity-40"
                  style={{
                    background: "var(--color-bt-tag-bg)",
                    color: "var(--color-bt-accent)",
                  }}
                >
                  {isFetchingAi ? (
                    <>
                      <Loader2 size={16} className="animate-spin" />
                      Getting AI ideas...
                    </>
                  ) : (
                    <>
                      <Sparkles size={16} />
                      Get AI Ideas
                    </>
                  )}
                </button>

                {aiError && (
                  <p
                    className="mt-1 text-xs"
                    style={{ color: "var(--color-bt-danger)" }}
                  >
                    {aiError}
                  </p>
                )}
              </div>

              {/* AI Ideas display */}
              {aiIdeas.length > 0 && (
                <div>
                  <p
                    className="mb-2 text-sm font-semibold"
                    style={{ color: "var(--color-bt-text)" }}
                  >
                    AI-suggested destinations
                  </p>
                  <div className="space-y-2">
                    {aiIdeas.map((idea) => (
                      <div
                        key={idea.id}
                        data-testid={`ai-idea-${idea.id}`}
                        className="flex items-start gap-3 rounded-lg border p-3"
                        style={{
                          background: "var(--color-bt-card)",
                          borderColor: "var(--color-bt-border)",
                        }}
                      >
                        <Sparkles
                          size={16}
                          className="mt-0.5 flex-shrink-0"
                          style={{ color: "var(--color-bt-accent)" }}
                        />
                        <div className="min-w-0 flex-1">
                          <p
                            className="text-sm font-medium"
                            style={{ color: "var(--color-bt-text)" }}
                          >
                            {idea.title}
                          </p>
                          <p
                            className="text-xs"
                            style={{ color: "var(--color-bt-text-dim)" }}
                          >
                            {idea.location}
                            {idea.costTier && ` · ${idea.costTier}`}
                          </p>
                          {idea.description && (
                            <p
                              className="mt-1 text-xs"
                              style={{ color: "var(--color-bt-text-dim)" }}
                            >
                              {idea.description}
                            </p>
                          )}
                        </div>
                        <button
                          onClick={() => handleRemoveAiIdea(idea.id)}
                          className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded transition-colors hover:bg-[var(--color-bt-hover)]"
                          aria-label={`Remove ${idea.title}`}
                        >
                          <Trash2
                            size={14}
                            style={{ color: "var(--color-bt-text-dim)" }}
                          />
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {validationError && (
                <p
                  className="text-sm"
                  style={{ color: "var(--color-bt-danger)" }}
                  data-testid="validation-error"
                >
                  {validationError}
                </p>
              )}

              <button
                data-testid="create-trip-vote"
                onClick={onSubmit}
                disabled={isSubmitting || !hasAnyIdeas}
                className="flex w-full items-center justify-center gap-2 rounded-xl py-3 text-sm font-semibold transition-opacity disabled:opacity-40"
                style={{
                  background: "var(--color-bt-accent)",
                  color: "var(--color-bt-base)",
                }}
              >
                {isSubmitting ? (
                  <>
                    <Loader2 size={16} className="animate-spin" />
                    Creating your trip...
                  </>
                ) : (
                  <>
                    <Check size={16} />
                    Create Trip
                  </>
                )}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Wizard shell ──────────────────────────────────────────────────────────

export default function TripNewPage() {
  const router = useRouter();
  const utils = trpc.useUtils();

  // Step 1 state
  const [step, setStep] = useState(1);
  const [tripName, setTripName] = useState("");
  const [nameError, setNameError] = useState("");
  const [invites, setInvites] = useState<PendingInvite[]>([]);

  // Step 2 state
  const [choice, setChoice] = useState<DestinationChoice>(null);
  const [destination, setDestination] = useState("");
  const [voteDests, setVoteDests] = useState<string[]>([]);
  const [crewDescription, setCrewDescription] = useState("");
  const [aiIdeas, setAiIdeas] = useState<AiIdea[]>([]);
  const [validationError, setValidationError] = useState("");

  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const createTrip = trpc.trips.create.useMutation({
    onSuccess: () => utils.trips.list.invalidate(),
  });

  const handleNameBlur = () => {
    if (!tripName.trim()) {
      setNameError("Trip needs a name");
    } else {
      setNameError("");
    }
  };

  const handleNext = () => {
    if (!tripName.trim()) {
      setNameError("Trip needs a name");
      return;
    }
    setNameError("");
    setStep(2);
  };

  const handleSubmitKnown = async () => {
    setError("");
    setIsSubmitting(true);
    const tripId = crypto.randomUUID();
    const dest = destination.trim();

    try {
      await createTrip.mutateAsync({
        id: tripId,
        title: tripName.trim(),
        comparisonMode: false,
        lockedDestination: { title: dest, location: dest },
        coplanners: invites.map((i) => ({
          userId: i.userId,
          role: i.role,
        })),
      });

      router.push(`/trips/${tripId}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create trip");
      setIsSubmitting(false);
    }
  };

  const handleSubmitVote = async () => {
    setValidationError("");
    setError("");

    // Validate: need at least one idea (manual or AI)
    if (voteDests.length === 0 && aiIdeas.length === 0) {
      setValidationError(
        "Add at least one destination or get AI ideas before creating the trip."
      );
      return;
    }

    setIsSubmitting(true);
    const tripId = crypto.randomUUID();

    try {
      // Build user-entered ideas
      const userIdeas = voteDests.map((d, i) => ({
        id: `idea-${Date.now()}-${i}`,
        title: d,
        location: d,
        source: "manual" as const,
      }));

      await createTrip.mutateAsync({
        id: tripId,
        title: tripName.trim(),
        comparisonMode: true,
        coplanners: invites.map((i) => ({
          userId: i.userId,
          role: i.role,
        })),
        ideas: [...userIdeas, ...aiIdeas],
      });

      router.push(`/trips/${tripId}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create trip");
      setIsSubmitting(false);
    }
  };

  const handleSubmit = () => {
    if (choice === "known") {
      handleSubmitKnown();
    } else if (choice === "vote") {
      handleSubmitVote();
    }
  };

  return (
    <div
      className="min-h-screen"
      style={{
        background: "var(--color-bt-base)",
        color: "var(--color-bt-text)",
      }}
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
          onClick={() => {
            if (step === 2) {
              setStep(1);
            } else {
              router.back();
            }
          }}
          className="flex h-9 w-9 items-center justify-center rounded-full transition-colors hover:bg-[var(--color-bt-hover)]"
          style={{ color: "var(--color-bt-text)" }}
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
              className="h-2 rounded-full transition-all"
              style={{
                background:
                  s === step
                    ? "var(--color-bt-accent)"
                    : "var(--color-bt-border)",
                width: s === step ? "20px" : "8px",
              }}
            />
          ))}
        </div>
      </header>

      <main className="mx-auto max-w-lg px-4 pt-6 pb-16">
        {/* Step label */}
        <p
          className="mb-1 text-xs font-semibold uppercase tracking-wider"
          style={{ color: "var(--color-bt-text-dim)" }}
        >
          Step {step} of 2
        </p>
        <h2
          className="mb-6 text-xl font-bold"
          style={{ color: "var(--color-bt-text)" }}
        >
          {step === 1
            ? "Let's get started"
            : "Where are you headed?"}
        </h2>

        {error && (
          <div
            className="mb-4 rounded-lg border px-4 py-3 text-sm"
            style={{
              background: "var(--color-bt-danger-bg)",
              borderColor: "var(--color-bt-danger-border)",
              color: "var(--color-bt-danger)",
            }}
          >
            {error}
          </div>
        )}

        {step === 1 ? (
          <Step1
            tripName={tripName}
            onTripNameChange={(v) => {
              setTripName(v);
              if (v.trim()) setNameError("");
            }}
            nameError={nameError}
            onNameBlur={handleNameBlur}
            invites={invites}
            onAddInvite={(u) => setInvites((prev) => [...prev, u])}
            onRemoveInvite={(id) =>
              setInvites((prev) => prev.filter((i) => i.userId !== id))
            }
            onNext={handleNext}
          />
        ) : (
          <Step2
            choice={choice}
            onChoiceChange={setChoice}
            destination={destination}
            onDestinationChange={setDestination}
            voteDests={voteDests}
            onAddVoteDest={(d) => setVoteDests((prev) => [...prev, d])}
            onRemoveVoteDest={(idx) =>
              setVoteDests((prev) => prev.filter((_, i) => i !== idx))
            }
            crewDescription={crewDescription}
            onCrewDescriptionChange={setCrewDescription}
            aiIdeas={aiIdeas}
            onAiIdeasChange={setAiIdeas}
            onBack={() => setStep(1)}
            onSubmit={handleSubmit}
            isSubmitting={isSubmitting}
            validationError={validationError}
          />
        )}
      </main>
    </div>
  );
}
