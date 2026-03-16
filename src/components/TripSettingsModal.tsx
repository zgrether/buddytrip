"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Save, Lock, Unlock, Trash2, X } from "lucide-react";
import { trpc } from "@/lib/trpc-client";

interface TripSettingsModalProps {
  trip: {
    id: string;
    title: string;
    description?: string | null;
    location?: string | null;
    start_date?: string | null;
    end_date?: string | null;
    notes?: string | null;
    locked_destination_title?: string | null;
    locked_destination_location?: string | null;
  };
  isOwner: boolean;
  canEdit: boolean;
  onClose: () => void;
}

export function TripSettingsModal({ trip, isOwner, canEdit, onClose }: TripSettingsModalProps) {
  const router = useRouter();
  const utils = trpc.useUtils();

  // Edit form state
  const [title, setTitle] = useState(trip.title);
  const [description, setDescription] = useState(trip.description ?? "");
  const [location, setLocation] = useState(trip.location ?? "");
  const [startDate, setStartDate] = useState(trip.start_date ?? "");
  const [endDate, setEndDate] = useState(trip.end_date ?? "");
  const [notes, setNotes] = useState(trip.notes ?? "");

  // Lock destination
  const [lockTitle, setLockTitle] = useState(trip.locked_destination_title ?? "");
  const [lockLocation, setLockLocation] = useState(trip.locked_destination_location ?? "");
  const [showLockForm, setShowLockForm] = useState(false);

  // Confirm delete
  const [confirmDelete, setConfirmDelete] = useState(false);

  const updateTrip = trpc.trips.update.useMutation({
    onSuccess: () => {
      utils.trips.getById.invalidate({ tripId: trip.id });
      utils.trips.list.invalidate();
      onClose();
    },
  });

  const lockDest = trpc.trips.lockDestination.useMutation({
    onSuccess() {
      setShowLockForm(false);
      utils.trips.getById.invalidate({ tripId: trip.id });
      onClose();
    },
  });

  const unlockDest = trpc.trips.unlockDestination.useMutation({
    onSuccess() {
      utils.trips.getById.invalidate({ tripId: trip.id });
    },
  });

  const deleteTrip = trpc.trips.delete.useMutation({
    onSuccess: () => router.push("/dashboard"),
  });

  const isLocked = !!trip.locked_destination_title;

  function handleSave() {
    updateTrip.mutate({
      tripId: trip.id,
      title: title.trim() || trip.title,
      description: description || undefined,
      location: location || null,
      startDate: startDate || null,
      endDate: endDate || null,
      notes: notes || undefined,
    });
  }

  function handleLock() {
    if (!lockTitle.trim() || !lockLocation.trim()) return;
    lockDest.mutate({ tripId: trip.id, title: lockTitle.trim(), location: lockLocation.trim() });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center p-4 sm:items-center">
      <div
        className="absolute inset-0"
        style={{ background: "var(--color-bt-overlay)" }}
        onClick={onClose}
      />
      <div
        className="relative max-h-[85vh] w-full max-w-lg overflow-y-auto rounded-2xl p-5"
        style={{ background: "var(--color-bt-card)", border: "1px solid var(--color-bt-border)" }}
      >
        {/* Header */}
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-base font-semibold" style={{ color: "var(--color-bt-text)" }}>
            Trip Settings
          </h2>
          <button
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-full transition-colors hover:bg-[var(--color-bt-hover)]"
            style={{ color: "var(--color-bt-text-dim)" }}
          >
            <X size={18} />
          </button>
        </div>

        <div className="space-y-5">
          {/* Trip details form */}
          {canEdit && (
            <section className="space-y-3">
              <h3 className="text-xs font-semibold uppercase tracking-wider" style={{ color: "var(--color-bt-text-dim)" }}>
                Trip Details
              </h3>
              <div>
                <label className="mb-1 block text-xs" style={{ color: "var(--color-bt-text-dim)" }}>Name</label>
                <input
                  data-testid="edit-title"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  className="w-full rounded-lg border px-3 py-2 text-sm outline-none"
                  style={{ background: "var(--color-bt-base)", borderColor: "var(--color-bt-border)", color: "var(--color-bt-text)" }}
                />
              </div>
              <div>
                <label className="mb-1 block text-xs" style={{ color: "var(--color-bt-text-dim)" }}>Description</label>
                <textarea
                  data-testid="edit-description"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  rows={2}
                  className="w-full rounded-lg border px-3 py-2 text-sm outline-none"
                  style={{ background: "var(--color-bt-base)", borderColor: "var(--color-bt-border)", color: "var(--color-bt-text)", resize: "none" }}
                />
              </div>
              <div>
                <label className="mb-1 block text-xs" style={{ color: "var(--color-bt-text-dim)" }}>Location</label>
                <input
                  data-testid="edit-location"
                  value={location}
                  onChange={(e) => setLocation(e.target.value)}
                  className="w-full rounded-lg border px-3 py-2 text-sm outline-none"
                  style={{ background: "var(--color-bt-base)", borderColor: "var(--color-bt-border)", color: "var(--color-bt-text)" }}
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block text-xs" style={{ color: "var(--color-bt-text-dim)" }}>Start Date</label>
                  <input
                    type="date"
                    data-testid="edit-start-date"
                    value={startDate}
                    onChange={(e) => setStartDate(e.target.value)}
                    className="w-full rounded-lg border px-3 py-2 text-sm outline-none"
                    style={{ background: "var(--color-bt-base)", borderColor: "var(--color-bt-border)", color: "var(--color-bt-text)", colorScheme: "inherit" }}
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs" style={{ color: "var(--color-bt-text-dim)" }}>End Date</label>
                  <input
                    type="date"
                    data-testid="edit-end-date"
                    value={endDate}
                    min={startDate}
                    onChange={(e) => setEndDate(e.target.value)}
                    className="w-full rounded-lg border px-3 py-2 text-sm outline-none"
                    style={{ background: "var(--color-bt-base)", borderColor: "var(--color-bt-border)", color: "var(--color-bt-text)", colorScheme: "inherit" }}
                  />
                </div>
              </div>
              <div>
                <label className="mb-1 block text-xs" style={{ color: "var(--color-bt-text-dim)" }}>Notes</label>
                <textarea
                  data-testid="edit-notes"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  rows={3}
                  className="w-full rounded-lg border px-3 py-2 text-sm outline-none"
                  style={{ background: "var(--color-bt-base)", borderColor: "var(--color-bt-border)", color: "var(--color-bt-text)", resize: "none" }}
                />
              </div>
              <button
                data-testid="save-trip-btn"
                disabled={updateTrip.isPending}
                onClick={handleSave}
                className="flex w-full items-center justify-center gap-2 rounded-lg py-2.5 text-sm font-medium disabled:opacity-40"
                style={{ background: "var(--color-bt-accent)", color: "var(--color-bt-base)" }}
              >
                <Save size={14} />
                {updateTrip.isPending ? "Saving…" : "Save Changes"}
              </button>
            </section>
          )}

          {/* Destination lock/unlock */}
          {isOwner && (
            <section className="space-y-3">
              <h3 className="text-xs font-semibold uppercase tracking-wider" style={{ color: "var(--color-bt-text-dim)" }}>
                Destination
              </h3>
              <div
                className="rounded-xl p-4"
                style={{ background: "var(--color-bt-base)", border: "1px solid var(--color-bt-border)" }}
              >
                {isLocked ? (
                  <>
                    <div className="mb-3 flex items-center gap-2">
                      <Lock size={14} style={{ color: "var(--color-bt-accent)" }} />
                      <p className="text-sm font-medium" style={{ color: "var(--color-bt-text)" }}>
                        {trip.locked_destination_title}
                      </p>
                    </div>
                    <p className="mb-3 text-xs" style={{ color: "var(--color-bt-text-dim)" }}>
                      {trip.locked_destination_location}
                    </p>
                    <button
                      data-testid="unlock-destination-btn"
                      disabled={unlockDest.isPending}
                      onClick={() => unlockDest.mutate({ tripId: trip.id })}
                      className="flex w-full items-center justify-center gap-2 rounded-lg border py-2 text-sm transition-colors hover:bg-[var(--color-bt-hover)] disabled:opacity-40"
                      style={{ borderColor: "var(--color-bt-border)", color: "var(--color-bt-text-dim)" }}
                    >
                      <Unlock size={14} />
                      Unlock Destination
                    </button>
                  </>
                ) : showLockForm ? (
                  <div className="space-y-3">
                    <p className="text-sm font-medium" style={{ color: "var(--color-bt-text)" }}>Lock Destination</p>
                    <input
                      data-testid="lock-title-input"
                      placeholder="Destination name"
                      value={lockTitle}
                      onChange={(e) => setLockTitle(e.target.value)}
                      className="w-full rounded-lg border px-3 py-2 text-sm outline-none"
                      style={{ background: "var(--color-bt-base)", borderColor: "var(--color-bt-border)", color: "var(--color-bt-text)" }}
                    />
                    <input
                      data-testid="lock-location-input"
                      placeholder="Location"
                      value={lockLocation}
                      onChange={(e) => setLockLocation(e.target.value)}
                      className="w-full rounded-lg border px-3 py-2 text-sm outline-none"
                      style={{ background: "var(--color-bt-base)", borderColor: "var(--color-bt-border)", color: "var(--color-bt-text)" }}
                    />
                    <div className="flex gap-2">
                      <button
                        onClick={() => setShowLockForm(false)}
                        className="flex-1 rounded-lg border py-2 text-sm"
                        style={{ borderColor: "var(--color-bt-border)", color: "var(--color-bt-text-dim)" }}
                      >
                        Cancel
                      </button>
                      <button
                        data-testid="confirm-lock-btn"
                        disabled={!lockTitle.trim() || !lockLocation.trim() || lockDest.isPending}
                        onClick={handleLock}
                        className="flex-1 rounded-lg py-2 text-sm font-medium disabled:opacity-40"
                        style={{ background: "var(--color-bt-accent)", color: "var(--color-bt-base)" }}
                      >
                        Lock
                      </button>
                    </div>
                  </div>
                ) : (
                  <>
                    <p className="mb-3 text-xs" style={{ color: "var(--color-bt-text-dim)" }}>
                      Lock the destination to finalize it for all crew members.
                    </p>
                    <button
                      data-testid="lock-destination-btn"
                      onClick={() => setShowLockForm(true)}
                      className="flex w-full items-center justify-center gap-2 rounded-lg border py-2 text-sm transition-colors hover:bg-[var(--color-bt-hover)]"
                      style={{ borderColor: "var(--color-bt-accent)", color: "var(--color-bt-accent)" }}
                    >
                      <Lock size={14} />
                      Lock Destination
                    </button>
                  </>
                )}
              </div>
            </section>
          )}

          {/* Danger zone */}
          {isOwner && (
            <section className="space-y-3">
              <h3 className="text-xs font-semibold uppercase tracking-wider" style={{ color: "var(--color-bt-text-dim)" }}>
                Danger Zone
              </h3>
              <div
                className="rounded-xl p-4"
                style={{ background: "var(--color-bt-base)", border: "1px solid var(--color-bt-border)" }}
              >
                {confirmDelete ? (
                  <div>
                    <p className="mb-3 text-sm" style={{ color: "var(--color-bt-text)" }}>
                      Delete <strong>{trip.title}</strong>? This cannot be undone.
                    </p>
                    <div className="flex gap-2">
                      <button
                        onClick={() => setConfirmDelete(false)}
                        className="flex-1 rounded-lg border py-2 text-sm"
                        style={{ borderColor: "var(--color-bt-border)", color: "var(--color-bt-text-dim)" }}
                      >
                        Cancel
                      </button>
                      <button
                        data-testid="confirm-delete-btn"
                        disabled={deleteTrip.isPending}
                        onClick={() => deleteTrip.mutate({ tripId: trip.id })}
                        className="flex-1 rounded-lg py-2 text-sm font-medium disabled:opacity-40"
                        style={{ background: "var(--color-bt-danger)", color: "#fff" }}
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                ) : (
                  <button
                    data-testid="delete-trip-btn"
                    onClick={() => setConfirmDelete(true)}
                    className="flex w-full items-center justify-center gap-2 rounded-lg py-2 text-sm"
                    style={{ color: "var(--color-bt-danger)" }}
                  >
                    <Trash2 size={14} />
                    Delete Trip
                  </button>
                )}
              </div>
            </section>
          )}
        </div>
      </div>
    </div>
  );
}
