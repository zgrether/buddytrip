"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Save, Lock, Unlock, Trash2 } from "lucide-react";
import { trpc } from "@/lib/trpc-client";
import type { TabProps } from "./types";

// ── MoreTab ───────────────────────────────────────────────────────────────

export function MoreTab({ trip, canEdit, isOwner }: TabProps) {
  const router = useRouter();
  const utils = trpc.useUtils();

  // ── Edit form state ──────────────────────────────────────────────────────
  const [title, setTitle] = useState(trip.title);
  const [description, setDescription] = useState(trip.description ?? "");
  const [location, setLocation] = useState(trip.location ?? "");
  const [startDate, setStartDate] = useState(trip.start_date ?? "");
  const [endDate, setEndDate] = useState(trip.end_date ?? "");
  const [notes, setNotes] = useState(trip.notes ?? "");

  // ── Lock destination state ───────────────────────────────────────────────
  const [lockTitle, setLockTitle] = useState(
    trip.locked_destination_title ?? ""
  );
  const [lockLocation, setLockLocation] = useState(
    trip.locked_destination_location ?? ""
  );
  const [showLockForm, setShowLockForm] = useState(false);

  // ── Confirm delete state ─────────────────────────────────────────────────
  const [confirmDelete, setConfirmDelete] = useState(false);

  // ── Mutations ────────────────────────────────────────────────────────────
  const updateTrip = trpc.trips.update.useMutation({
    onSuccess: () => {
      utils.trips.getById.invalidate({ tripId: trip.id });
      utils.trips.list.invalidate();
    },
  });

  const lockDest = trpc.trips.lockDestination.useMutation({
    onSuccess: () => {
      utils.trips.getById.invalidate({ tripId: trip.id });
      setShowLockForm(false);
    },
  });

  const unlockDest = trpc.trips.unlockDestination.useMutation({
    onSuccess: () => utils.trips.getById.invalidate({ tripId: trip.id }),
  });

  const deleteTrip = trpc.trips.delete.useMutation({
    onSuccess: () => router.push("/dashboard"),
  });

  // ── Handlers ─────────────────────────────────────────────────────────────

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
    lockDest.mutate({
      tripId: trip.id,
      title: lockTitle.trim(),
      location: lockLocation.trim(),
    });
  }

  const isLocked = !!trip.locked_destination_title;

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-5 px-4">
      {/* ── Trip details ──────────────────────────────────────────────────── */}
      {canEdit && (
        <section>
          <h2
            className="mb-3 text-sm font-semibold uppercase tracking-wider"
            style={{ color: "#8b949e" }}
          >
            Trip Details
          </h2>
          <div
            className="space-y-3 rounded-xl p-4"
            style={{ background: "#161b22", border: "1px solid #30363d" }}
          >
            {/* Title */}
            <div>
              <label className="mb-1 block text-xs" style={{ color: "#8b949e" }}>
                Name
              </label>
              <input
                data-testid="edit-title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                className="w-full rounded-lg border px-3 py-2 text-sm outline-none"
                style={{
                  background: "#0d1117",
                  borderColor: "#30363d",
                  color: "#e6edf3",
                }}
              />
            </div>

            {/* Description */}
            <div>
              <label className="mb-1 block text-xs" style={{ color: "#8b949e" }}>
                Description
              </label>
              <textarea
                data-testid="edit-description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={2}
                className="w-full rounded-lg border px-3 py-2 text-sm outline-none"
                style={{
                  background: "#0d1117",
                  borderColor: "#30363d",
                  color: "#e6edf3",
                  resize: "none",
                }}
              />
            </div>

            {/* Location */}
            <div>
              <label className="mb-1 block text-xs" style={{ color: "#8b949e" }}>
                Location
              </label>
              <input
                data-testid="edit-location"
                value={location}
                onChange={(e) => setLocation(e.target.value)}
                className="w-full rounded-lg border px-3 py-2 text-sm outline-none"
                style={{
                  background: "#0d1117",
                  borderColor: "#30363d",
                  color: "#e6edf3",
                }}
              />
            </div>

            {/* Dates */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="mb-1 block text-xs" style={{ color: "#8b949e" }}>
                  Start Date
                </label>
                <input
                  type="date"
                  data-testid="edit-start-date"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                  className="w-full rounded-lg border px-3 py-2 text-sm outline-none"
                  style={{
                    background: "#0d1117",
                    borderColor: "#30363d",
                    color: "#e6edf3",
                    colorScheme: "dark",
                  }}
                />
              </div>
              <div>
                <label className="mb-1 block text-xs" style={{ color: "#8b949e" }}>
                  End Date
                </label>
                <input
                  type="date"
                  data-testid="edit-end-date"
                  value={endDate}
                  min={startDate}
                  onChange={(e) => setEndDate(e.target.value)}
                  className="w-full rounded-lg border px-3 py-2 text-sm outline-none"
                  style={{
                    background: "#0d1117",
                    borderColor: "#30363d",
                    color: "#e6edf3",
                    colorScheme: "dark",
                  }}
                />
              </div>
            </div>

            {/* Notes */}
            <div>
              <label className="mb-1 block text-xs" style={{ color: "#8b949e" }}>
                Notes
              </label>
              <textarea
                data-testid="edit-notes"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={3}
                className="w-full rounded-lg border px-3 py-2 text-sm outline-none"
                style={{
                  background: "#0d1117",
                  borderColor: "#30363d",
                  color: "#e6edf3",
                  resize: "none",
                }}
              />
            </div>

            {/* Save button */}
            <button
              data-testid="save-trip-btn"
              disabled={updateTrip.isPending}
              onClick={handleSave}
              className="flex w-full items-center justify-center gap-2 rounded-lg py-2.5 text-sm font-medium disabled:opacity-40"
              style={{ background: "#00d4aa", color: "#0d1117" }}
            >
              <Save size={14} />
              {updateTrip.isPending ? "Saving…" : "Save Changes"}
            </button>
          </div>
        </section>
      )}

      {/* ── Lock / Unlock destination ──────────────────────────────────────── */}
      {isOwner && (
        <section>
          <h2
            className="mb-3 text-sm font-semibold uppercase tracking-wider"
            style={{ color: "#8b949e" }}
          >
            Destination
          </h2>
          <div
            className="rounded-xl p-4"
            style={{ background: "#161b22", border: "1px solid #30363d" }}
          >
            {isLocked ? (
              <>
                <div className="mb-3 flex items-center gap-2">
                  <Lock size={14} style={{ color: "#00d4aa" }} />
                  <p className="text-sm font-medium" style={{ color: "#e6edf3" }}>
                    {trip.locked_destination_title}
                  </p>
                </div>
                <p className="mb-3 text-xs" style={{ color: "#8b949e" }}>
                  {trip.locked_destination_location}
                </p>
                <button
                  data-testid="unlock-destination-btn"
                  disabled={unlockDest.isPending}
                  onClick={() => unlockDest.mutate({ tripId: trip.id })}
                  className="flex w-full items-center justify-center gap-2 rounded-lg border py-2 text-sm transition-colors hover:bg-white/5 disabled:opacity-40"
                  style={{ borderColor: "#30363d", color: "#8b949e" }}
                >
                  <Unlock size={14} />
                  Unlock Destination
                </button>
              </>
            ) : showLockForm ? (
              <div className="space-y-3">
                <p className="text-sm font-medium" style={{ color: "#e6edf3" }}>
                  Lock Destination
                </p>
                <input
                  data-testid="lock-title-input"
                  placeholder="Destination name"
                  value={lockTitle}
                  onChange={(e) => setLockTitle(e.target.value)}
                  className="w-full rounded-lg border px-3 py-2 text-sm outline-none"
                  style={{
                    background: "#0d1117",
                    borderColor: "#30363d",
                    color: "#e6edf3",
                  }}
                />
                <input
                  data-testid="lock-location-input"
                  placeholder="Location"
                  value={lockLocation}
                  onChange={(e) => setLockLocation(e.target.value)}
                  className="w-full rounded-lg border px-3 py-2 text-sm outline-none"
                  style={{
                    background: "#0d1117",
                    borderColor: "#30363d",
                    color: "#e6edf3",
                  }}
                />
                <div className="flex gap-2">
                  <button
                    onClick={() => setShowLockForm(false)}
                    className="flex-1 rounded-lg border py-2 text-sm"
                    style={{ borderColor: "#30363d", color: "#8b949e" }}
                  >
                    Cancel
                  </button>
                  <button
                    data-testid="confirm-lock-btn"
                    disabled={
                      !lockTitle.trim() ||
                      !lockLocation.trim() ||
                      lockDest.isPending
                    }
                    onClick={handleLock}
                    className="flex-1 rounded-lg py-2 text-sm font-medium disabled:opacity-40"
                    style={{ background: "#00d4aa", color: "#0d1117" }}
                  >
                    Lock
                  </button>
                </div>
              </div>
            ) : (
              <>
                <p className="mb-3 text-xs" style={{ color: "#8b949e" }}>
                  Lock the destination to finalize it for all crew members.
                </p>
                <button
                  data-testid="lock-destination-btn"
                  onClick={() => setShowLockForm(true)}
                  className="flex w-full items-center justify-center gap-2 rounded-lg border py-2 text-sm transition-colors hover:bg-white/5"
                  style={{ borderColor: "#00d4aa", color: "#00d4aa" }}
                >
                  <Lock size={14} />
                  Lock Destination
                </button>
              </>
            )}
          </div>
        </section>
      )}

      {/* ── Invite hint ───────────────────────────────────────────────────── */}
      {isOwner && (
        <section>
          <h2
            className="mb-3 text-sm font-semibold uppercase tracking-wider"
            style={{ color: "#8b949e" }}
          >
            Members
          </h2>
          <div
            className="rounded-xl p-4"
            style={{ background: "#161b22", border: "1px solid #30363d" }}
          >
            <p className="text-xs" style={{ color: "#8b949e" }}>
              To invite new members, search for users in the Crew tab and add
              them by email.
            </p>
          </div>
        </section>
      )}

      {/* ── Danger zone (Owner only) ───────────────────────────────────────── */}
      {isOwner && (
        <section>
          <h2
            className="mb-3 text-sm font-semibold uppercase tracking-wider"
            style={{ color: "#8b949e" }}
          >
            Danger Zone
          </h2>
          <div
            className="rounded-xl p-4"
            style={{ background: "#161b22", border: "1px solid #30363d" }}
          >
            {confirmDelete ? (
              <div>
                <p className="mb-3 text-sm" style={{ color: "#e6edf3" }}>
                  Delete <strong>{trip.title}</strong>? This cannot be undone.
                </p>
                <div className="flex gap-2">
                  <button
                    onClick={() => setConfirmDelete(false)}
                    className="flex-1 rounded-lg border py-2 text-sm"
                    style={{ borderColor: "#30363d", color: "#8b949e" }}
                  >
                    Cancel
                  </button>
                  <button
                    data-testid="confirm-delete-btn"
                    disabled={deleteTrip.isPending}
                    onClick={() => deleteTrip.mutate({ tripId: trip.id })}
                    className="flex-1 rounded-lg py-2 text-sm font-medium disabled:opacity-40"
                    style={{ background: "#ef4444", color: "#fff" }}
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
                style={{ color: "#ef4444" }}
              >
                <Trash2 size={14} />
                Delete Trip
              </button>
            )}
          </div>
        </section>
      )}
    </div>
  );
}
