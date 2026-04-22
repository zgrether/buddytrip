"use client";

import { useState } from "react";
import {
  ChevronRight,
  Trophy,
  Check,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { trpc } from "@/lib/trpc-client";
import { getTripStatus } from "@/components/StatusBadge";
import { useModalBackButton } from "@/hooks/useModalBackButton";
import IdeaZonePanel from "../components/IdeaZonePanel";
import { ActionCenter } from "./components/ActionCenter";
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

// ── HomeTab ──────────────────────────────────────────────────────────────

export function HomeTab({
  trip,
  canEdit: canEditProp,
  isOwner,
  onTabChange,
  onEnableComp,
  onOpenChat,
  onWriteInvitation,
}: TabProps & { displayStatus?: TripDisplayStatus; onTabChange?: (tab: string) => void; onEnableComp?: () => void; onOpenChat?: () => void; onWriteInvitation?: () => void }) {
  const { data: ideas = [] } = trpc.ideas.list.useQuery({ tripId: trip.id });
  const { data: reservations = [] } = trpc.reservations.list.useQuery({ tripId: trip.id });

  const status = getTripStatus(trip);
  const _isCompleted = status === "past";
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
      {/* ── Action Center — unified "what needs your attention"   ── */}
      {/*    surface: idea/planning show Dates cards, going shows    ── */}
      {/*    the RSVP card. Rendered first so it stays visible        ── */}
      {/*    above the itinerary once the trip is going.              ── */}
      {(stage === "idea" || stage === "planning" || stage === "going") && (
        <ActionCenter trip={trip} isOwner={!!isOwner} canEdit={canEditProp} onTabChange={onTabChange} onWriteInvitation={onWriteInvitation} />
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

      {/* ── Lodging moved to its own Lodging tab (between Crew and   ── */}
      {/*    Schedule). Home deliberately doesn't render it anymore so ── */}
      {/*    the main flow stays focused on status + itinerary.        ── */}

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
