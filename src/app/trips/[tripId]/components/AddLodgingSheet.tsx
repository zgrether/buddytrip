"use client";

import { useState, useRef } from "react";
import { Link, Globe, Pencil, MapPin } from "lucide-react";
import { useModalBackButton } from "@/hooks/useModalBackButton";
import { trpc } from "@/lib/trpc-client";

// ── Platform detection ────────────────────────────────────────────────────

type Platform = "airbnb" | "vrbo" | "hotel" | "rental" | "other";

const PLATFORM_LABEL: Record<Platform, string> = {
  airbnb: "AirBnB",
  vrbo:   "VRBO",
  hotel:  "Hotel",
  rental: "Rental",
  other:  "Lodging",
};

function detectPlatform(url: string): Platform {
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

function extractDomain(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

function isValidUrl(str: string): boolean {
  try {
    const u = new URL(str);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

/** Prepend https:// if the user forgot the protocol */
function ensureProtocol(val: string): string {
  const t = val.trim();
  if (!t || /^https?:\/\//i.test(t)) return t;
  return `https://${t}`;
}

// ── Address autocomplete types ────────────────────────────────────────────

interface PlacePrediction {
  placeId: string;
  name: string;
  description: string;
  fullText: string;
}

// ── Link preview card ─────────────────────────────────────────────────────

function LinkPreviewCard({
  url,
  nickname,
  platform,
}: {
  url: string;
  nickname: string;
  platform: Platform;
}) {
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
        {nickname ? (
          <p className="text-xs font-semibold" style={{ color: "var(--color-bt-text)" }}>
            {nickname}
          </p>
        ) : (
          <p className="text-xs italic" style={{ color: "var(--color-bt-text-dim)" }}>
            Add a nickname below if you&apos;d like
          </p>
        )}
        <p className="mt-0.5 truncate text-[11px]" style={{ color: "var(--color-bt-text-dim)" }}>
          {url.length > 55 ? url.slice(0, 52) + "…" : url}
        </p>
      </div>
    </div>
  );
}

// ── Types ─────────────────────────────────────────────────────────────────

export interface LodgingItem {
  id: string;
  label: string;
  detail?: string | null;
  property_name?: string | null;   // sleeps count
  address?: string | null;
  check_in_time?: string | null;
  check_out_time?: string | null;
  transport_type?: string | null;
  total_price?: string | null;
}

// ── Shared input style ────────────────────────────────────────────────────

const inputStyle = {
  background: "var(--color-bt-card-raised)",
  borderColor: "var(--color-bt-border)",
  color: "var(--color-bt-text)",
};

// ── Sheet ─────────────────────────────────────────────────────────────────

export function AddLodgingSheet({
  tripId,
  item,
  onClose,
}: {
  tripId: string;
  item?: LodgingItem;          // present → edit mode
  onClose: () => void;
}) {
  useModalBackButton(onClose);
  const utils = trpc.useUtils();

  const isEditing = !!item;

  const existingUrl = isEditing && item.detail?.startsWith("http") ? item.detail : "";
  const existingNickname =
    isEditing && item.label && item.label !== extractDomain(existingUrl)
      ? item.label
      : "";

  // Core form state
  const [url, setUrl] = useState(existingUrl);
  const [nickname, setNickname] = useState(existingNickname);
  const [sleeps, setSleeps] = useState(item?.property_name ?? "");
  const [totalPrice, setTotalPrice] = useState(item?.total_price ?? "");
  const [checkIn, setCheckIn] = useState(item?.check_in_time ?? "");
  const [checkOut, setCheckOut] = useState(item?.check_out_time ?? "");

  // Manual mode — skip URL requirement
  const [manualMode, setManualMode] = useState(isEditing && !existingUrl);

  // Address autocomplete
  const [addressInput, setAddressInput] = useState(item?.address ?? "");
  const [addressDropdown, setAddressDropdown] = useState<PlacePrediction[]>([]);
  const addressTimer = useRef<ReturnType<typeof setTimeout>>();

  const handleAddressChange = (val: string) => {
    setAddressInput(val);
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
      setAddressInput(data.address ?? p.fullText);
    } catch {
      setAddressInput(p.fullText);
    }
  };

  // Derived
  const validUrl = isValidUrl(url);
  const platform = validUrl ? detectPlatform(url) : ((item?.transport_type ?? "other") as Platform);
  const showExpanded = validUrl || manualMode || isEditing;
  const canSubmit =
    showExpanded &&
    (validUrl || manualMode) &&
    (!manualMode || nickname.trim().length > 0);

  const handleUrlBlur = () => {
    const prefixed = ensureProtocol(url);
    if (prefixed !== url) setUrl(prefixed);
  };

  // Mutations
  const create = trpc.logistics.create.useMutation({
    onSuccess: () => { utils.logistics.list.invalidate({ tripId }); onClose(); },
  });
  const update = trpc.logistics.update.useMutation({
    onSuccess: () => { utils.logistics.list.invalidate({ tripId }); onClose(); },
  });

  const isPending = create.isPending || update.isPending;

  const handleSubmit = () => {
    if (!canSubmit) return;
    const domain = validUrl ? extractDomain(url) : "";
    const label = nickname.trim() || domain || "Property";

    if (isEditing) {
      update.mutate({
        tripId,
        itemId: item.id,
        label,
        detail: url || null,
        propertyName: sleeps.trim() || null,
        totalPrice: totalPrice.trim() || null,
        address: addressInput.trim() || null,
        checkInTime: checkIn || null,
        checkOutTime: checkOut || null,
        transportType: validUrl ? platform : "other",
      });
    } else {
      create.mutate({
        tripId,
        type: "lodging",
        label,
        propertyName: sleeps.trim() || undefined,
        totalPrice: totalPrice.trim() || undefined,
        address: addressInput.trim() || undefined,
        checkInTime: checkIn || undefined,
        checkOutTime: checkOut || undefined,
        transportType: validUrl ? platform : "other",
        detail: url || undefined,
      });
    }
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
        {/* Header */}
        <div className="flex items-center gap-2">
          {isEditing && <Pencil size={15} style={{ color: "var(--color-bt-accent)" }} />}
          <h2 className="text-lg font-semibold" style={{ color: "var(--color-bt-text)" }}>
            {isEditing ? "Edit Property" : "Add Property"}
          </h2>
        </div>
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

        {/* URL field — always visible; not required in manual mode */}
        <div className="relative mt-4">
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
            className="w-full rounded-xl border py-2.5 pl-9 pr-3 text-sm outline-none"
            style={{
              ...inputStyle,
              borderColor: validUrl ? "var(--color-bt-accent-border)" : "var(--color-bt-border)",
            }}
          />
        </div>

        {/* Link preview */}
        {validUrl && (
          <div className="mt-3">
            <p className="mb-1.5 text-[11px] font-medium uppercase tracking-wider" style={{ color: "var(--color-bt-text-dim)" }}>
              Preview
            </p>
            <LinkPreviewCard url={url} nickname={nickname} platform={platform} />
          </div>
        )}

        {/* Expanded fields */}
        {showExpanded && (
          <>
            {/* Optional Items divider */}
            <div className="mt-4 mb-3 flex items-center gap-2">
              <div className="flex-1 border-t" style={{ borderColor: "var(--color-bt-border)" }} />
              <span className="text-[11px] font-medium uppercase tracking-wider" style={{ color: "var(--color-bt-text-dim)" }}>
                {manualMode && !isEditing ? "Property Details" : "Optional"}
              </span>
              <div className="flex-1 border-t" style={{ borderColor: "var(--color-bt-border)" }} />
            </div>

            <div className="space-y-2">
              {/* Nickname / Name — required in manual mode */}
              <input
                type="text"
                placeholder={manualMode && !isEditing ? "Property name *" : "Nickname — e.g. Beach House"}
                value={nickname}
                onChange={(e) => setNickname(e.target.value)}
                // eslint-disable-next-line jsx-a11y/no-autofocus
                autoFocus={manualMode && !isEditing}
                className="w-full rounded-xl border px-3 py-2.5 text-sm outline-none"
                style={{
                  ...inputStyle,
                  borderColor:
                    manualMode && !isEditing && !nickname.trim()
                      ? "var(--color-bt-border)"
                      : manualMode && nickname.trim()
                        ? "var(--color-bt-accent-border)"
                        : "var(--color-bt-border)",
                }}
              />

              <div className="grid grid-cols-2 gap-2">
                <input
                  type="number"
                  placeholder="Sleeps — e.g. 8"
                  min={1}
                  max={99}
                  value={sleeps}
                  onChange={(e) => setSleeps(e.target.value)}
                  className="w-full rounded-xl border px-3 py-2.5 text-sm outline-none"
                  style={inputStyle}
                />
                <input
                  type="text"
                  placeholder="Total price — e.g. $2,400"
                  value={totalPrice}
                  onChange={(e) => setTotalPrice(e.target.value)}
                  className="w-full rounded-xl border px-3 py-2.5 text-sm outline-none"
                  style={inputStyle}
                />
              </div>

              {/* Address with Places autocomplete */}
              <div className="relative">
                <MapPin
                  size={14}
                  className="absolute left-3 top-3.5"
                  style={{ color: addressInput ? "var(--color-bt-accent)" : "var(--color-bt-text-dim)" }}
                />
                <input
                  type="text"
                  placeholder="Address"
                  value={addressInput}
                  onChange={(e) => handleAddressChange(e.target.value)}
                  className="w-full rounded-xl border py-2.5 pl-9 pr-3 text-sm outline-none"
                  style={{
                    ...inputStyle,
                    borderColor: addressInput ? "var(--color-bt-accent-border)" : "var(--color-bt-border)",
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

              {/* Check-in / Check-out */}
              <div className="grid grid-cols-2 gap-2">
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
            </div>
          </>
        )}

        {/* Actions */}
        <button
          onClick={handleSubmit}
          disabled={isPending || !canSubmit}
          className="mt-4 w-full rounded-xl py-3 text-sm font-semibold transition-opacity hover:opacity-90 disabled:opacity-40"
          style={{ background: "var(--color-bt-accent)", color: "var(--color-bt-base)" }}
        >
          {isPending
            ? (isEditing ? "Saving..." : "Adding...")
            : (isEditing ? "Save Changes" : "Add Property")}
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
