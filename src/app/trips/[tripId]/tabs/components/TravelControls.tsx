"use client";

import { useState } from "react";
import { AlertTriangle, Car, HelpCircle, Plane } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { trpc } from "@/lib/trpc-client";
import { DatePicker } from "@/components/DatePicker";
import { TimePicker } from "@/components/TimePicker";
import { DOMAIN_COLORS } from "@/lib/domainColors";
import { parseLocalDate, toISODate } from "@/lib/dates";
import { parseTime, toTime24 } from "@/lib/time";

/**
 * Shared travel controls for the Crew tab.
 *
 * Travel lives on the crew member, not the Home tab. These pieces are
 * reused in two places:
 *   - the YOU tile's inline editor (a member self-serving their own travel)
 *   - the MemberEditor crew-edit drawer (owner editing anyone, incl. placeholders)
 *
 * The data model collapsed to a single free-text `travel_detail` string for
 * every mode (no separate airline/number fields) — `mode` only drives the
 * icon + color, and a mode-adaptive placeholder hints at what to type. The
 * legacy structured flight columns are read for prefill of older rows but
 * never written; saving clears them so the detail string stays authoritative.
 */

export type TravelMode = "driving" | "flying" | "other";

/** Minimum member shape the travel controls read for prefill + display. */
export interface TravelMember {
  travel_mode?: string | null;
  travel_detail?: string | null;
  flight_airline?: string | null;
  flight_number?: string | null;
  flight_airport?: string | null;
  flight_arrival_time?: string | null;
}

// ── Mode metadata (icon + color tone, shared by pill + segmented control) ──

interface ModeMeta {
  label: string;
  Icon: LucideIcon;
  /** Background/foreground/border for the at-a-glance pill. */
  bg: string;
  fg: string;
  border: string;
  /** Placeholder/tip text for the single detail field. */
  placeholder: string;
}

export const TRAVEL_MODE_META: Record<TravelMode, ModeMeta> = {
  flying: {
    label: "Flying",
    Icon: Plane,
    bg: "var(--color-bt-accent-faint)",
    fg: "var(--color-bt-accent)",
    border: "var(--color-bt-accent-border)",
    placeholder: "e.g. Delta 1733, landing at ATL",
  },
  driving: {
    label: "Driving",
    Icon: Car,
    bg: "var(--color-bt-warning-faint)",
    fg: "var(--color-bt-owner)",
    border: "var(--color-bt-warning-border)",
    placeholder: "e.g. Driving up from Charlotte",
  },
  other: {
    label: "Other",
    Icon: HelpCircle,
    bg: "var(--color-bt-blue-bg)",
    fg: "var(--color-bt-planning)",
    border: "var(--color-bt-planning-border)",
    placeholder: "e.g. Taking the train in from NYC",
  },
};

// Segmented-control order follows the spec: Flying · Driving · Other.
const MODE_ORDER: TravelMode[] = ["flying", "driving", "other"];

// ── TravelModePill — at-a-glance mode badge for crew rows ──────────────────
// Icon-only circular pill. Renders nothing when no mode is set (we never
// print "No travel" on rows per the spec).

export function TravelModePill({
  mode,
  withLabel = false,
}: {
  mode: TravelMode | null | undefined;
  /** When true, shows the mode label next to the icon (used in the YOU tile). */
  withLabel?: boolean;
}) {
  if (!mode) return null;
  const meta = TRAVEL_MODE_META[mode];
  const Icon = meta.Icon;
  return (
    <span
      className={
        withLabel
          ? "inline-flex flex-shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold"
          : "flex flex-shrink-0 items-center justify-center rounded-full p-1.5"
      }
      style={{ background: meta.bg, color: meta.fg, border: `1px solid ${meta.border}` }}
    >
      <Icon size={12} />
      {withLabel && meta.label}
    </span>
  );
}

// ── Display helpers ─────────────────────────────────────────────────────────

/** Detail line for a member's saved travel — the single detail string, with
 *  a graceful fallback to legacy flight fields for older rows. Empty → null. */
export function summarizeTravel(m: TravelMember): string | null {
  if (m.travel_detail) return m.travel_detail;
  // Legacy fallback: structured flight fields from before the detail collapse.
  if (m.travel_mode === "flying") {
    const flight = [m.flight_airline, m.flight_number].filter(Boolean).join(" ");
    const parts: string[] = [];
    if (flight) parts.push(flight);
    if (m.flight_airport) parts.push(`arriving ${m.flight_airport}`);
    return parts.join(" · ") || null;
  }
  return null;
}

/**
 * Render an ISO timestamp as "Sep 10 · 3:00 PM" — or just "Sep 10" when there's
 * no specific time (date-only arrivals store midnight as the sentinel).
 *
 * Read literally (TZ-naive): the stored value is a `timestamptz` and running it
 * through `new Date()` would shift it into the viewer's local zone, landing the
 * label on the wrong day. We format directly off the date/time prefix instead.
 */
export function formatArrivalLabel(iso: string | null | undefined): string {
  const date = parseArrivalDate(iso);
  if (!date) return "";
  const time = parseArrivalTime(iso); // "" when midnight / no time

  // Build a label off the literal Y/M/D parts (no timezone math).
  const [y, mo, da] = date.split("-").map(Number);
  const dateLabel = new Date(y, mo - 1, da).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });

  if (!time) return dateLabel;
  const [hh, mm] = time.split(":").map(Number);
  const timeLabel = new Date(2000, 0, 1, hh, mm).toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
  });
  return `${dateLabel} · ${timeLabel}`;
}

/** Pull YYYY-MM-DD out of an ISO timestamp, read literally (TZ-naive). */
function parseArrivalDate(iso: string | null | undefined): string {
  if (!iso) return "";
  const m = iso.match(/^(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : "";
}

/**
 * Pull HH:MM out of an ISO timestamp, read literally (TZ-naive).
 *
 * Returns "" for missing times and for exactly midnight — midnight is our
 * sentinel for "date only, no specific time", so re-opening the editor on a
 * date-only arrival shows an empty time field rather than a spurious 12:00 AM.
 */
function parseArrivalTime(iso: string | null | undefined): string {
  if (!iso) return "";
  const m = iso.match(/T(\d{2}):(\d{2})/);
  if (!m) return "";
  const hhmm = `${m[1]}:${m[2]}`;
  return hhmm === "00:00" ? "" : hhmm;
}

// ── Travel form state (shared by TravelFields, TravelEditor, MemberEditor) ──
//
// The travel inputs collapse to four controlled values. Both the standalone
// TravelEditor (YOU tile, owns its own Save) and the MemberEditor crew drawer
// (always-on fields, saved by the drawer's own footer) drive the same
// `TravelFields` presentational component off this shape.

export interface TravelFormValue {
  /** `null` = no mode picked yet (the segmented control sits unselected).
   *  Mode is the canonical "has travel" marker — saving with a null mode
   *  persists *no* travel rather than silently defaulting to a mode. */
  mode: TravelMode | null;
  detail: string;
  arrivalDate: string;
  arrivalTime: string;
}

/** Build the initial form value from a member's saved travel (with legacy
 *  flight-field fallback for older flying rows). A member with no saved
 *  travel starts with `mode: null` so the segmented control opens unselected
 *  rather than pre-selecting Flying. */
export function travelMemberToForm(member: TravelMember): TravelFormValue {
  return {
    mode: (member.travel_mode as TravelMode) ?? null,
    detail: summarizeTravel(member) ?? "",
    arrivalDate: parseArrivalDate(member.flight_arrival_time),
    arrivalTime: parseArrivalTime(member.flight_arrival_time),
  };
}

/** Payload that wipes a member's travel entirely — no mode (so the row reads
 *  as "no travel"), no detail, no arrival, and the legacy flight columns
 *  cleared too. Used by the Clear / reset action on both travel surfaces. */
export const TRAVEL_CLEAR_PAYLOAD = {
  travelMode: null,
  travelDetail: null,
  flightAirline: null,
  flightNumber: null,
  flightArrivalTime: null,
  flightAirport: null,
} as const;

/** Convert form state into the mutation payload. Clears the legacy structured
 *  flight columns on every save so the single detail string stays
 *  authoritative.
 *
 *  With no mode picked there's no travel to record — the mode is the marker
 *  the crew roster and itinerary key off, so a detail/arrival without a mode
 *  would be invisible orphan data. We persist the clear payload instead, which
 *  is also what prevents an untouched form from silently saving "Flying". */
export function travelFormToPayload(value: TravelFormValue) {
  if (!value.mode) {
    return { ...TRAVEL_CLEAR_PAYLOAD };
  }
  let arrivalISO: string | null = null;
  if (value.arrivalDate) {
    arrivalISO = value.arrivalTime
      ? `${value.arrivalDate}T${value.arrivalTime}:00`
      : `${value.arrivalDate}T00:00:00`;
  }
  return {
    travelMode: value.mode,
    travelDetail: value.detail.trim() || null,
    flightAirline: null,
    flightNumber: null,
    flightArrivalTime: arrivalISO,
    flightAirport: null,
  };
}

/** Field-by-field equality so callers can tell whether the form is dirty. */
export function travelFormsEqual(a: TravelFormValue, b: TravelFormValue): boolean {
  return (
    a.mode === b.mode &&
    a.detail.trim() === b.detail.trim() &&
    a.arrivalDate === b.arrivalDate &&
    a.arrivalTime === b.arrivalTime
  );
}

// ── TravelFields — presentational, footerless travel inputs ────────────────
//
// Controlled segmented mode + detail + arriving date/time. No Save/Cancel —
// the host decides how/when to persist. Used directly by the MemberEditor
// drawer (the drawer's own footer saves) and wrapped by TravelEditor (which
// adds a Save/Cancel footer for the YOU tile's add/edit toggle).

export function TravelFields({
  value,
  onChange,
  tripStartDate,
  surface = "card",
}: {
  value: TravelFormValue;
  onChange: (next: TravelFormValue) => void;
  /** Optional — flags arrivals entered before the trip starts. */
  tripStartDate?: string | null;
  /** "card" = sits on a card surface (YOU tile); "recessed" = sits inside a
   *  drawer, so inputs use the recessed base background. */
  surface?: "card" | "recessed";
}) {
  const arrivalBeforeTrip =
    !!value.arrivalDate && !!tripStartDate && value.arrivalDate < tripStartDate;
  const inputBg =
    surface === "recessed" ? "var(--color-bt-base)" : "var(--color-bt-card-raised)";

  // Everything below the mode picker depends on a chosen mode — travel won't
  // persist without one. Keep the detail/arrival fields disabled until the
  // user selects Flying / Driving / Other so the form can't be half-filled.
  const modeSelected = !!value.mode;

  return (
    <div className="space-y-3">
      {arrivalBeforeTrip && (
        <div
          className="flex items-center gap-2.5 rounded-lg px-3 py-2"
          style={{
            background: "var(--color-bt-warning-faint)",
            border: "1px solid var(--color-bt-warning-border)",
          }}
        >
          <AlertTriangle
            size={14}
            style={{ color: "var(--color-bt-warning)", flexShrink: 0 }}
          />
          <p
            className="text-[11px] leading-snug"
            style={{ color: "var(--color-bt-text-dim)" }}
          >
            Arrival is before the trip starts — double-check the month and day.
          </p>
        </div>
      )}

      {/* Mode segmented control — Flying · Driving · Other. */}
      <div
        className="inline-flex rounded-xl p-1"
        style={{
          background: inputBg,
          border: "1px solid var(--color-bt-border)",
        }}
      >
        {MODE_ORDER.map((m) => {
          const meta = TRAVEL_MODE_META[m];
          const Icon = meta.Icon;
          const active = value.mode === m;
          return (
            <button
              key={m}
              type="button"
              onClick={() => onChange({ ...value, mode: m })}
              className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors"
              style={
                active
                  ? {
                      // Active segment is teal-on-faint so it stands out
                      // against the recessed base track without re-introducing
                      // a flat card fill.
                      background: "var(--color-bt-accent-faint)",
                      color: "var(--color-bt-accent)",
                      boxShadow: "var(--shadow-card)",
                    }
                  : { background: "transparent", color: "var(--color-bt-text-dim)" }
              }
            >
              <Icon size={12} />
              {meta.label}
            </button>
          );
        })}
      </div>

      {/* Details — single free-text string with a mode-adaptive tip. */}
      <div>
        <label
          className="mb-1 block text-[10px] font-bold uppercase tracking-wider"
          style={{ color: "var(--color-bt-text-dim)" }}
        >
          Details
        </label>
        <input
          type="text"
          value={value.detail}
          onChange={(e) => onChange({ ...value, detail: e.target.value })}
          disabled={!modeSelected}
          placeholder={
            value.mode
              ? TRAVEL_MODE_META[value.mode].placeholder
              : "Pick how you're getting there above"
          }
          className="w-full rounded-lg border px-2.5 py-1.5 text-sm outline-none disabled:cursor-not-allowed disabled:opacity-50"
          style={{
            background: inputBg,
            borderColor: "var(--color-bt-border)",
            color: "var(--color-bt-text)",
          }}
        />
      </div>

      {/* Arriving date + time side by side. */}
      <div className="flex flex-wrap items-end gap-2">
        <div style={{ flex: "1 1 140px" }}>
          <label
            className="mb-1 block text-[10px] font-bold uppercase tracking-wider"
            style={{ color: "var(--color-bt-text-dim)" }}
          >
            Arriving
          </label>
          <DatePicker
            mode="single"
            icon={<Plane size={15} />}
            disabled={!modeSelected}
            accent={DOMAIN_COLORS.travel.color}
            accentFaint={DOMAIN_COLORS.travel.faint}
            value={value.arrivalDate ? parseLocalDate(value.arrivalDate) : null}
            onChange={(d) =>
              onChange({ ...value, arrivalDate: d ? toISODate(d) : "" })
            }
          />
        </div>
        <div style={{ flex: "1 1 100px" }}>
          <TimePicker
            label="Time"
            icon={<Plane size={15} />}
            presets="daypart"
            disabled={!modeSelected}
            accent={DOMAIN_COLORS.travel.color}
            accentFaint={DOMAIN_COLORS.travel.faint}
            value={parseTime(value.arrivalTime)}
            onChange={(t) => onChange({ ...value, arrivalTime: toTime24(t) })}
          />
        </div>
      </div>
    </div>
  );
}

// ── TravelEditor — segmented mode + detail + arriving date/time + footer ────
//
// The YOU tile's add/edit toggle: TravelFields plus its own Save/Cancel.
// Self-edit (member's own travel) when `targetUserId` is omitted → writes via
// tripMembers.updateTravel. Owner editing someone else → pass `targetUserId`
// → writes via tripMembers.updateMemberTravel (works for placeholders too).

export function TravelEditor({
  tripId,
  member,
  targetUserId,
  tripStartDate,
  surface = "card",
  onSaved,
  onCancel,
}: {
  tripId: string;
  member: TravelMember;
  /** Omit for self-edit; set to edit another member as owner. */
  targetUserId?: string;
  /** Optional — flags arrivals entered before the trip starts. */
  tripStartDate?: string | null;
  /** "card" = sits on a card surface (YOU tile); "recessed" = sits inside a
   *  drawer, so inputs use the recessed base background. */
  surface?: "card" | "recessed";
  onSaved: () => void;
  onCancel: () => void;
}) {
  const utils = trpc.useUtils();
  const [form, setForm] = useState<TravelFormValue>(() => travelMemberToForm(member));

  const invalidate = () => {
    utils.tripMembers.list.invalidate({ tripId });
    onSaved();
  };
  const updateTravel = trpc.tripMembers.updateTravel.useMutation({ onSuccess: invalidate });
  const updateMemberTravel = trpc.tripMembers.updateMemberTravel.useMutation({
    onSuccess: invalidate,
  });
  const isPending = targetUserId
    ? updateMemberTravel.isPending
    : updateTravel.isPending;

  const handleSave = () => {
    const common = travelFormToPayload(form);
    if (targetUserId) {
      updateMemberTravel.mutate({ tripId, targetUserId, ...common });
    } else {
      updateTravel.mutate({ tripId, ...common, travelShared: true });
    }
  };

  // Clear / reset — wipes the saved travel entirely and closes the editor
  // (onSuccess → invalidate → onSaved). Only offered when there's something
  // to reset; adding fresh travel has nothing to clear. This is a member's own
  // travel (self-edit when targetUserId is omitted), so it's a routine action,
  // not a destructive owner one — styled teal, not danger-red.
  const handleClear = () => {
    if (targetUserId) {
      updateMemberTravel.mutate({ tripId, targetUserId, ...TRAVEL_CLEAR_PAYLOAD });
    } else {
      updateTravel.mutate({ tripId, ...TRAVEL_CLEAR_PAYLOAD, travelShared: true });
    }
  };
  const hasSavedTravel = !!member.travel_mode;

  return (
    <div className="space-y-3">
      <TravelFields
        value={form}
        onChange={setForm}
        tripStartDate={tripStartDate}
        surface={surface}
      />

      {/* Footer actions. Clear (left) only shows when there's saved travel to
          reset; Cancel/Save stay right-aligned. */}
      <div className="flex items-center gap-2 pt-1">
        {hasSavedTravel && (
          <button
            type="button"
            onClick={handleClear}
            disabled={isPending}
            className="rounded-lg px-3 py-1.5 text-xs font-medium transition-colors hover:bg-[var(--color-bt-accent-faint)] disabled:opacity-40"
            style={{ color: "var(--color-bt-accent)", background: "transparent" }}
          >
            Clear
          </button>
        )}
        <button
          type="button"
          onClick={onCancel}
          disabled={isPending}
          className="ml-auto rounded-lg border px-3 py-1.5 text-xs font-medium disabled:opacity-40"
          style={{
            borderColor: "var(--color-bt-border)",
            color: "var(--color-bt-text-dim)",
            background: "transparent",
          }}
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={handleSave}
          disabled={isPending}
          className="rounded-lg px-4 py-1.5 text-xs font-bold disabled:opacity-40"
          style={{
            background: "var(--color-bt-accent)",
            color: "var(--color-bt-on-accent)",
          }}
        >
          {isPending ? "Saving…" : "Save"}
        </button>
      </div>
    </div>
  );
}
