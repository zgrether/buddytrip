"use client";

import { useState } from "react";
import { RotateCcw, Send, Sparkles, X } from "lucide-react";
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
      {/* Canonical modal structure (CC_MODAL_AUDIT.md Part 2.1) */}
      <div
        className="flex w-full max-w-[560px] flex-col overflow-hidden rounded-t-2xl lg:rounded-2xl"
        style={{
          background: "var(--color-bt-card)",
          border: "1px solid var(--color-bt-border)",
          boxShadow: "var(--shadow-floating)",
          maxHeight: "min(85dvh, 720px)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div
          className="flex flex-shrink-0 items-center justify-between gap-2 px-5 py-4"
          style={{ borderBottom: "1px solid var(--color-bt-border)" }}
        >
          <div className="flex min-w-0 items-center gap-2">
            <Sparkles size={16} style={{ color: "var(--color-bt-accent)" }} />
            <h2 className="text-base font-semibold" style={{ color: "var(--color-bt-text)" }}>
              Trip Invitation
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full transition-colors hover:bg-[var(--color-bt-hover)]"
            style={{
              background: "var(--color-bt-card-raised)",
              color: "var(--color-bt-text-dim)",
            }}
          >
            <X size={14} />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 py-4">
          <p className="mb-3 text-sm" style={{ color: "var(--color-bt-text-dim)" }}>
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
        </div>

        {/* Footer — Reset (left-aligned ghost when applicable) + Cancel + Save (right) */}
        <div
          className="flex flex-shrink-0 items-center justify-between gap-3 px-5 py-4"
          style={{ borderTop: "1px solid var(--color-bt-border)" }}
        >
          {canReset ? (
            <button
              type="button"
              onClick={handleReset}
              disabled={update.isPending}
              data-testid="trip-invitation-reset-btn"
              className="inline-flex items-center gap-1.5 rounded-xl px-3 py-2.5 text-xs font-medium transition-opacity hover:opacity-90 disabled:opacity-50"
              style={{
                background: "transparent",
                color: "var(--color-bt-text-dim)",
                border: "0.5px solid var(--color-bt-border)",
              }}
            >
              <RotateCcw size={11} />
              Reset to Default
            </button>
          ) : (
            <span />
          )}
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={onClose}
              className="rounded-xl px-4 py-2.5 text-sm font-medium"
              style={{
                background: "transparent",
                color: "var(--color-bt-text-dim)",
                border: "0.5px solid var(--color-bt-border)",
              }}
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={update.isPending}
              data-testid="trip-invitation-save-btn"
              className="flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold transition-opacity disabled:opacity-50"
              style={{
                background: "var(--color-bt-accent)",
                color: "var(--color-bt-base)",
              }}
            >
              <Send size={14} />
              {update.isPending ? "Saving…" : "Save invitation"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
