"use client";

import { useState, useRef, useEffect, type FC } from "react";
import { MapPin, Calendar, MoreHorizontal, Check, X } from "lucide-react";
import { StatusBadge, type TripStatus } from "@/components/StatusBadge";
import { LocationHero } from "@/components/LocationHero";

interface TripHeaderProps {
  tripName: string;
  status: TripStatus;
  location?: string | null;
  lockedTitle?: string | null;
  dateRange?: string;
  isLocked: boolean;
  /** owner/planner can edit destination & dates inline */
  canEdit?: boolean;
  /** Show settings gear (owner only) */
  settingsSlot?: React.ReactNode;
  /** Called when destination is edited inline */
  onDestinationChange?: (value: string) => void;
  /** Called when dates are tapped (navigate to date poll or open picker) */
  onDatesTap?: () => void;
}

// ── Inline editable text ─────────────────────────────────────────────────

function InlineEdit({
  value,
  onSave,
  placeholder,
  className,
  style,
}: {
  value: string;
  onSave: (val: string) => void;
  placeholder?: string;
  className?: string;
  style?: React.CSSProperties;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [editing]);

  const save = () => {
    const trimmed = draft.trim();
    if (trimmed && trimmed !== value) {
      onSave(trimmed);
    } else {
      setDraft(value);
    }
    setEditing(false);
  };

  const cancel = () => {
    setDraft(value);
    setEditing(false);
  };

  if (!editing) {
    return (
      <button
        onClick={() => setEditing(true)}
        className={`cursor-pointer text-left underline decoration-dotted underline-offset-2 transition-opacity hover:opacity-80 ${className ?? ""}`}
        style={style}
        data-testid="inline-edit-trigger"
      >
        {value}
      </button>
    );
  }

  return (
    <span className="inline-flex items-center gap-1">
      <input
        ref={inputRef}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={save}
        onKeyDown={(e) => {
          if (e.key === "Enter") save();
          if (e.key === "Escape") cancel();
        }}
        placeholder={placeholder}
        className="rounded border px-1.5 py-0.5 text-sm outline-none"
        style={{
          background: "rgba(255,255,255,0.15)",
          borderColor: "rgba(255,255,255,0.3)",
          color: "inherit",
          minWidth: "8rem",
        }}
        data-testid="inline-edit-input"
      />
    </span>
  );
}

// ── Plain card (no locked destination) ───────────────────────────────────

const PlainHeader: FC<Omit<TripHeaderProps, "isLocked">> = ({
  tripName,
  status,
  location,
  dateRange,
  settingsSlot,
}) => (
  <div
    className="rounded-2xl border p-5"
    style={{
      background: "var(--color-bt-card)",
      borderColor: "var(--color-bt-border)",
    }}
    data-testid="trip-header-plain"
  >
    {/* Row 1: trip name + settings + badge */}
    <div className="flex items-start justify-between">
      <h1
        data-testid="trip-title"
        className="text-xl font-bold"
        style={{ color: "var(--color-bt-text)" }}
      >
        {tripName}
      </h1>
      <div className="flex items-center gap-2">
        <StatusBadge status={status} />
        {settingsSlot}
      </div>
    </div>

    {/* Destination: TBD */}
    <div
      className="mt-2 flex items-center gap-1 text-sm"
      style={{ color: "var(--color-bt-text-dim)" }}
    >
      <MapPin size={13} />
      <span>{location || "Destination: TBD"}</span>
    </div>

    {/* Dates: TBD */}
    <div
      className="mt-1 flex items-center gap-1 text-xs"
      style={{ color: "var(--color-bt-text-dim)" }}
    >
      <Calendar size={11} />
      <span>{dateRange && dateRange !== "Dates TBD" ? dateRange : "Dates: TBD"}</span>
    </div>
  </div>
);

// ── Hero card (locked destination) ───────────────────────────────────────

const HeroHeader: FC<Omit<TripHeaderProps, "isLocked">> = ({
  tripName,
  status,
  location,
  lockedTitle,
  dateRange,
  canEdit,
  settingsSlot,
  onDestinationChange,
  onDatesTap,
}) => {
  const displayLocation = lockedTitle
    ? location && location !== lockedTitle
      ? `${lockedTitle}, ${location}`
      : lockedTitle
    : location ?? "";

  return (
    <LocationHero location={location ?? tripName} tripName={tripName}>
      {/* Row 1: trip name + settings + badge */}
      <div className="flex items-start justify-between">
        <h1
          data-testid="trip-title"
          className="text-2xl font-bold text-white"
        >
          {tripName}
        </h1>
        <div className="flex items-center gap-2">
          <StatusBadge status={status} />
          {settingsSlot && (
            <span className="[&_button]:text-white/60 [&_button:hover]:text-white/90">
              {settingsSlot}
            </span>
          )}
        </div>
      </div>

      {/* Destination */}
      <div className="mt-1.5 flex items-center gap-1 text-sm text-white/70">
        <MapPin size={13} className="shrink-0" />
        {canEdit && onDestinationChange && displayLocation ? (
          <InlineEdit
            value={displayLocation}
            onSave={onDestinationChange}
            className="text-sm text-white/70"
          />
        ) : (
          <span>{displayLocation || "Destination: TBD"}</span>
        )}
      </div>

      {/* Dates */}
      <div className="mt-1 flex items-center gap-1 text-xs text-white/50">
        <Calendar size={11} className="shrink-0" />
        {canEdit && onDatesTap && dateRange && dateRange !== "Dates TBD" ? (
          <button
            onClick={onDatesTap}
            className="cursor-pointer text-left underline decoration-dotted underline-offset-2 text-xs text-white/50 hover:text-white/70"
            data-testid="dates-tap"
          >
            {dateRange}
          </button>
        ) : (
          <span>{dateRange && dateRange !== "Dates TBD" ? dateRange : "Dates: TBD"}</span>
        )}
      </div>
    </LocationHero>
  );
};

// ── Exported TripHeader ──────────────────────────────────────────────────

export function TripHeader(props: TripHeaderProps) {
  if (props.isLocked) {
    return <HeroHeader {...props} />;
  }
  return <PlainHeader {...props} />;
}
