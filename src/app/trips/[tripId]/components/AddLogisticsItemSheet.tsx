"use client";

import { useState } from "react";
import { useModalBackButton } from "@/hooks/useModalBackButton";
import { trpc } from "@/lib/trpc-client";

type LogisticsType = "lodging" | "transport" | "general";

const TYPES: { value: LogisticsType; label: string }[] = [
  { value: "lodging", label: "Lodging" },
  { value: "transport", label: "Transport" },
  { value: "general", label: "General" },
];

interface AddLogisticsItemSheetProps {
  tripId: string;
  onClose: () => void;
}

export function AddLogisticsItemSheet({ tripId, onClose }: AddLogisticsItemSheetProps) {
  useModalBackButton(onClose);
  const utils = trpc.useUtils();

  const [type, setType] = useState<LogisticsType>("lodging");
  const [label, setLabel] = useState("");
  const [detail, setDetail] = useState("");
  // Lodging
  const [propertyName, setPropertyName] = useState("");
  const [address, setAddress] = useState("");
  const [checkInTime, setCheckInTime] = useState("");
  const [checkOutTime, setCheckOutTime] = useState("");
  // Transport
  const [transportType, setTransportType] = useState("");
  const [pickupLocation, setPickupLocation] = useState("");
  const [pickupTime, setPickupTime] = useState("");

  const create = trpc.logistics.create.useMutation({
    onSuccess: () => {
      utils.logistics.list.invalidate({ tripId });
      onClose();
    },
  });

  const handleSubmit = () => {
    if (!label.trim()) return;
    create.mutate({
      tripId,
      type,
      label: label.trim(),
      detail: detail.trim() || undefined,
      propertyName: propertyName.trim() || undefined,
      address: address.trim() || undefined,
      checkInTime: checkInTime.trim() || undefined,
      checkOutTime: checkOutTime.trim() || undefined,
      transportType: transportType.trim() || undefined,
      pickupLocation: pickupLocation.trim() || undefined,
      pickupTime: pickupTime.trim() || undefined,
    });
  };

  const inputStyle = {
    background: "var(--color-bt-card-raised)",
    borderColor: "var(--color-bt-border)",
    color: "var(--color-bt-text)",
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
        <h2
          className="text-lg font-semibold"
          style={{ color: "var(--color-bt-text)" }}
        >
          Add Logistics Item
        </h2>

        {/* Type selector */}
        <div className="mt-3 flex flex-wrap gap-2">
          {TYPES.map(({ value, label: tLabel }) => (
            <button
              key={value}
              onClick={() => setType(value)}
              className="rounded-full px-3 py-1.5 text-xs font-medium transition-colors"
              style={{
                background: type === value ? "var(--color-bt-accent)" : "var(--color-bt-card-raised)",
                color: type === value ? "var(--color-bt-base)" : "var(--color-bt-text-dim)",
                border: type === value ? "none" : "1px solid var(--color-bt-border)",
              }}
            >
              {tLabel}
            </button>
          ))}
        </div>

        {/* Label — always shown */}
        <input
          type="text"
          placeholder={
            type === "lodging"
              ? "e.g. Beach House"
              : type === "transport"
              ? "e.g. Airport Shuttle"
              : "e.g. Grocery Run"
          }
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          className="mt-3 w-full rounded-xl border px-3 py-2.5 text-sm outline-none"
          style={inputStyle}
        />

        {/* Lodging fields */}
        {type === "lodging" && (
          <>
            <input
              type="text"
              placeholder="Property name"
              value={propertyName}
              onChange={(e) => setPropertyName(e.target.value)}
              className="mt-2 w-full rounded-xl border px-3 py-2.5 text-sm outline-none"
              style={inputStyle}
            />
            <input
              type="text"
              placeholder="Address"
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              className="mt-2 w-full rounded-xl border px-3 py-2.5 text-sm outline-none"
              style={inputStyle}
            />
            <div className="mt-2 flex gap-2">
              <input
                type="text"
                placeholder="Check-in time"
                value={checkInTime}
                onChange={(e) => setCheckInTime(e.target.value)}
                className="flex-1 rounded-xl border px-3 py-2.5 text-sm outline-none"
                style={inputStyle}
              />
              <input
                type="text"
                placeholder="Check-out time"
                value={checkOutTime}
                onChange={(e) => setCheckOutTime(e.target.value)}
                className="flex-1 rounded-xl border px-3 py-2.5 text-sm outline-none"
                style={inputStyle}
              />
            </div>
          </>
        )}

        {/* Transport fields */}
        {type === "transport" && (
          <>
            <input
              type="text"
              placeholder="Transport type (e.g. rental car, shuttle)"
              value={transportType}
              onChange={(e) => setTransportType(e.target.value)}
              className="mt-2 w-full rounded-xl border px-3 py-2.5 text-sm outline-none"
              style={inputStyle}
            />
            <input
              type="text"
              placeholder="Pickup location"
              value={pickupLocation}
              onChange={(e) => setPickupLocation(e.target.value)}
              className="mt-2 w-full rounded-xl border px-3 py-2.5 text-sm outline-none"
              style={inputStyle}
            />
            <input
              type="text"
              placeholder="Pickup time"
              value={pickupTime}
              onChange={(e) => setPickupTime(e.target.value)}
              className="mt-2 w-full rounded-xl border px-3 py-2.5 text-sm outline-none"
              style={inputStyle}
            />
          </>
        )}

        {/* General detail */}
        {type === "general" && (
          <textarea
            placeholder="Details (optional)"
            value={detail}
            onChange={(e) => setDetail(e.target.value)}
            rows={2}
            className="mt-2 w-full resize-none rounded-xl border px-3 py-2.5 text-sm outline-none"
            style={inputStyle}
          />
        )}

        {/* Actions */}
        <button
          onClick={handleSubmit}
          disabled={create.isPending || !label.trim()}
          className="mt-4 w-full rounded-xl py-3 text-sm font-semibold transition-opacity hover:opacity-90 disabled:opacity-40"
          style={{
            background: "var(--color-bt-accent)",
            color: "var(--color-bt-base)",
          }}
        >
          {create.isPending ? "Adding..." : "Add"}
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
