"use client";

import { useState } from "react";
import { useModalBackButton } from "@/hooks/useModalBackButton";
import { trpc } from "@/lib/trpc-client";

type Platform = "airbnb" | "vrbo" | "hotel" | "rental" | "other";

const PLATFORMS: { value: Platform; label: string }[] = [
  { value: "airbnb",  label: "AirBnB" },
  { value: "vrbo",    label: "VRBO" },
  { value: "hotel",   label: "Hotel" },
  { value: "rental",  label: "Rental" },
  { value: "other",   label: "Other" },
];

const inputStyle = {
  background: "var(--color-bt-card-raised)",
  borderColor: "var(--color-bt-border)",
  color: "var(--color-bt-text)",
};

export function AddLodgingSheet({
  tripId,
  onClose,
}: {
  tripId: string;
  onClose: () => void;
}) {
  useModalBackButton(onClose);
  const utils = trpc.useUtils();

  const [platform, setPlatform] = useState<Platform>("other");
  const [name, setName] = useState("");
  const [address, setAddress] = useState("");
  const [checkIn, setCheckIn] = useState("");
  const [checkOut, setCheckOut] = useState("");
  const [notes, setNotes] = useState("");

  const create = trpc.logistics.create.useMutation({
    onSuccess: () => {
      utils.logistics.list.invalidate({ tripId });
      onClose();
    },
  });

  const handleSubmit = () => {
    if (!name.trim()) return;
    create.mutate({
      tripId,
      type: "lodging",
      label: name.trim(),
      address: address.trim() || undefined,
      // check_in_time / check_out_time store date strings ("YYYY-MM-DD")
      checkInTime: checkIn || undefined,
      checkOutTime: checkOut || undefined,
      // transport_type repurposed to store platform for lodging items
      transportType: platform,
      detail: notes.trim() || undefined,
    });
  };

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
        <h2 className="text-lg font-semibold" style={{ color: "var(--color-bt-text)" }}>
          Add Property
        </h2>
        <p className="mt-0.5 text-sm" style={{ color: "var(--color-bt-text-dim)" }}>
          Where is everyone staying?
        </p>

        {/* Platform chips */}
        <p className="mt-4 mb-2 text-xs font-medium" style={{ color: "var(--color-bt-text-dim)" }}>
          Booked on
        </p>
        <div className="flex flex-wrap gap-2">
          {PLATFORMS.map(({ value, label }) => (
            <button
              key={value}
              onClick={() => setPlatform(value)}
              className="rounded-full px-3 py-1.5 text-xs font-medium transition-colors"
              style={{
                background: platform === value ? "var(--color-bt-accent)" : "var(--color-bt-card-raised)",
                color: platform === value ? "var(--color-bt-base)" : "var(--color-bt-text-dim)",
                border: platform === value ? "none" : "1px solid var(--color-bt-border)",
              }}
            >
              {label}
            </button>
          ))}
        </div>

        {/* Property name */}
        <input
          type="text"
          placeholder="Property name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          // eslint-disable-next-line jsx-a11y/no-autofocus
          autoFocus
          className="mt-3 w-full rounded-xl border px-3 py-2.5 text-sm outline-none"
          style={inputStyle}
        />

        {/* Address */}
        <input
          type="text"
          placeholder="Address"
          value={address}
          onChange={(e) => setAddress(e.target.value)}
          className="mt-2 w-full rounded-xl border px-3 py-2.5 text-sm outline-none"
          style={inputStyle}
        />

        {/* Check-in / check-out dates */}
        <div className="mt-3 grid grid-cols-2 gap-2">
          <div>
            <label className="mb-1 block text-xs" style={{ color: "var(--color-bt-text-dim)" }}>
              Check-in
            </label>
            <input
              type="date"
              value={checkIn}
              onChange={(e) => setCheckIn(e.target.value)}
              className="w-full rounded-xl border px-3 py-2.5 text-sm outline-none"
              style={inputStyle}
            />
          </div>
          <div>
            <label className="mb-1 block text-xs" style={{ color: "var(--color-bt-text-dim)" }}>
              Check-out
            </label>
            <input
              type="date"
              value={checkOut}
              onChange={(e) => setCheckOut(e.target.value)}
              className="w-full rounded-xl border px-3 py-2.5 text-sm outline-none"
              style={inputStyle}
            />
          </div>
        </div>

        {/* Notes / link */}
        <input
          type="text"
          placeholder="Link or notes (optional)"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          className="mt-2 w-full rounded-xl border px-3 py-2.5 text-sm outline-none"
          style={inputStyle}
        />

        {/* Actions */}
        <button
          onClick={handleSubmit}
          disabled={create.isPending || !name.trim()}
          className="mt-4 w-full rounded-xl py-3 text-sm font-semibold transition-opacity hover:opacity-90 disabled:opacity-40"
          style={{ background: "var(--color-bt-accent)", color: "var(--color-bt-base)" }}
        >
          {create.isPending ? "Adding..." : "Add Property"}
        </button>
        <button
          onClick={onClose}
          className="mt-2 w-full rounded-xl py-2.5 text-sm transition-opacity hover:opacity-80"
          style={{ color: "var(--color-bt-text-dim)" }}
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
