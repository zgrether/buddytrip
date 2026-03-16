"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Save, Trash2, X } from "lucide-react";
import { trpc } from "@/lib/trpc-client";

interface TripSettingsModalProps {
  trip: {
    id: string;
    title: string;
    description?: string | null;
  };
  isOwner: boolean;
  canEdit: boolean;
  onClose: () => void;
}

export function TripSettingsModal({ trip, isOwner, canEdit, onClose }: TripSettingsModalProps) {
  const router = useRouter();
  const utils = trpc.useUtils();

  const [title, setTitle] = useState(trip.title);
  const [description, setDescription] = useState(trip.description ?? "");
  const [confirmDelete, setConfirmDelete] = useState(false);

  const updateTrip = trpc.trips.update.useMutation({
    onSuccess: () => {
      utils.trips.getById.invalidate({ tripId: trip.id });
      utils.trips.list.invalidate();
      onClose();
    },
  });

  const deleteTrip = trpc.trips.delete.useMutation({
    onSuccess: () => router.push("/dashboard"),
  });

  function handleSave() {
    updateTrip.mutate({
      tripId: trip.id,
      title: title.trim() || trip.title,
      description: description || undefined,
    });
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
