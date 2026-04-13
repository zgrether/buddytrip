"use client";

import { useState } from "react";
import { ExternalLink, MapPin, Plus, Trash2, Hotel, Pencil, Home, Clock } from "lucide-react";
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
  const name = nickname ?? domain ?? "No name";

  const checkIn = fmtDate(item.check_in_time);
  const checkOut = fmtDate(item.check_out_time);
  const dateRange = checkIn && checkOut
    ? `${checkIn} – ${checkOut}`
    : checkIn || checkOut || null;

  const confirmed = !!item.is_confirmed;

  const price = item.total_price
    ? (/^[$€£¥]/.test(item.total_price) ? item.total_price : `$${item.total_price}`)
    : null;

  return (
    <div
      className="flex items-start gap-2 rounded-xl px-4 py-3 transition-all"
      style={{
        background: confirmed ? "var(--color-bt-tag-bg)" : "var(--color-bt-card)",
        border: `1px solid ${confirmed ? "var(--color-bt-accent-border)" : "var(--color-bt-border)"}`,
      }}
    >
      {/* Content */}
      <div className="min-w-0 flex-1">
        {/* Line 1: Name · sleeps · price */}
        <div className="flex flex-wrap items-baseline gap-x-1.5 gap-y-0.5">
          <span className="text-sm font-medium" style={{ color: "var(--color-bt-text)" }}>
            {name}
          </span>
          {item.property_name && (
            <span className="text-xs" style={{ color: "var(--color-bt-text-dim)" }}>
              · Sleeps {item.property_name}
            </span>
          )}
          {price && (
            <span className="text-xs" style={{ color: "var(--color-bt-text-dim)" }}>
              · {price}
            </span>
          )}
        </div>

        {/* Line 2: Notes / detail */}
        {item.detail && !isHttpUrl(item.detail) && (
          <p className="mt-0.5 text-xs" style={{ color: "var(--color-bt-text-dim)" }}>
            {item.detail}
          </p>
        )}

        {/* Line 3: Address → Map */}
        {item.address && (
          <div className="mt-1 flex flex-wrap items-center gap-2 text-xs" style={{ color: "var(--color-bt-text-dim)" }}>
            <span>{item.address}</span>
            <a
              href={mapsUrl(item.address)}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-0.5"
              style={{ color: "var(--color-bt-accent)" }}
              onClick={(e) => e.stopPropagation()}
            >
              <MapPin size={10} />
              Map
            </a>
          </div>
        )}

        {/* Line 4: Check-in / check-out */}
        {dateRange && (
          <div className="mt-1 flex items-center gap-1 text-xs" style={{ color: "var(--color-bt-text-dim)" }}>
            <Clock size={10} />
            {dateRange}
          </div>
        )}

      </div>

      {/* Right column: actions (top) + listing link (bottom) */}
      <div className="flex flex-shrink-0 flex-col items-end justify-between gap-2 self-stretch">
        <div className="flex items-center gap-1">
          {canEdit && (
            <button
              onClick={onConfirmToggle}
              className="rounded-lg px-2 py-1 text-[11px] font-medium transition-colors"
              style={{ color: confirmed ? "var(--color-bt-accent)" : "var(--color-bt-text-dim)" }}
            >
              {confirmed ? "Confirmed 🔒" : "Confirm"}
            </button>
          )}
          {canEdit && (
            <>
              <button
                onClick={onEdit}
                className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded"
                aria-label="Edit property"
              >
                <Pencil size={13} style={{ color: "var(--color-bt-text-dim)" }} />
              </button>
              <button
                onClick={onRemove}
                disabled={removing}
                className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded disabled:opacity-40"
                aria-label="Remove property"
              >
                <Trash2 size={13} style={{ color: "var(--color-bt-text-dim)" }} />
              </button>
            </>
          )}
        </div>
        {url && (
          <a
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-0.5 no-underline"
            style={{ color: "var(--color-bt-accent)" }}
          >
            <ExternalLink size={10} />
            <span className="text-[11px] font-medium">→ {platform.label}</span>
          </a>
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
    async onMutate(vars) {
      await utils.logistics.list.cancel({ tripId });
      const prev = utils.logistics.list.getData({ tripId });
      utils.logistics.list.setData({ tripId }, (old) =>
        old?.map((item) =>
          item.id === vars.itemId ? { ...item, is_confirmed: true } : item
        )
      );
      return { prev };
    },
    onError(_e, _v, ctx) {
      if (ctx?.prev) utils.logistics.list.setData({ tripId }, ctx.prev);
    },
    onSettled: () => utils.logistics.list.invalidate({ tripId }),
  });

  const unconfirmItem = trpc.logistics.unconfirm.useMutation({
    async onMutate(vars) {
      await utils.logistics.list.cancel({ tripId });
      const prev = utils.logistics.list.getData({ tripId });
      utils.logistics.list.setData({ tripId }, (old) =>
        old?.map((item) =>
          item.id === vars.itemId ? { ...item, is_confirmed: false } : item
        )
      );
      return { prev };
    },
    onError(_e, _v, ctx) {
      if (ctx?.prev) utils.logistics.list.setData({ tripId }, ctx.prev);
    },
    onSettled: () => utils.logistics.list.invalidate({ tripId }),
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
