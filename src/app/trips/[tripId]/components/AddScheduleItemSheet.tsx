"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Plus, X, Search, MapPin } from "lucide-react";
import { useModalBackButton } from "@/hooks/useModalBackButton";
import { ConfirmDeleteButton } from "@/components/ConfirmDeleteButton";
import { trpc } from "@/lib/trpc-client";

const GOLF_TYPES = ["golf_course"];

// ── Types ────────────────────────────────────────────────────────────────

interface ScheduleItemData {
  id: string;
  item_type: "general" | "golf";
  title: string;
  detail?: string | null;
  scheduled_date?: string | null;
  scheduled_time?: string | null;
  is_confirmed: boolean;
  course_id?: string | null;
  course_name?: string | null;
  course_location?: string | null;
  tee_times?: string[] | null;
  course?: {
    id: string;
    place_id?: string | null;
    name: string;
    address?: string | null;
    lat?: number | null;
    lng?: number | null;
  } | null;
}

interface PlacePrediction {
  placeId: string;
  name: string;
  description: string;
  fullText: string;
}

interface AddScheduleItemSheetProps {
  tripId: string;
  itemType: "general" | "golf";
  editItem?: ScheduleItemData | null;
  onClose: () => void;
  /** When editing, wires the footer "Remove from agenda" danger button. */
  onRemove?: () => void;
  /** Whether the remove mutation is in flight (disables the button). */
  removing?: boolean;
}

// ── Places Autocomplete Hook ─────────────────────────────────────────────

function usePlacesSearch(types?: string[]) {
  const [query, setQuery] = useState("");
  const [predictions, setPredictions] = useState<PlacePrediction[]>([]);
  const [loading, setLoading] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();

  const search = useCallback((q: string) => {
    setQuery(q);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (q.length < 2) {
      setPredictions([]);
      return;
    }
    setLoading(true);
    debounceRef.current = setTimeout(async () => {
      try {
        const res = await fetch("/api/places", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ query: q, types }),
        });
        const data = await res.json();
        setPredictions(data.predictions ?? []);
      } catch {
        setPredictions([]);
      } finally {
        setLoading(false);
      }
    }, 300);
  }, [types]);

  const clear = useCallback(() => {
    setQuery("");
    setPredictions([]);
  }, []);

  return { query, predictions, loading, search, clear };
}

// ── Component ────────────────────────────────────────────────────────────

export function AddScheduleItemSheet({
  tripId,
  itemType,
  editItem,
  onClose,
  onRemove,
  removing,
}: AddScheduleItemSheetProps) {
  useModalBackButton(onClose);
  const utils = trpc.useUtils();
  const isEditing = !!editItem;
  // In add mode the user can switch between Activity and Golf Round via a
  // segmented control inside the sheet. In edit mode the type is locked.
  const [activeType, setActiveType] = useState<"general" | "golf">(itemType);
  const isGolf = activeType === "golf";

  // General fields
  const [title, setTitle] = useState(editItem?.title ?? "");
  const [detail, setDetail] = useState(editItem?.detail ?? "");
  const [scheduledDate, setScheduledDate] = useState(editItem?.scheduled_date ?? "");
  const [scheduledTime, setScheduledTime] = useState(editItem?.scheduled_time ?? "");

  // Trip date bounds — used to clamp the date input so users can't
  // assign an item outside the trip range. Free read because the
  // parent page already prefetches this.
  const { data: trip } = trpc.trips.getById.useQuery({ tripId });
  const tripStart = trip?.start_date ?? undefined;
  const tripEnd = trip?.end_date ?? undefined;

  // Golf fields
  const [selectedCourse, setSelectedCourse] = useState<{
    id?: string;
    placeId: string;
    name: string;
    address: string;
    lat?: number | null;
    lng?: number | null;
  } | null>(
    editItem?.course
      ? {
          id: editItem.course.id,
          placeId: editItem.course.place_id ?? "",
          name: editItem.course.name,
          address: editItem.course.address ?? "",
          lat: editItem.course.lat,
          lng: editItem.course.lng,
        }
      : editItem?.course_name
      ? {
          placeId: "",
          name: editItem.course_name,
          address: editItem.course_location ?? "",
        }
      : null
  );
  // tee_times === [] (non-null empty array) means "walk on" — confirmed without
  // a specific time. tee_times === null means no tee time intent at all.
  const [isWalkOn, setIsWalkOn] = useState<boolean>(
    !!editItem &&
    editItem.item_type === "golf" &&
    Array.isArray(editItem.tee_times) &&
    editItem.tee_times.length === 0
  );
  const [teeTimes, setTeeTimes] = useState<string[]>(
    editItem?.tee_times?.length ? editItem.tee_times : [""]
  );
  const [showSearch, setShowSearch] = useState(!selectedCourse && isGolf);
  // Manual entry fallback — shown when the Places search doesn't find the course.
  const [manualMode, setManualMode] = useState(false);
  const [manualName, setManualName] = useState("");
  const [manualAddress, setManualAddress] = useState("");

  const placesSearch = usePlacesSearch(isGolf ? GOLF_TYPES : undefined);

  // General item: optional location
  const [selectedLocation, setSelectedLocation] = useState<{
    placeId: string;
    name: string;
    address: string;
    lat?: number | null;
    lng?: number | null;
  } | null>(
    !isGolf && editItem?.course_name
      ? { placeId: "", name: editItem.course_name, address: editItem.course_location ?? "" }
      : null
  );
  const [showLocationSearch, setShowLocationSearch] = useState(false);
  const locationSearch = usePlacesSearch();

  // Reset type-specific fields when the user switches between Activity and Golf Round.
  // Only runs in add mode — edit mode type is locked.
  useEffect(() => {
    if (isEditing) return;
    setTitle("");
    setDetail("");
    setSelectedCourse(null);
    setShowSearch(activeType === "golf");
    setManualMode(false);
    setManualName("");
    setManualAddress("");
    setTeeTimes([""]);
    setIsWalkOn(false);
    setSelectedLocation(null);
    setShowLocationSearch(false);
    placesSearch.clear();
    locationSearch.clear();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeType]);

  // Mutations
  const create = trpc.schedule.create.useMutation({
    onSuccess: () => {
      utils.schedule.list.invalidate({ tripId });
      onClose();
    },
  });

  const update = trpc.schedule.update.useMutation({
    onSuccess: () => {
      utils.schedule.list.invalidate({ tripId });
      onClose();
    },
  });

  const findOrCreate = trpc.golfCourses.findOrCreate.useMutation();

  const isPending = create.isPending || update.isPending || findOrCreate.isPending;

  // Select a course from autocomplete
  const handleSelectCourse = async (prediction: PlacePrediction) => {
    placesSearch.clear();
    setShowSearch(false);

    // Fetch place details for address/GPS
    try {
      const res = await fetch(`/api/places?placeId=${prediction.placeId}`);
      const details = await res.json();
      setSelectedCourse({
        placeId: prediction.placeId,
        name: details.name || prediction.name,
        address: details.address || prediction.description,
        lat: details.lat,
        lng: details.lng,
      });
    } catch {
      setSelectedCourse({
        placeId: prediction.placeId,
        name: prediction.name,
        address: prediction.description,
      });
    }
  };

  // Select a location for general items
  const handleSelectLocation = async (prediction: PlacePrediction) => {
    locationSearch.clear();
    setShowLocationSearch(false);
    try {
      const res = await fetch(`/api/places?placeId=${prediction.placeId}`);
      const details = await res.json();
      setSelectedLocation({
        placeId: prediction.placeId,
        name: details.name || prediction.name,
        address: details.address || prediction.description,
        lat: details.lat,
        lng: details.lng,
      });
    } catch {
      setSelectedLocation({
        placeId: prediction.placeId,
        name: prediction.name,
        address: prediction.description,
      });
    }
  };

  const handleSubmit = async () => {
    if (isGolf && !selectedCourse) return;
    if (!isGolf && !title.trim()) return;

    const filteredTeeTimes = teeTimes.filter((t) => t.trim());

    if (isGolf && selectedCourse) {
      // Golf confirmation is implicit: walk-on or at least one tee time = confirmed.
      // tee_times: null   → no intent (unconfirmed)
      // tee_times: []     → walk on (confirmed, no specific time)
      // tee_times: [...]  → confirmed with specific times
      const golfTeeTimes = isWalkOn
        ? []
        : filteredTeeTimes.length > 0
        ? filteredTeeTimes
        : null;
      const golfConfirmed = isWalkOn || filteredTeeTimes.length > 0;

      // Find or create the golf course record
      const course = await findOrCreate.mutateAsync({
        placeId: selectedCourse.placeId || `manual-${Date.now()}`,
        name: selectedCourse.name,
        address: selectedCourse.address || undefined,
        lat: selectedCourse.lat ?? undefined,
        lng: selectedCourse.lng ?? undefined,
      });

      if (isEditing) {
        update.mutate({
          tripId,
          itemId: editItem!.id,
          title: selectedCourse.name,
          scheduledDate: scheduledDate || null,
          // Golf: confirmed as soon as tee times or walk-on are set,
          // regardless of whether the round is on a day yet.
          isConfirmed: golfConfirmed,
          courseId: course.id,
          courseName: selectedCourse.name,
          courseLocation: selectedCourse.address || null,
          teeTimes: golfTeeTimes,
        });
      } else {
        create.mutate({
          tripId,
          itemType: "golf",
          title: selectedCourse.name,
          scheduledDate: scheduledDate || undefined,
          isConfirmed: golfConfirmed,
          courseId: course.id,
          courseName: selectedCourse.name,
          courseLocation: selectedCourse.address || undefined,
          teeTimes: golfTeeTimes ?? undefined,
        });
      }
    } else {
      // General item — confirmed automatically when assigned to a day.
      if (isEditing) {
        update.mutate({
          tripId,
          itemId: editItem!.id,
          title: title.trim(),
          detail: detail.trim() || null,
          scheduledDate: scheduledDate || null,
          scheduledTime: scheduledTime || null,
          isConfirmed: !!scheduledDate,
          courseName: selectedLocation?.name || null,
          courseLocation: selectedLocation?.address || null,
        });
      } else {
        create.mutate({
          tripId,
          itemType: "general",
          title: title.trim(),
          detail: detail.trim() || undefined,
          scheduledDate: scheduledDate || undefined,
          scheduledTime: scheduledTime || undefined,
          isConfirmed: !!scheduledDate,
          courseName: selectedLocation?.name || undefined,
          courseLocation: selectedLocation?.address || undefined,
        });
      }
    }
  };

  const addTeeTime = () => setTeeTimes((prev) => [...prev, ""]);
  const removeTeeTime = (idx: number) =>
    setTeeTimes((prev) => prev.filter((_, i) => i !== idx));
  const updateTeeTime = (idx: number, val: string) =>
    setTeeTimes((prev) => prev.map((t, i) => (i === idx ? val : t)));

  const inputStyle = {
    background: "var(--color-bt-card)",
    borderColor: "var(--color-bt-border)",
    color: "var(--color-bt-text)",
  };

  // Dirty check — in edit mode the Save button stays disabled until the user
  // actually changes a field, mirroring the lodging/receipts sheets.
  const isDirty = (() => {
    if (!isEditing) return true;
    if (isGolf) {
      const initialCourseName = editItem?.course?.name ?? editItem?.course_name ?? "";
      const initialCourseAddr =
        editItem?.course?.address ?? editItem?.course_location ?? "";
      const initialWalkOn =
        !!editItem &&
        editItem.item_type === "golf" &&
        Array.isArray(editItem.tee_times) &&
        editItem.tee_times.length === 0;
      const initialTeeTimes = editItem?.tee_times ?? [];
      const currentTeeTimes = isWalkOn ? [] : teeTimes.filter((t) => t.trim());
      return (
        (selectedCourse?.name ?? "") !== initialCourseName ||
        (selectedCourse?.address ?? "") !== initialCourseAddr ||
        scheduledDate !== (editItem?.scheduled_date ?? "") ||
        isWalkOn !== initialWalkOn ||
        JSON.stringify(currentTeeTimes) !== JSON.stringify(initialTeeTimes)
      );
    }
    return (
      title !== (editItem?.title ?? "") ||
      detail !== (editItem?.detail ?? "") ||
      scheduledDate !== (editItem?.scheduled_date ?? "") ||
      scheduledTime !== (editItem?.scheduled_time ?? "") ||
      (selectedLocation?.name ?? "") !== (editItem?.course_name ?? "") ||
      (selectedLocation?.address ?? "") !== (editItem?.course_location ?? "")
    );
  })();

  const canSubmit =
    (isGolf ? !!selectedCourse : !!title.trim()) && isDirty;

  return (
    <>
      {/* Tiered backdrop tokens — sheet (mobile) vs drawer (desktop). */}
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
          (tablet + desktop, sm+ / ≥640px). Sticky header + scrollable
          body + sticky footer per the canonical edit-drawer spec.
          Threshold dropped from lg (1024) to sm (640) per Task 51 —
          bottom sheets are a mobile pattern and shouldn't activate at
          tablet widths where the right drawer fits comfortably. */}
      <div
        role="dialog"
        aria-modal="true"
        className={[
          "fixed z-50 flex flex-col",
          "inset-x-0 bottom-0 max-h-[85vh] rounded-t-2xl",
          "sm:inset-x-auto sm:bottom-auto sm:right-0 sm:top-0 sm:h-screen sm:max-h-screen sm:w-[440px] sm:rounded-none",
        ].join(" ")}
        style={{
          background: "var(--color-bt-card-float)",
          boxShadow: "var(--shadow-floating)",
          borderLeft: "1px solid var(--color-bt-border)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
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
                Agenda
              </div>
              <div
                className="mt-0.5 truncate text-[15px] font-bold"
                style={{ color: "var(--color-bt-text)" }}
              >
                {title || (isGolf ? "Golf round" : "Untitled activity")}
              </div>
            </div>
          ) : (
            <h2
              className="text-base font-semibold"
              style={{ color: "var(--color-bt-text)" }}
            >
              Add to Agenda
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

        {/* Body — scrollable */}
        <div className="flex-1 overflow-y-auto px-5 py-4">

        {/* ── Type selector (add mode only) ────────────────────────────── */}
        {!isEditing && (
          <div
            className="mb-2 inline-flex rounded-xl p-1"
            style={{
              background: "var(--color-bt-card-raised)",
              border: "1px solid var(--color-bt-border)",
            }}
          >
            {(
              [
                { value: "general" as const, label: "Activity" },
                { value: "golf"    as const, label: "Golf Round" },
              ] as const
            ).map(({ value, label }) => {
              const active = activeType === value;
              return (
                <button
                  key={value}
                  type="button"
                  onClick={() => setActiveType(value)}
                  className="rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors"
                  style={
                    active
                      ? {
                          background: "var(--color-bt-card)",
                          color: "var(--color-bt-text)",
                          boxShadow: "var(--shadow-card)",
                        }
                      : {
                          background: "transparent",
                          color: "var(--color-bt-text-dim)",
                        }
                  }
                >
                  {label}
                </button>
              );
            })}
          </div>
        )}

        {/* ── Golf: course search ──────────────────────────────────────── */}
        {isGolf && (
          <>
            {!manualMode && (
              <p className="mb-1.5 text-[11px] font-bold uppercase tracking-[0.08em]" style={{ color: "var(--color-bt-text-dim)" }}>
                Golf Course Location<span className="ml-1.5 inline-block h-1.5 w-1.5 rounded-full align-middle" style={{ background: "var(--color-bt-danger)" }} aria-hidden />
              </p>
            )}
            {selectedCourse && !showSearch ? (
              /* ── Selected course card ── */
              <div
                className="flex items-center gap-3 rounded-xl px-3 py-2.5"
                style={{ background: "var(--color-bt-card-raised)", border: "1px solid var(--color-bt-accent-border)" }}
              >
                <MapPin size={14} style={{ color: "var(--color-bt-accent)" }} />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium" style={{ color: "var(--color-bt-text)" }}>
                    {selectedCourse.name}
                  </p>
                  {selectedCourse.address && (
                    <p className="text-xs" style={{ color: "var(--color-bt-text-dim)" }}>
                      {selectedCourse.address}
                    </p>
                  )}
                </div>
                <button
                  onClick={() => {
                    setSelectedCourse(null);
                    setManualMode(false);
                    setManualName("");
                    setManualAddress("");
                    setShowSearch(true);
                  }}
                  className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full"
                  style={{ color: "var(--color-bt-text-dim)" }}
                >
                  <X size={14} />
                </button>
              </div>
            ) : manualMode ? (
              /* ── Manual entry fallback ── */
              <div className="space-y-2">
                <p className="mb-1.5 text-[11px] font-bold uppercase tracking-[0.08em]" style={{ color: "var(--color-bt-text-dim)" }}>
                  Name<span className="ml-1.5 inline-block h-1.5 w-1.5 rounded-full align-middle" style={{ background: "var(--color-bt-danger)" }} aria-hidden />
                </p>
                <input
                  type="text"
                  placeholder="Course name"
                  value={manualName}
                  onChange={(e) => {
                    const val = e.target.value;
                    setManualName(val);
                    if (val.trim()) {
                      setSelectedCourse({ placeId: "", name: val.trim(), address: manualAddress });
                    } else {
                      setSelectedCourse(null);
                    }
                  }}
                  className="w-full rounded-xl border px-3 py-2.5 text-sm outline-none"
                  style={inputStyle}
                  autoFocus
                />
                <p className="mb-1.5 mt-3 text-[11px] font-bold uppercase tracking-[0.08em]" style={{ color: "var(--color-bt-text-dim)" }}>
                  Location <span className="font-medium normal-case tracking-normal">(optional)</span>
                </p>
                <input
                  type="text"
                  placeholder="Location (optional)"
                  value={manualAddress}
                  onChange={(e) => {
                    const val = e.target.value;
                    setManualAddress(val);
                    if (selectedCourse) {
                      setSelectedCourse({ ...selectedCourse, address: val });
                    }
                  }}
                  className="w-full rounded-xl border px-3 py-2.5 text-sm outline-none"
                  style={inputStyle}
                />
                <button
                  type="button"
                  onClick={() => {
                    setManualMode(false);
                    setManualName("");
                    setManualAddress("");
                    setSelectedCourse(null);
                    setShowSearch(true);
                    placesSearch.clear();
                  }}
                  className="text-xs transition-opacity hover:opacity-70"
                  style={{ color: "var(--color-bt-accent)" }}
                >
                  ← Back to search
                </button>
              </div>
            ) : (
              /* ── Places autocomplete search ── */
              <div className="relative">
                <div className="relative">
                  <Search
                    size={14}
                    className="absolute left-3 top-1/2 -translate-y-1/2"
                    style={{ color: "var(--color-bt-text-dim)" }}
                  />
                  <input
                    type="text"
                    placeholder="Search golf courses..."
                    value={placesSearch.query}
                    onChange={(e) => placesSearch.search(e.target.value)}
                    className="w-full rounded-xl border py-2.5 pl-9 pr-3 text-sm outline-none"
                    style={inputStyle}
                    autoFocus
                  />
                </div>

                {/* Autocomplete dropdown */}
                {placesSearch.predictions.length > 0 && (
                  <div
                    className="absolute left-0 right-0 top-full z-10 mt-1 overflow-hidden rounded-xl shadow-lg"
                    style={{ background: "var(--color-bt-card)", border: "1px solid var(--color-bt-border)" }}
                  >
                    {placesSearch.predictions.map((p) => (
                      <button
                        key={p.placeId}
                        onClick={() => handleSelectCourse(p)}
                        className="flex w-full items-start gap-2 px-3 py-2.5 text-left transition-colors hover:bg-[var(--color-bt-hover)]"
                      >
                        <MapPin size={13} className="mt-0.5 flex-shrink-0" style={{ color: "var(--color-bt-accent)" }} />
                        <div className="min-w-0">
                          <p className="text-sm font-medium" style={{ color: "var(--color-bt-text)" }}>
                            {p.name}
                          </p>
                          <p className="text-xs" style={{ color: "var(--color-bt-text-dim)" }}>
                            {p.description}
                          </p>
                        </div>
                      </button>
                    ))}
                  </div>
                )}

                {placesSearch.loading && placesSearch.query.length >= 2 && (
                  <p className="mt-1 text-xs" style={{ color: "var(--color-bt-text-dim)" }}>
                    Searching...
                  </p>
                )}

                {/* "Can't find it?" fallback — shown once the user has typed something */}
                {!placesSearch.loading && placesSearch.query.length >= 2 && (
                  <button
                    type="button"
                    onClick={() => {
                      setManualMode(true);
                      const q = placesSearch.query.trim();
                      setManualName(q);
                      // Mirror the onChange path of the manual name
                      // input so canSubmit picks up the pre-filled
                      // query immediately. Without this, the button
                      // stays disabled until the user re-types.
                      if (q) {
                        setSelectedCourse({ placeId: "", name: q, address: "" });
                      }
                      placesSearch.clear();
                    }}
                    className="mt-1.5 text-xs transition-opacity hover:opacity-70"
                    style={{ color: "var(--color-bt-text-dim)" }}
                  >
                    Can&apos;t find it? Enter manually →
                  </button>
                )}
              </div>
            )}

            {/* Date — restored for golf rounds too (round-7 item 7).
                Native date input clamped to the trip date range so
                rounds can be assigned to a day directly from the
                drawer instead of via On Deck drag. */}
            <p
              className="mt-3 mb-1.5 text-[11px] font-bold uppercase tracking-[0.08em]"
              style={{ color: "var(--color-bt-text-dim)" }}
            >
              Date <span className="font-medium normal-case tracking-normal">(optional)</span>
            </p>
            <input
              type={scheduledDate ? "date" : "text"}
              value={scheduledDate}
              min={tripStart}
              max={tripEnd}
              onFocus={(e) => { e.currentTarget.type = "date"; }}
              onBlur={(e) => { if (!scheduledDate) e.currentTarget.type = "text"; }}
              onChange={(e) => setScheduledDate(e.target.value)}
              placeholder="Add a date"
              className="rounded-xl border px-3 py-2.5 text-sm outline-none"
              style={inputStyle}
            />

            {/* Tee times */}
            <p
              className="mt-3 mb-1.5 text-[11px] font-bold uppercase tracking-[0.08em]"
              style={{ color: "var(--color-bt-text-dim)" }}
            >
              Tee times
            </p>
            {!isWalkOn && (
              <>
                <div className="space-y-1.5">
                  {teeTimes.map((t, idx) => (
                    <div key={idx} className="flex items-center gap-2">
                      <input
                        type="time"
                        value={t}
                        onChange={(e) => updateTeeTime(idx, e.target.value)}
                        onClick={(e) => e.currentTarget.showPicker?.()}
                        className="flex-1 rounded-xl border px-3 py-2.5 text-sm font-mono tabular-nums outline-none"
                        style={inputStyle}
                      />
                      {teeTimes.length > 1 && (
                        <button
                          onClick={() => removeTeeTime(idx)}
                          className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg transition-opacity hover:opacity-80"
                          style={{ color: "var(--color-bt-text-dim)" }}
                        >
                          <X size={14} />
                        </button>
                      )}
                    </div>
                  ))}
                </div>
                <button
                  onClick={addTeeTime}
                  className="mt-1.5 flex items-center gap-1 text-xs font-medium transition-opacity hover:opacity-80"
                  style={{ color: "var(--color-bt-accent)" }}
                >
                  <Plus size={12} />
                  Add tee time
                </button>
              </>
            )}
            {/* Walk on option — confirmed without a specific tee time.
                Extra top spacing keeps it clear of "Add tee time" so it's
                not accidentally toggled after entering times. */}
            <label className="mt-6 flex cursor-pointer items-center gap-2">
              <input
                type="checkbox"
                checked={isWalkOn}
                onChange={(e) => {
                  setIsWalkOn(e.target.checked);
                  if (e.target.checked) setTeeTimes([""]);
                }}
                className="flex-shrink-0 cursor-pointer accent-bt-accent"
              />
              <span className="text-[13px]" style={{ color: "var(--color-bt-text-dim)" }}>
                Walk on — no specific tee time
              </span>
            </label>
          </>
        )}

        {/* ── General: title + detail ──────────────────────────────────── */}
        {!isGolf && (
          <>
            <p className="mb-1.5 text-[11px] font-bold uppercase tracking-[0.08em]" style={{ color: "var(--color-bt-text-dim)" }}>
              Title<span className="ml-1.5 inline-block h-1.5 w-1.5 rounded-full align-middle" style={{ background: "var(--color-bt-danger)" }} aria-hidden />
            </p>
            <input
              type="text"
              placeholder="Title (e.g. Dinner at The Grill)"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="w-full rounded-xl border px-3 py-2.5 text-sm outline-none"
              style={inputStyle}
            />
            <p className="mt-3 mb-1.5 text-[11px] font-bold uppercase tracking-[0.08em]" style={{ color: "var(--color-bt-text-dim)" }}>
              Detail <span className="font-medium normal-case tracking-normal">(optional)</span>
            </p>
            <textarea
              placeholder="Detail (optional)"
              value={detail}
              onChange={(e) => setDetail(e.target.value)}
              rows={2}
              className="w-full resize-none rounded-xl border px-3 py-2.5 text-sm outline-none"
              style={inputStyle}
            />

            {/* Location search (optional) */}
            <p className="mt-3 mb-1.5 text-[11px] font-bold uppercase tracking-[0.08em]" style={{ color: "var(--color-bt-text-dim)" }}>
              Location <span className="font-medium normal-case tracking-normal">(optional)</span>
            </p>
            {selectedLocation && !showLocationSearch ? (
              <div
                className="flex items-center gap-3 rounded-xl px-3 py-2.5"
                style={{ background: "var(--color-bt-card-raised)", border: "1px solid var(--color-bt-accent-border)" }}
              >
                <MapPin size={14} style={{ color: "var(--color-bt-accent)" }} />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium" style={{ color: "var(--color-bt-text)" }}>
                    {selectedLocation.name}
                  </p>
                  {selectedLocation.address && (
                    <p className="text-xs" style={{ color: "var(--color-bt-text-dim)" }}>
                      {selectedLocation.address}
                    </p>
                  )}
                </div>
                <button
                  onClick={() => { setSelectedLocation(null); setShowLocationSearch(true); }}
                  className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full"
                  style={{ color: "var(--color-bt-text-dim)" }}
                >
                  <X size={14} />
                </button>
              </div>
            ) : (
              <div className="relative">
                <div className="relative">
                  <Search
                    size={14}
                    className="absolute left-3 top-1/2 -translate-y-1/2"
                    style={{ color: "var(--color-bt-text-dim)" }}
                  />
                  <input
                    type="text"
                    placeholder="Search for a venue..."
                    value={locationSearch.query}
                    onChange={(e) => locationSearch.search(e.target.value)}
                    className="w-full rounded-xl border py-2.5 pl-9 pr-3 text-sm outline-none"
                    style={inputStyle}
                  />
                </div>
                {locationSearch.predictions.length > 0 && (
                  <div
                    className="absolute left-0 right-0 top-full z-10 mt-1 max-h-48 overflow-y-auto rounded-xl shadow-lg"
                    style={{ background: "var(--color-bt-card)", border: "1px solid var(--color-bt-border)" }}
                  >
                    {locationSearch.predictions.map((p) => (
                      <button
                        key={p.placeId}
                        onClick={() => handleSelectLocation(p)}
                        className="flex w-full items-start gap-2 px-3 py-2.5 text-left transition-colors hover:bg-[var(--color-bt-hover)]"
                      >
                        <MapPin size={13} className="mt-0.5 flex-shrink-0" style={{ color: "var(--color-bt-accent)" }} />
                        <div className="min-w-0">
                          <p className="text-sm font-medium" style={{ color: "var(--color-bt-text)" }}>
                            {p.name}
                          </p>
                          <p className="text-xs" style={{ color: "var(--color-bt-text-dim)" }}>
                            {p.description}
                          </p>
                        </div>
                      </button>
                    ))}
                  </div>
                )}
                {locationSearch.loading && locationSearch.query.length >= 2 && (
                  <p className="mt-1 text-xs" style={{ color: "var(--color-bt-text-dim)" }}>
                    Searching...
                  </p>
                )}
              </div>
            )}
          </>
        )}

        {/* ── Time (optional) ──────────────────────────────────────────────
            Date pickers were removed — new items land in the Unscheduled
            section and the user drags them onto a day. Editing a
            previously-scheduled item preserves its date in state (it just
            isn't editable here). Golf rounds keep their own tee_times list
            below, so this slot only renders for non-golf items. */}
        {!isGolf && (
          <>
            {/* Date + Time — date select restored per round-4 item 8.
                Native date input with min/max bound to the trip's date
                range keeps users from assigning items outside it. */}
            <div className="mt-3 flex gap-3">
              <div>
                <p className="mb-1.5 text-[11px] font-bold uppercase tracking-[0.08em]" style={{ color: "var(--color-bt-text-dim)" }}>
                  Date <span className="font-medium normal-case tracking-normal">(optional)</span>
                </p>
                <input
                  type={scheduledDate ? "date" : "text"}
                  value={scheduledDate}
                  min={tripStart}
                  max={tripEnd}
                  onFocus={(e) => { e.currentTarget.type = "date"; }}
                  onBlur={(e) => { if (!scheduledDate) e.currentTarget.type = "text"; }}
                  onChange={(e) => setScheduledDate(e.target.value)}
                  placeholder="Add a date"
                  className="rounded-xl border px-3 py-2.5 text-sm outline-none"
                  style={inputStyle}
                />
              </div>
              <div>
                <p className="mb-1.5 text-[11px] font-bold uppercase tracking-[0.08em]" style={{ color: "var(--color-bt-text-dim)" }}>
                  Time <span className="font-medium normal-case tracking-normal">(optional)</span>
                </p>
                <input
                  type="time"
                  value={scheduledTime}
                  onChange={(e) => setScheduledTime(e.target.value)}
                  onClick={(e) => e.currentTarget.showPicker?.()}
                  className="w-32 rounded-xl border px-3 py-2.5 text-sm font-mono tabular-nums outline-none"
                  style={inputStyle}
                />
              </div>
            </div>
          </>
        )}

        {/* Destructive "Remove from agenda" sits at the end of the body —
            above the footer divider and the Cancel/Save row. */}
        {isEditing && onRemove && (
          <div className="mt-4">
            <ConfirmDeleteButton
              label="Remove from agenda"
              confirmLabel="Remove"
              pendingLabel="Removing…"
              prompt="Remove this from the agenda?"
              pending={removing}
              testId="remove-agenda-item-btn"
              onConfirm={onRemove}
            />
          </div>
        )}

        </div>

        {/* Footer — sticky bottom: Cancel + Save row. */}
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
            className="flex-1 rounded-lg py-2 text-sm font-semibold transition-opacity hover:opacity-90 disabled:opacity-40"
            style={{
              background: "var(--color-bt-accent)",
              color: "var(--color-bt-on-accent)",
            }}
          >
            {isPending
              ? isEditing ? "Saving..." : "Adding..."
              : isEditing
              ? "Save changes"
              : isGolf ? "Add Golf Round" : "Add Activity"}
          </button>
        </div>
      </div>
    </>
  );
}
