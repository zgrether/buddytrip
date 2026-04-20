"use client";

import { useState } from "react";
import { Send, Sparkles } from "lucide-react";
import { trpc } from "@/lib/trpc-client";
import { useModalBackButton } from "@/hooks/useModalBackButton";

export interface TripInvitationModalProps {
  tripId: string;
  trip: {
    title?: string | null;
    about_message?: string | null;
    locked_destination_title?: string | null;
    start_date?: string | null;
    end_date?: string | null;
  };
  onClose: () => void;
}

/**
 * TripInvitationModal — opened from the going-stage Action Center "Write
 * invitation" button. Lets the owner compose / edit the invitation message
 * the crew sees on their RSVP surface. Distinct from TripSummaryModal,
 * which is the planning→going recap/advance gate.
 */
export function TripInvitationModal({ tripId, trip, onClose }: TripInvitationModalProps) {
  useModalBackButton(onClose);
  const utils = trpc.useUtils();

  const [message, setMessage] = useState(trip.about_message ?? "");

  const update = trpc.trips.updateAboutMessage.useMutation({
    onSuccess() {
      utils.trips.getById.invalidate({ tripId });
      onClose();
    },
  });

  const handleSave = () => {
    update.mutate({ tripId, aboutMessage: message.trim() || null });
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center lg:items-center"
      style={{ background: "var(--color-bt-overlay)" }}
      onClick={onClose}
    >
      <div
        className="w-full max-w-[560px] rounded-t-2xl p-6 lg:rounded-2xl"
        style={{ background: "var(--color-bt-card)" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-1 flex items-center gap-2">
          <Sparkles size={16} style={{ color: "var(--color-bt-accent)" }} />
          <h2 className="text-lg font-semibold" style={{ color: "var(--color-bt-text)" }}>
            Trip Invitation
          </h2>
        </div>
        <p className="mb-4 text-sm" style={{ color: "var(--color-bt-text-dim)" }}>
          Tell the crew what this trip is about. This message shows up alongside
          their RSVP so they know what they&apos;re saying yes to.
        </p>

        <textarea
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          placeholder="Three days in Charlotte, golf every morning, BBQ most evenings. Bring clubs and a jacket for the cold front coming through."
          rows={6}
          className="w-full resize-none rounded-xl border px-3 py-2.5 text-sm outline-none"
          style={{
            background: "var(--color-bt-card-raised)",
            borderColor: "var(--color-bt-border)",
            color: "var(--color-bt-text)",
          }}
          data-testid="trip-invitation-message-input"
        />

        <div className="mt-4 flex gap-2">
          <button
            type="button"
            onClick={onClose}
            className="flex-1 rounded-xl py-3 text-sm font-medium"
            style={{
              background: "transparent",
              color: "var(--color-bt-text-dim)",
              border: "1px solid var(--color-bt-border)",
            }}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={update.isPending}
            data-testid="trip-invitation-save-btn"
            className="flex flex-1 items-center justify-center gap-2 rounded-xl py-3 text-sm font-semibold transition-opacity hover:opacity-90 disabled:opacity-50"
            style={{
              background: "var(--color-bt-accent)",
              color: "var(--color-bt-base)",
              border: "1px solid var(--color-bt-accent)",
            }}
          >
            <Send size={14} />
            {update.isPending ? "Saving…" : "Save invitation"}
          </button>
        </div>
      </div>
    </div>
  );
}
