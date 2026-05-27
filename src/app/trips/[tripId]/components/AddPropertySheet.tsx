"use client";

import { useState, useRef, useEffect } from "react";
import { Globe, Hotel, Link, MapPin } from "lucide-react";
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
  /** og:image fetched from /api/lodging-meta when the URL is pasted. */
  imageUrl: string;
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
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="mb-1 block text-xs font-medium" style={{ color: "var(--color-bt-text-dim)" }}>
        {label}
        {hint && (
          <span className="ml-1.5 font-normal" style={{ opacity: 0.75 }}>
            ({hint})
          </span>
        )}
      </label>
      {children}
    </div>
  );
}

// ── Link preview card ─────────────────────────────────────────────────────

function LinkPreviewCard({
  url,
  name,
  imageUrl,
  loading,
}: {
  url: string;
  name: string;
  /** og:image fetched from /api/lodging-meta. Renders as the preview
   *  photo strip when present; falls back to the placeholder gradient
   *  while loading or when the host doesn't expose an og:image. */
  imageUrl?: string | null;
  /** True while /api/lodging-meta is in flight for this URL. */
  loading?: boolean;
}) {
  const platform = detectPlatform(url);
  const domain = extractDomain(url);
  const label = PLATFORM_LABEL[platform];

  return (
    <div
      className="overflow-hidden rounded-xl"
      style={{ border: "1px solid var(--color-bt-accent-border)" }}
    >
      {/* Photo strip — real listing image if fetched, placeholder
          gradient + generic-property icon otherwise. Matches the
          LodgingCard photo strip so the preview reads like what the
          saved card will look like (no blank panel). */}
      <div
        className="relative h-32 w-full"
        style={{
          backgroundImage: imageUrl
            ? `url("${imageUrl}")`
            : "linear-gradient(135deg, #0d2c3a 0%, #0d3a4f 100%)",
          backgroundSize: "cover",
          backgroundPosition: "center",
        }}
      >
        {!imageUrl && !loading && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center" aria-hidden>
            <Hotel size={44} strokeWidth={1.5} style={{ color: "rgba(255,255,255,0.22)" }} />
          </div>
        )}
        {loading && !imageUrl && (
          <div
            className="absolute inset-0 flex items-center justify-center text-[11px] font-medium"
            style={{ color: "#e2e8f0" }}
          >
            <span
              className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1"
              style={{ background: "rgba(0,0,0,0.45)" }}
            >
              <span
                className="inline-block h-2 w-2 animate-pulse rounded-full"
                style={{ background: "var(--color-bt-accent)" }}
                aria-hidden
              />
              Fetching listing…
            </span>
          </div>
        )}
      </div>

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
            {loading
              ? "Pulling the title from the listing…"
              : "Add a nickname in the fields below"}
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
  const [imageUrl, setImageUrl] = useState(initialValues.imageUrl ?? "");

  // Manual mode — expand the form without requiring a valid URL
  const [manualMode, setManualMode] = useState(isEditing && !(initialValues.url ?? ""));

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
          if (data.image && !imageUrl) setImageUrl(data.image);
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
    // We intentionally don't depend on name/notes/imageUrl — those
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
      imageUrl,
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
          className="flex-shrink-0 px-5 pb-3 pt-4"
          style={{ borderBottom: "1px solid var(--color-bt-subtle-border)" }}
        >
          <h2 className="text-lg font-semibold" style={{ color: "var(--color-bt-text)" }}>
            {isEditing ? "Edit property" : "Add a property"}
          </h2>
        </div>

        {/* Body — scrollable */}
        <div className="flex-1 overflow-y-auto px-5 py-4">
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
            <LinkPreviewCard url={url} name={name} imageUrl={imageUrl} loading={metaLoading} />
          </div>
        )}

        {/* Name / Nickname — shown as soon as the form expands, above Optional divider */}
        {showExpanded && (
          <div className="mt-3">
            <Field label={manualMode && !isEditing ? "Title *" : "Title"}>
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
                      className={`${inputCls} pl-7 text-right font-mono`}
                      style={inputStyle}
                    />
                  </div>
                </Field>
              </div>

              {/* Notes */}
              <Field label="Notes" hint="optional">
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

        </div>

        {/* Footer — sticky bottom. Cancel + Save side-by-side, matching
            the MemberEditor pattern so every drawer's commit point
            lives in the same spot. */}
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
