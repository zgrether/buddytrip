"use client";

import { useState } from "react";
import { Link, Globe } from "lucide-react";
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
    if (host.includes("airbnb"))                          return "airbnb";
    if (host.includes("vrbo") || host.includes("homeaway")) return "vrbo";
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

// ── Sheet ─────────────────────────────────────────────────────────────────

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

  const [url, setUrl] = useState("");
  const [nickname, setNickname] = useState("");
  const [address, setAddress] = useState("");
  const [checkIn, setCheckIn] = useState("");
  const [checkOut, setCheckOut] = useState("");

  const validUrl = isValidUrl(url);
  const platform = detectPlatform(url);

  const create = trpc.logistics.create.useMutation({
    onSuccess: () => {
      utils.logistics.list.invalidate({ tripId });
      onClose();
    },
  });

  const handleSubmit = () => {
    if (!validUrl) return;
    const domain = extractDomain(url);
    create.mutate({
      tripId,
      type: "lodging",
      label: nickname.trim() || domain,  // nickname → domain as fallback
      address: address.trim() || undefined,
      checkInTime: checkIn || undefined,
      checkOutTime: checkOut || undefined,
      transportType: platform,           // stores detected platform
      detail: url,                       // URL stored in detail
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
          Paste an AirBnB, VRBO, or hotel link
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
            autoFocus
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

        {/* Optional fields — shown after URL is valid */}
        {validUrl && (
          <div className="mt-4 space-y-2">
            <input
              type="text"
              placeholder="Nickname (optional) — e.g. Beach House"
              value={nickname}
              onChange={(e) => setNickname(e.target.value)}
              className="w-full rounded-xl border px-3 py-2.5 text-sm outline-none"
              style={inputStyle}
            />

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
          disabled={create.isPending || !validUrl}
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
