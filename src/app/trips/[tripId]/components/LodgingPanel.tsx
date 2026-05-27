"use client";

import { useState } from "react";
import { ExternalLink, MapPin, Trash2, Hotel, Pencil, Clock, Plus, Check, Link2 } from "lucide-react";
import { trpc } from "@/lib/trpc-client";
import { EmptyState } from "@/components/EmptyState";
import { SampleHeader, SampleCard, RailComposer } from "@/components/SampleSection";
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
  check_in_time_of_day?: string | null;
  check_out_time_of_day?: string | null;
  transport_type?: string | null;  // platform
  total_price?: string | null;
  notes?: string | null;
  is_confirmed?: boolean | null;
  /** og:image fetched from the listing URL (or empty when unavailable).
   *  When set, surfaces as the LodgingCard photo strip instead of the
   *  placeholder gradient. */
  image_url?: string | null;
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
      className="flex flex-col gap-2 rounded-xl p-3 transition-all"
      style={{
        background: confirmed ? "var(--color-bt-tag-bg)" : "var(--color-bt-card)",
        border: `1px solid ${confirmed ? "var(--color-bt-accent-border)" : "var(--color-bt-border)"}`,
      }}
    >
      {/* Photo strip — real listing photo (og:image) when we have one,
          placeholder gradient otherwise. Mirrors PropertyExample so the
          populated tiles match the empty-state preview promised.
          Carries the Confirmed pill / Confirm button bottom-right and
          the edit/delete actions top-right when canEdit. Gradient hex
          literals are spec-explicit (HANDOFF rule 4 exception). */}
      <div
        className="relative flex items-end justify-end rounded-lg p-2"
        style={{
          height: 80,
          backgroundImage: item.image_url
            ? `url("${item.image_url}")`
            : "linear-gradient(135deg, #0d2c3a 0%, #0d3a4f 100%)",
          backgroundSize: "cover",
          backgroundPosition: "center",
        }}
      >
        {/* Generic-property placeholder icon — centered, low opacity.
            Shows only when we don't have a real listing photo, so the
            tile never reads as a blank panel waiting to load. */}
        {!item.image_url && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center" aria-hidden>
            <Hotel size={36} strokeWidth={1.5} style={{ color: "rgba(255,255,255,0.22)" }} />
          </div>
        )}

        {/* Edit / delete — top-right overlay on the photo strip */}
        {canEdit && (
          <div className="absolute right-1.5 top-1.5 flex items-center gap-1">
            <button
              onClick={onEdit}
              aria-label="Edit property"
              className="flex h-6 w-6 items-center justify-center rounded transition-colors hover:bg-black/30"
              style={{ background: "rgba(0,0,0,0.35)", color: "#e2e8f0" }}
            >
              <Pencil size={12} strokeWidth={2.25} />
            </button>
            <button
              onClick={onRemove}
              disabled={removing}
              aria-label="Remove property"
              className="flex h-6 w-6 items-center justify-center rounded transition-colors hover:bg-black/30 disabled:opacity-40"
              style={{ background: "rgba(0,0,0,0.35)", color: "#e2e8f0" }}
            >
              <Trash2 size={12} strokeWidth={2.25} />
            </button>
          </div>
        )}

        {/* Confirmed / Confirm — bottom-right matches PropertyExample */}
        {confirmed ? (
          <button
            onClick={onConfirmToggle}
            disabled={!canEdit}
            aria-label={canEdit ? "Mark as not confirmed" : undefined}
            className="inline-flex items-center gap-1 rounded-[4px] px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-[0.08em] transition-opacity hover:opacity-85 disabled:cursor-default"
            style={{
              background: "var(--color-bt-accent)",
              color: "var(--color-bt-on-accent)",
            }}
          >
            <Check size={9} strokeWidth={3.5} />
            Confirmed
          </button>
        ) : canEdit ? (
          <button
            onClick={onConfirmToggle}
            className="inline-flex items-center gap-1 rounded-[4px] px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-[0.08em] transition-opacity hover:opacity-85"
            style={{
              background: "rgba(0,0,0,0.45)",
              color: "#e2e8f0",
              border: "1px solid rgba(255,255,255,0.18)",
            }}
          >
            Confirm
          </button>
        ) : null}
      </div>

      {/* Name + monospace meta line — same hierarchy as PropertyExample */}
      <div className="flex flex-col gap-0.5">
        <div
          className="truncate text-sm font-semibold"
          style={{ color: "var(--color-bt-text)" }}
          title={name}
        >
          {name}
        </div>
        <div
          className="font-mono text-[11px]"
          style={{ color: "var(--color-bt-text-dim)" }}
        >
          {[
            price ? price : null,
            item.property_name ? `sleeps ${item.property_name}` : null,
          ]
            .filter(Boolean)
            .join(" · ") || "—"}
        </div>
      </div>

      {/* Notes — italic, smaller */}
      {item.notes && (
        <p
          className="m-0 line-clamp-2 text-[11px] italic leading-snug"
          style={{ color: "var(--color-bt-text-dim)" }}
        >
          {item.notes}
        </p>
      )}

      {/* Address + Map link */}
      {item.address && (
        <div
          className="flex flex-wrap items-center gap-1.5 text-[11px]"
          style={{ color: "var(--color-bt-text-dim)" }}
        >
          <span className="truncate" title={item.address}>{item.address}</span>
          <a
            href={mapsUrl(item.address)}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-0.5"
            style={{ color: "var(--color-bt-accent)" }}
            onClick={(e) => e.stopPropagation()}
          >
            <MapPin size={10} />
            Map
          </a>
        </div>
      )}

      {/* Date range */}
      {dateRange && (
        <div
          className="inline-flex items-center gap-1 text-[11px]"
          style={{ color: "var(--color-bt-text-dim)" }}
        >
          <Clock size={10} />
          {dateRange}
        </div>
      )}

      {/* Listing link — anchored to the tile's bottom row */}
      {url && (
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-auto inline-flex items-center gap-0.5 self-start pt-1 no-underline"
          style={{ color: "var(--color-bt-accent)" }}
        >
          <ExternalLink size={10} />
          <span className="text-[11px] font-medium">→ {platform.label}</span>
        </a>
      )}
    </div>
  );
}

// ── PropertyExample ───────────────────────────────────────────────────────
// Tile-style sample rendered inside <SampleCard /> on the empty-state
// Lodging page. Spec mandates a tile (not a row) so the example reads
// like a populated property card with photo + meta + amenity pills,
// not like a stripped-down list item.
//
// Layout matches `GhostCard` from explorations-empty.jsx:
//   - 80px gradient image strip with the ✓ CONFIRMED pill at bottom-right
//   - Name (12px / 600)
//   - Monospace meta line "$2,400 · sleeps 6 · 3.2mi"
//   - Three amenity pills

function PropertyExample() {
  const pills = ["Hot tub", "5 ★", "Pet OK"];
  return (
    <div
      className="flex flex-col gap-2 rounded-xl p-3"
      style={{
        background: "var(--color-bt-accent-faint)",
        border: "1px solid var(--color-bt-accent-border)",
      }}
    >
      {/* Photo placeholder — gradient strip + centered generic-property
          icon so the preview never looks like a missing photo. Hex
          literals are spec-explicit gradient stops (HANDOFF rule 4
          exception). */}
      <div
        className="relative flex items-end justify-end rounded-lg p-2"
        style={{
          height: 80,
          backgroundImage: "linear-gradient(135deg, #0d2c3a 0%, #0d3a4f 100%)",
        }}
      >
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center" aria-hidden>
          <Hotel size={32} strokeWidth={1.5} style={{ color: "rgba(255,255,255,0.22)" }} />
        </div>
        <span
          className="inline-flex items-center gap-1 rounded-[4px] px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-[0.08em]"
          style={{
            background: "var(--color-bt-accent)",
            color: "var(--color-bt-on-accent)",
          }}
        >
          <Check size={9} strokeWidth={3.5} />
          Confirmed
        </span>
      </div>

      <div className="flex flex-col gap-0.5">
        <div className="text-xs font-semibold" style={{ color: "var(--color-bt-text)" }}>
          Sea Ranch Cottages
        </div>
        <div className="font-mono text-[10px]" style={{ color: "var(--color-bt-text-dim)" }}>
          $2,400 · sleeps 6 · 3.2mi
        </div>
      </div>

      <div className="flex flex-wrap gap-1">
        {pills.map((p) => (
          <span
            key={p}
            className="rounded-full px-1.5 py-0.5 text-[9px]"
            style={{
              background: "var(--color-bt-subtle-border)",
              color: "var(--color-bt-text-dim)",
            }}
          >
            {p}
          </span>
        ))}
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
   * When true, renders as a flat section without the collapsible
   * PlanningRow wrapper. The owner of this mode (LodgingTab) provides
   * the TabHeader + TabFab; this component just renders the optional
   * out-of-range nudge and the property list.
   */
  inline?: boolean;
  /**
   * @deprecated — kept for back-compat. The inline-mode header is no
   * longer rendered here regardless (LodgingTab owns the header now).
   */
  hideHeader?: boolean;
  /**
   * Inline-mode only: controlled "Add property" sheet state. LodgingTab
   * lifts this so both the desktop header pill and mobile FAB can open
   * the same sheet.
   */
  addOpen?: boolean;
  onAddOpenChange?: (open: boolean) => void;
}

export function LodgingPanel({
  tripId,
  canEdit,
  isOpen,
  onToggle,
  inline = false,
  hideHeader: _hideHeader = false,
  addOpen,
  onAddOpenChange,
}: LodgingPanelProps) {
  const utils = trpc.useUtils();

  const { data: items = [] } = trpc.logistics.list.useQuery({ tripId });
  // Trip query is already cached from the parent page — pulling it
  // here is a free read used to validate lodging dates against the
  // trip date range.
  const { data: trip } = trpc.trips.getById.useQuery({ tripId });

  // Local fallback for the legacy (non-inline) branch — inline mode is
  // controlled by the parent via addOpen/onAddOpenChange.
  const [localShowAddLodging, setLocalShowAddLodging] = useState(false);
  const showAddLodging = inline && addOpen !== undefined ? addOpen : localShowAddLodging;
  const setShowAddLodging = (open: boolean) => {
    if (inline && onAddOpenChange) onAddOpenChange(open);
    else setLocalShowAddLodging(open);
  };
  const [editingItem, setEditingItem] = useState<LodgingItemFull | null>(null);
  // Composer rail URL — typed into the empty-state rail composer so
  // clicking "Add property" pre-fills the AddPropertySheet's URL field
  // instead of opening it blank. Cleared on close.
  const [composerUrl, setComposerUrl] = useState("");

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
      checkInTimeOfDay: values.checkInTimeOfDay || undefined,
      checkOutTimeOfDay: values.checkOutTimeOfDay || undefined,
      transportType: platform,
      imageUrl: values.imageUrl || undefined,
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
      checkInTimeOfDay: values.checkInTimeOfDay || null,
      checkOutTimeOfDay: values.checkOutTimeOfDay || null,
      transportType: platform,
      imageUrl: values.imageUrl || null,
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
        {/* Unconfirmed-properties nudge — only fires when nothing has
            been confirmed yet (Task 70). Once at least one property is
            locked in, the rest can sit unconfirmed as "considered but
            not booked" without nagging. Also suppressed when the
            warning nudge above is showing so two cards don't stack on
            the same tab. Pairs with lodgingUnconfirmed in page.tsx,
            which uses the same `confirmedCount === 0` test for the
            info dot. */}
        {canEdit &&
          outOfRangeCount === 0 &&
          confirmedCount === 0 &&
          totalCount > 0 && (
            <div
              className="mb-4 flex items-center gap-3 rounded-xl px-4 py-3"
              style={{
                background: "var(--color-bt-card)",
                border: "1px solid var(--color-bt-border)",
              }}
            >
              <span
                className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg"
                style={{
                  background: "var(--color-bt-accent-faint)",
                  color: "var(--color-bt-accent)",
                }}
              >
                <Hotel size={14} />
              </span>
              <div>
                <p
                  className="text-[13px] font-semibold leading-tight"
                  style={{ color: "var(--color-bt-text)" }}
                >
                  {totalCount}{" "}
                  {totalCount === 1 ? "property is" : "properties are"} still
                  being considered
                </p>
                <p
                  className="mt-0.5 text-[11px] leading-snug"
                  style={{ color: "var(--color-bt-text-dim)" }}
                >
                  Tap Confirm on any once they&apos;re booked so the crew sees the
                  official lodging.
                </p>
              </div>
            </div>
          )}

        {/* Inline header + blurb + add affordance live in the parent
            LodgingTab via TabHeader + TabFab — this branch just renders
            the property list and an empty state. */}
        <section>
          {lodgingItems.length === 0 ? (
            canEdit ? (
              <div
                className={[
                  // Mirrors the Crew tab's responsive pattern (Task 65):
                  //   <640   single column — composer aside hides, FAB
                  //          (wrapped sm:hidden in LodgingTab) takes over
                  //   640-899 two equal columns — sample-block | composer
                  //          side-by-side so they fill the stacked space
                  //          instead of expanding full-width vertically
                  //   ≥900   1fr / 320px — sample in main slot, composer
                  //          tucked into the narrow right rail
                  // Both breakpoints use arbitrary `min-[...]:` variants
                  // so Tailwind v4 sorts them numerically (Task 45's
                  // cascade fix — `sm:` interleaved with `min-[900px]:`
                  // ends up wrong-ordered in the generated stylesheet).
                  "grid gap-5",
                  "min-[640px]:grid-cols-2",
                  "min-[900px]:grid-cols-[minmax(0,1fr)_minmax(280px,320px)]",
                ].join(" ")}
              >
                {/* Main column — SampleHeader + a 2-col grid pairing the
                    tile example with helper copy. The grid collapses to
                    single-column at < sm so the tile + helper read top to
                    bottom on phones. Whole column capped at 540px so the
                    example doesn't stretch awkwardly on very wide
                    desktops. */}
                <div className="flex flex-col gap-3" style={{ maxWidth: 540 }}>
                  <SampleHeader label="How a property will look" />
                  <div className="grid gap-3 sm:grid-cols-2">
                    <SampleCard>
                      <PropertyExample />
                    </SampleCard>
                    <div
                      className="hidden flex-col justify-center gap-2 sm:flex"
                      style={{
                        fontSize: 12,
                        lineHeight: 1.5,
                        color: "var(--color-bt-text-dim)",
                      }}
                    >
                      <p className="m-0">
                        Drop a VRBO / Airbnb / hotels.com link and we&apos;ll
                        pull the photo, price, and sleeps count.
                      </p>
                      <p className="m-0">
                        The crew can compare across multiple properties. Confirm
                        the one(s) you book to lock them in as official trip
                        details.
                      </p>
                    </div>
                  </div>
                </div>

                {/* Composer aside — visible at sm+ (≥640). Below that
                    the LodgingTab's sm:hidden-wrapped TabFab is the
                    sole add affordance, matching Crew. The outer grid
                    handles the rest: at 640-899 the aside occupies the
                    right half of a 2-col grid; at ≥900 it slots into
                    the narrow `minmax(280px, 320px)` rail track. */}
                <aside
                  className="hidden min-[640px]:block"
                  style={{ maxWidth: 540 }}
                >
                  <RailComposer
                    title="Add your first property"
                    primary="Add property"
                    onPrimary={() => setShowAddLodging(true)}
                    boosted
                    hint={
                      <>
                        Paste a link from VRBO, Airbnb, or hotels.com — we&apos;ll
                        pull the photo, price, and sleeps count. Or{" "}
                        <button
                          type="button"
                          onClick={() => setShowAddLodging(true)}
                          className="underline transition-opacity hover:opacity-80"
                          style={{
                            color: "var(--color-bt-accent)",
                            background: "none",
                            border: "none",
                            padding: 0,
                            font: "inherit",
                            cursor: "pointer",
                          }}
                        >
                          enter manually
                        </button>
                        .
                      </>
                    }
                  >
                    {/* URL input — typed value pre-fills the AddPropertySheet's
                        URL field when the user clicks "Add property", so the
                        rail isn't just a button asking for action with no
                        inline affordance. */}
                    <div className="relative">
                      <Link2
                        size={13}
                        className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2"
                        style={{ color: "var(--color-bt-text-dim)" }}
                      />
                      <input
                        type="url"
                        value={composerUrl}
                        onChange={(e) => setComposerUrl(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") setShowAddLodging(true);
                        }}
                        placeholder="https://airbnb.com/rooms/…"
                        className="w-full rounded-lg border py-2 pl-8 pr-2 font-mono text-[13px] outline-none"
                        style={{
                          background: "var(--color-bt-card-raised)",
                          borderColor: "var(--color-bt-border)",
                          color: "var(--color-bt-text-dim)",
                        }}
                      />
                    </div>
                  </RailComposer>
                </aside>
              </div>
            ) : (
              <EmptyState
                icon={<Hotel className="h-10 w-10" />}
                headline="No properties yet"
                subtext="The organizer hasn't added any properties yet."
              />
            )
          ) : (
            // Tile grid (Task 67) — properties stack horizontally as
            // feature-rich cards instead of full-width rows, matching
            // the PropertyExample preview. Breakpoints:
            //   <500px (phone)  : single column
            //   500-799px       : two-column grid
            //   ≥800px          : three-column grid
            // Items shrink to fit; the gradient strip + meta + actions
            // stay readable down to ~220px tile widths.
            <div className="grid gap-3 min-[500px]:grid-cols-2 min-[800px]:grid-cols-3">
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
            onClose={() => {
              setShowAddLodging(false);
              setComposerUrl("");
            }}
            initialValues={composerUrl ? { url: composerUrl } : undefined}
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
              checkInTimeOfDay: editingItem.check_in_time_of_day ?? "",
              checkOutTimeOfDay: editingItem.check_out_time_of_day ?? "",
              imageUrl: editingItem.image_url ?? "",
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
        <div className="flex flex-col gap-3">
          {/* Same tile grid as the inline LodgingTab path (Task 67). */}
          <div className="grid gap-3 min-[500px]:grid-cols-2 min-[800px]:grid-cols-3">
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

          {/* Add property — dashed/add style, full-width below the tile
              grid, canEdit only. Kept at full width so the affordance
              reads as a list-level CTA rather than another card. */}
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
            checkInTimeOfDay: editingItem.check_in_time_of_day ?? "",
            checkOutTimeOfDay: editingItem.check_out_time_of_day ?? "",
            imageUrl: editingItem.image_url ?? "",
          }}
          isPending={updateItem.isPending}
          onSubmit={handleUpdate}
          onClose={() => setEditingItem(null)}
        />
      )}
    </>
  );
}
