"use client";

import { useState, useRef, useEffect, useMemo } from "react";
import { Hotel, Link, MapPin, ImagePlus, X } from "lucide-react";
import { ConfirmDeleteButton } from "@/components/ConfirmDeleteButton";
import { useModalBackButton } from "@/hooks/useModalBackButton";
import { createClient } from "@/lib/supabase";
import { DatePicker } from "@/components/DatePicker";
import { DOMAIN_COLORS } from "@/lib/domainColors";
import { parseLocalDate, toISODate } from "@/lib/dates";

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
  /** Up to 3 photo URLs (public Storage URLs and/or an og:image). The
   *  first entry is the cover the LodgingCard renders. */
  imageUrls: string[];
}

const MAX_PHOTOS = 3;

// ── Props ─────────────────────────────────────────────────────────────────

export interface AddPropertySheetProps {
  isEditing?: boolean;
  initialValues?: Partial<PropertyFormValues>;
  /** Show address + check-in/out fields (planning stage) */
  showAddressAndDates?: boolean;
  isPending: boolean;
  onSubmit: (values: PropertyFormValues) => void;
  onClose: () => void;
  /** When editing, wires the footer "Remove property" danger button. */
  onRemove?: () => void;
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
  background: "var(--color-bt-card)",
  borderColor: "var(--color-bt-border)",
  color: "var(--color-bt-text)",
};

function Field({
  label,
  hint,
  required,
  children,
}: {
  label: string;
  hint?: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="mb-1.5 block text-[11px] font-bold uppercase tracking-[0.08em]" style={{ color: "var(--color-bt-text-dim)" }}>
        {label}
        {required && (
          <span
            className="ml-1.5 inline-block h-1.5 w-1.5 rounded-full align-middle"
            style={{ background: "var(--color-bt-danger)" }}
            aria-hidden
          />
        )}
        {hint && (
          <span className="ml-1.5 font-medium normal-case tracking-normal" style={{ opacity: 0.75 }}>
            ({hint})
          </span>
        )}
      </label>
      {children}
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
  onRemove,
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
  const [imageUrls, setImageUrls] = useState<string[]>(initialValues.imageUrls ?? []);

  // ── Photo upload (3 square slots) ──────────────────────────────────
  // Uploads the chosen image(s) to the public `lodging-photos` storage
  // bucket and appends their public URLs to imageUrls (capped at
  // MAX_PHOTOS). The first entry is the cover the LodgingCard renders.
  // A user-uploaded photo always wins over the og:image scraped from
  // the listing.
  const supabase = useMemo(() => createClient(), []);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploadingCount, setUploadingCount] = useState(0);
  const [uploadError, setUploadError] = useState("");

  const uploadOne = async (file: File): Promise<string | null> => {
    if (!file.type.startsWith("image/")) {
      setUploadError("Please choose an image file.");
      return null;
    }
    if (file.size > 8 * 1024 * 1024) {
      setUploadError("Image must be under 8 MB.");
      return null;
    }
    const ext = (file.name.split(".").pop() || "jpg").toLowerCase();
    const path = `${crypto.randomUUID()}.${ext}`;
    const { error } = await supabase.storage
      .from("lodging-photos")
      .upload(path, file, { cacheControl: "3600", upsert: false, contentType: file.type });
    if (error) throw error;
    const { data } = supabase.storage.from("lodging-photos").getPublicUrl(path);
    return data.publicUrl;
  };

  const handlePhotoSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    e.target.value = ""; // allow re-selecting the same file later
    if (files.length === 0) return;

    // Only take as many as remaining slots allow.
    const remaining = MAX_PHOTOS - imageUrls.length;
    if (remaining <= 0) return;
    const toUpload = files.slice(0, remaining);

    setUploadError("");
    setUploadingCount(toUpload.length);
    try {
      const urls: string[] = [];
      for (const file of toUpload) {
        const u = await uploadOne(file);
        if (u) urls.push(u);
      }
      if (urls.length > 0) {
        setImageUrls((prev) => [...prev, ...urls].slice(0, MAX_PHOTOS));
        // Stop the listing-meta effect from re-filling the cover photo.
        setMetaFetchedFor(url.trim());
      }
    } catch {
      setUploadError("Upload failed. Try again.");
    } finally {
      setUploadingCount(0);
    }
  };

  const removePhoto = (idx: number) => {
    setImageUrls((prev) => prev.filter((_, i) => i !== idx));
  };

  // ── Listing-metadata fetch (Task 68) ──────────────────────────────
  //
  // When the URL turns into a valid http(s) URL, fire /api/lodging-meta
  // to pull og:title / og:image / og:description from the listing.
  // Pre-fills `name` (empty fields only — never overwrite something the
  // user typed) and `imageUrl` so the LodgingCard renders the real
  // photo instead of the placeholder gradient.
  //
  // Debounced (500ms) so each keystroke doesn't kick off a fetch. The
  // fetch itself bails fast on a non-success response — surfacing
  // failures inline would be more noise than signal, the user can
  // always type the fields by hand.
  const [metaLoading, setMetaLoading] = useState(false);
  const [metaFetchedFor, setMetaFetchedFor] = useState<string | null>(null);
  const metaTimer = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => {
    const trimmed = url.trim();
    if (metaTimer.current) clearTimeout(metaTimer.current);
    if (!isValidUrl(trimmed) || trimmed === metaFetchedFor) return;

    metaTimer.current = setTimeout(async () => {
      setMetaLoading(true);
      try {
        const res = await fetch("/api/lodging-meta", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ url: trimmed }),
        });
        const data: {
          ok: boolean;
          title?: string | null;
          description?: string | null;
          image?: string | null;
        } = await res.json();
        if (data.ok) {
          // Only fill empty fields — preserve anything the user typed.
          if (data.title && !name.trim()) setName(data.title);
          if (data.description && !notes.trim()) {
            // Trim to ~240 chars; full og:description is often a long
            // marketing blurb the user wouldn't paste themselves.
            const trimmedDesc =
              data.description.length > 240
                ? data.description.slice(0, 237).trimEnd() + "…"
                : data.description;
            setNotes(trimmedDesc);
          }
          if (data.image && imageUrls.length === 0) setImageUrls([data.image]);
        }
        setMetaFetchedFor(trimmed);
      } catch {
        // Best-effort — silent failure, user fills the form manually.
      } finally {
        setMetaLoading(false);
      }
    }, 500);

    return () => {
      if (metaTimer.current) clearTimeout(metaTimer.current);
    };
    // We intentionally don't depend on name/notes/imageUrls — those
    // can be set by this very effect, which would re-trigger. The
    // metaFetchedFor guard handles "URL hasn't changed, skip."
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url, metaFetchedFor]);

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

  // Derived — a property needs at minimum a title or a valid link.
  const validUrl = isValidUrl(url);
  const hasContent = name.trim().length > 0 || validUrl;

  // When editing, Save stays disabled until something actually changes —
  // opening the drawer shouldn't present an active Save. Compared against
  // the same defaults the state was seeded with.
  const isDirty =
    url !== (initialValues.url ?? "") ||
    name !== (initialValues.name ?? "") ||
    sleeps !== (initialValues.sleeps ?? "") ||
    price !== (initialValues.price ?? "") ||
    notes !== (initialValues.notes ?? "") ||
    address !== (initialValues.address ?? "") ||
    checkIn !== (initialValues.checkIn ?? "") ||
    checkOut !== (initialValues.checkOut ?? "") ||
    checkInTimeOfDay !== (initialValues.checkInTimeOfDay ?? "") ||
    checkOutTimeOfDay !== (initialValues.checkOutTimeOfDay ?? "") ||
    JSON.stringify(imageUrls) !== JSON.stringify(initialValues.imageUrls ?? []);

  const canSubmit = hasContent && (!isEditing || isDirty);

  const handleUrlBlur = () => {
    const prefixed = ensureProtocol(url);
    if (prefixed !== url) setUrl(prefixed);
  };

  const handleSubmit = () => {
    if (!canSubmit) return;
    onSubmit({
      url,
      name,
      sleeps,
      price,
      notes,
      address,
      checkIn,
      checkOut,
      checkInTimeOfDay,
      checkOutTimeOfDay,
      imageUrls,
    });
  };

  return (
    <>
      {/* Backdrops — separate elements so each can carry the right
          overlay token for its breakpoint (sheet alpha on mobile,
          drawer alpha on desktop), matching the MemberEditor pattern. */}
      <div
        className="fixed inset-0 z-40 sm:hidden"
        style={{ background: "var(--color-bt-overlay-sheet)" }}
        onClick={onClose}
        aria-hidden
      />
      <div
        className="fixed inset-0 z-40 hidden sm:block"
        style={{ background: "var(--color-bt-overlay-drawer)" }}
        onClick={onClose}
        aria-hidden
      />

      {/* Panel — bottom-sheet (mobile) / right-anchored 440px drawer
          (tablet + desktop, sm+ / ≥640px) per the canonical edit-drawer
          spec. Threshold lowered from lg (1024) to sm (640) per Task 51
          so a ~20px viewport change doesn't reorient the whole panel. */}
      <div
        role="dialog"
        aria-modal="true"
        className={[
          "fixed z-50 flex flex-col",
          // Mobile: bottom sheet
          "inset-x-0 bottom-0 max-h-[90vh] rounded-t-2xl",
          // Desktop: 440px right drawer
          "sm:inset-x-auto sm:bottom-auto sm:right-0 sm:top-0 sm:h-screen sm:max-h-screen sm:w-[440px] sm:rounded-none",
        ].join(" ")}
        style={{
          background: "var(--color-bt-card-float)",
          boxShadow: "var(--shadow-floating)",
          borderLeft: "1px solid var(--color-bt-border)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Handle bar (mobile) */}
        <div
          className="mx-auto mt-2 h-1 w-10 flex-shrink-0 rounded-full sm:hidden"
          style={{ background: "var(--color-bt-border)" }}
        />

        {/* Header — sticky top */}
        <div
          className="flex flex-shrink-0 items-center justify-between gap-3 px-5 pb-3 pt-4"
          style={{ borderBottom: "1px solid var(--color-bt-subtle-border)" }}
        >
          {isEditing ? (
            <div className="min-w-0">
              <div
                className="text-[10px] font-bold uppercase tracking-[0.12em]"
                style={{ color: "var(--color-bt-text-dim)" }}
              >
                Lodging
              </div>
              <div
                className="mt-0.5 truncate text-[15px] font-bold"
                style={{ color: "var(--color-bt-text)" }}
              >
                {name || "Untitled property"}
              </div>
            </div>
          ) : (
            <h2 className="text-lg font-semibold" style={{ color: "var(--color-bt-text)" }}>
              Add a property
            </h2>
          )}
          <button
            onClick={onClose}
            aria-label="Close"
            className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full transition-opacity hover:opacity-80"
            style={{ background: "var(--color-bt-card-raised)", color: "var(--color-bt-text-dim)" }}
          >
            <X size={16} />
          </button>
        </div>

        {/* Body — scrollable. Field order: photo, title, link, location,
            sleeps+cost, check-in/out, notes — then Remove (when editing). */}
        <div className="flex-1 space-y-4 overflow-y-auto px-5 py-4">
          {/* Photos — up to 3 square slots. Filled slots show the image
              with a remove control; the first empty slot is the add
              button (the others render as quiet placeholders so an empty
              row reads as "optional" rather than broken). The cover the
              LodgingCard renders is always the first photo. */}
          <Field label="Photos" hint="optional">
            <div className="grid grid-cols-3 gap-2">
              {Array.from({ length: MAX_PHOTOS }).map((_, i) => {
                const src = imageUrls[i];
                const isFirstEmpty = !src && i === imageUrls.length;
                const isUploadingSlot =
                  !src && uploadingCount > 0 && i >= imageUrls.length && i < imageUrls.length + uploadingCount;

                // Filled slot — image with remove + cover badge.
                if (src) {
                  return (
                    <div
                      key={i}
                      className="group relative aspect-square overflow-hidden rounded-xl"
                      style={{
                        backgroundImage: `url("${src}")`,
                        backgroundSize: "cover",
                        backgroundPosition: "center",
                        border: "1px solid var(--color-bt-border)",
                      }}
                    >
                      {i === 0 && (
                        <span
                          className="absolute left-1.5 top-1.5 rounded-full px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-[0.06em]"
                          style={{ background: "rgba(0,0,0,0.55)", color: "#e2e8f0" }}
                        >
                          Cover
                        </span>
                      )}
                      <button
                        type="button"
                        onClick={() => removePhoto(i)}
                        aria-label="Remove photo"
                        className="absolute right-1.5 top-1.5 flex h-6 w-6 items-center justify-center rounded-full text-xs font-bold transition-opacity hover:opacity-90"
                        style={{ background: "rgba(0,0,0,0.6)", color: "#fff" }}
                      >
                        ✕
                      </button>
                    </div>
                  );
                }

                // Uploading placeholder.
                if (isUploadingSlot) {
                  return (
                    <div
                      key={i}
                      className="flex aspect-square items-center justify-center rounded-xl"
                      style={{ background: "var(--color-bt-card)", border: "1px solid var(--color-bt-border)" }}
                    >
                      <span
                        className="inline-block h-3 w-3 animate-pulse rounded-full"
                        style={{ background: "var(--color-bt-accent)" }}
                        aria-hidden
                      />
                    </div>
                  );
                }

                // First empty slot = the add button; the rest are quiet
                // placeholders so the empty state still looks intentional.
                return (
                  <button
                    key={i}
                    type="button"
                    onClick={isFirstEmpty ? () => fileInputRef.current?.click() : undefined}
                    disabled={!isFirstEmpty}
                    aria-label={isFirstEmpty ? "Add photo" : undefined}
                    className="flex aspect-square items-center justify-center rounded-xl transition-colors disabled:cursor-default"
                    style={{
                      background: "var(--color-bt-card)",
                      border: isFirstEmpty
                        ? "1.5px dashed var(--color-bt-border)"
                        : "1px dashed var(--color-bt-subtle-border)",
                      color: "var(--color-bt-text-dim)",
                      opacity: isFirstEmpty ? 1 : 0.5,
                    }}
                  >
                    {isFirstEmpty ? (
                      <ImagePlus size={20} strokeWidth={1.75} />
                    ) : (
                      <Hotel size={18} strokeWidth={1.5} style={{ opacity: 0.6 }} />
                    )}
                  </button>
                );
              })}
            </div>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              multiple
              className="hidden"
              onChange={handlePhotoSelected}
            />
            {metaLoading && imageUrls.length === 0 && (
              <p className="mt-1.5 text-[11px]" style={{ color: "var(--color-bt-text-dim)" }}>
                Fetching listing photo…
              </p>
            )}
            {uploadError && (
              <p className="mt-1.5 text-[11px]" style={{ color: "var(--color-bt-danger)" }}>
                {uploadError}
              </p>
            )}
          </Field>

          {/* Title */}
          <Field label="Title" required>
            <input
              type="text"
              placeholder="e.g. Beach House, The Lodge"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className={inputCls}
              style={{
                ...inputStyle,
                borderColor: name.trim() ? "var(--color-bt-accent-border)" : "var(--color-bt-border)",
              }}
            />
          </Field>

          {/* Link */}
          <Field label="Link" hint="opens externally">
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
                className={`${inputCls} pl-9`}
                style={{
                  ...inputStyle,
                  borderColor: validUrl ? "var(--color-bt-accent-border)" : "var(--color-bt-border)",
                }}
              />
            </div>
          </Field>

          {/* Location — planning only */}
          {showAddressAndDates && (
            <Field label="Location" hint="optional">
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
          )}

          {/* Sleeps + Cost */}
          <div className="grid grid-cols-2 gap-2">
            <Field label="Sleeps">
              <input
                type="number"
                placeholder="e.g. 8"
                min={1}
                max={99}
                value={sleeps}
                onChange={(e) => setSleeps(e.target.value)}
                className={`${inputCls} font-mono tabular-nums`}
                style={inputStyle}
              />
            </Field>
            <Field label="Cost">
              <div className="relative">
                <span
                  className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 font-mono text-sm"
                  style={{ color: "var(--color-bt-text-dim)" }}
                >
                  $
                </span>
                <input
                  type="text"
                  inputMode="decimal"
                  placeholder="2,400"
                  value={price}
                  onChange={(e) => setPrice(e.target.value)}
                  className={`${inputCls} pl-7 text-right font-mono tabular-nums`}
                  style={inputStyle}
                />
              </div>
            </Field>
          </div>

          {/* Check-in / Check-out — planning only */}
          {showAddressAndDates && (
            <div className="space-y-2">
              <DatePicker
                mode="range"
                label="Check-in → check-out"
                icon={<Hotel size={15} />}
                accent={DOMAIN_COLORS.lodging.color}
                accentFaint={DOMAIN_COLORS.lodging.faint}
                value={{
                  start: checkIn ? parseLocalDate(checkIn) : null,
                  end: checkOut ? parseLocalDate(checkOut) : null,
                }}
                onChange={(r) => {
                  setCheckIn(r.start ? toISODate(r.start) : "");
                  setCheckOut(r.end ? toISODate(r.end) : "");
                }}
              />
              <div className="grid grid-cols-2 gap-2">
              <Field label="Check-in time">
                <input
                  type="time"
                  value={checkInTimeOfDay}
                  onChange={(e) => setCheckInTimeOfDay(e.target.value)}
                  onClick={(e) => e.currentTarget.showPicker?.()}
                  className={`${inputCls} font-mono tabular-nums`}
                  style={inputStyle}
                />
              </Field>
              <Field label="Check-out time">
                <input
                  type="time"
                  value={checkOutTimeOfDay}
                  onChange={(e) => setCheckOutTimeOfDay(e.target.value)}
                  onClick={(e) => e.currentTarget.showPicker?.()}
                  className={`${inputCls} font-mono tabular-nums`}
                  style={inputStyle}
                />
              </Field>
              </div>
            </div>
          )}

          {/* Notes */}
          <Field label="Notes" hint="optional">
            <textarea
              placeholder="e.g. great pool, tons of space, perfect grilling deck"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
              className="w-full resize-none rounded-xl border px-3 py-2.5 text-sm outline-none"
              style={inputStyle}
            />
          </Field>

          {/* Remove property — at the end of the body, matching the
              Receipt/Agenda edit modals (danger action above the footer). */}
          {isEditing && onRemove && (
            <div className="pt-1">
              <ConfirmDeleteButton
                label="Remove property"
                confirmLabel="Remove"
                prompt="Remove this property?"
                pending={isPending}
                testId="remove-property-btn"
                onConfirm={onRemove}
              />
            </div>
          )}
        </div>

        {/* Footer — sticky bottom */}
        <div
          className="flex flex-shrink-0 gap-2 px-5 py-3"
          style={{ borderTop: "1px solid var(--color-bt-subtle-border)" }}
        >
          <button
            onClick={onClose}
            className="rounded-lg border px-4 py-2 text-sm font-medium"
            style={{
              borderColor: "var(--color-bt-border)",
              color: "var(--color-bt-text-dim)",
              background: "transparent",
            }}
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={isPending || !canSubmit}
            className="flex-1 rounded-lg py-2 text-sm font-semibold transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
            style={{
              background: "var(--color-bt-accent)",
              color: "var(--color-bt-on-accent)",
            }}
          >
            {isPending
              ? isEditing ? "Saving..." : "Adding..."
              : isEditing ? "Save changes" : "Add property"}
          </button>
        </div>
      </div>
    </>
  );
}
