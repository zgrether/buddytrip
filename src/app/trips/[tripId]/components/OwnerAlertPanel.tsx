"use client";

import { useEffect, useState } from "react";
import { AlertTriangle, Pencil, X } from "lucide-react";
import { trpc } from "@/lib/trpc-client";
import type { TripData } from "../tabs/types";

interface OwnerAlertPanelProps {
  trip: TripData;
  isOwner: boolean;
}

export function OwnerAlertPanel({ trip, isOwner }: OwnerAlertPanelProps) {
  const tripId = trip.id;
  const utils = trpc.useUtils();

  // Dismiss state keyed by alert timestamp (resets when owner sets a new alert)
  const storageKey = `owner-alert-dismissed-${tripId}-${trip.owner_alert_set_at ?? ""}`;
  const [dismissed, setDismissed] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(trip.owner_alert ?? "");

  // Sync draft when trip alert changes externally
  useEffect(() => {
    setDraft(trip.owner_alert ?? "");
  }, [trip.owner_alert]);

  // Check localStorage on mount
  useEffect(() => {
    if (typeof window !== "undefined") {
      setDismissed(localStorage.getItem(storageKey) === "true");
    }
  }, [storageKey]);

  const setAlert = trpc.trips.setOwnerAlert.useMutation({
    onSuccess() {
      utils.trips.getById.invalidate({ tripId });
      setEditing(false);
    },
  });

  const handleDismiss = () => {
    localStorage.setItem(storageKey, "true");
    setDismissed(true);
  };

  // ── Early returns (no alert exists or was dismissed) ──────────────────
  // Must check AFTER editing state — clicking "Set an alert" sets editing=true
  // and we need to fall through to the inline edit block below.
  if (!editing && (!trip.owner_alert || dismissed)) {
    // Owner-only affordance to create a new alert
    if (isOwner && !trip.owner_alert) {
      return (
        <button
          onClick={() => {
            setDraft("");
            setEditing(true);
          }}
          className="mb-3 flex w-full items-center gap-2 rounded-xl px-4 py-2.5 text-xs font-medium transition-colors"
          style={{
            border: "1.5px dashed var(--color-bt-warning-border)",
            color: "var(--color-bt-warning)",
            background: "transparent",
          }}
        >
          <AlertTriangle size={14} />
          Set an alert for the crew
        </button>
      );
    }
    return null;
  }

  // Inline edit mode — owner only
  if (editing && isOwner) {
    return (
      <div
        className="mb-3 rounded-xl px-4 py-3"
        style={{
          background: "var(--color-bt-warning-faint)",
          border: "1px solid var(--color-bt-warning-border)",
          borderLeft: "3px solid var(--color-bt-warning)",
        }}
      >
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          rows={2}
          className="w-full resize-none rounded-lg border px-3 py-2 text-sm outline-none"
          style={{
            background: "var(--color-bt-card-raised)",
            borderColor: "var(--color-bt-border)",
            color: "var(--color-bt-text)",
          }}
          placeholder="Type your alert message..."
        />
        <div className="mt-2 flex gap-2">
          <button
            onClick={() => setAlert.mutate({ tripId, alert: draft.trim() || null })}
            disabled={setAlert.isPending || !draft.trim()}
            className="rounded-xl px-4 py-2 text-sm font-semibold transition-opacity hover:opacity-90 disabled:opacity-40"
            style={{
              background: "var(--color-bt-accent)",
              color: "var(--color-bt-base)",
            }}
          >
            {setAlert.isPending ? "Saving..." : "Save"}
          </button>
          <button
            onClick={() => setAlert.mutate({ tripId, alert: null })}
            disabled={setAlert.isPending}
            className="rounded-xl px-4 py-2 text-sm font-medium transition-opacity hover:opacity-80 disabled:opacity-40"
            style={{
              color: "var(--color-bt-danger)",
              border: "1px solid var(--color-bt-danger-border)",
            }}
          >
            Clear
          </button>
          <button
            onClick={() => {
              setDraft(trip.owner_alert ?? "");
              setEditing(false);
            }}
            className="rounded-xl px-4 py-2 text-sm transition-opacity hover:opacity-80"
            style={{ color: "var(--color-bt-text-dim)" }}
          >
            Cancel
          </button>
        </div>
      </div>
    );
  }

  // Read-only alert display
  return (
    <div
      className="mb-3 flex items-start gap-3 rounded-xl px-4 py-3"
      style={{
        background: "var(--color-bt-warning-faint)",
        border: "1px solid var(--color-bt-warning-border)",
        borderLeft: "3px solid var(--color-bt-warning)",
      }}
    >
      <AlertTriangle
        size={16}
        className="mt-0.5 flex-shrink-0"
        style={{ color: "var(--color-bt-warning)" }}
      />
      <p
        className="min-w-0 flex-1 text-[13px]"
        style={{ color: "var(--color-bt-text)" }}
      >
        {trip.owner_alert}
      </p>
      {isOwner && (
        <button
          onClick={() => setEditing(true)}
          className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full transition-opacity hover:opacity-80"
          style={{ color: "var(--color-bt-text-dim)" }}
          aria-label="Edit alert"
        >
          <Pencil size={12} />
        </button>
      )}
      <button
        onClick={handleDismiss}
        className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full transition-opacity hover:opacity-80"
        style={{ color: "var(--color-bt-text-dim)" }}
        aria-label="Dismiss alert"
      >
        <X size={14} />
      </button>
    </div>
  );
}
