"use client";

import { useState, Fragment } from "react";
import {
  ChevronRight,
  X,
  Trophy,
  Check,
  Edit2,
  Bell,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { trpc } from "@/lib/trpc-client";
import { getTripStatus } from "@/components/StatusBadge";
import { useModalBackButton } from "@/hooks/useModalBackButton";
import IdeaZonePanel from "../components/IdeaZonePanel";
import { ActionCenter } from "./components/ActionCenter";
import { LodgingPanel } from "../components/LodgingPanel";
import { TravelPanel } from "../components/TravelPanel";
import { ItineraryPanel } from "../components/ItineraryPanel";
import type { TripDisplayStatus } from "@/lib/tripStatus";
import type { TabProps, TripData } from "./types";

// ── Competition Preview Modal ─────────────────────────────────────────────

function CompetitionPreviewModal({
  onConfirm,
  onDismiss,
}: {
  onConfirm: () => void;
  onDismiss: () => void;
}) {
  useModalBackButton(onDismiss);
  const mockTeams = [
    { short: "USA", color: "#3b82f6", pts: 24, maxPts: 24 },
    { short: "EUR", color: "#ef4444", pts: 18, maxPts: 24 },
  ];
  const mockRounds = [
    { title: "Scramble", status: "closed" as const },
    { title: "Skins", status: "active" as const },
    { title: "Singles", status: "upcoming" as const },
  ];
  const features = ["Custom teams", "Live scoring", "Play groups", "Leaderboard"];

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center p-4 sm:items-center"
      onClick={onDismiss}
    >
      <div className="absolute inset-0" style={{ background: "var(--color-bt-overlay)" }} />
      <div
        className="relative w-full max-w-sm overflow-hidden rounded-2xl"
        style={{ background: "var(--color-bt-card)", border: "1px solid var(--color-bt-border)" }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Epic gradient header */}
        <div
          className="px-5 pb-6 pt-8 text-center"
          style={{
            background:
              "linear-gradient(160deg, hsl(220,65%,18%) 0%, hsl(260,55%,14%) 50%, hsl(20,75%,16%) 100%)",
          }}
        >
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl"
            style={{ background: "rgba(255,255,255,0.1)", border: "1px solid rgba(255,255,255,0.18)" }}
          >
            <Trophy size={30} style={{ color: "hsl(45,100%,65%)" }} />
          </div>
          <p className="text-xl font-bold text-white">Competition Mode</p>
          <p className="mt-1 text-sm" style={{ color: "rgba(255,255,255,0.55)" }}>
            Turn your trip into a tournament
          </p>

          {/* Mini scoreboard preview */}
          <div
            className="mt-5 rounded-xl p-3 text-left"
            style={{ background: "rgba(0,0,0,0.35)", border: "1px solid rgba(255,255,255,0.1)" }}
          >
            <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider" style={{ color: "rgba(255,255,255,0.4)" }}>
              Leaderboard
            </p>
            <div className="space-y-2 mb-3">
              {mockTeams.map((t) => (
                <div key={t.short} className="flex items-center gap-2.5">
                  <div
                    className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-md text-[9px] font-bold text-white"
                    style={{ background: t.color }}
                  >
                    {t.short}
                  </div>
                  <div className="flex-1 overflow-hidden rounded-full" style={{ background: "rgba(255,255,255,0.1)", height: 6 }}>
                    <div
                      className="h-full rounded-full"
                      style={{ width: `${(t.pts / t.maxPts) * 100}%`, background: t.color }}
                    />
                  </div>
                  <span className="w-6 text-right text-xs font-bold text-white">{t.pts}</span>
                </div>
              ))}
            </div>
            <div className="flex gap-1.5">
              {mockRounds.map((r) => {
                const isActive = r.status === "active";
                const isDone = r.status === "closed";
                return (
                  <div
                    key={r.title}
                    className="flex-1 rounded-lg px-1.5 py-1 text-center"
                    style={{
                      background: isActive ? "rgba(99,200,120,0.15)" : "rgba(255,255,255,0.06)",
                      border: `1px solid ${isActive ? "rgba(99,200,120,0.35)" : "rgba(255,255,255,0.1)"}`,
                    }}
                  >
                    <p className="truncate text-[9px] font-semibold" style={{ color: isActive ? "#6bc87a" : "rgba(255,255,255,0.55)" }}>
                      {r.title}
                    </p>
                    <p className="text-[8px]" style={{ color: "rgba(255,255,255,0.3)" }}>
                      {isDone ? "✓ done" : isActive ? "▶ live" : "soon"}
                    </p>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* Feature pills */}
        <div className="flex flex-wrap justify-center gap-2 px-5 py-4">
          {features.map((f) => (
            <span
              key={f}
              className="flex items-center gap-1 rounded-full px-2.5 py-1 text-xs"
              style={{
                background: "var(--color-bt-accent-faint)",
                border: "1px solid var(--color-bt-accent-border)",
                color: "var(--color-bt-accent)",
              }}
            >
              <Check size={10} />
              {f}
            </span>
          ))}
        </div>

        {/* Actions */}
        <div className="space-y-2 px-5 pb-6">
          <button
            data-testid="competition-preview-confirm"
            onClick={onConfirm}
            className="flex w-full items-center justify-center gap-2 rounded-xl py-3 text-sm font-semibold"
            style={{ background: "var(--color-bt-accent)", color: "var(--color-bt-base)" }}
          >
            <Trophy size={15} />
            Let&apos;s Go!
          </button>
          <button
            data-testid="competition-preview-dismiss"
            onClick={onDismiss}
            className="w-full py-2.5 text-sm"
            style={{ color: "var(--color-bt-text-dim)" }}
          >
            No thanks
          </button>
        </div>
      </div>
    </div>
  );
}

// RsvpPanel was moved to ./components/RsvpActionCard.tsx and is now
// rendered via ActionCenter for the going stage.

// ── Competition Panel ─────────────────────────────────────────────────────

function CompetitionPanel({
  trip,
  canEdit,
  onSetupComp,
}: {
  trip: TripData;
  canEdit: boolean;
  onSetupComp?: () => void;
}) {
  const router = useRouter();
  const [showPreview, setShowPreview] = useState(false);
  const hasComp = !!trip.event_id;

  const { data: event } = trpc.events.getByTrip.useQuery(
    { tripId: trip.id },
    { enabled: hasComp }
  );

  // Use trip.event_id (available immediately from the trip object) so teams
  // and scores fire in parallel with events.getByTrip instead of waiting for
  // it to resolve first — eliminates the 2-step waterfall.
  const knownEventId = event?.id ?? trip.event_id ?? "";

  const { data: teams = [] } = trpc.teams.list.useQuery(
    { tripId: trip.id, eventId: knownEventId },
    { enabled: !!knownEventId }
  );

  const { data: scoreRows = [] } = trpc.groupResults.listScoresByEvent.useQuery(
    { tripId: trip.id, eventId: knownEventId },
    { enabled: !!knownEventId }
  );

  // Aggregate total points per team, sorted descending
  const teamTotals = teams
    .map((t) => ({
      ...t,
      total: scoreRows
        .filter((r) => r.team_id === t.id)
        .reduce((sum, r) => sum + (r.total_points ?? 0), 0),
    }))
    .sort((a, b) => b.total - a.total);

  if (hasComp && event) {
    return (
      <button
        data-testid="competition-panel"
        onClick={() => router.push(`/trips/${trip.id}/leaderboard`)}
        className="w-full rounded-xl p-4 text-left"
        style={{ background: "var(--color-bt-tag-bg)", border: "1px solid var(--color-bt-accent-border)" }}
      >
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <Trophy size={16} style={{ color: "var(--color-bt-accent)" }} />
            <p className="text-xs font-semibold uppercase tracking-wider" style={{ color: "var(--color-bt-accent)" }}>
              {event.title ?? "Competition"}
            </p>
          </div>
          <span className="flex items-center gap-1 text-xs font-medium" style={{ color: "var(--color-bt-accent)" }}>
            Leaderboard <ChevronRight size={14} />
          </span>
        </div>
        {teamTotals.length > 0 ? (
          <div className="flex gap-3">
            {teamTotals.map((team) => (
              <div
                key={team.id}
                className="flex-1 rounded-lg p-2 text-center"
                style={{ background: "var(--color-bt-base)", border: "1px solid var(--color-bt-border)" }}
              >
                <p
                  className="text-[10px] font-semibold truncate mb-0.5"
                  style={{ color: team.color }}
                >
                  {team.short_name}
                </p>
                <p className="text-lg font-bold" style={{ color: "var(--color-bt-text)" }}>
                  {team.total}
                </p>
                <p className="text-[10px]" style={{ color: "var(--color-bt-text-dim)" }}>pts</p>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-xs" style={{ color: "var(--color-bt-text-dim)" }}>No scores yet</p>
        )}
      </button>
    );
  }

  if (!hasComp && canEdit) {
    return (
      <>
        <button
          data-testid="home-setup-competition-btn"
          onClick={() => setShowPreview(true)}
          className="w-full rounded-xl p-4 text-center"
          style={{ border: "1.5px dashed var(--color-bt-border)", background: "var(--color-bt-surface-invitation)" }}
        >
          <Trophy size={20} className="mx-auto mb-2" style={{ color: "var(--color-bt-text-dim)" }} />
          <p className="text-sm font-semibold" style={{ color: "var(--color-bt-text)" }}>
            Add a Competition
          </p>
          <p className="text-xs mt-0.5" style={{ color: "var(--color-bt-text-dim)" }}>
            Your group already has a rivalry. Give it a scoreboard.
          </p>
        </button>
        {showPreview && (
          <CompetitionPreviewModal
            onConfirm={() => { setShowPreview(false); onSetupComp?.(); }}
            onDismiss={() => setShowPreview(false)}
          />
        )}
      </>
    );
  }

  return null;
}

// ── Planning Section (expandable rows) ───────────────────────────────────

function PlanningSection({
  trip,
  canEdit,
  isOwner,
  onTabChange,
}: {
  trip: TripData;
  canEdit: boolean;
  isOwner: boolean;
  onTabChange?: (tab: string) => void;
}) {
  const stage = trip.stage ?? "idea";
  const [travelOpen, setTravelOpen] = useState(false);

  return (
    <section className="space-y-2">
      <p
        className="text-xs font-semibold uppercase tracking-wider"
        style={{ color: "var(--color-bt-text-dim)" }}
      >
        Planning
      </p>

      {/* ── Lodging — always expanded ── */}
      <LodgingPanel
        tripId={trip.id}
        canEdit={canEdit}
        isOpen={true}
        onToggle={() => {}}
      />
      {/* ── Travel — hidden during planning ── */}
      {stage !== "planning" && (
        <TravelPanel
          tripId={trip.id}
          isOpen={travelOpen}
          onToggle={() => setTravelOpen((v) => !v)}
        />
      )}
    </section>
  );
}

// ── About Panel (GOING / NOW / PAST) ────────────────────────────────────

function AboutPanel({ tripId, aboutMessage, canEdit, isPast }: { tripId: string; aboutMessage?: string | null; canEdit: boolean; isPast: boolean }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(aboutMessage ?? "");
  const [notifyState, setNotifyState] = useState<"idle" | "confirm" | "sending" | "success" | "error">("idle");
  const utils = trpc.useUtils();

  const update = trpc.trips.updateAboutMessage.useMutation({
    onSuccess() {
      utils.trips.getById.invalidate({ tripId });
      setEditing(false);
    },
  });

  const notifyCrew = trpc.tripMembers.notifyCrewAboutUpdate.useMutation({
    onSuccess() {
      setNotifyState("success");
      setTimeout(() => setNotifyState("idle"), 2000);
    },
    onError() {
      setNotifyState("error");
      setTimeout(() => setNotifyState("idle"), 3000);
    },
  });

  if (!aboutMessage && !canEdit) return null;

  const showNotifyButton = canEdit && !isPast && !editing && !!aboutMessage?.trim();

  return (
    <>
      <div
        className="mx-4 rounded-xl p-5 lg:mx-0"
        style={{ background: "var(--color-bt-card)", border: "1px solid var(--color-bt-border)" }}
      >
        {/* Header row */}
        <div className="mb-2 flex items-center justify-between">
          <p className="text-xs font-semibold uppercase tracking-wider" style={{ color: "var(--color-bt-text-dim)" }}>
            About
          </p>
          <div className="flex items-center gap-2">
            {showNotifyButton && (
              notifyState === "success" ? (
                <p className="text-xs font-medium" style={{ color: "var(--color-bt-accent)" }}>
                  Crew notified ✓
                </p>
              ) : notifyState === "error" ? (
                <p className="text-xs" style={{ color: "var(--color-bt-danger)" }}>
                  Couldn&apos;t send — try again
                </p>
              ) : (
                <button
                  onClick={() => setNotifyState("confirm")}
                  disabled={notifyState === "sending"}
                  className="flex items-center gap-1 rounded-xl border px-2.5 py-1 text-xs font-medium transition-opacity hover:opacity-80 disabled:opacity-40"
                  style={{ borderColor: "var(--color-bt-border)", color: "var(--color-bt-text-dim)" }}
                >
                  <Bell size={13} />
                  Notify Crew
                </button>
              )
            )}
            {canEdit && !editing && (
              <button
                onClick={() => { setDraft(aboutMessage ?? ""); setEditing(true); }}
                className="flex items-center justify-center rounded p-0.5 transition-opacity hover:opacity-70"
                style={{ color: "var(--color-bt-text-dim)" }}
                aria-label="Edit about message"
              >
                <Edit2 size={14} />
              </button>
            )}
          </div>
        </div>

        {editing ? (
          <>
            <div className="relative">
              <textarea
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                rows={4}
                autoFocus
                className="w-full resize-none rounded-xl border px-3 py-2.5 text-sm outline-none"
                style={{
                  background: "var(--color-bt-card-raised)",
                  borderColor: "var(--color-bt-border)",
                  color: "var(--color-bt-text)",
                }}
              />
              {draft && (
                <button
                  onClick={() => setDraft("")}
                  className="absolute right-2 top-2 rounded p-0.5 transition-opacity hover:opacity-70"
                  style={{ color: "var(--color-bt-text-dim)" }}
                  aria-label="Clear"
                >
                  <X size={14} />
                </button>
              )}
            </div>
            <div className="mt-2 flex gap-2">
              <button
                onClick={() => update.mutate({ tripId, aboutMessage: draft.trim() || null })}
                disabled={update.isPending}
                className="rounded-lg px-4 py-1.5 text-sm font-semibold transition-opacity disabled:opacity-40"
                style={{ background: "var(--color-bt-accent)", color: "var(--color-bt-base)" }}
              >
                {update.isPending ? "Saving..." : "Save"}
              </button>
              <button
                onClick={() => setEditing(false)}
                className="rounded-lg px-4 py-1.5 text-sm transition-opacity hover:opacity-70"
                style={{ color: "var(--color-bt-text-dim)" }}
              >
                Cancel
              </button>
            </div>
          </>
        ) : (
          aboutMessage && (
            <p className="text-sm leading-relaxed" style={{ color: "var(--color-bt-text)" }}>
              {aboutMessage}
            </p>
          )
        )}
      </div>

      {/* Notify crew confirmation modal */}
      {notifyState === "confirm" && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center lg:items-center"
          style={{ background: "var(--color-bt-overlay)" }}
          onClick={() => setNotifyState("idle")}
        >
          <div
            className="w-full max-w-[400px] rounded-t-2xl p-6 lg:rounded-2xl"
            style={{ background: "var(--color-bt-card)" }}
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="text-base font-semibold" style={{ color: "var(--color-bt-text)" }}>
              Send out this update?
            </h2>
            {aboutMessage && (
              <p
                className="mt-3 rounded-xl px-4 py-3 text-sm leading-relaxed"
                style={{ background: "var(--color-bt-card-raised)", color: "var(--color-bt-text)" }}
              >
                {aboutMessage}
              </p>
            )}
            <button
              onClick={() => { setNotifyState("sending"); notifyCrew.mutate({ tripId }); }}
              className="mt-4 w-full rounded-xl py-3 text-sm font-semibold transition-opacity hover:opacity-90"
              style={{ background: "var(--color-bt-accent)", color: "var(--color-bt-base)" }}
            >
              Yes, notify crew
            </button>
            <button
              onClick={() => setNotifyState("idle")}
              className="mt-2 w-full rounded-xl py-2.5 text-sm transition-opacity hover:opacity-80"
              style={{ color: "var(--color-bt-text-dim)" }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </>
  );
}

// ── HomeTab ──────────────────────────────────────────────────────────────

export function HomeTab({
  trip,
  canEdit: canEditProp,
  isOwner,
  onTabChange,
  onEnableComp,
  onOpenChat,
}: TabProps & { displayStatus?: TripDisplayStatus; onTabChange?: (tab: string) => void; onEnableComp?: () => void; onOpenChat?: () => void }) {
  const { data: ideas = [] } = trpc.ideas.list.useQuery({ tripId: trip.id });
  const { data: reservations = [] } = trpc.reservations.list.useQuery({ tripId: trip.id });

  const status = getTripStatus(trip);
  const _isCompleted = status === "past";
  const isLocked = !!trip.locked_destination_title;
  const _isExploring = !!trip.comparison_mode && !isLocked;
  const isBlank = !trip.comparison_mode && !isLocked;
  const stage = trip.stage ?? "idea";

  // IDEA stage: render IdeaZonePanel only — no planning rows
  if (stage === "idea") {
    return (
      <IdeaZonePanel
        trip={trip}
        canEdit={canEditProp}
        isOwner={!!isOwner}
        onTabChange={onTabChange}
        onOpenChat={onOpenChat}
      />
    );
  }

  return (
    <div className="space-y-4">
      {/* ── GOING / NOW / PAST stage: About panel ──────────────── */}
      {(stage === "going" || status === "now" || status === "past") && (
        <AboutPanel tripId={trip.id} aboutMessage={trip.about_message} canEdit={canEditProp} isPast={status === "past"} />
      )}

      {/* ── Itinerary panel — read-only confirmed-only timeline ── */}
      {stage !== "idea" && stage !== "planning" && (
        <ItineraryPanel
          tripId={trip.id}
          tripStartDate={trip.start_date}
          stage={stage}
          status={status}
          onTabChange={onTabChange}
        />
      )}

      {/* ── Action Center — unified "what needs your attention"   ── */}
      {/*    surface: idea/planning show Dates cards, going shows    ── */}
      {/*    the RSVP card.                                          ── */}
      {(stage === "idea" || stage === "planning" || stage === "going") && (
        <ActionCenter trip={trip} isOwner={!!isOwner} canEdit={canEditProp} onTabChange={onTabChange} />
      )}

      {/* ── Planning rows — gated by stage + canEdit ──────────── */}
      {(isBlank || isLocked) && (stage === "idea" || stage === "planning") && canEditProp && (
        <PlanningSection
          trip={trip}
          canEdit={canEditProp}
          isOwner={!!isOwner}
          onTabChange={onTabChange}
        />
      )}

      {/* ── GOING/NOW: planning rows — logistics stays editable ── */}
      {(stage === "going" || status === "now" || status === "past") && (isBlank || isLocked) && (
        <PlanningSection
          trip={trip}
          canEdit={canEditProp}
          isOwner={!!isOwner}
          onTabChange={onTabChange}
        />
      )}

      {/* Competition panel — only in READY stage and beyond */}
      {stage !== "idea" && stage !== "planning" && (
        <CompetitionPanel
          trip={trip}
          canEdit={canEditProp}
          onSetupComp={onEnableComp}
        />
      )}
    </div>
  );
}
