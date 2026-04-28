"use client";

import { useState } from "react";
import { ExternalLink, MapPin, Trash2, Hotel, Pencil, Clock, Plus } from "lucide-react";
import { trpc } from "@/lib/trpc-client";
import { EmptyState } from "@/components/EmptyState";
import { PlanningRow, type ArcCardState } from "./PlanningRow";
import { AddPropertySheet, detectPlatform, extractDomain, isValidUrl, type PropertyFormValues } from "./AddPropertySheet";

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

function extractDomainNullable(url?: string | null): string {
  if (!url) return "";
  return extractDomain(url);
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
  notes?: string | null;
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
  const domain = url ? extractDomainNullable(url) : null;
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

        {/* Line 2: Thoughts/notes */}
        {item.notes && (
          <p className="mt-0.5 text-xs italic" style={{ color: "var(--color-bt-text-dim)" }}>
            {item.notes}
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
  /**
   * When true, renders as a flat Schedule-tab-style section — own
   * `LODGING` header, explanatory blurb, `+ Add property` button at the
   * top, no collapsible PlanningRow wrapper. Used during the planning
   * stage in HomeTab so lodging reads as a primary section rather than
   * a nested accordion. Non-inline mode (default) keeps the original
   * PlanningRow behaviour for going/now/past.
   */
  inline?: boolean;
  /** Suppress the inline section header — used when an outer panel already provides the title. */
  hideHeader?: boolean;
}

export function LodgingPanel({
  tripId,
  canEdit,
  isOpen,
  onToggle,
  inline = false,
  hideHeader = false,
}: LodgingPanelProps) {
  const utils = trpc.useUtils();

  const { data: items = [] } = trpc.logistics.list.useQuery({ tripId });
  // Trip query is already cached from the parent page — pulling it
  // here is a free read used to validate lodging dates against the
  // trip date range.
  const { data: trip } = trpc.trips.getById.useQuery({ tripId });

  const [showAddLodging, setShowAddLodging] = useState(false);
  const [editingItem, setEditingItem] = useState<LodgingItemFull | null>(null);

  const createItem = trpc.logistics.create.useMutation({
    onSuccess: () => { utils.logistics.list.invalidate({ tripId }); setShowAddLodging(false); },
  });

  const updateItem = trpc.logistics.update.useMutation({
    onSuccess: () => { utils.logistics.list.invalidate({ tripId }); setEditingItem(null); },
  });

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

  // ── Submit handlers ──────────────────────────────────────────────────
  const handleCreate = (values: PropertyFormValues) => {
    const platform = isValidUrl(values.url) ? detectPlatform(values.url) : "other";
    const domain = isValidUrl(values.url) ? extractDomain(values.url) : "";
    createItem.mutate({
      tripId,
      type: "lodging",
      label: values.name.trim() || domain || "Property",
      detail: values.url || undefined,
      propertyName: values.sleeps.trim() || undefined,
      totalPrice: values.price.trim() || undefined,
      notes: values.notes.trim() || undefined,
      address: values.address.trim() || undefined,
      checkInTime: values.checkIn || undefined,
      checkOutTime: values.checkOut || undefined,
      transportType: platform,
    });
  };

  const handleUpdate = (values: PropertyFormValues) => {
    if (!editingItem) return;
    const platform = isValidUrl(values.url) ? detectPlatform(values.url) : "other";
    const domain = isValidUrl(values.url) ? extractDomain(values.url) : "";
    updateItem.mutate({
      tripId,
      itemId: editingItem.id,
      label: values.name.trim() || domain || "Property",
      detail: values.url || null,
      propertyName: values.sleeps.trim() || null,
      totalPrice: values.price.trim() || null,
      notes: values.notes.trim() || null,
      address: values.address.trim() || null,
      checkInTime: values.checkIn || null,
      checkOutTime: values.checkOut || null,
      transportType: platform,
    });
  };

  const confirmedCount = lodgingItems.filter((i) => i.is_confirmed).length;
  const totalCount = lodgingItems.length;

  // Lodging items where check-in or check-out date falls outside the trip
  // date range. Mostly catches typos (e.g., wrong year) so the user can
  // double-check before relying on the itinerary.
  const tripStart = trip?.start_date ?? null;
  const tripEnd = trip?.end_date ?? null;
  const outOfRangeCount =
    tripStart && tripEnd
      ? lodgingItems.filter((i) => {
          const checkIn = i.check_in_time?.slice(0, 10) ?? null;
          const checkOut = i.check_out_time?.slice(0, 10) ?? null;
          if (checkIn && (checkIn < tripStart || checkIn > tripEnd)) return true;
          if (checkOut && (checkOut < tripStart || checkOut > tripEnd)) return true;
          return false;
        }).length
      : 0;

  // ── PlanningRow header state ──────────────────────────────────────────
  let note = "No properties added yet";
  if (totalCount > 0) {
    note = confirmedCount > 0
      ? `${confirmedCount} of ${totalCount} confirmed`
      : `${totalCount} option${totalCount !== 1 ? "s" : ""} being considered`;
  }

  const state: ArcCardState = confirmedCount > 0 ? "inProgress" : totalCount > 0 ? "inProgress" : "none";

  // ── Inline variant — Schedule-tab-style section ──────────────────────
  // Used during the planning stage: no collapsible wrapper, section
  // header + blurb + add-button-on-top, then the list of properties.
  if (inline) {
    return (
      <>
        <section>
          {!hideHeader && (
            <h2
              className="mb-2 text-xs font-semibold uppercase tracking-wider"
              style={{ color: "var(--color-bt-text-dim)" }}
            >
              Lodging
            </h2>
          )}

          <p
            className="mb-3 text-[13px] leading-relaxed"
            style={{ color: "var(--color-bt-text-dim)" }}
          >
            Drop in the places you&apos;re considering so the crew can
            compare — links, prices, sleep counts, anything helpful.
            Confirm the winner once it&apos;s booked and it&apos;ll lock
            onto the official trip details.
          </p>

          {canEdit && outOfRangeCount > 0 && (
            <div
              className="mb-4 flex items-center gap-3 rounded-xl px-4 py-3"
              style={{
                background: "var(--color-bt-card)",
                border: "1px solid var(--color-bt-border)",
              }}
            >
              <span
                className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg"
                style={{ background: "var(--color-bt-warning-faint)", color: "var(--color-bt-warning)" }}
              >
                <Hotel size={14} />
              </span>
              <div>
                <p className="text-[13px] font-semibold leading-tight" style={{ color: "var(--color-bt-text)" }}>
                  {outOfRangeCount} {outOfRangeCount === 1 ? "property has" : "properties have"} dates outside the trip
                </p>
                <p className="mt-0.5 text-[11px] leading-snug" style={{ color: "var(--color-bt-text-dim)" }}>
                  Double-check the check-in / check-out or update the trip dates if entered wrong
                </p>
              </div>
            </div>
          )}

          {canEdit && (
            <button
              onClick={() => setShowAddLodging(true)}
              className="mb-4 flex w-full items-center justify-center gap-1.5 rounded-xl py-2.5 text-sm font-medium transition-all"
              style={{
                background: "var(--color-bt-card-raised)",
                color: "var(--color-bt-text)",
                border: "1px solid var(--color-bt-border)",
              }}
            >
              <Hotel size={15} />
              <Plus size={12} /> Property
            </button>
          )}

          {lodgingItems.length === 0 ? (
            <EmptyState
              icon={<Hotel className="h-10 w-10" />}
              headline="No properties yet"
              subtext={
                canEdit
                  ? "Add properties to compare places the crew is considering — confirm the winner once it's booked."
                  : "The organizer hasn't added any properties yet."
              }
            />
          ) : (
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
        </section>

        {showAddLodging && (
          <AddPropertySheet
            showAddressAndDates
            isPending={createItem.isPending}
            onSubmit={handleCreate}
            onClose={() => setShowAddLodging(false)}
          />
        )}

        {editingItem && (
          <AddPropertySheet
            isEditing
            showAddressAndDates
            initialValues={{
              url: editingItem.detail?.startsWith("http") ? editingItem.detail : "",
              name: (() => {
                const domain = editingItem.detail?.startsWith("http") ? extractDomainNullable(editingItem.detail) : "";
                return editingItem.label && editingItem.label !== domain ? editingItem.label : "";
              })(),
              sleeps: editingItem.property_name ?? "",
              price: editingItem.total_price ?? "",
              notes: editingItem.notes ?? "",
              address: editingItem.address ?? "",
              checkIn: editingItem.check_in_time ?? "",
              checkOut: editingItem.check_out_time ?? "",
            }}
            isPending={updateItem.isPending}
            onSubmit={handleUpdate}
            onClose={() => setEditingItem(null)}
          />
        )}
      </>
    );
  }

  // ── Empty state — flat non-collapsible header row ─────────────────────
  if (lodgingItems.length === 0) {
    return (
      <>
        <div
          className="rounded-xl border"
          style={{
            background: "var(--color-bt-card)",
            borderColor: "var(--color-bt-border)",
            boxShadow: "var(--shadow-card)",
          }}
        >
          <div className="flex items-center gap-3 px-4 py-3.5">
            {/* Icon */}
            <div
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg"
              style={{ background: "var(--color-bt-card-raised)" }}
            >
              <Hotel size={16} style={{ color: "var(--color-bt-text-dim)" }} />
            </div>

            {/* Title + subtitle */}
            <div className="min-w-0 flex-1">
              <div
                className="text-sm font-semibold"
                style={{ color: "var(--color-bt-text)" }}
              >
                Lodging
              </div>
              <div
                className="mt-0.5 text-xs"
                style={{ color: "var(--color-bt-text-dim)" }}
              >
                Where are you staying?
              </div>
            </div>

            {/* Add button — secondary small, canEdit only */}
            {canEdit && (
              <button
                onClick={() => setShowAddLodging(true)}
                className="shrink-0 rounded-xl px-3 py-1.5 text-xs font-semibold"
                style={{
                  background: "var(--color-bt-card-raised)",
                  color: "var(--color-bt-text)",
                  border: "0.5px solid var(--color-bt-border)",
                }}
              >
                + Add property
              </button>
            )}
          </div>
        </div>

        {showAddLodging && (
          <AddPropertySheet
            showAddressAndDates
            isPending={createItem.isPending}
            onSubmit={handleCreate}
            onClose={() => setShowAddLodging(false)}
          />
        )}
      </>
    );
  }

  // ── Has properties — collapsible PlanningRow ───────────────────────────
  return (
    <>
      <PlanningRow
        icon={<Hotel size={16} />}
        label="Lodging"
        note={note}
        state={state}
        isOpen={isOpen}
        onToggle={onToggle}
        noExpand={true}
      >
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

          {/* Add property — dashed/add style, bottom of list, canEdit only */}
          {canEdit && (
            <button
              onClick={() => setShowAddLodging(true)}
              className="w-full rounded-xl py-2.5 text-sm font-medium"
              style={{
                border: "1.5px dashed var(--color-bt-accent)",
                color: "var(--color-bt-accent)",
                background: "transparent",
              }}
            >
              + Add property
            </button>
          )}
        </div>
      </PlanningRow>

      {showAddLodging && (
        <AddPropertySheet
          showAddressAndDates
          isPending={createItem.isPending}
          onSubmit={handleCreate}
          onClose={() => setShowAddLodging(false)}
        />
      )}

      {editingItem && (
        <AddPropertySheet
          isEditing
          showAddressAndDates
          initialValues={{
            url: editingItem.detail?.startsWith("http") ? editingItem.detail : "",
            name: (() => {
              const domain = editingItem.detail?.startsWith("http") ? extractDomainNullable(editingItem.detail) : "";
              return editingItem.label && editingItem.label !== domain ? editingItem.label : "";
            })(),
            sleeps: editingItem.property_name ?? "",
            price: editingItem.total_price ?? "",
            notes: editingItem.notes ?? "",
            address: editingItem.address ?? "",
            checkIn: editingItem.check_in_time ?? "",
            checkOut: editingItem.check_out_time ?? "",
          }}
          isPending={updateItem.isPending}
          onSubmit={handleUpdate}
          onClose={() => setEditingItem(null)}
        />
      )}
    </>
  );
}
