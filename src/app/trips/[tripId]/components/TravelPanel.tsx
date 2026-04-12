"use client";

import { useState } from "react";
import { Plane, Car } from "lucide-react";
import { trpc } from "@/lib/trpc-client";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { PlanningRow, type ArcCardState } from "./PlanningRow";
import { TravelEntryForm } from "./TravelEntryForm";
import { useModalBackButton } from "@/hooks/useModalBackButton";

// ── Types ─────────────────────────────────────────────────────────────────

interface TripMemberTravel {
  user_id: string | null;
  displayName: string;
  travel_mode?: string | null;
  travel_detail?: string | null;
  flight_airline?: string | null;
  flight_number?: string | null;
  flight_airport?: string | null;
  flight_arrival_time?: string | null;
  travel_shared?: boolean | null;
}

// ── TravelSheet ───────────────────────────────────────────────────────────

function TravelSheet({
  tripId,
  currentTravel,
  onClose,
}: {
  tripId: string;
  currentTravel: TripMemberTravel | null;
  onClose: () => void;
}) {
  useModalBackButton(onClose);

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center lg:items-center"
      style={{ background: "var(--color-bt-overlay)" }}
      onClick={onClose}
    >
      <div
        className="max-h-[85vh] w-full max-w-[480px] overflow-y-auto rounded-t-2xl p-5 lg:rounded-2xl"
        style={{ background: "var(--color-bt-card)" }}
        onClick={(e) => e.stopPropagation()}
      >
        <p className="text-base font-semibold" style={{ color: "var(--color-bt-text)" }}>
          Your Travel Plans
        </p>
        <TravelEntryForm
          tripId={tripId}
          currentTravel={currentTravel}
          onSave={onClose}
        />
        <button
          onClick={onClose}
          className="mt-3 w-full rounded-xl py-2.5 text-sm"
          style={{ color: "var(--color-bt-text-dim)" }}
        >
          Close
        </button>
      </div>
    </div>
  );
}

// ── TravelPanel ───────────────────────────────────────────────────────────

interface TravelPanelProps {
  tripId: string;
  isOpen: boolean;
  onToggle: () => void;
}

export function TravelPanel({ tripId, isOpen, onToggle }: TravelPanelProps) {
  const currentUser = useCurrentUser();
  const { data: members = [] } = trpc.tripMembers.list.useQuery({ tripId });

  const [showTravelSheet, setShowTravelSheet] = useState(false);

  // ── Derived data ─────────────────────────────────────────────────────
  const travelMembers = (members as TripMemberTravel[]).filter(
    (m) => m.travel_shared || m.user_id === currentUser?.id
  );
  const myMember = (members as TripMemberTravel[]).find(
    (m) => m.user_id === currentUser?.id
  );
  const myTravel = myMember ?? null;

  const sharedCount = travelMembers.filter((m) => m.travel_mode).length;
  const totalCount = travelMembers.length;

  // ── PlanningRow header state ──────────────────────────────────────────
  let note = "No travel info yet";
  if (sharedCount > 0) {
    note = `${sharedCount} of ${totalCount} shared`;
  }

  const state: ArcCardState = sharedCount > 0 ? "inProgress" : "none";

  return (
    <>
      <PlanningRow
        icon={<Plane size={16} />}
        label="Travel"
        note={note}
        state={state}
        isOpen={isOpen}
        onToggle={onToggle}
      >
        <div>
          <p className="mb-3 text-[13px]" style={{ color: "var(--color-bt-text-dim)" }}>
            Share how you&apos;re getting there so the crew can coordinate pickups and arrivals.
          </p>

          {travelMembers.length > 0 && (
            <div className="mb-3 space-y-1">
              {travelMembers.map((m) => {
                const isMe = m.user_id === currentUser?.id;
                const hasInfo = !!m.travel_mode;
                let summary = "Not shared yet";

                if (hasInfo) {
                  if (m.travel_mode === "flying") {
                    summary = [
                      m.flight_airline,
                      m.flight_number,
                      m.flight_airport && `→ ${m.flight_airport}`,
                    ]
                      .filter(Boolean)
                      .join(" ") || "Flying";
                  } else {
                    summary =
                      m.travel_detail ||
                      (m.travel_mode === "driving" ? "Driving" : "Other");
                  }
                }

                return (
                  <div
                    key={m.user_id ?? m.displayName}
                    className="flex items-center gap-2 rounded-lg px-2 py-1.5"
                  >
                    {hasInfo ? (
                      m.travel_mode === "flying" ? (
                        <Plane size={12} className="flex-shrink-0" style={{ color: "var(--color-bt-accent)" }} />
                      ) : (
                        <Car size={12} className="flex-shrink-0" style={{ color: "var(--color-bt-accent)" }} />
                      )
                    ) : (
                      <div className="h-3 w-3 flex-shrink-0" />
                    )}
                    <span
                      className="text-[13px]"
                      style={{ color: hasInfo ? "var(--color-bt-text)" : "var(--color-bt-text-dim)" }}
                    >
                      {m.displayName}
                      {isMe && (
                        <span className="ml-1 text-[11px]" style={{ color: "var(--color-bt-text-dim)" }}>
                          (you)
                        </span>
                      )}
                    </span>
                    <span className="truncate text-[12px]" style={{ color: "var(--color-bt-text-dim)" }}>
                      — {summary}
                    </span>
                  </div>
                );
              })}
            </div>
          )}

          {myTravel && (
            <button
              onClick={() => setShowTravelSheet(true)}
              className="flex w-full items-center justify-center gap-1.5 rounded-xl py-2.5 text-sm font-medium transition-all"
              style={{
                background: "var(--color-bt-card-raised)",
                color: "var(--color-bt-text)",
                border: "1px solid var(--color-bt-border)",
              }}
            >
              <Plane size={14} />
              {myTravel.travel_mode ? "Edit my travel" : "Log my travel"}
            </button>
          )}
        </div>
      </PlanningRow>

      {showTravelSheet && (
        <TravelSheet
          tripId={tripId}
          currentTravel={myTravel}
          onClose={() => setShowTravelSheet(false)}
        />
      )}
    </>
  );
}
