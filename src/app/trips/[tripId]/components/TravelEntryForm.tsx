"use client";

import { useEffect, useState } from "react";
import { Plane, Car, HelpCircle, Pencil } from "lucide-react";
import { trpc } from "@/lib/trpc-client";

type TravelMode = "driving" | "flying" | "other";

const MODE_OPTIONS: { value: TravelMode; label: string; icon: typeof Car }[] = [
  { value: "driving", label: "Driving", icon: Car },
  { value: "flying", label: "Flying", icon: Plane },
  { value: "other", label: "Other", icon: HelpCircle },
];

interface TravelEntryFormProps {
  tripId: string;
  currentTravel: {
    travel_mode?: string | null;
    travel_detail?: string | null;
    flight_airline?: string | null;
    flight_number?: string | null;
    flight_arrival_time?: string | null;
    flight_airport?: string | null;
    travel_shared?: boolean | null;
  } | null;
  onSave?: () => void;
}

export function TravelEntryForm({ tripId, currentTravel, onSave }: TravelEntryFormProps) {
  const utils = trpc.useUtils();

  const hasSaved = !!currentTravel?.travel_mode;
  const [editing, setEditing] = useState(!hasSaved);

  const [mode, setMode] = useState<TravelMode | null>(
    (currentTravel?.travel_mode as TravelMode) ?? null
  );
  const [detail, setDetail] = useState(currentTravel?.travel_detail ?? "");
  const [airline, setAirline] = useState(currentTravel?.flight_airline ?? "");
  const [arrivalTime, setArrivalTime] = useState(currentTravel?.flight_arrival_time ?? "");
  const [airport, setAirport] = useState(currentTravel?.flight_airport ?? "");
  const [shared, setShared] = useState(currentTravel?.travel_shared ?? true);

  // Sync when travel data changes externally
  useEffect(() => {
    if (currentTravel?.travel_mode) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setMode(currentTravel.travel_mode as TravelMode);
      setDetail(currentTravel.travel_detail ?? "");
      setAirline(currentTravel.flight_airline ?? "");
      setArrivalTime(currentTravel.flight_arrival_time ?? "");
      setAirport(currentTravel.flight_airport ?? "");
      setShared(currentTravel.travel_shared ?? true);
    }
  }, [currentTravel]);

  const updateTravel = trpc.tripMembers.updateTravel.useMutation({
    onSuccess() {
      utils.tripMembers.list.invalidate({ tripId });
      setEditing(false);
      onSave?.();
    },
  });

  const handleSave = () => {
    if (!mode) return;
    updateTravel.mutate({
      tripId,
      travelMode: mode,
      travelDetail: detail.trim() || null,
      flightAirline: airline.trim() || null,
      flightNumber: null,
      flightArrivalTime: arrivalTime || null,
      flightAirport: airport.trim() || null,
      travelShared: shared,
    });
  };

  const inputStyle = {
    background: "var(--color-bt-card-raised)",
    borderColor: "var(--color-bt-border)",
    color: "var(--color-bt-text)",
  };

  // Summary view (after saving)
  if (hasSaved && !editing) {
    let summary = "";
    if (currentTravel?.travel_mode === "flying") {
      summary = [
        currentTravel.flight_airline,
        currentTravel.flight_airport && `→ ${currentTravel.flight_airport}`,
      ]
        .filter(Boolean)
        .join(" ");
    } else {
      summary = currentTravel?.travel_detail || (currentTravel?.travel_mode === "driving" ? "Driving" : "Other");
    }

    return (
      <div className="mt-3 flex items-center gap-2">
        {currentTravel?.travel_mode === "flying" ? (
          <Plane size={14} style={{ color: "var(--color-bt-accent)" }} />
        ) : (
          <Car size={14} style={{ color: "var(--color-bt-accent)" }} />
        )}
        <span className="text-[13px]" style={{ color: "var(--color-bt-text)" }}>
          {summary}
        </span>
        <button
          onClick={() => setEditing(true)}
          className="ml-1 flex items-center gap-1 text-xs font-medium"
          style={{ color: "var(--color-bt-accent)" }}
        >
          <Pencil size={11} />
          Edit
        </button>
      </div>
    );
  }

  // Edit form
  return (
    <div className="mt-4">
      <div
        className="mb-3"
        style={{ borderTop: "1px solid var(--color-bt-border)" }}
      />
      <p
        className="mb-2 text-[13px] leading-relaxed"
        style={{ color: "var(--color-bt-text-dim)" }}
      >
        You said you&apos;re in — can you share your travel plans so the crew
        can coordinate?
      </p>

      {/* Travel mode pills */}
      <p
        className="mb-1.5 text-xs font-medium"
        style={{ color: "var(--color-bt-text-dim)" }}
      >
        How are you getting there?
      </p>
      <div className="flex gap-2">
        {MODE_OPTIONS.map((opt) => {
          const isSelected = mode === opt.value;
          const Icon = opt.icon;
          return (
            <button
              key={opt.value}
              onClick={() => setMode(opt.value)}
              className="flex flex-1 items-center justify-center gap-1.5 rounded-xl py-2 text-sm font-medium transition-all"
              style={{
                background: isSelected ? "var(--color-bt-accent)" : "var(--color-bt-card-raised)",
                color: isSelected ? "var(--color-bt-base)" : "var(--color-bt-text-dim)",
                border: isSelected ? "none" : "1px solid var(--color-bt-border)",
              }}
            >
              <Icon size={14} />
              {opt.label}
            </button>
          );
        })}
      </div>

      {/* Flying fields */}
      {mode === "flying" && (
        <div className="mt-3 space-y-2">
          <div className="flex gap-2">
            <input
              type="text"
              placeholder="Flight (e.g. Delta 1733)"
              value={airline}
              onChange={(e) => setAirline(e.target.value)}
              className="flex-1 rounded-xl border px-3 py-2.5 text-sm outline-none"
              style={inputStyle}
            />
            <input
              type="text"
              placeholder="Airport (e.g. SAV)"
              value={airport}
              onChange={(e) => setAirport(e.target.value)}
              className="w-28 rounded-xl border px-3 py-2.5 text-sm outline-none"
              style={inputStyle}
            />
          </div>
          <input
            type="datetime-local"
            placeholder="Arrival time"
            value={arrivalTime}
            onChange={(e) => setArrivalTime(e.target.value)}
            className="w-full rounded-xl border px-3 py-2.5 text-sm outline-none"
            style={inputStyle}
          />
        </div>
      )}

      {/* Driving / Other detail */}
      {(mode === "driving" || mode === "other") && (
        <textarea
          placeholder="Any other details?"
          value={detail}
          onChange={(e) => setDetail(e.target.value)}
          rows={2}
          className="mt-3 w-full resize-none rounded-xl border px-3 py-2.5 text-sm outline-none"
          style={inputStyle}
        />
      )}

      {/* Share checkbox */}
      {mode && (
        <label className="mt-3 flex cursor-pointer items-center gap-2">
          <input
            type="checkbox"
            checked={shared}
            onChange={(e) => setShared(e.target.checked)}
            className="h-4 w-4 rounded"
          />
          <span className="text-[13px]" style={{ color: "var(--color-bt-text-dim)" }}>
            Share this with the crew
          </span>
        </label>
      )}

      {/* Save button */}
      {mode && (
        <button
          onClick={handleSave}
          disabled={updateTravel.isPending}
          className="mt-3 w-full rounded-xl py-3 text-sm font-semibold transition-opacity hover:opacity-90 disabled:opacity-40"
          style={{
            background: "var(--color-bt-accent)",
            color: "var(--color-bt-base)",
          }}
        >
          {updateTravel.isPending ? "Saving..." : "Save travel info"}
        </button>
      )}
    </div>
  );
}
