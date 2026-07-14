"use client";

import { useState } from "react";
import { AlertTriangle, Calendar, Car, Clock, HelpCircle, Plane, PlaneLanding, PlaneTakeoff } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { trpc } from "@/lib/trpc-client";
import { DatePicker } from "@/components/DatePicker";
import { TimePicker } from "@/components/TimePicker";
import { DOMAIN_COLORS } from "@/lib/domainColors";
import { parseLocalDate, toISODate } from "@/lib/dates";
import { parseTime, toTime24 } from "@/lib/time";
import {
  type TravelMode,
  type TravelMember,
  type TravelFormValue,
  summarizeTravel,
  formatArrivalLabel,
  travelMemberToForm,
  travelFormToPayload,
  travelFormsEqual,
  TRAVEL_CLEAR_PAYLOAD,
} from "./travelForm";

/**
 * Shared travel controls for the Crew tab.
 *
 * Travel lives on the crew member, not the Home tab. These pieces are
 * reused in two places:
 *   - the YOU tile's inline editor (a member self-serving their own travel)
 *   - the MemberEditor crew-edit drawer (owner editing anyone, incl. placeholders)
 *
 * Each mode drives an icon + color and a mode-adaptive placeholder. Members
 * capture two legs — ARRIVAL and DEPARTURE — with the same fields/behavior;
 * the pure form <-> payload logic lives in `./travelForm` (client-safe, tested).
 * The legacy structured flight columns are read for prefill of older rows but
 * never written; saving clears them so the detail string stays authoritative.
 */

// Re-export the pure form helpers so existing `./TravelControls` importers
// (CrewRoster, MemberEditor) keep a single import site; definitions live in
// `./travelForm`.
export {
  summarizeTravel,
  formatArrivalLabel,
  travelMemberToForm,
  travelFormToPayload,
  travelFormsEqual,
  TRAVEL_CLEAR_PAYLOAD,
};
export type { TravelMode, TravelMember, TravelFormValue };

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

// ── TravelLegFields — one leg (arrival OR departure) ───────────────────────
//
// Shared inner control for a single travel leg: segmented mode + detail +
// date/time (progressive disclosure — the detail/date fields only mount once a
// mode is chosen). Both the arrival and departure legs render THIS, so the two
// legs can't drift. Fully controlled; the parent maps each field back into the
// TravelFormValue.

function TravelLegFields({
  mode,
  detail,
  date,
  time,
  onMode,
  onDetail,
  onDate,
  onTime,
  dateLabel,
  inputBg,
  emptyHint,
  warning,
}: {
  mode: TravelMode | null;
  detail: string;
  date: string;
  time: string;
  onMode: (m: TravelMode) => void;
  onDetail: (s: string) => void;
  onDate: (s: string) => void;
  onTime: (s: string) => void;
  /** "Arriving" / "Departing" — the date field's label. */
  dateLabel: string;
  inputBg: string;
  /** Quiet line shown in place of the detail fields before a mode is picked. */
  emptyHint?: string;
  /** Optional inline warning banner rendered above the mode picker. */
  warning?: React.ReactNode;
}) {
  const modeSelected = !!mode;

  return (
    <div className="space-y-3">
      {warning}

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
          const active = mode === m;
          return (
            <button
              key={m}
              type="button"
              onClick={() => onMode(m)}
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

      {modeSelected ? (
        <>
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
              value={detail}
              onChange={(e) => onDetail(e.target.value)}
              placeholder={mode ? TRAVEL_MODE_META[mode].placeholder : ""}
              className="w-full rounded-lg border px-2.5 py-1.5 text-sm outline-none"
              style={{
                background: inputBg,
                borderColor: "var(--color-bt-border)",
                color: "var(--color-bt-text)",
              }}
            />
          </div>

          {/* Date + time side by side. */}
          <div className="flex flex-wrap items-end gap-2">
            <div style={{ flex: "1 1 140px" }}>
              <label
                className="mb-1 block text-[10px] font-bold uppercase tracking-wider"
                style={{ color: "var(--color-bt-text-dim)" }}
              >
                {dateLabel}
              </label>
              <DatePicker
                mode="single"
                icon={<Calendar size={15} />}
                accent={DOMAIN_COLORS.travel.color}
                accentFaint={DOMAIN_COLORS.travel.faint}
                value={date ? parseLocalDate(date) : null}
                onChange={(d) => onDate(d ? toISODate(d) : "")}
              />
            </div>
            <div style={{ flex: "1 1 100px" }}>
              <TimePicker
                label="Time"
                icon={<Clock size={15} />}
                presets="daypart"
                accent={DOMAIN_COLORS.travel.color}
                accentFaint={DOMAIN_COLORS.travel.faint}
                value={parseTime(time)}
                onChange={(t) => onTime(toTime24(t))}
              />
            </div>
          </div>
        </>
      ) : emptyHint ? (
        <p className="text-[11px] leading-snug" style={{ color: "var(--color-bt-text-dim)" }}>
          {emptyHint}
        </p>
      ) : null}
    </div>
  );
}

// ── LegHeader — small "Arrival" / "Departure" sub-header ───────────────────

function LegHeader({ Icon, label }: { Icon: LucideIcon; label: string }) {
  return (
    <div
      className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider"
      style={{ color: "var(--color-bt-text-dim)" }}
    >
      <Icon size={12} strokeWidth={2.5} />
      {label}
    </div>
  );
}

// ── TravelFields — presentational, footerless travel inputs ────────────────
//
// Controlled ARRIVAL + DEPARTURE legs (each a TravelLegFields). No Save/Cancel
// — the host decides how/when to persist. Used directly by the MemberEditor
// drawer (the drawer's own footer saves) and wrapped by TravelEditor (which
// adds a Save/Cancel footer for the YOU tile's add/edit toggle).

export function TravelFields({
  value,
  onChange,
  tripStartDate,
  surface = "card",
  emptyHint = "Pick a travel type to add details.",
}: {
  value: TravelFormValue;
  onChange: (next: TravelFormValue) => void;
  /** Optional — flags arrivals entered before the trip starts. */
  tripStartDate?: string | null;
  /** "card" = sits on a card surface (YOU tile); "recessed" = sits inside a
   *  drawer, so inputs use the recessed base background. */
  surface?: "card" | "recessed";
  /** Quiet line shown in place of the detail fields before a mode is picked. */
  emptyHint?: string;
}) {
  const arrivalBeforeTrip =
    !!value.arrivalDate && !!tripStartDate && value.arrivalDate < tripStartDate;
  const inputBg =
    surface === "recessed" ? "var(--color-bt-base)" : "var(--color-bt-card-raised)";

  return (
    <div className="space-y-4">
      {/* ── Arrival leg ── */}
      <div className="space-y-2">
        <LegHeader Icon={PlaneLanding} label="Arrival" />
        <TravelLegFields
          mode={value.mode}
          detail={value.detail}
          date={value.arrivalDate}
          time={value.arrivalTime}
          onMode={(m) => onChange({ ...value, mode: m })}
          onDetail={(s) => onChange({ ...value, detail: s })}
          onDate={(s) => onChange({ ...value, arrivalDate: s })}
          onTime={(s) => onChange({ ...value, arrivalTime: s })}
          dateLabel="Arriving"
          inputBg={inputBg}
          emptyHint={emptyHint}
          warning={
            arrivalBeforeTrip ? (
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
                <p className="text-[11px] leading-snug" style={{ color: "var(--color-bt-text-dim)" }}>
                  Arrival is before the trip starts — double-check the month and day.
                </p>
              </div>
            ) : null
          }
        />
      </div>

      {/* ── Departure leg — same fields/behavior as arrival ── */}
      <div
        className="space-y-2 pt-3"
        style={{ borderTop: "1px solid var(--color-bt-subtle-border)" }}
      >
        <LegHeader Icon={PlaneTakeoff} label="Departure" />
        <TravelLegFields
          mode={value.departureMode}
          detail={value.departureDetail}
          date={value.departureDate}
          time={value.departureTime}
          onMode={(m) => onChange({ ...value, departureMode: m })}
          onDetail={(s) => onChange({ ...value, departureDetail: s })}
          onDate={(s) => onChange({ ...value, departureDate: s })}
          onTime={(s) => onChange({ ...value, departureTime: s })}
          dateLabel="Departing"
          inputBg={inputBg}
          emptyHint={emptyHint}
        />
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
  const hasSavedTravel = !!member.travel_mode || !!member.departure_mode;

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
