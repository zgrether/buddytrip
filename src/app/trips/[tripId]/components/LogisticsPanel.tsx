"use client";

import { useState } from "react";
import { Hotel, Car, ClipboardList, Plus, Pencil, Trash2 } from "lucide-react";
import { trpc } from "@/lib/trpc-client";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { PlanningRow, type ArcCardState } from "./PlanningRow";
import { AddLogisticsItemSheet } from "./AddLogisticsItemSheet";

interface LogisticsPanelProps {
  tripId: string;
  canEdit: boolean;
  isOwner: boolean;
  isOpen: boolean;
  onToggle: () => void;
}

interface LogisticsItem {
  id: string;
  type: "lodging" | "transport" | "general";
  label: string;
  detail?: string | null;
  property_name?: string | null;
  address?: string | null;
  check_in_time?: string | null;
  check_out_time?: string | null;
  transport_type?: string | null;
  pickup_location?: string | null;
  pickup_time?: string | null;
}

interface TripMemberTravel {
  user_id: string | null;
  displayName: string;
  travel_mode?: string | null;
  travel_detail?: string | null;
  flight_airline?: string | null;
  flight_number?: string | null;
  flight_airport?: string | null;
  travel_shared?: boolean | null;
}

const TYPE_ICON: Record<string, typeof Hotel> = {
  lodging: Hotel,
  transport: Car,
  general: ClipboardList,
};

export function LogisticsPanel({
  tripId,
  canEdit,
  isOwner: _isOwner,
  isOpen,
  onToggle,
}: LogisticsPanelProps) {
  const currentUser = useCurrentUser();
  const utils = trpc.useUtils();

  const { data: items = [] } = trpc.logistics.list.useQuery({ tripId });
  const { data: members = [] } = trpc.tripMembers.list.useQuery({ tripId });

  const [showAdd, setShowAdd] = useState(false);

  const removeItem = trpc.logistics.remove.useMutation({
    onSuccess: () => utils.logistics.list.invalidate({ tripId }),
  });

  const logisticsItems = items as LogisticsItem[];
  const travelMembers = (members as TripMemberTravel[]).filter(
    (m) => m.travel_shared || m.user_id === currentUser?.id
  );
  const hasTravelData = travelMembers.some((m) => m.travel_mode);

  const itemCount = logisticsItems.length;
  const state: ArcCardState = itemCount > 0 ? "inProgress" : "none";
  const note = itemCount > 0
    ? `${itemCount} item${itemCount !== 1 ? "s" : ""}`
    : "Nothing added yet";

  return (
    <>
      <PlanningRow
        icon={<Hotel size={16} />}
        label="Logistics"
        note={note}
        state={state}
        isOpen={isOpen}
        onToggle={onToggle}
      >
        <div className="space-y-4">
          {/* Section 1: Trip Logistics */}
          <div>
            <p
              className="mb-2 text-[11px] font-medium uppercase tracking-wider"
              style={{ color: "var(--color-bt-text-dim)" }}
            >
              Trip logistics
            </p>

            {logisticsItems.length === 0 ? (
              <p
                className="text-[13px] italic"
                style={{ color: "var(--color-bt-text-dim)" }}
              >
                No logistics items yet
              </p>
            ) : (
              <div className="space-y-2">
                {logisticsItems.map((item) => {
                  const Icon = TYPE_ICON[item.type] ?? ClipboardList;
                  return (
                    <div
                      key={item.id}
                      className="flex items-start gap-3 rounded-xl px-3 py-2.5"
                      style={{
                        background: "var(--color-bt-card-raised)",
                      }}
                    >
                      <Icon
                        size={16}
                        className="mt-0.5 flex-shrink-0"
                        style={{ color: "var(--color-bt-accent)" }}
                      />
                      <div className="min-w-0 flex-1">
                        <p
                          className="text-sm font-medium"
                          style={{ color: "var(--color-bt-text)" }}
                        >
                          {item.type === "lodging" && item.property_name
                            ? item.property_name
                            : item.label}
                        </p>
                        {/* Lodging details */}
                        {item.type === "lodging" && (
                          <p
                            className="mt-0.5 text-xs"
                            style={{ color: "var(--color-bt-text-dim)" }}
                          >
                            {[
                              item.address,
                              item.check_in_time && `Check-in ${item.check_in_time}`,
                              item.check_out_time && `Check-out ${item.check_out_time}`,
                            ]
                              .filter(Boolean)
                              .join(" · ")}
                          </p>
                        )}
                        {/* Transport details */}
                        {item.type === "transport" && (
                          <p
                            className="mt-0.5 text-xs"
                            style={{ color: "var(--color-bt-text-dim)" }}
                          >
                            {[
                              item.transport_type,
                              item.pickup_location,
                              item.pickup_time,
                            ]
                              .filter(Boolean)
                              .join(" · ")}
                          </p>
                        )}
                        {/* General details */}
                        {item.type === "general" && item.detail && (
                          <p
                            className="mt-0.5 text-xs"
                            style={{ color: "var(--color-bt-text-dim)" }}
                          >
                            {item.detail}
                          </p>
                        )}
                      </div>
                      {canEdit && (
                        <div className="flex flex-shrink-0 gap-1">
                          <button
                            onClick={() =>
                              removeItem.mutate({ tripId, itemId: item.id })
                            }
                            className="flex h-7 w-7 items-center justify-center rounded-lg transition-opacity hover:opacity-80"
                            style={{ color: "var(--color-bt-text-dim)" }}
                            aria-label="Remove item"
                          >
                            <Trash2 size={13} />
                          </button>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}

            {canEdit && (
              <button
                onClick={() => setShowAdd(true)}
                className="mt-2 flex w-full items-center justify-center gap-1.5 rounded-xl py-3 text-sm font-medium transition-colors"
                style={{
                  border: "1.5px dashed var(--color-bt-accent)",
                  color: "var(--color-bt-accent)",
                  background: "transparent",
                }}
              >
                <Plus size={14} />
                Add item
              </button>
            )}
          </div>

          {/* Section 2: Crew Travel */}
          {(hasTravelData || travelMembers.length > 0) && (
            <div>
              <p
                className="mb-2 text-[11px] font-medium uppercase tracking-wider"
                style={{ color: "var(--color-bt-text-dim)" }}
              >
                Crew travel
              </p>
              <div className="space-y-1">
                {travelMembers.map((m) => {
                  const isMe = m.user_id === currentUser?.id;
                  const hasTravelInfo = !!m.travel_mode;
                  let travelSummary = "not shared yet";
                  if (hasTravelInfo) {
                    if (m.travel_mode === "flying") {
                      travelSummary = [
                        m.flight_airline,
                        m.flight_number,
                        m.flight_airport && `→ ${m.flight_airport}`,
                      ]
                        .filter(Boolean)
                        .join(" ") || "Flying";
                    } else {
                      travelSummary = m.travel_detail || (m.travel_mode === "driving" ? "Driving" : "Other");
                    }
                  }

                  return (
                    <div
                      key={m.user_id ?? m.displayName}
                      className="flex items-center gap-2 rounded-lg px-2 py-1.5"
                    >
                      <span
                        className="text-[13px]"
                        style={{
                          color: hasTravelInfo
                            ? "var(--color-bt-text)"
                            : "var(--color-bt-text-dim)",
                        }}
                      >
                        {m.displayName}
                        {isMe && (
                          <span
                            className="text-[11px]"
                            style={{ color: "var(--color-bt-text-dim)" }}
                          >
                            {" "}
                            (you)
                          </span>
                        )}
                        <span style={{ color: "var(--color-bt-text-dim)" }}>
                          {" — "}
                          {travelSummary}
                        </span>
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </PlanningRow>

      {showAdd && (
        <AddLogisticsItemSheet tripId={tripId} onClose={() => setShowAdd(false)} />
      )}
    </>
  );
}
