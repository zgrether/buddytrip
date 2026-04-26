"use client";

import { useState } from "react";
import { RotateCcw, Send, Sparkles } from "lucide-react";
import { trpc } from "@/lib/trpc-client";
import { useModalBackButton } from "@/hooks/useModalBackButton";
import { buildCannedInvitation } from "@/lib/invitationDefault";

export interface TripInvitationModalProps {
  tripId: string;
  trip: {
    title?: string | null;
    about_message?: string | null;
    location?: string | null;
    /** Real-world location string ("Bandon, OR"); preferred over the cute idea title. */
    locked_destination_location?: string | null;
    locked_destination_title?: string | null;
    start_date?: string | null;
    end_date?: string | null;
  };
  onClose: () => void;
}

/**
 * TripInvitationModal — opened from the going-stage Action Center
 * invitation pencil. Lets the owner compose / edit the invitation message
 * the crew sees on their Home tab. Distinct from TripSummaryModal, which
 * is the planning→going recap/advance gate.
 */
export function TripInvitationModal({ tripId, trip, onClose }: TripInvitationModalProps) {
  useModalBackButton(onClose);
  const utils = trpc.useUtils();

  // Preload with the message the crew currently sees: saved custom message
  // if one exists, otherwise the canned default. That way the owner can edit
  // from a real starting point instead of a blank page.
  const cannedDefault = buildCannedInvitation(trip);
  const initialMessage = trip.about_message?.trim() || cannedDefault;
  const [message, setMessage] = useState(initialMessage);

  // Reset only makes sense when the textarea is showing something other than
  // the canned default — i.e. there's actually something to reset back from.
  const canReset = message.trim() !== cannedDefault;

  const update = trpc.trips.updateAboutMessage.useMutation({
    onSuccess() {
      utils.trips.getById.invalidate({ tripId });
      onClose();
    },
  });

  const handleSave = () => {
    const trimmed = message.trim();
    // If the owner saved back to the canned default (verbatim), persist
    // `null` so we keep the "using default" state instead of pinning the
    // literal string forever.
    const aboutMessage =
      !trimmed || trimmed === cannedDefault ? null : trimmed;
    update.mutate({ tripId, aboutMessage });
  };

  const handleReset = () => {
    update.mutate({ tripId, aboutMessage: null });
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
          Tell the crew what this trip is about.
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

        <div className="mt-4 flex flex-wrap items-center gap-2">
          {canReset && (
            <button
              type="button"
              onClick={handleReset}
              disabled={update.isPending}
              data-testid="trip-invitation-reset-btn"
              className="inline-flex items-center gap-1.5 rounded-xl px-3 py-3 text-sm font-medium transition-opacity hover:opacity-90 disabled:opacity-50"
              style={{
                background: "transparent",
                color: "var(--color-bt-text-dim)",
                border: "1px solid var(--color-bt-border)",
              }}
            >
              <RotateCcw size={13} />
              Reset to Default
            </button>
          )}
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
