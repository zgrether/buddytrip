"use client";

import { useState } from "react";
import { ExternalLink, MapPin, CalendarDays, Plus, Trash2, Hotel, Pencil, Home } from "lucide-react";
import { trpc } from "@/lib/trpc-client";
import { PlanningRow, type ArcCardState } from "./PlanningRow";
import { AddLodgingSheet, type LodgingItem } from "./AddLodgingSheet";

// ── Platform config ───────────────────────────────────────────────────────

const PLATFORM: Record<string, { label: string; color: string }> = {
  airbnb:  { label: "AirBnB",  color: "var(--color-bt-danger)" },
  vrbo:    { label: "VRBO",    color: "var(--color-bt-planning)" },
  hotel:   { label: "Hotel",   color: "var(--color-bt-accent)" },
  rental:  { label: "Rental",  color: "var(--color-bt-ready)" },
  other:   { label: "Lodging", color: "var(--color-bt-text-dim)" },
};

function getPlatform(key?: string | null) {
  return PLATFORM[key ?? ""] ?? PLATFORM.other;
}

// ── Helpers ───────────────────────────────────────────────────────────────

function extractDomain(url?: string | null): string {
  if (!url) return "";
  try { return new URL(url).hostname.replace(/^www\./, ""); }
  catch { return url; }
}

function isHttpUrl(str?: string | null): boolean {
  if (!str) return false;
  return str.startsWith("http://") || str.startsWith("https://");
}

function mapsUrl(address: string): string {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`;
}

function fmtDate(dateStr?: string | null): string {
  if (!dateStr) return "";
  const d = new Date(dateStr.length === 10 ? `${dateStr}T12:00:00` : dateStr);
  if (isNaN(d.getTime())) return dateStr;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

// ── Types ─────────────────────────────────────────────────────────────────

interface LodgingItemFull {
  id: string;
  type: "lodging" | "transport" | "general";
  label: string;
  detail?: string | null;
  property_name?: string | null;   // sleeps count
  address?: string | null;
  check_in_time?: string | null;
  check_out_time?: string | null;
  transport_type?: string | null;  // platform
  total_price?: string | null;
  is_confirmed?: boolean | null;
}

// ── LodgingCard ───────────────────────────────────────────────────────────

function LodgingCard({
  item,
  canEdit,
  onEdit,
  onRemove,
  onConfirmToggle,
  removing,
}: {
  item: LodgingItemFull;
  canEdit: boolean;
  onEdit: () => void;
  onRemove: () => void;
  onConfirmToggle: () => void;
  removing: boolean;
}) {
  const platform = getPlatform(item.transport_type);
  const url = isHttpUrl(item.detail) ? item.detail! : null;
  const domain = url ? extractDomain(url) : null;
  const nickname = item.label && item.label !== domain ? item.label : null;
  const name = nickname ?? domain ?? platform.label;

  const checkIn = fmtDate(item.check_in_time);
  const checkOut = fmtDate(item.check_out_time);
  const dateRange = checkIn && checkOut
    ? `${checkIn} – ${checkOut}`
    : checkIn || checkOut || null;

  const confirmed = !!item.is_confirmed;

  return (
    <div
      className="overflow-hidden rounded-xl transition-all"
      style={{
        border: `1px solid ${confirmed ? "var(--color-bt-accent-border)" : "var(--color-bt-border)"}`,
      }}
    >
      {/* Platform strip */}
      <div
        className="flex items-center gap-2 px-3 py-2"
        style={{ background: confirmed ? "var(--color-bt-tag-bg)" : "var(--color-bt-tag-bg)" }}
      >
        <span
          className="flex-shrink-0 rounded-full px-2 py-0.5 text-[11px] font-bold uppercase tracking-wider"
          style={{ background: platform.color, color: "var(--color-bt-base)" }}
        >
          {platform.label}
        </span>

        <span className="flex-1" />

        {/* Confirm toggle — planners only */}
        {canEdit && (
          <button
            onClick={onConfirmToggle}
            className="flex-shrink-0 rounded-lg px-2 py-1 text-[11px] font-medium transition-colors"
            style={{ color: confirmed ? "var(--color-bt-accent)" : "var(--color-bt-text-dim)" }}
          >
            {confirmed ? "Confirmed 🔒" : "Confirm"}
          </button>
        )}

        {canEdit && (
          <>
            <button
              onClick={onEdit}
              className="flex-shrink-0 flex h-5 w-5 items-center justify-center rounded"
              style={{ color: "var(--color-bt-accent)" }}
              aria-label="Edit property"
            >
              <Pencil size={13} />
            </button>
            <button
              onClick={onRemove}
              disabled={removing}
              className="flex-shrink-0 flex h-5 w-5 items-center justify-center rounded disabled:opacity-40"
              style={{ color: "var(--color-bt-text-dim)" }}
              aria-label="Remove property"
            >
              <Trash2 size={13} />
            </button>
          </>
        )}
      </div>

      {/* Card body */}
      <div
        className="px-3 py-2.5 space-y-2"
        style={{ background: "var(--color-bt-card-raised)" }}
      >
        {/* Row 1: Name · Open link */}
        <div className="flex items-start justify-between gap-2">
          <p className="text-[13px] font-semibold leading-tight" style={{ color: "var(--color-bt-text)" }}>
            {name}
          </p>
          {url && (
            <a
              href={url}
              target="_blank"
              rel="noopener noreferrer"
              className="flex-shrink-0 flex items-center gap-1 no-underline"
            >
              <ExternalLink size={11} style={{ color: "var(--color-bt-accent)" }} />
              <span className="text-[11px] font-medium" style={{ color: "var(--color-bt-accent)" }}>
                Open
              </span>
            </a>
          )}
        </div>

        {/* Row 2: Date · Sleeps */}
        {(dateRange || item.property_name) && (
          <div className="flex items-center justify-between gap-2">
            {dateRange ? (
              <div className="flex items-center gap-1.5">
                <CalendarDays size={11} className="flex-shrink-0" style={{ color: "var(--color-bt-text-dim)" }} />
                <span className="text-[12px]" style={{ color: "var(--color-bt-text-dim)" }}>
                  {dateRange}
                </span>
              </div>
            ) : <span />}
            {item.property_name && (
              <span className="flex-shrink-0 text-[12px]" style={{ color: "var(--color-bt-text-dim)" }}>
                Sleeps {item.property_name}
              </span>
            )}
          </div>
        )}

        {/* Bottom row: Address (left) · Price (right) */}
        {(item.address || item.total_price) && (
          <div className="flex items-end justify-between gap-2">
            {item.address ? (
              <a
                href={mapsUrl(item.address)}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-start gap-1.5 no-underline"
              >
                <MapPin size={11} className="mt-0.5 flex-shrink-0" style={{ color: "var(--color-bt-accent)" }} />
                <span className="text-[12px] leading-tight underline" style={{ color: "var(--color-bt-accent)" }}>
                  {item.address}
                </span>
              </a>
            ) : <span />}
            {item.total_price && (
              <span className="flex-shrink-0 text-[12px]" style={{ color: "var(--color-bt-text-dim)" }}>
                {/^[$€£¥]/.test(item.total_price) ? item.total_price : `$${item.total_price}`}
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ── LodgingPanel ──────────────────────────────────────────────────────────

interface LodgingPanelProps {
  tripId: string;
  canEdit: boolean;
  isOpen: boolean;
  onToggle: () => void;
}

export function LodgingPanel({
  tripId,
  canEdit,
  isOpen,
  onToggle,
}: LodgingPanelProps) {
  const utils = trpc.useUtils();

  const { data: items = [] } = trpc.logistics.list.useQuery({ tripId });

  const [showAddLodging, setShowAddLodging] = useState(false);
  const [editingItem, setEditingItem] = useState<LodgingItem | null>(null);

  const removeItem = trpc.logistics.remove.useMutation({
    onSuccess: () => utils.logistics.list.invalidate({ tripId }),
  });
  const confirmItem = trpc.logistics.confirm.useMutation({
    onSuccess: () => utils.logistics.list.invalidate({ tripId }),
  });
  const unconfirmItem = trpc.logistics.unconfirm.useMutation({
    onSuccess: () => utils.logistics.list.invalidate({ tripId }),
  });

  // ── Derived data ─────────────────────────────────────────────────────
  const lodgingItems = (items as LodgingItemFull[])
    .filter((i) => i.type === "lodging")
    .sort((a, b) => {
      if (!a.check_in_time && !b.check_in_time) return 0;
      if (!a.check_in_time) return 1;
      if (!b.check_in_time) return -1;
      return a.check_in_time < b.check_in_time ? -1 : 1;
    });

  const confirmedCount = lodgingItems.filter((i) => i.is_confirmed).length;
  const totalCount = lodgingItems.length;

  // ── PlanningRow header state ──────────────────────────────────────────
  let note = "No properties added yet";
  if (totalCount > 0) {
    note = confirmedCount > 0
      ? `${confirmedCount} of ${totalCount} confirmed`
      : `${totalCount} option${totalCount !== 1 ? "s" : ""} being considered`;
  }

  const state: ArcCardState = confirmedCount > 0 ? "inProgress" : totalCount > 0 ? "inProgress" : "none";

  return (
    <>
      <PlanningRow
        icon={<Hotel size={16} />}
        label="Lodging"
        note={note}
        state={state}
        isOpen={isOpen}
        onToggle={onToggle}
      >
        <div>
          <p className="mb-3 text-[13px]" style={{ color: "var(--color-bt-text-dim)" }}>
            Add the places you&apos;re thinking of staying at. Once you decide on the
            perfect one, lock it in and remove the others.
          </p>

          {canEdit && (
            <button
              onClick={() => setShowAddLodging(true)}
              className="mb-3 flex w-full items-center justify-center gap-1.5 rounded-xl py-2.5 text-sm font-medium transition-all"
              style={{
                background: "var(--color-bt-card-raised)",
                color: "var(--color-bt-text)",
                border: "1px solid var(--color-bt-border)",
              }}
            >
              <Home size={14} />
              <Plus size={12} />
              Add property
            </button>
          )}

          {lodgingItems.length > 0 && (
            <div className="flex flex-col gap-2">
              {lodgingItems.map((item) => (
                <LodgingCard
                  key={item.id}
                  item={item}
                  canEdit={canEdit}
                  onEdit={() => setEditingItem(item)}
                  onRemove={() => removeItem.mutate({ tripId, itemId: item.id })}
                  onConfirmToggle={() =>
                    item.is_confirmed
                      ? unconfirmItem.mutate({ tripId, itemId: item.id })
                      : confirmItem.mutate({ tripId, itemId: item.id })
                  }
                  removing={removeItem.isPending}
                />
              ))}
            </div>
          )}
        </div>
      </PlanningRow>

      {showAddLodging && (
        <AddLodgingSheet
          tripId={tripId}
          onClose={() => setShowAddLodging(false)}
        />
      )}

      {editingItem && (
        <AddLodgingSheet
          tripId={tripId}
          item={editingItem}
          onClose={() => setEditingItem(null)}
        />
      )}
    </>
  );
}
