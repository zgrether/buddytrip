"use client";

import { useMemo, useState, type CSSProperties, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Avatar } from "@/components/Avatar";
import {
  X,
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  MapPin,
  Calendar as CalendarIcon,
  UserPlus,
  MessageCircle,
  Trash2,
  AlertTriangle,
  Trophy,
} from "lucide-react";
import { trpc } from "@/lib/trpc-client";
import { useModalBackButton } from "@/hooks/useModalBackButton";
import { ScrollLock } from "@/hooks/useScrollLock";
import { RoleBadge } from "@/components/RoleBadge";
import { formatDateRangeCompact, parseLocalDate } from "@/lib/dates";
import {
  addMonths,
  applyRangeClick,
  atNoon,
  isSameDay,
  isWithinRange,
  monthMatrix,
  nightsBetween,
  startOfMonth,
  type DateRange,
} from "@/lib/calendar";
import type { TripRole } from "@/server/middleware";
import type { TripData } from "@/app/trips/[tripId]/tabs/types";

// ── Trip settings (drill-in / master→detail) ──────────────────────────────
//
// Replaces the old inline-accordion modal. A fixed-width card with a stable
// height; the master menu lists setting rows, and tapping one slides to a
// focused detail screen (forward from the right, back from the left — skipped
// under prefers-reduced-motion via the .ts-slide-* classes in globals.css).
//
// Date polling is intentionally NOT here — it lives only in the setup guide.
// Trip dates is a plain date-setter (the same calendar recipe as the guide,
// with more room).

type View =
  | "menu"
  | "details"
  | "dates"
  | "transfer"
  | "clear-crew"
  | "clear-org"
  | "delete";

const TITLES: Record<View, string> = {
  menu: "Trip settings",
  details: "Trip details",
  dates: "Trip dates",
  transfer: "Transfer ownership",
  "clear-crew": "Clear crew chat",
  "clear-org": "Clear organizer chat",
  delete: "Delete trip",
};

interface TripSettingsModalProps {
  tripId: string;
  tripName: string;
  trip?: TripData;
  onClose: () => void;
  viewerRole: TripRole;
}

// YYYY-MM-DD from local parts (a UTC-shifted toISOString could slip a day).
function localYMD(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function TripSettingsModal({
  tripId,
  tripName,
  trip,
  onClose,
  viewerRole,
}: TripSettingsModalProps) {
  const router = useRouter();
  const utils = trpc.useUtils();
  useModalBackButton(onClose);

  const isOwner = viewerRole === "Owner";
  const canEditPlan = viewerRole === "Owner" || viewerRole === "Organizer";

  // Competition existence drives the owner's "Enable competition" entry — the
  // permanent creation/recovery path now that the enable card (the proactive
  // prompt) can be dismissed. Deduped with the trip page's own query.
  const { data: competition } = trpc.competitions.getByTrip.useQuery({ tripId });

  // ── Navigation ────────────────────────────────────────────────────────
  const [view, setView] = useState<View>("menu");
  const [dir, setDir] = useState<"right" | "left">("right");
  const go = (v: View) => {
    setDir("right");
    setView(v);
  };
  const back = () => {
    setDir("left");
    setView("menu");
  };

  // ── Current values ──────────────────────────────────────────────────────
  const currentDestination =
    trip?.locked_destination_location ?? trip?.locked_destination_title ?? "";
  const dateRangeLabel = formatDateRangeCompact(
    trip?.start_date ?? null,
    trip?.end_date ?? null,
  );
  const tripNights =
    trip?.start_date && trip?.end_date
      ? nightsBetween(parseLocalDate(trip.start_date), parseLocalDate(trip.end_date))
      : null;

  // ── Detail-screen drafts ──────────────────────────────────────────────
  const [nameDraft, setNameDraft] = useState(tripName);
  const [destDraft, setDestDraft] = useState(currentDestination);
  const [datesRange, setDatesRange] = useState<DateRange>({
    start: trip?.start_date ? parseLocalDate(trip.start_date) : null,
    end: trip?.end_date ? parseLocalDate(trip.end_date) : null,
  });
  const [selectedNewOwner, setSelectedNewOwner] = useState<string | null>(null);

  const openDetails = () => {
    setNameDraft(tripName);
    setDestDraft(currentDestination);
    go("details");
  };
  const openDates = () => {
    setDatesRange({
      start: trip?.start_date ? parseLocalDate(trip.start_date) : null,
      end: trip?.end_date ? parseLocalDate(trip.end_date) : null,
    });
    setDir("right");
    setView("dates");
  };
  const openTransfer = () => {
    setSelectedNewOwner(null);
    go("transfer");
  };

  // ── Mutations ─────────────────────────────────────────────────────────
  const renameMutation = trpc.trips.renameTripName.useMutation();
  const changeDestinationMutation = trpc.trips.changeDestination.useMutation();
  const lockDatesMutation = trpc.trips.lockDates.useMutation();
  // Clear dates → null start/end (and drop the now-empty date_window). This is
  // the plain "reset dates" mechanism; it doesn't reopen a poll or surface any
  // poll UI.
  const clearDatesMutation = trpc.datePoll.unlock.useMutation({
    onSuccess: () => {
      utils.trips.getById.invalidate({ tripId });
      utils.trips.list.invalidate();
      utils.datePoll.get.invalidate({ tripId });
      setDatesRange({ start: null, end: null });
    },
  });

  const { data: members = [] } = trpc.tripMembers.list.useQuery(
    { tripId },
    { enabled: view === "transfer" },
  );
  const transferCandidates = members.filter(
    (m) => m.role !== "Owner" && !m.isGuest && m.status === "in",
  );

  const transferMutation = trpc.trips.transferOwnership.useMutation({
    onSuccess: () => {
      utils.trips.getById.invalidate({ tripId });
      utils.tripMembers.list.invalidate({ tripId });
      onClose();
    },
  });

  const clearChatMutation = trpc.messages.clearChannel.useMutation({
    onSuccess: (_, variables) => {
      utils.messages.list.invalidate({
        tripId,
        channel: "trip",
        visibility: variables.visibility,
      });
      back();
    },
  });

  const deleteMutation = trpc.trips.delete.useMutation({
    onSuccess: () => {
      // Drop the trip from the dashboard list cache immediately (no stale
      // flash), then invalidate. Clear the "last trip" pointer so the root
      // route won't 307 back to the now-deleted trip.
      utils.trips.list.setData(undefined, (old) =>
        old ? old.filter((t) => t.id !== tripId) : old,
      );
      utils.trips.list.invalidate();
      utils.trips.getById.invalidate({ tripId });
      if (
        typeof window !== "undefined" &&
        window.localStorage.getItem("bt-last-trip-id") === tripId
      ) {
        window.localStorage.removeItem("bt-last-trip-id");
        document.cookie = "bt-last-trip-id=; Max-Age=0; Path=/; SameSite=Lax";
      }
      router.push("/dashboard");
    },
  });

  // ── Derived: dirty / validity ─────────────────────────────────────────
  const nameChanged = nameDraft.trim().length > 0 && nameDraft.trim() !== tripName;
  const destChanged =
    destDraft.trim().length > 0 && destDraft.trim() !== currentDestination;
  const detailsDirty = nameChanged || destChanged;
  const detailsPending =
    renameMutation.isPending || changeDestinationMutation.isPending;

  const datesValid = !!(datesRange.start && datesRange.end);
  const datesChanged =
    datesValid &&
    (localYMD(datesRange.start!) !== (trip?.start_date ?? "") ||
      localYMD(datesRange.end!) !== (trip?.end_date ?? ""));

  const saveDetails = async () => {
    if (!detailsDirty || detailsPending) return;
    try {
      const tasks: Promise<unknown>[] = [];
      if (nameChanged)
        tasks.push(renameMutation.mutateAsync({ tripId, name: nameDraft.trim() }));
      if (destChanged)
        tasks.push(
          changeDestinationMutation.mutateAsync({
            tripId,
            destination: destDraft.trim(),
          }),
        );
      await Promise.all(tasks);
      utils.trips.getById.invalidate({ tripId });
      utils.trips.list.invalidate();
      utils.datePoll.get.invalidate({ tripId });
      back();
    } catch {
      // mutation errors surface via isError; leave the screen open to retry.
    }
  };

  const saveDates = () => {
    if (!datesValid || lockDatesMutation.isPending) return;
    lockDatesMutation.mutate(
      {
        tripId,
        startDate: localYMD(datesRange.start!),
        endDate: localYMD(datesRange.end!),
      },
      {
        onSuccess: () => {
          utils.trips.getById.invalidate({ tripId });
          utils.trips.list.invalidate();
          utils.datePoll.get.invalidate({ tripId });
          back();
        },
      },
    );
  };

  const isMenu = view === "menu";
  const slideClass = dir === "right" ? "ts-slide-right" : "ts-slide-left";
  // Footer (right-aligned Cancel + primary, divider above) for the editable
  // detail screens. Confirm screens keep their own centered destructive layout.
  const showFooter =
    view === "details" || view === "dates" || view === "transfer";

  return (
    <ScrollLock>
      <div
        className="fixed inset-0 z-50 flex items-center justify-center p-4"
        style={{ background: "var(--color-bt-overlay)" }}
        onClick={onClose}
      >
        <div
          className="flex w-full max-w-[400px] flex-col rounded-2xl"
          style={{
            background: "var(--color-bt-card-float)",
            border: "1px solid var(--color-bt-border)",
            boxShadow: "var(--shadow-floating, 0 24px 60px rgba(0,0,0,0.45))",
            minHeight: 320,
            maxHeight: "85vh",
            overflow: "hidden",
          }}
          onClick={(e) => e.stopPropagation()}
        >
          {/* ── Header ───────────────────────────────────────────────── */}
          <div
            className="flex items-center gap-2.5 px-4 pb-3 pt-4"
            style={{ borderBottom: "1px solid var(--color-bt-subtle-border)" }}
          >
            {!isMenu && (
              <button
                onClick={back}
                aria-label="Back"
                className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full transition-colors hover:bg-[var(--color-bt-hover)]"
                style={{
                  background: "var(--color-bt-card-raised)",
                  color: "var(--color-bt-text)",
                }}
              >
                <ArrowLeft size={16} />
              </button>
            )}
            <span
              className="min-w-0 flex-1 truncate text-base font-bold"
              style={{ color: "var(--color-bt-text)" }}
            >
              {TITLES[view]}
            </span>
            <button
              onClick={onClose}
              aria-label="Close"
              data-testid="settings-close-btn"
              className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full transition-colors hover:bg-[var(--color-bt-hover)]"
              style={{
                background: "var(--color-bt-card-raised)",
                color: "var(--color-bt-text-dim)",
              }}
            >
              <X size={15} />
            </button>
          </div>

          {/* ── Sliding viewport ─────────────────────────────────────── */}
          {/* overflow-x-hidden clips the slide-in transform (translateX 28px)
              so it doesn't briefly widen the page / flash a horizontal
              scrollbar; overflow-y-auto still scrolls tall detail screens. */}
          <div className="relative flex-1 overflow-x-hidden overflow-y-auto">
            <div key={view} className={`p-4 ${slideClass}`}>
              {/* ── Menu ──────────────────────────────────────────── */}
              {view === "menu" && (
                <>
                  {canEditPlan && (
                    <Section label="Trip plan">
                      <Row
                        testId="settings-details-row"
                        icon={<MapPin size={17} />}
                        title="Trip details"
                        subtitle={[tripName, currentDestination, dateRangeLabel]
                          .filter(Boolean)
                          .join(" · ")}
                        onClick={openDetails}
                      />
                    </Section>
                  )}

                  {isOwner && (
                    <Section label="Competition">
                      <Row
                        testId="settings-competition-row"
                        icon={<Trophy size={17} />}
                        title={competition ? "Competition" : "Enable competition"}
                        subtitle={
                          competition
                            ? "Open the Live face to manage it"
                            : "Teams, games, and a live leaderboard"
                        }
                        onClick={() => {
                          // Same entry the enable card uses — the face hosts the
                          // create flow (and the management surface once it
                          // exists). One creation path, two entry points.
                          // Navigate WITHOUT onClose() — the navigation unmounts
                          // the modal, and (like the delete-trip row) skipping
                          // onClose avoids useModalBackButton's cleanup
                          // history.back() racing/cancelling the push.
                          router.push(`/trips/${tripId}/leaderboard`);
                        }}
                      />
                    </Section>
                  )}

                  {isOwner && (
                    <Section label="Trip management">
                      <Row
                        testId="settings-transfer-row"
                        icon={<UserPlus size={17} />}
                        title="Transfer ownership"
                        subtitle="Pass owner role to a crew member"
                        onClick={openTransfer}
                      />
                    </Section>
                  )}

                  {isOwner && (
                    <Section label="Danger zone" danger>
                      <Row
                        danger
                        testId="settings-clear-crew-row"
                        icon={<MessageCircle size={16} />}
                        title="Clear crew chat"
                        subtitle="Deletes all Crew messages"
                        onClick={() => go("clear-crew")}
                      />
                      <Row
                        danger
                        testId="settings-clear-org-row"
                        icon={<MessageCircle size={16} />}
                        title="Clear organizer chat"
                        subtitle="Deletes all Organizer messages"
                        onClick={() => go("clear-org")}
                      />
                      <Row
                        danger
                        testId="settings-delete-row"
                        icon={<Trash2 size={16} />}
                        title="Delete trip"
                        subtitle="Removes all data for everyone"
                        onClick={() => go("delete")}
                      />
                    </Section>
                  )}
                </>
              )}

              {/* ── Trip details ──────────────────────────────────── */}
              {view === "details" && (
                <>
                  <FieldLabel>Trip name</FieldLabel>
                  <input
                    data-testid="settings-trip-name"
                    value={nameDraft}
                    onChange={(e) => setNameDraft(e.target.value)}
                    className="ts-field"
                    style={fieldStyle}
                  />
                  <div className="h-3.5" />
                  <FieldLabel>Destination</FieldLabel>
                  <input
                    data-testid="settings-destination-input"
                    value={destDraft}
                    onChange={(e) => setDestDraft(e.target.value)}
                    placeholder="Where to?"
                    className="ts-field"
                    style={fieldStyle}
                  />
                  <div className="h-3.5" />
                  <FieldLabel>Dates</FieldLabel>
                  <div className="flex items-center gap-2">
                    <button
                      data-testid="settings-dates-chip"
                      onClick={openDates}
                      className="flex flex-1 items-center gap-2.5 rounded-[10px] px-3 py-2.5"
                      style={{
                        background: "var(--color-bt-card-raised)",
                        border: "1px solid var(--color-bt-border)",
                      }}
                    >
                      <CalendarIcon size={15} style={{ color: "var(--color-bt-accent)" }} />
                      <span
                        className="flex-1 text-left text-sm font-semibold"
                        style={{ color: "var(--color-bt-text)" }}
                      >
                        {dateRangeLabel || "Set dates"}
                      </span>
                      {tripNights != null && (
                        <span
                          className="rounded-full px-2 py-0.5 font-mono text-[11px]"
                          style={{
                            color: "var(--color-bt-accent)",
                            background: "var(--color-bt-accent-faint)",
                          }}
                        >
                          {tripNights} {tripNights === 1 ? "night" : "nights"}
                        </span>
                      )}
                      <ChevronRight size={15} style={{ color: "var(--color-bt-text-dim)" }} />
                    </button>
                    {!!(trip?.start_date && trip?.end_date) && (
                      <button
                        data-testid="settings-clear-dates-btn"
                        onClick={() => clearDatesMutation.mutate({ tripId })}
                        disabled={clearDatesMutation.isPending}
                        className="flex-shrink-0 rounded-[10px] px-3 py-2.5 text-sm font-semibold disabled:opacity-50"
                        style={{
                          background: "transparent",
                          border: "1px solid var(--color-bt-border)",
                          color: "var(--color-bt-text-dim)",
                        }}
                      >
                        {clearDatesMutation.isPending ? "…" : "Clear"}
                      </button>
                    )}
                  </div>

                  {destChanged && (
                    <div
                      className="mt-3.5 flex items-start gap-2.5 rounded-[10px] px-3 py-2.5"
                      style={{
                        background: "var(--color-bt-warning-faint)",
                        border: "1px solid var(--color-bt-warning-border)",
                      }}
                    >
                      <AlertTriangle
                        size={16}
                        className="flex-shrink-0"
                        style={{ color: "var(--color-bt-owner)" }}
                      />
                      <span
                        className="text-xs leading-snug"
                        style={{ color: "var(--color-bt-text)" }}
                      >
                        Changing the destination or dates will reset any date-poll
                        responses.
                      </span>
                    </div>
                  )}

                </>
              )}

              {/* ── Trip dates ────────────────────────────────────── */}
              {view === "dates" && (
                <RangeCalendar value={datesRange} onChange={setDatesRange} />
              )}

              {/* ── Transfer ownership ────────────────────────────── */}
              {view === "transfer" && (
                <>
                  <FieldLabel>Choose the new owner</FieldLabel>
                  {transferCandidates.length === 0 ? (
                    <p
                      className="px-1 py-3 text-sm"
                      style={{ color: "var(--color-bt-text-dim)" }}
                    >
                      No eligible crew members yet.
                    </p>
                  ) : (
                    transferCandidates.map((m) => {
                      const sel = selectedNewOwner === m.user_id;
                      return (
                        <button
                          key={m.user_id}
                          onClick={() => setSelectedNewOwner(m.user_id)}
                          className="mb-2 flex w-full items-center gap-3 rounded-[10px] px-3 py-2.5"
                          style={{
                            background: sel
                              ? "var(--color-bt-accent-faint)"
                              : "var(--color-bt-card)",
                            border: `1px solid ${
                              sel ? "var(--color-bt-accent)" : "var(--color-bt-border)"
                            }`,
                          }}
                        >
                          <Avatar
                            name={m.displayName ?? "?"}
                            avatarIcon={m.user?.avatar_icon ?? null}
                            size="md"
                          />
                          <span
                            className="min-w-0 flex-1 text-left text-sm font-semibold"
                            style={{ color: "var(--color-bt-text)" }}
                          >
                            {m.displayName}
                          </span>
                          <RoleBadge role={m.role as TripRole} />
                          <span
                            className="flex h-[18px] w-[18px] flex-shrink-0 items-center justify-center rounded-full border-2"
                            style={{
                              borderColor: sel
                                ? "var(--color-bt-accent)"
                                : "var(--color-bt-border)",
                            }}
                          >
                            {sel && (
                              <span
                                className="h-2.5 w-2.5 rounded-full"
                                style={{ background: "var(--color-bt-accent)" }}
                              />
                            )}
                          </span>
                        </button>
                      );
                    })
                  )}
                </>
              )}

              {/* ── Destructive confirm screens ───────────────────── */}
              {(view === "clear-crew" ||
                view === "clear-org" ||
                view === "delete") && (
                <ConfirmScreen
                  view={view}
                  pending={
                    view === "delete"
                      ? deleteMutation.isPending
                      : clearChatMutation.isPending
                  }
                  onConfirm={() => {
                    if (view === "delete") deleteMutation.mutate({ tripId });
                    else
                      clearChatMutation.mutate({
                        tripId,
                        visibility: view === "clear-crew" ? "crew" : "planning",
                      });
                  }}
                  onCancel={back}
                />
              )}
            </div>
          </div>

          {/* ── Footer — right-aligned Cancel + primary, divider above.
              Confirm screens keep their own centered destructive buttons. */}
          {showFooter && (
            <div
              className="flex items-center gap-2 px-4 py-3"
              style={{ borderTop: "1px solid var(--color-bt-subtle-border)" }}
            >
              <div className="flex-1" />
              <button
                onClick={back}
                className="rounded-lg px-3 py-1.5 text-sm transition-colors hover:bg-[var(--color-bt-hover)]"
                style={{ color: "var(--color-bt-text-dim)" }}
              >
                Cancel
              </button>
              {view === "details" && (
                <button
                  data-testid="settings-save-details-btn"
                  disabled={!detailsDirty || detailsPending}
                  onClick={saveDetails}
                  className="rounded-lg px-3.5 py-1.5 text-sm font-semibold transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
                  style={{ background: "var(--color-bt-accent)", color: "var(--color-bt-on-accent)" }}
                >
                  {detailsPending ? "Saving…" : "Save changes"}
                </button>
              )}
              {view === "dates" && (
                <button
                  data-testid="settings-set-dates-btn"
                  disabled={!datesValid || !datesChanged || lockDatesMutation.isPending}
                  onClick={saveDates}
                  className="rounded-lg px-3.5 py-1.5 text-sm font-semibold transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
                  style={{ background: "var(--color-bt-accent)", color: "var(--color-bt-on-accent)" }}
                >
                  {lockDatesMutation.isPending ? "Saving…" : "Set dates"}
                </button>
              )}
              {view === "transfer" && (
                <button
                  data-testid="settings-confirm-transfer-btn"
                  disabled={!selectedNewOwner || transferMutation.isPending}
                  onClick={() =>
                    selectedNewOwner &&
                    transferMutation.mutate({ tripId, newOwnerId: selectedNewOwner })
                  }
                  className="rounded-lg px-3.5 py-1.5 text-sm font-semibold transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
                  style={{ background: "var(--color-bt-accent)", color: "var(--color-bt-on-accent)" }}
                >
                  {transferMutation.isPending ? "Transferring…" : "Transfer"}
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </ScrollLock>
  );
}

// ── Inline range calendar ─────────────────────────────────────────────────
// Same round-cap / continuous-fill recipe as DatesSheet / the setup guide,
// at full (36px) size with day numbers optically centered (leading-none).

const ROW_H = 36;
const CAP_PX = 30;
const WEEKDAYS = ["S", "M", "T", "W", "T", "F", "S"];

function RangeCalendar({
  value,
  onChange,
}: {
  value: DateRange;
  onChange: (r: DateRange) => void;
}) {
  const today = useMemo(() => atNoon(new Date()), []);
  const [viewMonth, setViewMonth] = useState<Date>(() =>
    startOfMonth(value.start ?? value.end ?? today),
  );
  const matrix = useMemo(() => monthMatrix(viewMonth), [viewMonth]);
  const accent = "var(--color-bt-accent)";
  const accentFaint = "var(--color-bt-accent-faint)";

  const monthLabel = viewMonth.toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
  });

  return (
    <div>
      {/* Month header + nav */}
      <div className="mb-2 flex items-center justify-between">
        <button
          aria-label="Previous month"
          onClick={() => setViewMonth((m) => addMonths(m, -1))}
          className="flex h-7 w-7 items-center justify-center rounded-lg"
          style={{ color: "var(--color-bt-text-dim)" }}
        >
          <ChevronLeft size={16} />
        </button>
        <span
          className="text-sm font-semibold"
          style={{ color: "var(--color-bt-text)" }}
        >
          {monthLabel}
        </span>
        <button
          aria-label="Next month"
          onClick={() => setViewMonth((m) => addMonths(m, 1))}
          className="flex h-7 w-7 items-center justify-center rounded-lg"
          style={{ color: "var(--color-bt-text-dim)" }}
        >
          <ChevronRight size={16} />
        </button>
      </div>

      {/* Weekday row */}
      <div className="grid grid-cols-7">
        {WEEKDAYS.map((w, i) => (
          <div
            key={i}
            className="flex h-6 items-center justify-center text-[10px] font-semibold uppercase"
            style={{ color: "var(--color-bt-text-dim)" }}
          >
            {w}
          </div>
        ))}
      </div>

      {/* Day grid */}
      <div className="grid grid-cols-7">
        {matrix.flat().map((day, idx) => {
          const inMonth = day.getMonth() === viewMonth.getMonth();
          const isStart = isSameDay(day, value.start);
          const isEnd = isSameDay(day, value.end);
          const isCap = isStart || isEnd;
          const between = isWithinRange(day, value);
          const hasEnd = !!value.end;
          const showFill = between || (isStart && hasEnd) || isEnd;
          return (
            <div
              key={idx}
              className="relative flex items-center justify-center"
              style={{ height: ROW_H }}
            >
              {showFill && (
                <div
                  className="absolute inset-y-1"
                  style={{
                    left: isStart ? "50%" : 0,
                    right: isEnd ? "50%" : 0,
                    background: accentFaint,
                  }}
                />
              )}
              <button
                type="button"
                onClick={() => onChange(applyRangeClick(value, day))}
                className="relative mx-auto flex items-center justify-center rounded-full text-[13px] leading-none transition-colors"
                style={{
                  width: CAP_PX,
                  height: CAP_PX,
                  background: isCap ? accent : "transparent",
                  color: isCap
                    ? "var(--color-bt-on-accent)"
                    : inMonth
                      ? "var(--color-bt-text)"
                      : "var(--color-bt-text-dim)",
                  fontWeight: isCap ? 700 : 400,
                  opacity: inMonth ? 1 : 0.45,
                }}
                data-testid={`settings-day-${day.toISOString().slice(0, 10)}`}
              >
                {day.getDate()}
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Confirm screen (clear crew / clear org / delete) ──────────────────────
function ConfirmScreen({
  view,
  pending,
  onConfirm,
  onCancel,
}: {
  view: "clear-crew" | "clear-org" | "delete";
  pending: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const isDelete = view === "delete";
  const title = isDelete
    ? "Delete this trip?"
    : view === "clear-crew"
      ? "Clear crew chat?"
      : "Clear organizer chat?";
  const body = isDelete
    ? "This removes all data for everyone — itinerary, lodging, receipts, chat. This can't be undone."
    : `This permanently deletes all ${
        view === "clear-crew" ? "Crew" : "Organizer"
      } messages for everyone. This can't be undone.`;
  const confirmLabel = isDelete ? "Delete trip" : "Clear chat";

  return (
    <>
      <div
        className="mx-auto mb-3.5 mt-1 flex h-12 w-12 items-center justify-center rounded-[13px]"
        style={{ background: "var(--color-bt-danger-faint)", color: "var(--color-bt-danger)" }}
      >
        {isDelete ? <Trash2 size={22} /> : <MessageCircle size={22} />}
      </div>
      <p
        className="text-center text-base font-bold"
        style={{ color: "var(--color-bt-text)" }}
      >
        {title}
      </p>
      <p
        className="mb-[18px] mt-[7px] text-center text-[13px] leading-relaxed"
        style={{ color: "var(--color-bt-text-dim)" }}
      >
        {body}
      </p>
      <button
        data-testid={`settings-confirm-${view}-btn`}
        disabled={pending}
        onClick={onConfirm}
        className="mb-2 w-full rounded-[10px] py-2.5 text-[13.5px] font-bold disabled:opacity-50"
        style={{ background: "var(--color-bt-danger)", color: "#fff" }}
      >
        {pending ? "Working…" : confirmLabel}
      </button>
      <GhostButton onClick={onCancel}>Cancel</GhostButton>
    </>
  );
}

// ── Small presentational helpers ──────────────────────────────────────────

const fieldStyle: CSSProperties = {
  width: "100%",
  boxSizing: "border-box",
  background: "var(--color-bt-card-raised)",
  border: "1px solid var(--color-bt-border)",
  borderRadius: 10,
  padding: "11px 13px",
  fontSize: 14,
  color: "var(--color-bt-text)",
  outline: "none",
};

function Section({
  label,
  danger,
  children,
}: {
  label: string;
  danger?: boolean;
  children: ReactNode;
}) {
  return (
    <div className="mb-4 last:mb-0">
      <p
        className="mb-2 px-0.5 text-[10px] font-bold uppercase"
        style={{
          letterSpacing: "0.09em",
          color: danger ? "var(--color-bt-danger)" : "var(--color-bt-text-dim)",
        }}
      >
        {label}
      </p>
      {children}
    </div>
  );
}

function Row({
  icon,
  title,
  subtitle,
  onClick,
  danger,
  testId,
}: {
  icon: ReactNode;
  title: string;
  subtitle: string;
  onClick: () => void;
  danger?: boolean;
  testId?: string;
}) {
  return (
    <button
      data-testid={testId}
      onClick={onClick}
      className="mb-2 flex w-full items-center gap-3 rounded-[11px] px-3 py-3 text-left transition-colors last:mb-0 hover:bg-[var(--color-bt-hover)]"
      style={{ background: "var(--color-bt-card)", border: "1px solid var(--color-bt-border)" }}
    >
      <span
        className="flex h-[34px] w-[34px] flex-shrink-0 items-center justify-center rounded-[9px]"
        style={{
          background: danger
            ? "var(--color-bt-danger-faint)"
            : "var(--color-bt-accent-faint)",
          color: danger ? "var(--color-bt-danger)" : "var(--color-bt-accent)",
        }}
      >
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <span
          className="block text-sm font-semibold"
          style={{ color: danger ? "var(--color-bt-danger)" : "var(--color-bt-text)" }}
        >
          {title}
        </span>
        {subtitle && (
          <span
            className="mt-0.5 block truncate text-xs"
            style={{ color: "var(--color-bt-text-dim)" }}
          >
            {subtitle}
          </span>
        )}
      </span>
      <ChevronRight
        size={17}
        className="flex-shrink-0"
        style={{ color: "var(--color-bt-text-dim)" }}
      />
    </button>
  );
}

function FieldLabel({ children }: { children: ReactNode }) {
  return (
    <p
      className="mb-1.5 text-[10px] font-bold uppercase"
      style={{ letterSpacing: "0.08em", color: "var(--color-bt-text-dim)" }}
    >
      {children}
    </p>
  );
}

function GhostButton({
  children,
  onClick,
}: {
  children: ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="w-full rounded-[10px] py-2.5 text-[13.5px] font-semibold"
      style={{
        background: "transparent",
        border: "1px solid var(--color-bt-border)",
        color: "var(--color-bt-text)",
      }}
    >
      {children}
    </button>
  );
}
