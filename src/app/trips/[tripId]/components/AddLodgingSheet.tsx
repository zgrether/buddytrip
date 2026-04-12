"use client";

import { useState } from "react";
import { Link, Globe, Pencil } from "lucide-react";
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

// ── Link preview card — mirrors what shows in the lodging grid ────────────

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
      {/* Domain strip */}
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
      {/* Body */}
      <div className="px-3 py-2.5" style={{ background: "var(--color-bt-card-raised)" }}>
        {nickname ? (
          <p className="text-xs font-semibold" style={{ color: "var(--color-bt-text)" }}>
            {nickname}
          </p>
        ) : (
          <p className="text-xs italic" style={{ color: "var(--color-bt-text-dim)" }}>
            Add a nickname below (optional)
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

// ── Sheet ─────────────────────────────────────────────────────────────────

const inputStyle = {
  background: "var(--color-bt-card-raised)",
  borderColor: "var(--color-bt-border)",
  color: "var(--color-bt-text)",
};

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

  // Seed state from existing item when editing
  const existingUrl = isEditing && item.detail?.startsWith("http") ? item.detail : "";
  const existingNickname =
    isEditing && item.label && item.label !== extractDomain(existingUrl)
      ? item.label
      : "";

  const [url, setUrl] = useState(existingUrl);
  const [nickname, setNickname] = useState(existingNickname);
  const [sleeps, setSleeps] = useState(item?.property_name ?? "");
  const [totalPrice, setTotalPrice] = useState(item?.total_price ?? "");
  const [address, setAddress] = useState(item?.address ?? "");
  const [checkIn, setCheckIn] = useState(item?.check_in_time ?? "");
  const [checkOut, setCheckOut] = useState(item?.check_out_time ?? "");

  const validUrl = isValidUrl(url);
  const platform = validUrl ? detectPlatform(url) : ((item?.transport_type ?? "other") as Platform);

  const create = trpc.logistics.create.useMutation({
    onSuccess: () => {
      utils.logistics.list.invalidate({ tripId });
      onClose();
    },
  });

  const update = trpc.logistics.update.useMutation({
    onSuccess: () => {
      utils.logistics.list.invalidate({ tripId });
      onClose();
    },
  });

  const isPending = create.isPending || update.isPending;

  const handleSubmit = () => {
    if (!validUrl) return;
    const domain = extractDomain(url);
    const label = nickname.trim() || domain;

    if (isEditing) {
      update.mutate({
        tripId,
        itemId: item.id,
        label,
        detail: url,
        propertyName: sleeps.trim() || null,
        totalPrice: totalPrice.trim() || null,
        address: address.trim() || null,
        checkInTime: checkIn || null,
        checkOutTime: checkOut || null,
        transportType: platform,
      });
    } else {
      create.mutate({
        tripId,
        type: "lodging",
        label,
        propertyName: sleeps.trim() || undefined,
        totalPrice: totalPrice.trim() || undefined,
        address: address.trim() || undefined,
        checkInTime: checkIn || undefined,
        checkOutTime: checkOut || undefined,
        transportType: platform,
        detail: url,
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
        <div className="flex items-center gap-2">
          {isEditing && <Pencil size={15} style={{ color: "var(--color-bt-accent)" }} />}
          <h2 className="text-lg font-semibold" style={{ color: "var(--color-bt-text)" }}>
            {isEditing ? "Edit Property" : "Add Property"}
          </h2>
        </div>
        <p className="mt-0.5 text-sm" style={{ color: "var(--color-bt-text-dim)" }}>
          {isEditing
            ? "Update the link, nickname, address, or dates"
            : "Paste an AirBnB, VRBO, or hotel link"}
        </p>

        {/* URL field — primary */}
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
            // eslint-disable-next-line jsx-a11y/no-autofocus
            autoFocus={!isEditing}
            className="w-full rounded-xl border py-2.5 pl-9 pr-3 text-sm outline-none"
            style={{
              ...inputStyle,
              borderColor: validUrl ? "var(--color-bt-accent-border)" : "var(--color-bt-border)",
            }}
          />
        </div>

        {/* Live preview — shown once URL is valid */}
        {validUrl && (
          <div className="mt-3">
            <p className="mb-1.5 text-[11px] font-medium uppercase tracking-wider" style={{ color: "var(--color-bt-text-dim)" }}>
              Preview
            </p>
            <LinkPreviewCard url={url} nickname={nickname} platform={platform} />
          </div>
        )}

        {/* Optional fields — shown after URL is valid (or always in edit mode) */}
        {(validUrl || isEditing) && (
          <div className="mt-4 space-y-2">
            <input
              type="text"
              placeholder="Nickname (optional) — e.g. Beach House"
              value={nickname}
              onChange={(e) => setNickname(e.target.value)}
              className="w-full rounded-xl border px-3 py-2.5 text-sm outline-none"
              style={inputStyle}
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

            <input
              type="text"
              placeholder="Address (optional)"
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              className="w-full rounded-xl border px-3 py-2.5 text-sm outline-none"
              style={inputStyle}
            />

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
        )}

        {/* Actions */}
        <button
          onClick={handleSubmit}
          disabled={isPending || !validUrl}
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
