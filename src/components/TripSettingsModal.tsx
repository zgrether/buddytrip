"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { UserAvatar } from "@/components/UserAvatar";
import {
  X,
  UserCheck,
  Trash2,
  ChevronRight,
  Lock,
  MapPin,
  Calendar,
} from "lucide-react";
import { trpc } from "@/lib/trpc-client";
import { useModalBackButton } from "@/hooks/useModalBackButton";
import { RoleBadge } from "@/components/RoleBadge";
import { formatDateRangeCompact } from "@/lib/dates";
import type { TripRole } from "@/server/middleware";
import type { TripData } from "@/app/trips/[tripId]/tabs/types";

interface TripSettingsModalProps {
  tripId: string;
  tripName: string;
  trip?: TripData;
  onClose: () => void;
  viewerRole: TripRole;
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
  const canEditName = viewerRole === "Owner" || viewerRole === "Planner";

  // ── Trip name state ──────────────────────────────────────────────────
  const [newName, setNewName] = useState(tripName);
  const [renameSuccess, setRenameSuccess] = useState(false);

  const renameMutation = trpc.trips.renameTripName.useMutation({
    onSuccess: () => {
      utils.trips.getById.invalidate({ tripId });
      utils.trips.list.invalidate();
      setRenameSuccess(true);
    },
  });

  useEffect(() => {
    if (!renameSuccess) return;
    const timer = setTimeout(() => setRenameSuccess(false), 2000);
    return () => clearTimeout(timer);
  }, [renameSuccess]);

  const nameChanged = newName.trim() !== tripName && newName.trim().length > 0;

  // ── Destination / Dates edit state ────────────────────────────────────
  const stage = trip?.stage ?? "idea";
  // Show the "Trip plan" section for any role-eligible user. Destination edits
  // live here in settings; dates are managed primarily from the header
  // DatesSheet but can also be cleared from this surface.
  const canEditPlan = viewerRole === "Owner" || viewerRole === "Planner";
  const destinationLocked = !!trip?.locked_destination_title;
  const datesLocked = !!(trip?.start_date && trip?.end_date);

  const [destExpanded, setDestExpanded] = useState(false);
  const [destDraft, setDestDraft] = useState(
    trip?.locked_destination_location ?? trip?.locked_destination_title ?? "",
  );
  const [datesExpanded, setDatesExpanded] = useState(false);
  const [startDraft, setStartDraft] = useState(trip?.start_date ?? "");
  const [endDraft, setEndDraft] = useState(trip?.end_date ?? "");

  // Lazy-fetch poll data when the dates section is open so we know whether
  // there are existing windows to return to.
  const { data: pollData } = trpc.datePoll.get.useQuery(
    { tripId },
    { enabled: datesExpanded && isOwner && datesLocked }
  );
  const hasPollWindows = (pollData?.windows.length ?? 0) > 0;

  const changeDestinationMutation = trpc.trips.changeDestination.useMutation({
    onSuccess: () => {
      utils.trips.getById.invalidate({ tripId });
      utils.trips.list.invalidate();
      utils.datePoll.get.invalidate({ tripId });
      setDestExpanded(false);
    },
  });

  const lockDatesMutation = trpc.trips.lockDates.useMutation({
    onSuccess: () => {
      utils.trips.getById.invalidate({ tripId });
      utils.datePoll.get.invalidate({ tripId });
      setDatesExpanded(false);
    },
  });

  const unlockDatesMutation = trpc.datePoll.unlock.useMutation({
    onSuccess: () => {
      utils.trips.getById.invalidate({ tripId });
      utils.datePoll.get.invalidate({ tripId });
      setDatesExpanded(false);
    },
  });

  // Return-to-poll: clears trip dates, flips poll_mode back on, and
  // reopens the poll row — all in one server call that preserves every
  // existing window (including the formerly-locked one) and every vote.
  const returnToPollMutation = trpc.datePoll.returnToPoll.useMutation({
    onSuccess: () => {
      utils.trips.getById.invalidate({ tripId });
      utils.datePoll.get.invalidate({ tripId });
      setDatesExpanded(false);
      onClose();
    },
  });

  const returnToPollPending = returnToPollMutation.isPending;

  const handleReturnToPoll = () => {
    returnToPollMutation.mutate({ tripId });
  };

  const canSaveDest =
    destDraft.trim().length > 0 &&
    destDraft.trim() !==
      (trip?.locked_destination_location ?? trip?.locked_destination_title ?? "") &&
    !changeDestinationMutation.isPending;

  const canSaveDates =
    !!startDraft &&
    !!endDraft &&
    startDraft < endDraft &&
    (startDraft !== (trip?.start_date ?? "") || endDraft !== (trip?.end_date ?? "")) &&
    !lockDatesMutation.isPending;

  // ── Transfer ownership state ─────────────────────────────────────────
  const [transferExpanded, setTransferExpanded] = useState(false);
  const [selectedNewOwner, setSelectedNewOwner] = useState<string | null>(null);

  const { data: members = [] } = trpc.tripMembers.list.useQuery(
    { tripId },
    { enabled: transferExpanded }
  );

  // Filter to active non-owner, non-guest members for transfer
  const transferCandidates = members.filter(
    (m) => m.role !== "Owner" && !m.isGuest && m.status === "in"
  );

  const transferMutation = trpc.trips.transferOwnership.useMutation({
    onSuccess: () => {
      utils.trips.getById.invalidate({ tripId });
      utils.tripMembers.list.invalidate({ tripId });
      onClose();
    },
  });

  const selectedMemberName = transferCandidates.find(
    (m) => m.user_id === selectedNewOwner
  )?.displayName;

  // ── Delete trip state ────────────────────────────────────────────────
  const [deleteConfirming, setDeleteConfirming] = useState(false);

  const deleteMutation = trpc.trips.delete.useMutation({
    onSuccess: () => router.push("/dashboard"),
  });

  // ── Render ───────────────────────────────────────────────────────────
  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center lg:items-center"
      style={{ background: "var(--color-bt-overlay)" }}
      onClick={onClose}
    >
      <div
        className="w-full max-w-[480px] max-h-[85vh] overflow-y-auto rounded-t-2xl p-5 lg:rounded-2xl"
        style={{ background: "var(--color-bt-card)", border: "1px solid var(--color-bt-border)" }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* ── Header ────────────────────────────────────────────────── */}
        <div className="mb-4 flex items-center justify-between">
          <h2
            className="text-base font-medium"
            style={{ color: "var(--color-bt-text)" }}
          >
            Trip settings
          </h2>
          <button
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-full"
            style={{ background: "var(--color-bt-card-raised)", color: "var(--color-bt-text-dim)" }}
          >
            <X size={18} />
          </button>
        </div>

        {/* ── Section 1: Trip name (owner + planner) ────────────────── */}
        {canEditName && (
          <>
            <div className="space-y-2">
              <label
                className="text-xs font-medium"
                style={{ color: "var(--color-bt-text-dim)" }}
              >
                Trip name
              </label>
              <input
                data-testid="settings-trip-name"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                className="w-full rounded-xl border px-3 py-2.5 text-sm outline-none"
                style={{
                  background: "var(--color-bt-card-raised)",
                  borderColor: "var(--color-bt-border)",
                  color: "var(--color-bt-text)",
                }}
              />
              <button
                data-testid="settings-rename-btn"
                disabled={!nameChanged || renameMutation.isPending}
                onClick={() =>
                  renameMutation.mutate({ tripId, name: newName.trim() })
                }
                className="w-full rounded-xl py-2.5 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-40"
                style={{
                  background: "var(--color-bt-accent)",
                  color: "var(--color-bt-base)",
                }}
              >
                {renameMutation.isPending ? "Saving…" : "Rename"}
              </button>
              {renameSuccess && (
                <p className="text-center text-xs" style={{ color: "var(--color-bt-accent)" }}>
                  Renamed!
                </p>
              )}
            </div>

            {/* Divider */}
            <div
              className="my-4"
              style={{ height: 1, background: "var(--color-bt-border)" }}
            />
          </>
        )}

        {/* ── Section: Trip plan ──────────────────────────────────────── */}
        {/* Surfaces here once dates or destination are locked, regardless of
            stage — the header DatesSheet is the primary entry point for dates,
            this is the back-stop "clear / return to poll" surface. */}
        {canEditPlan && (destinationLocked || datesLocked) && (
          <>
            <p
              className="mb-3 text-[11px] font-medium uppercase tracking-wider"
              style={{ color: "var(--color-bt-text-dim)", letterSpacing: "0.08em" }}
            >
              Trip plan
            </p>

            <div className="mb-4 space-y-2">
              {/* Change destination */}
              {destinationLocked && (
                <div>
                  <button
                    data-testid="settings-change-destination-btn"
                    onClick={() => {
                      setDestExpanded(!destExpanded);
                      setDatesExpanded(false);
                      setTransferExpanded(false);
                      setDestDraft(trip?.locked_destination_location ?? trip?.locked_destination_title ?? "");
                    }}
                    className="flex w-full items-center gap-3 rounded-xl border px-3 py-2.5"
                    style={{
                      background: "var(--color-bt-card-raised)",
                      borderColor: "var(--color-bt-border)",
                    }}
                  >
                    <div
                      className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg"
                      style={{ background: "rgba(45,212,191,0.12)" }}
                    >
                      <MapPin size={16} style={{ color: "var(--color-bt-accent)" }} />
                    </div>
                    <div className="min-w-0 flex-1 text-left">
                      <p className="text-sm" style={{ color: "var(--color-bt-text)" }}>
                        Change destination
                      </p>
                      <p className="truncate text-xs" style={{ color: "var(--color-bt-text-dim)" }}>
                        {trip?.locked_destination_location ?? trip?.locked_destination_title}
                      </p>
                    </div>
                    <ChevronRight
                      size={16}
                      style={{
                        color: "var(--color-bt-text-dim)",
                        transform: destExpanded ? "rotate(90deg)" : undefined,
                        transition: "transform 150ms",
                      }}
                    />
                  </button>

                  {destExpanded && (
                    <div
                      className="mt-2 space-y-2 rounded-xl border p-3"
                      style={{ borderColor: "var(--color-bt-border)" }}
                    >
                      <div
                        className="flex items-start gap-2 rounded-lg px-3 py-2"
                        style={{ background: "var(--color-bt-warning-bg, rgba(217,119,6,0.1))" }}
                      >
                        <span style={{ color: "var(--color-bt-warning)" }}>⚠</span>
                        <p className="text-xs" style={{ color: "var(--color-bt-warning)" }}>
                          Changing the destination will reset any date poll responses.
                        </p>
                      </div>
                      <input
                        data-testid="settings-destination-input"
                        value={destDraft}
                        onChange={(e) => setDestDraft(e.target.value)}
                        placeholder="New destination"
                        className="w-full rounded-xl border px-3 py-2.5 text-sm outline-none"
                        style={{
                          background: "var(--color-bt-card-raised)",
                          borderColor: "var(--color-bt-border)",
                          color: "var(--color-bt-text)",
                        }}
                      />
                      <button
                        data-testid="settings-save-destination-btn"
                        disabled={!canSaveDest}
                        onClick={() =>
                          changeDestinationMutation.mutate({
                            tripId,
                            destination: destDraft.trim(),
                          })
                        }
                        className="w-full rounded-xl py-2.5 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-40"
                        style={{
                          background: "var(--color-bt-accent)",
                          color: "var(--color-bt-base)",
                        }}
                      >
                        {changeDestinationMutation.isPending ? "Updating…" : "Update destination"}
                      </button>
                      <button
                        onClick={() => setDestExpanded(false)}
                        className="w-full rounded-xl border py-2 text-sm"
                        style={{
                          borderColor: "var(--color-bt-border)",
                          color: "var(--color-bt-text-dim)",
                        }}
                      >
                        Cancel
                      </button>
                    </div>
                  )}
                </div>
              )}

              {/* Change dates */}
              {datesLocked && (
                <div>
                  <button
                    data-testid="settings-change-dates-btn"
                    onClick={() => {
                      setDatesExpanded(!datesExpanded);
                      setDestExpanded(false);
                      setTransferExpanded(false);
                      setStartDraft(trip?.start_date ?? "");
                      setEndDraft(trip?.end_date ?? "");
                    }}
                    className="flex w-full items-center gap-3 rounded-xl border px-3 py-2.5"
                    style={{
                      background: "var(--color-bt-card-raised)",
                      borderColor: "var(--color-bt-border)",
                    }}
                  >
                    <div
                      className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg"
                      style={{ background: "rgba(96,165,250,0.12)" }}
                    >
                      <Calendar size={16} style={{ color: "#60a5fa" }} />
                    </div>
                    <div className="min-w-0 flex-1 text-left">
                      <p className="text-sm" style={{ color: "var(--color-bt-text)" }}>
                        Change dates
                      </p>
                      <p className="truncate text-xs" style={{ color: "var(--color-bt-text-dim)" }}>
                        {formatDateRangeCompact(trip?.start_date ?? null, trip?.end_date ?? null)}
                      </p>
                    </div>
                    <ChevronRight
                      size={16}
                      style={{
                        color: "var(--color-bt-text-dim)",
                        transform: datesExpanded ? "rotate(90deg)" : undefined,
                        transition: "transform 150ms",
                      }}
                    />
                  </button>

                  {datesExpanded && (
                    <div
                      className="mt-2 space-y-2 rounded-xl border p-3"
                      style={{ borderColor: "var(--color-bt-border)" }}
                    >
                      <>
                          <div className="grid grid-cols-2 gap-2">
                            <div className="space-y-1">
                              <label
                                className="text-[11px] font-semibold uppercase tracking-wider"
                                style={{ color: "var(--color-bt-text-dim)" }}
                              >
                                Start date
                              </label>
                              <input
                                type="date"
                                data-testid="settings-start-date-input"
                                value={startDraft}
                                onChange={(e) => setStartDraft(e.target.value)}
                                className="w-full rounded-xl border px-3 py-2.5 text-sm outline-none"
                                style={{
                                  background: "var(--color-bt-card-raised)",
                                  borderColor: "var(--color-bt-border)",
                                  color: "var(--color-bt-text)",
                                }}
                              />
                            </div>
                            <div className="space-y-1">
                              <label
                                className="text-[11px] font-semibold uppercase tracking-wider"
                                style={{ color: "var(--color-bt-text-dim)" }}
                              >
                                End date
                              </label>
                              <input
                                type="date"
                                data-testid="settings-end-date-input"
                                value={endDraft}
                                onChange={(e) => setEndDraft(e.target.value)}
                                className="w-full rounded-xl border px-3 py-2.5 text-sm outline-none"
                                style={{
                                  background: "var(--color-bt-card-raised)",
                                  borderColor: "var(--color-bt-border)",
                                  color: "var(--color-bt-text)",
                                }}
                              />
                            </div>
                          </div>
                          <button
                            data-testid="settings-save-dates-btn"
                            disabled={!canSaveDates}
                            onClick={() =>
                              lockDatesMutation.mutate({
                                tripId,
                                startDate: startDraft,
                                endDate: endDraft,
                              })
                            }
                            className="w-full rounded-xl py-2.5 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-40"
                            style={{
                              background: "var(--color-bt-accent)",
                              color: "var(--color-bt-base)",
                            }}
                          >
                            {lockDatesMutation.isPending ? "Updating…" : "Update dates"}
                          </button>
                          {hasPollWindows && (
                            <button
                              data-testid="settings-reopen-poll-btn"
                              disabled={returnToPollPending || lockDatesMutation.isPending}
                              onClick={handleReturnToPoll}
                              className="w-full rounded-xl border py-2 text-sm font-medium transition-opacity disabled:opacity-40"
                              style={{
                                borderColor: "var(--color-bt-accent-border)",
                                color: "var(--color-bt-accent)",
                              }}
                            >
                              {returnToPollPending ? "Reopening…" : "Reopen poll"}
                            </button>
                          )}
                          <button
                            data-testid="settings-clear-dates-btn"
                            disabled={unlockDatesMutation.isPending || lockDatesMutation.isPending || returnToPollMutation.isPending}
                            onClick={() => unlockDatesMutation.mutate({ tripId })}
                            className="w-full rounded-xl border py-2 text-sm font-medium transition-opacity disabled:opacity-40"
                            style={{
                              borderColor: "var(--color-bt-danger-border)",
                              color: "var(--color-bt-danger)",
                            }}
                          >
                            {unlockDatesMutation.isPending ? "Clearing…" : "Clear dates"}
                          </button>
                      </>
                      <button
                        onClick={() => setDatesExpanded(false)}
                        className="w-full rounded-xl border py-2 text-sm"
                        style={{
                          borderColor: "var(--color-bt-border)",
                          color: "var(--color-bt-text-dim)",
                        }}
                      >
                        Cancel
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Divider */}
            <div
              className="mb-4"
              style={{ height: 1, background: "var(--color-bt-border)" }}
            />
          </>
        )}

        {/* ── Section 2: Trip management ─────────────────────────────── */}
        <p
          className="mb-3 text-[11px] font-medium uppercase tracking-wider"
          style={{ color: "var(--color-bt-text-dim)", letterSpacing: "0.08em" }}
        >
          Trip management
        </p>

        <div className="space-y-2">
          {/* ── Transfer ownership ──────────────────────────────────── */}
          {isOwner ? (
            <div>
              <button
                data-testid="settings-transfer-btn"
                onClick={() => {
                  setTransferExpanded(!transferExpanded);
                }}
                className="flex w-full items-center gap-3 rounded-xl border px-3 py-2.5"
                style={{
                  background: "var(--color-bt-card-raised)",
                  borderColor: "var(--color-bt-border)",
                }}
              >
                <div
                  className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg"
                  style={{ background: "rgba(45,212,191,0.12)" }}
                >
                  <UserCheck size={16} style={{ color: "var(--color-bt-accent)" }} />
                </div>
                <div className="min-w-0 flex-1 text-left">
                  <p className="text-sm" style={{ color: "var(--color-bt-text)" }}>
                    Transfer ownership
                  </p>
                  <p className="text-xs" style={{ color: "var(--color-bt-text-dim)" }}>
                    Pass owner role to a crew member
                  </p>
                </div>
                <ChevronRight
                  size={16}
                  style={{
                    color: "var(--color-bt-text-dim)",
                    transform: transferExpanded ? "rotate(90deg)" : undefined,
                    transition: "transform 150ms",
                  }}
                />
              </button>

              {/* Transfer expansion */}
              {transferExpanded && (
                <div className="mt-2 space-y-2 rounded-xl border p-3" style={{ borderColor: "var(--color-bt-border)" }}>
                  {transferCandidates.length === 0 ? (
                    <p className="text-center text-xs" style={{ color: "var(--color-bt-text-dim)" }}>
                      No eligible crew members
                    </p>
                  ) : (
                    transferCandidates.map((m) => (
                      <button
                        key={m.user_id}
                        onClick={() => setSelectedNewOwner(m.user_id)}
                        className="flex w-full items-center gap-3 rounded-lg px-2 py-2 transition-colors hover:bg-[var(--color-bt-hover)]"
                      >
                        <UserAvatar name={m.displayName ?? null} avatarUrl={null} size="md" />
                        <span className="min-w-0 flex-1 text-left text-sm" style={{ color: "var(--color-bt-text)" }}>
                          {m.displayName}
                        </span>
                        <RoleBadge role={m.role as TripRole} />
                        <div
                          className="flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full border-2"
                          style={{
                            borderColor:
                              selectedNewOwner === m.user_id
                                ? "var(--color-bt-accent)"
                                : "var(--color-bt-border)",
                          }}
                        >
                          {selectedNewOwner === m.user_id && (
                            <div
                              className="h-2.5 w-2.5 rounded-full"
                              style={{ background: "var(--color-bt-accent)" }}
                            />
                          )}
                        </div>
                      </button>
                    ))
                  )}

                  <button
                    data-testid="settings-confirm-transfer-btn"
                    disabled={!selectedNewOwner || transferMutation.isPending}
                    onClick={() =>
                      selectedNewOwner &&
                      transferMutation.mutate({ tripId, newOwnerId: selectedNewOwner })
                    }
                    className="w-full rounded-xl py-2.5 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-40"
                    style={{
                      background: "var(--color-bt-accent)",
                      color: "var(--color-bt-base)",
                    }}
                  >
                    {selectedNewOwner
                      ? `Transfer to ${selectedMemberName}`
                      : "Select a crew member"}
                  </button>

                  <button
                    onClick={() => {
                      setTransferExpanded(false);
                      setSelectedNewOwner(null);
                    }}
                    className="w-full rounded-xl border py-2 text-sm"
                    style={{
                      borderColor: "var(--color-bt-border)",
                      color: "var(--color-bt-text-dim)",
                    }}
                  >
                    Cancel
                  </button>
                </div>
              )}
            </div>
          ) : (
            /* Locked transfer row (planner) */
            <div
              className="flex items-center gap-3 rounded-xl border px-3 py-2.5"
              style={{
                background: "var(--color-bt-card-raised)",
                borderColor: "var(--color-bt-border)",
                opacity: 0.5,
              }}
            >
              <div
                className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg"
                style={{ background: "var(--color-bt-border)" }}
              >
                <Lock size={16} style={{ color: "var(--color-bt-text-dim)" }} />
              </div>
              <p className="text-sm" style={{ color: "var(--color-bt-text-dim)", opacity: 0.45 }}>
                Transfer ownership
              </p>
            </div>
          )}

          {/* ── Locked delete row (planner only) ───────────────────── */}
          {!isOwner && (
            <div
              className="flex items-center gap-3 rounded-xl border px-3 py-2.5"
              style={{
                background: "var(--color-bt-card-raised)",
                borderColor: "var(--color-bt-border)",
                opacity: 0.5,
              }}
            >
              <div
                className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg"
                style={{ background: "var(--color-bt-border)" }}
              >
                <Lock size={16} style={{ color: "var(--color-bt-text-dim)" }} />
              </div>
              <p className="text-sm" style={{ color: "var(--color-bt-text-dim)", opacity: 0.45 }}>
                Delete trip
              </p>
            </div>
          )}

          {/* Planner caption */}
          {!isOwner && (
            <p
              className="pt-1 text-center text-xs"
              style={{ color: "var(--color-bt-text-dim)" }}
            >
              These actions require owner access
            </p>
          )}
        </div>

        {/* ── Section 3: Danger zone (owner only) ────────────────────── */}
        {isOwner && (
          <>
            {/* Divider */}
            <div
              className="my-4"
              style={{ height: 1, background: "var(--color-bt-border)" }}
            />

            <p
              className="mb-3 text-[11px] font-medium uppercase tracking-wider"
              style={{ color: "var(--color-bt-danger)", opacity: 0.7, letterSpacing: "0.08em" }}
            >
              Danger zone
            </p>

            <div>
              <button
                data-testid="settings-delete-btn"
                onClick={() => setDeleteConfirming(!deleteConfirming)}
                className="flex w-full items-center gap-3 rounded-xl border px-3 py-2.5"
                style={{
                  background: "var(--color-bt-card-raised)",
                  borderColor: "rgba(248,113,113,0.2)",
                }}
              >
                <div
                  className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg"
                  style={{ background: "rgba(248,113,113,0.12)" }}
                >
                  <Trash2 size={16} style={{ color: "var(--color-bt-danger)" }} />
                </div>
                <div className="min-w-0 flex-1 text-left">
                  <p className="text-sm" style={{ color: "var(--color-bt-danger)" }}>
                    Delete trip
                  </p>
                  <p className="text-xs" style={{ color: "var(--color-bt-text-dim)" }}>
                    Permanent — removes all data for everyone
                  </p>
                </div>
              </button>

              {deleteConfirming && (
                <div className="mt-2 space-y-2 rounded-xl border p-3" style={{ borderColor: "var(--color-bt-border)" }}>
                  <p className="text-sm" style={{ color: "var(--color-bt-text)" }}>
                    Delete <strong>{tripName}</strong>?
                  </p>
                  <p className="text-xs" style={{ color: "var(--color-bt-text-dim)" }}>
                    This will permanently delete the trip and remove it for all crew members.
                    This cannot be undone.
                  </p>
                  <button
                    data-testid="settings-confirm-delete-btn"
                    disabled={deleteMutation.isPending}
                    onClick={() => deleteMutation.mutate({ tripId })}
                    className="w-full rounded-xl py-2.5 text-sm font-semibold disabled:opacity-40"
                    style={{ background: "var(--color-bt-danger)", color: "#fff" }}
                  >
                    {deleteMutation.isPending ? "Deleting…" : "Delete trip"}
                  </button>
                  <button
                    onClick={() => setDeleteConfirming(false)}
                    className="w-full rounded-xl border py-2 text-sm"
                    style={{
                      borderColor: "var(--color-bt-border)",
                      color: "var(--color-bt-text-dim)",
                    }}
                  >
                    Cancel
                  </button>
                </div>
              )}
            </div>
          </>
        )}

      </div>
    </div>
  );
}
