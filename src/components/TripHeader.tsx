"use client";

import { useState, useRef, useEffect, type FC } from "react";
import { useTheme } from "next-themes";
import { MapPin, Calendar } from "lucide-react";
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

    {location ? (
      <div
        className="mt-2 flex items-center gap-1 text-sm"
        style={{ color: "var(--color-bt-text-dim)" }}
      >
        <MapPin size={13} />
        <span>{location}</span>
      </div>
    ) : (
      <p className="mt-2 text-xs" style={{ color: "var(--color-bt-text-dim)" }}>
        Destination TBD
      </p>
    )}

    {dateRange && dateRange !== "Dates TBD" && (
      <div
        className="mt-1 flex items-center gap-1 text-xs"
        style={{ color: "var(--color-bt-text-dim)" }}
      >
        <Calendar size={11} />
        <span>{dateRange}</span>
      </div>
    )}
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
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme === "dark";

  const titleColor = isDark ? "#ffffff" : "rgba(0,0,0,0.85)";
  const subColor = isDark ? "rgba(255,255,255,0.70)" : "rgba(0,0,0,0.60)";
  const metaColor = isDark ? "rgba(255,255,255,0.50)" : "rgba(0,0,0,0.45)";

  // Prefer location (locked_destination_location from parent) over lockedTitle
  // (locked_destination_title). Both now hold the same value after the
  // LockConfirmModal fix, but location is semantically the geographic string.
  const displayLocation = location || lockedTitle || "";

  return (
    <LocationHero location={displayLocation || tripName} tripName={tripName}>
      {/* Row 1: trip name + settings + badge */}
      <div className="flex items-start justify-between">
        <h1
          data-testid="trip-title"
          className="text-2xl font-bold"
          style={{ color: titleColor }}
        >
          {tripName}
        </h1>
        <div className="flex items-center gap-2">
          <StatusBadge status={status} />
          {settingsSlot && (
            <span style={{ color: subColor }}>
              {settingsSlot}
            </span>
          )}
        </div>
      </div>

      {/* Destination */}
      <div className="mt-1.5 flex items-center gap-1 text-sm" style={{ color: subColor }}>
        <MapPin size={13} className="shrink-0" />
        {canEdit && onDestinationChange && displayLocation ? (
          <InlineEdit
            value={displayLocation}
            onSave={onDestinationChange}
            className="text-sm"
            style={{ color: subColor }}
          />
        ) : (
          <span>{displayLocation || "Destination: TBD"}</span>
        )}
      </div>

      {/* Dates */}
      <div className="mt-1 flex items-center gap-1 text-xs" style={{ color: metaColor }}>
        <Calendar size={11} className="shrink-0" />
        {canEdit && onDatesTap && dateRange && dateRange !== "Dates TBD" ? (
          <button
            onClick={onDatesTap}
            className="cursor-pointer text-left underline decoration-dotted underline-offset-2 text-xs"
            style={{ color: metaColor }}
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
