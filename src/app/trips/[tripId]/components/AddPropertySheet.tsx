"use client";

import { useState, useRef } from "react";
import { Globe, Link, MapPin, X } from "lucide-react";
import { useModalBackButton } from "@/hooks/useModalBackButton";

// ── Platform detection (exported so parents can use it) ───────────────────

export type PropertyPlatform = "airbnb" | "vrbo" | "hotel" | "rental" | "other";

export const PLATFORM_LABEL: Record<PropertyPlatform, string> = {
  airbnb: "AirBnB",
  vrbo:   "VRBO",
  hotel:  "Hotel",
  rental: "Rental",
  other:  "Lodging",
};

export function detectPlatform(url: string): PropertyPlatform {
  try {
    const host = new URL(url).hostname.toLowerCase();
    if (host.includes("airbnb"))                              return "airbnb";
    if (host.includes("vrbo") || host.includes("homeaway"))   return "vrbo";
    if (host.includes("booking.com") || host.includes("marriott") || host.includes("hilton")) return "hotel";
    return "other";
  } catch {
    return "other";
  }
}

export function extractDomain(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

export function isValidUrl(str: string): boolean {
  try {
    const u = new URL(str);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

// ── Form values ───────────────────────────────────────────────────────────

export interface PropertyFormValues {
  url: string;
  name: string;      // nickname (planning) / property name (idea)
  sleeps: string;
  price: string;     // total_price (planning) / price_note (idea)
  notes: string;     // thoughts
  address: string;   // planning only
  checkIn: string;   // planning only — YYYY-MM-DD
  checkOut: string;  // planning only — YYYY-MM-DD
  checkInTimeOfDay: string;  // planning only — HH:MM, optional
  checkOutTimeOfDay: string; // planning only — HH:MM, optional
}

// ── Props ─────────────────────────────────────────────────────────────────

export interface AddPropertySheetProps {
  isEditing?: boolean;
  initialValues?: Partial<PropertyFormValues>;
  /** Show address + check-in/out fields (planning stage) */
  showAddressAndDates?: boolean;
  isPending: boolean;
  onSubmit: (values: PropertyFormValues) => void;
  onClose: () => void;
}

// ── Helpers ───────────────────────────────────────────────────────────────

function ensureProtocol(val: string): string {
  const t = val.trim();
  if (!t || /^https?:\/\//i.test(t)) return t;
  return `https://${t}`;
}

interface PlacePrediction {
  placeId: string;
  name: string;
  description: string;
  fullText: string;
}

// ── Shared input style ────────────────────────────────────────────────────

const inputCls = "w-full rounded-xl border px-3 py-2.5 text-sm outline-none";
const inputStyle = {
  background: "var(--color-bt-card-raised)",
  borderColor: "var(--color-bt-border)",
  color: "var(--color-bt-text)",
};

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="mb-1 block text-xs font-medium" style={{ color: "var(--color-bt-text-dim)" }}>
        {label}
      </label>
      {children}
    </div>
  );
}

// ── Link preview card ─────────────────────────────────────────────────────

function LinkPreviewCard({ url, name }: { url: string; name: string }) {
  const platform = detectPlatform(url);
  const domain = extractDomain(url);
  const label = PLATFORM_LABEL[platform];

  return (
    <div
      className="overflow-hidden rounded-xl"
      style={{ border: "1px solid var(--color-bt-accent-border)" }}
    >
      <div
        className="flex items-center gap-1.5 px-3 py-2"
        style={{ background: "var(--color-bt-tag-bg)" }}
      >
        <Globe size={11} style={{ color: "var(--color-bt-accent)" }} />
        <span className="text-[11px] font-medium" style={{ color: "var(--color-bt-accent)" }}>
          {domain}
        </span>
        <span
          className="ml-auto rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider"
          style={{ background: "var(--color-bt-accent)", color: "var(--color-bt-base)" }}
        >
          {label}
        </span>
      </div>
      <div className="px-3 py-2.5" style={{ background: "var(--color-bt-card-raised)" }}>
        {name ? (
          <p className="text-xs font-semibold" style={{ color: "var(--color-bt-text)" }}>{name}</p>
        ) : (
          <p className="text-xs italic" style={{ color: "var(--color-bt-text-dim)" }}>
            Add a nickname in the fields below
          </p>
        )}
        <p className="mt-0.5 truncate text-[11px]" style={{ color: "var(--color-bt-text-dim)" }}>
          {url.length > 55 ? url.slice(0, 52) + "…" : url}
        </p>
      </div>
    </div>
  );
}

// ── Sheet ─────────────────────────────────────────────────────────────────

export function AddPropertySheet({
  isEditing = false,
  initialValues = {},
  showAddressAndDates = false,
  isPending,
  onSubmit,
  onClose,
}: AddPropertySheetProps) {
  useModalBackButton(onClose);

  const [url, setUrl] = useState(initialValues.url ?? "");
  const [name, setName] = useState(initialValues.name ?? "");
  const [sleeps, setSleeps] = useState(initialValues.sleeps ?? "");
  const [price, setPrice] = useState(initialValues.price ?? "");
  const [notes, setNotes] = useState(initialValues.notes ?? "");
  const [address, setAddress] = useState(initialValues.address ?? "");
  const [checkIn, setCheckIn] = useState(initialValues.checkIn ?? "");
  const [checkOut, setCheckOut] = useState(initialValues.checkOut ?? "");
  const [checkInTimeOfDay, setCheckInTimeOfDay] = useState(initialValues.checkInTimeOfDay ?? "");
  const [checkOutTimeOfDay, setCheckOutTimeOfDay] = useState(initialValues.checkOutTimeOfDay ?? "");

  // Manual mode — expand the form without requiring a valid URL
  const [manualMode, setManualMode] = useState(isEditing && !(initialValues.url ?? ""));

  // Address autocomplete
  const [addressDropdown, setAddressDropdown] = useState<PlacePrediction[]>([]);
  const addressTimer = useRef<ReturnType<typeof setTimeout>>();

  const handleAddressChange = (val: string) => {
    setAddress(val);
    if (addressTimer.current) clearTimeout(addressTimer.current);
    setAddressDropdown([]);
    if (val.length < 2) return;
    addressTimer.current = setTimeout(async () => {
      try {
        const res = await fetch("/api/places", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ query: val }),
        });
        const data: { predictions: PlacePrediction[] } = await res.json();
        setAddressDropdown(data.predictions ?? []);
      } catch { /* ignore */ }
    }, 300);
  };

  const selectAddress = async (p: PlacePrediction) => {
    setAddressDropdown([]);
    try {
      const res = await fetch(`/api/places?placeId=${p.placeId}`);
      const data: { address?: string } = await res.json();
      setAddress(data.address ?? p.fullText);
    } catch {
      setAddress(p.fullText);
    }
  };

  // Derived
  const validUrl = isValidUrl(url);
  const showExpanded = validUrl || manualMode || isEditing;
  const canSubmit =
    showExpanded &&
    (validUrl || manualMode) &&
    (!manualMode || name.trim().length > 0);

  const handleUrlBlur = () => {
    const prefixed = ensureProtocol(url);
    if (prefixed !== url) setUrl(prefixed);
  };

  const handleSubmit = () => {
    if (!canSubmit) return;
    onSubmit({ url, name, sleeps, price, notes, address, checkIn, checkOut, checkInTimeOfDay, checkOutTimeOfDay });
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center lg:items-center"
      style={{ background: "var(--color-bt-overlay)" }}
      onClick={onClose}
    >
      <div
        className="relative max-h-[90vh] w-full max-w-[480px] overflow-y-auto rounded-t-2xl p-5 lg:rounded-2xl"
        style={{
          background: "var(--color-bt-card)",
          border: "1px solid var(--color-bt-border)",
          boxShadow: "var(--shadow-floating)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Handle bar (mobile) */}
        <div
          className="mx-auto mb-4 h-1 w-10 rounded-full lg:hidden"
          style={{ background: "var(--color-bt-border)" }}
        />

        {/* Canonical close X (CC_MODAL_AUDIT.md Part 2.1) — absolute so
            it lives in the corner without re-flowing the existing header
            content beneath it. */}
        <button
          onClick={onClose}
          aria-label="Close"
          className="absolute right-3 top-3 z-10 flex h-8 w-8 items-center justify-center rounded-full transition-colors hover:bg-[var(--color-bt-hover)]"
          style={{
            background: "var(--color-bt-card-raised)",
            color: "var(--color-bt-text-dim)",
          }}
        >
          <X size={14} />
        </button>

        {/* Header */}
        <h2 className="text-lg font-semibold pr-10" style={{ color: "var(--color-bt-text)" }}>
          {isEditing ? "Edit property" : "Add a property"}
        </h2>
        {!isEditing && !manualMode && (
          <p className="mt-0.5 text-sm" style={{ color: "var(--color-bt-text-dim)" }}>
            Paste a listing link, or{" "}
            <button
              onClick={() => setManualMode(true)}
              className="underline"
              style={{ color: "var(--color-bt-accent)" }}
            >
              enter manually
            </button>
          </p>
        )}

        {/* URL field */}
        <div className="mt-4">
          <Field label="Link to listing">
            <div className="relative">
              <Link
                size={15}
                className="absolute left-3 top-1/2 -translate-y-1/2"
                style={{ color: validUrl ? "var(--color-bt-accent)" : "var(--color-bt-text-dim)" }}
              />
              <input
                type="url"
                placeholder="https://airbnb.com/rooms/…"
                value={url}
                onChange={(e) => setUrl(e.target.value.trim())}
                onBlur={handleUrlBlur}
                // eslint-disable-next-line jsx-a11y/no-autofocus
                autoFocus={!isEditing && !manualMode}
                className={`${inputCls} pl-9`}
                style={{
                  ...inputStyle,
                  borderColor: validUrl ? "var(--color-bt-accent-border)" : "var(--color-bt-border)",
                }}
              />
            </div>
          </Field>
        </div>

        {/* Link preview */}
        {validUrl && (
          <div className="mt-3">
            <p className="mb-1.5 text-[11px] font-medium uppercase tracking-wider" style={{ color: "var(--color-bt-text-dim)" }}>
              Preview
            </p>
            <LinkPreviewCard url={url} name={name} />
          </div>
        )}

        {/* Name / Nickname — shown as soon as the form expands, above Optional divider */}
        {showExpanded && (
          <div className="mt-3">
            <Field label={manualMode && !isEditing ? "Property name *" : "Nickname"}>
              <input
                type="text"
                placeholder="e.g. Beach House, The Lodge"
                value={name}
                onChange={(e) => setName(e.target.value)}
                // eslint-disable-next-line jsx-a11y/no-autofocus
                autoFocus={manualMode && !isEditing}
                className={inputCls}
                style={{
                  ...inputStyle,
                  borderColor: manualMode && !isEditing && name.trim()
                    ? "var(--color-bt-accent-border)"
                    : "var(--color-bt-border)",
                }}
              />
            </Field>
          </div>
        )}

        {/* Optional fields — sleeps, price, thoughts, address, dates */}
        {showExpanded && (
          <>
            {/* Divider */}
            <div className="mt-4 mb-3 flex items-center gap-2">
              <div className="flex-1 border-t" style={{ borderColor: "var(--color-bt-border)" }} />
              <span className="text-[11px] font-medium uppercase tracking-wider" style={{ color: "var(--color-bt-text-dim)" }}>
                Optional
              </span>
              <div className="flex-1 border-t" style={{ borderColor: "var(--color-bt-border)" }} />
            </div>

            <div className="space-y-3">
              {/* Sleeps + Price */}
              <div className="grid grid-cols-2 gap-2">
                <Field label="Sleeps">
                  <input
                    type="number"
                    placeholder="e.g. 8"
                    min={1}
                    max={99}
                    value={sleeps}
                    onChange={(e) => setSleeps(e.target.value)}
                    className={inputCls}
                    style={inputStyle}
                  />
                </Field>
                <Field label="Price">
                  <input
                    type="text"
                    placeholder="e.g. $2,400"
                    value={price}
                    onChange={(e) => setPrice(e.target.value)}
                    className={inputCls}
                    style={inputStyle}
                  />
                </Field>
              </div>

              {/* Thoughts */}
              <Field label="Thoughts">
                <textarea
                  placeholder="e.g. great pool, tons of space, perfect grilling deck"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  rows={2}
                  className="w-full resize-none rounded-xl border px-3 py-2.5 text-sm outline-none"
                  style={inputStyle}
                />
              </Field>

              {/* Address + Dates — planning only */}
              {showAddressAndDates && (
                <>
                  <Field label="Address">
                    <div className="relative">
                      <MapPin
                        size={14}
                        className="absolute left-3 top-3.5"
                        style={{ color: address ? "var(--color-bt-accent)" : "var(--color-bt-text-dim)" }}
                      />
                      <input
                        type="text"
                        placeholder="Search for an address"
                        value={address}
                        onChange={(e) => handleAddressChange(e.target.value)}
                        className={`${inputCls} pl-9`}
                        style={{
                          ...inputStyle,
                          borderColor: address ? "var(--color-bt-accent-border)" : "var(--color-bt-border)",
                        }}
                      />
                      {addressDropdown.length > 0 && (
                        <div
                          className="absolute z-10 mt-1 w-full overflow-hidden rounded-xl shadow-lg"
                          style={{
                            background: "var(--color-bt-card-raised)",
                            border: "1px solid var(--color-bt-border)",
                          }}
                        >
                          {addressDropdown.map((p) => (
                            <button
                              key={p.placeId}
                              onClick={() => selectAddress(p)}
                              className="w-full px-3 py-2 text-left text-sm transition-opacity hover:opacity-70"
                              style={{ color: "var(--color-bt-text)" }}
                            >
                              <span className="font-medium">{p.name}</span>
                              {p.description && (
                                <span className="ml-1 text-[11px]" style={{ color: "var(--color-bt-text-dim)" }}>
                                  {p.description}
                                </span>
                              )}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  </Field>

                  <div className="grid grid-cols-2 gap-2">
                    <Field label="Check-in">
                      <input
                        type="date"
                        value={checkIn}
                        onChange={(e) => setCheckIn(e.target.value)}
                        className={inputCls}
                        style={inputStyle}
                      />
                    </Field>
                    <Field label="Check-out">
                      <input
                        type="date"
                        value={checkOut}
                        onChange={(e) => setCheckOut(e.target.value)}
                        className={inputCls}
                        style={inputStyle}
                      />
                    </Field>
                    <Field label="Check-in time">
                      <input
                        type="time"
                        value={checkInTimeOfDay}
                        onChange={(e) => setCheckInTimeOfDay(e.target.value)}
                        className={inputCls}
                        style={inputStyle}
                      />
                    </Field>
                    <Field label="Check-out time">
                      <input
                        type="time"
                        value={checkOutTimeOfDay}
                        onChange={(e) => setCheckOutTimeOfDay(e.target.value)}
                        className={inputCls}
                        style={inputStyle}
                      />
                    </Field>
                  </div>
                </>
              )}
            </div>
          </>
        )}

        {/* Actions */}
        <button
          onClick={handleSubmit}
          disabled={isPending || !canSubmit}
          className="mt-5 w-full rounded-xl py-3 text-sm font-semibold transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
          style={{ background: "var(--color-bt-accent)", color: "var(--color-bt-base)" }}
        >
          {isPending
            ? isEditing ? "Saving..." : "Adding..."
            : isEditing ? "Save changes" : "Add property"}
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
