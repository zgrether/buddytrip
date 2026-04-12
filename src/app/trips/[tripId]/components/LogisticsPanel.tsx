"use client";

import { useState } from "react";
import { Hotel, MapPin, CalendarDays, Plane, Car, Plus, Trash2 } from "lucide-react";
import { trpc } from "@/lib/trpc-client";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { PlanningRow, type ArcCardState } from "./PlanningRow";
import { AddLodgingSheet } from "./AddLodgingSheet";
import { TravelEntryForm } from "./TravelEntryForm";

// ── Platform config ───────────────────────────────────────────────────────
// transport_type field is repurposed to store the booking platform for
// lodging items. Colors use design-system tokens only.

const PLATFORM: Record<string, { label: string; color: string; bg: string }> = {
  airbnb:  { label: "AirBnB",  color: "var(--color-bt-danger)",   bg: "var(--color-bt-danger-faint)" },
  vrbo:    { label: "VRBO",    color: "var(--color-bt-planning)",  bg: "var(--color-bt-blue-bg)" },
  hotel:   { label: "Hotel",   color: "var(--color-bt-accent)",    bg: "var(--color-bt-tag-bg)" },
  rental:  { label: "Rental",  color: "var(--color-bt-ready)",     bg: "var(--color-bt-ready-bg)" },
  other:   { label: "Lodging", color: "var(--color-bt-text-dim)",  bg: "var(--color-bt-card-raised)" },
};

function getPlatform(key?: string | null) {
  return PLATFORM[key ?? ""] ?? PLATFORM.other;
}

// ── Date formatting ───────────────────────────────────────────────────────

function fmtDate(dateStr?: string | null): string {
  if (!dateStr) return "";
  // Support YYYY-MM-DD and datetime strings; anchor to noon to avoid tz shifts
  const d = new Date(dateStr.length === 10 ? `${dateStr}T12:00:00` : dateStr);
  if (isNaN(d.getTime())) return dateStr;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

// ── Types ─────────────────────────────────────────────────────────────────

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
  flight_arrival_time?: string | null;
  travel_shared?: boolean | null;
}

// ── LodgingCard ───────────────────────────────────────────────────────────

function LodgingCard({
  item,
  canEdit,
  onRemove,
  removing,
}: {
  item: LogisticsItem;
  canEdit: boolean;
  onRemove: () => void;
  removing: boolean;
}) {
  const platform = getPlatform(item.transport_type);
  const name = item.property_name || item.label;
  const checkIn = fmtDate(item.check_in_time);
  const checkOut = fmtDate(item.check_out_time);
  const dateRange = checkIn && checkOut
    ? `${checkIn} – ${checkOut}`
    : checkIn || checkOut || null;

  return (
    <div
      className="overflow-hidden rounded-xl"
      style={{ border: "1px solid var(--color-bt-border)" }}
    >
      {/* Platform header strip */}
      <div
        className="flex items-center justify-between px-2.5 py-1.5"
        style={{ background: platform.bg }}
      >
        <span
          className="text-[10px] font-bold uppercase tracking-wider"
          style={{ color: platform.color }}
        >
          {platform.label}
        </span>
        {canEdit && (
          <button
            onClick={onRemove}
            disabled={removing}
            className="flex h-5 w-5 items-center justify-center rounded disabled:opacity-40"
            style={{ color: platform.color }}
            aria-label="Remove property"
          >
            <Trash2 size={11} />
          </button>
        )}
      </div>

      {/* Card body */}
      <div
        className="px-2.5 py-2.5 space-y-1"
        style={{ background: "var(--color-bt-card-raised)" }}
      >
        <div className="flex items-start gap-1.5">
          <Hotel
            size={12}
            className="mt-0.5 flex-shrink-0"
            style={{ color: "var(--color-bt-text-dim)" }}
          />
          <p
            className="text-xs font-semibold leading-tight"
            style={{ color: "var(--color-bt-text)" }}
          >
            {name}
          </p>
        </div>

        {item.address && (
          <div className="flex items-start gap-1.5">
            <MapPin
              size={10}
              className="mt-0.5 flex-shrink-0"
              style={{ color: "var(--color-bt-text-dim)" }}
            />
            <p
              className="text-[11px] leading-tight"
              style={{ color: "var(--color-bt-text-dim)" }}
            >
              {item.address}
            </p>
          </div>
        )}

        {dateRange && (
          <div className="flex items-center gap-1.5">
            <CalendarDays
              size={10}
              className="flex-shrink-0"
              style={{ color: "var(--color-bt-text-dim)" }}
            />
            <p
              className="text-[11px]"
              style={{ color: "var(--color-bt-text-dim)" }}
            >
              {dateRange}
            </p>
          </div>
        )}

        {item.detail && (
          <p
            className="mt-1 truncate text-[11px] italic"
            style={{ color: "var(--color-bt-text-dim)" }}
          >
            {item.detail}
          </p>
        )}
      </div>
    </div>
  );
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

// ── LogisticsPanel ────────────────────────────────────────────────────────

interface LogisticsPanelProps {
  tripId: string;
  canEdit: boolean;
  isOwner: boolean;
  isOpen: boolean;
  onToggle: () => void;
}

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

  const [showAddLodging, setShowAddLodging] = useState(false);
  const [showTravelSheet, setShowTravelSheet] = useState(false);

  const removeItem = trpc.logistics.remove.useMutation({
    onSuccess: () => utils.logistics.list.invalidate({ tripId }),
  });

  // ── Derived data ─────────────────────────────────────────────────────
  const allItems = items as LogisticsItem[];
  const lodgingItems = allItems.filter((i) => i.type === "lodging");

  const travelMembers = (members as TripMemberTravel[]).filter(
    (m) => m.travel_shared || m.user_id === currentUser?.id
  );
  const myMember = (members as TripMemberTravel[]).find(
    (m) => m.user_id === currentUser?.id
  );
  const myTravel = myMember ?? null;
  const hasTravelData = travelMembers.some((m) => m.travel_mode);

  // ── PlanningRow header state ──────────────────────────────────────────
  const lodgingCount = lodgingItems.length;
  const travelCount = travelMembers.filter((m) => m.travel_mode).length;

  let note = "Nothing added yet";
  const noteParts: string[] = [];
  if (lodgingCount > 0) noteParts.push(`${lodgingCount} propert${lodgingCount === 1 ? "y" : "ies"}`);
  if (travelCount > 0) noteParts.push(`${travelCount} travel${travelCount === 1 ? "" : "s"}`);
  if (noteParts.length > 0) note = noteParts.join(" · ");

  const state: ArcCardState = lodgingCount > 0 || hasTravelData ? "inProgress" : "none";

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
        <div className="space-y-5">

          {/* ── LODGING ─────────────────────────────────────────────── */}
          <div>
            <p
              className="mb-2 text-[11px] font-medium uppercase tracking-wider"
              style={{ color: "var(--color-bt-text-dim)" }}
            >
              Lodging
            </p>

            {lodgingItems.length === 0 ? (
              <p className="text-[13px] italic" style={{ color: "var(--color-bt-text-dim)" }}>
                No properties added yet
              </p>
            ) : (
              <div className="grid grid-cols-2 gap-2">
                {lodgingItems.map((item) => (
                  <LodgingCard
                    key={item.id}
                    item={item}
                    canEdit={canEdit}
                    onRemove={() => removeItem.mutate({ tripId, itemId: item.id })}
                    removing={removeItem.isPending}
                  />
                ))}
              </div>
            )}

            {canEdit && (
              <button
                onClick={() => setShowAddLodging(true)}
                className="mt-2.5 flex w-full items-center justify-center gap-1.5 rounded-xl py-2.5 text-sm font-medium"
                style={{
                  border: "1.5px dashed var(--color-bt-accent)",
                  color: "var(--color-bt-accent)",
                  background: "transparent",
                }}
              >
                <Plus size={14} />
                Add property
              </button>
            )}
          </div>

          {/* ── CREW TRAVEL ─────────────────────────────────────────── */}
          <div>
            <p
              className="mb-2 text-[11px] font-medium uppercase tracking-wider"
              style={{ color: "var(--color-bt-text-dim)" }}
            >
              Crew travel
            </p>

            {travelMembers.length === 0 && !myTravel ? (
              <p className="text-[13px] italic" style={{ color: "var(--color-bt-text-dim)" }}>
                No one has shared their travel yet
              </p>
            ) : (
              <div className="space-y-1">
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
                      className="flex items-center justify-between gap-2 rounded-lg px-2 py-1.5"
                    >
                      <div className="flex min-w-0 items-center gap-2">
                        {hasInfo ? (
                          m.travel_mode === "flying" ? (
                            <Plane size={12} style={{ color: "var(--color-bt-accent)" }} />
                          ) : (
                            <Car size={12} style={{ color: "var(--color-bt-accent)" }} />
                          )
                        ) : (
                          <div className="h-3 w-3" />
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
                        <span
                          className="truncate text-[12px]"
                          style={{ color: "var(--color-bt-text-dim)" }}
                        >
                          — {summary}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {/* CTA for current user to log / edit their travel */}
            {myTravel && (
              <button
                onClick={() => setShowTravelSheet(true)}
                className="mt-2.5 flex w-full items-center justify-center gap-1.5 rounded-xl py-2.5 text-sm font-medium"
                style={{
                  border: "1.5px dashed var(--color-bt-border)",
                  color: "var(--color-bt-text-dim)",
                  background: "transparent",
                }}
              >
                <Plane size={13} />
                {myTravel.travel_mode ? "Edit my travel" : "Log my travel"}
              </button>
            )}
          </div>

        </div>
      </PlanningRow>

      {showAddLodging && (
        <AddLodgingSheet
          tripId={tripId}
          onClose={() => setShowAddLodging(false)}
        />
      )}

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
