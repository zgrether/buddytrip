"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Trash2, X } from "lucide-react";
import { trpc } from "@/lib/trpc-client";

interface TripSettingsModalProps {
  trip: {
    id: string;
    title: string;
  };
  isOwner: boolean;
  onClose: () => void;
}

export function TripSettingsModal({ trip, isOwner, onClose }: TripSettingsModalProps) {
  const router = useRouter();
  const [confirmDelete, setConfirmDelete] = useState(false);

  const deleteTrip = trpc.trips.delete.useMutation({
    onSuccess: () => router.push("/dashboard"),
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div
        className="absolute inset-0"
        style={{ background: "var(--color-bt-overlay)" }}
        onClick={onClose}
      />
      <div
        className="relative w-full max-w-lg rounded-2xl p-5"
        style={{ background: "var(--color-bt-card)", border: "1px solid var(--color-bt-border)" }}
      >
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
  );
}
