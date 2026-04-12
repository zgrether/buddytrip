"use client";

import { useState } from "react";
import { useModalBackButton } from "@/hooks/useModalBackButton";
import { trpc } from "@/lib/trpc-client";
import type { IdeaLodgingOption } from "./IdeaZonePanel";

// ── Platform auto-detection from URL ─────────────────────────────────────

type Source = "vrbo" | "airbnb" | "hotel" | "other";

function detectSource(url: string): Source {
  try {
    const host = new URL(url).hostname.toLowerCase();
    if (host.includes("airbnb"))                              return "airbnb";
    if (host.includes("vrbo") || host.includes("homeaway"))   return "vrbo";
    if (host.includes("booking.com") || host.includes("marriott") || host.includes("hilton")) return "hotel";
    return "other";
  } catch {
    return "other";
  }
}

// ── Types ─────────────────────────────────────────────────────────────────

export interface AddIdeaLodgingSheetProps {
  tripId: string;
  ideaId: string;
  item?: IdeaLodgingOption; // present = edit mode
  onClose: () => void;
}

const inputStyle = {
  background: "var(--color-bt-card-raised)",
  borderColor: "var(--color-bt-border)",
  color: "var(--color-bt-text)",
};

// ── Sheet ─────────────────────────────────────────────────────────────────

export function AddIdeaLodgingSheet({
  tripId,
  ideaId,
  item,
  onClose,
}: AddIdeaLodgingSheetProps) {
  useModalBackButton(onClose);
  const utils = trpc.useUtils();
  const isEditing = !!item;

  const [name, setName] = useState(item?.name ?? "");
  const [url, setUrl] = useState(item?.url ?? "");
  const [sleeps, setSleeps] = useState(
    item?.sleeps != null ? String(item.sleeps) : ""
  );
  const [priceNote, setPriceNote] = useState(item?.price_note ?? "");
  const [notes, setNotes] = useState(item?.notes ?? "");

  const create = trpc.ideaLodging.create.useMutation({
    onSuccess: () => {
      utils.ideaLodging.list.invalidate({ ideaId });
      onClose();
    },
  });

  const update = trpc.ideaLodging.update.useMutation({
    onSuccess: () => {
      utils.ideaLodging.list.invalidate({ ideaId });
      onClose();
    },
  });

  const isPending = create.isPending || update.isPending;
  const canSubmit = name.trim().length > 0;

  const handleSubmit = () => {
    if (!canSubmit) return;
    const sleepsNum = sleeps.trim() ? parseInt(sleeps.trim(), 10) : undefined;
    const trimmedUrl = url.trim() || undefined;
    const source = trimmedUrl ? detectSource(trimmedUrl) : undefined;

    if (isEditing) {
      update.mutate({
        id: item.id,
        tripId,
        name: name.trim(),
        source: source ?? null,
        sleeps: sleepsNum ?? null,
        priceNote: priceNote.trim() || null,
        url: trimmedUrl ?? null,
        notes: notes.trim() || null,
      });
    } else {
      create.mutate({
        ideaId,
        tripId,
        name: name.trim(),
        source,
        sleeps: sleepsNum,
        priceNote: priceNote.trim() || undefined,
        url: trimmedUrl,
        notes: notes.trim() || undefined,
      });
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center lg:items-center"
      style={{ background: "var(--color-bt-overlay)" }}
      onClick={onClose}
    >
      <div
        className="max-h-[85vh] w-full max-w-[400px] overflow-y-auto rounded-t-2xl p-5 lg:rounded-2xl"
        style={{ background: "var(--color-bt-card)" }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Handle bar (mobile) */}
        <div
          className="mx-auto mb-4 h-1 w-10 rounded-full lg:hidden"
          style={{ background: "var(--color-bt-border)" }}
        />

        <h2 className="mb-4 text-lg font-semibold" style={{ color: "var(--color-bt-text)" }}>
          {isEditing ? "Edit property" : "Add a property"}
        </h2>

        <div className="space-y-3">
          {/* Property name — required */}
          <div>
            <label className="mb-1 block text-xs font-medium" style={{ color: "var(--color-bt-text-dim)" }}>
              Property name <span style={{ color: "var(--color-bt-danger)" }}>*</span>
            </label>
            <input
              type="text"
              placeholder="e.g. Beach House, The Lodge"
              value={name}
              onChange={(e) => setName(e.target.value)}
              // eslint-disable-next-line jsx-a11y/no-autofocus
              autoFocus={!isEditing}
              className="w-full rounded-xl border px-3 py-2.5 text-sm outline-none"
              style={inputStyle}
            />
          </div>

          {/* Link to listing — below name */}
          <div>
            <label className="mb-1 block text-xs font-medium" style={{ color: "var(--color-bt-text-dim)" }}>
              Link to listing
            </label>
            <input
              type="url"
              placeholder="https://airbnb.com/rooms/…"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              className="w-full rounded-xl border px-3 py-2.5 text-sm outline-none"
              style={inputStyle}
            />
          </div>

          {/* Sleeps + Estimated price — side by side */}
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="mb-1 block text-xs font-medium" style={{ color: "var(--color-bt-text-dim)" }}>
                Sleeps
              </label>
              <input
                type="number"
                placeholder="e.g. 12"
                min={1}
                max={99}
                value={sleeps}
                onChange={(e) => setSleeps(e.target.value)}
                className="w-full rounded-xl border px-3 py-2.5 text-sm outline-none"
                style={inputStyle}
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium" style={{ color: "var(--color-bt-text-dim)" }}>
                Est. price
              </label>
              <input
                type="text"
                placeholder="~$2,300 total"
                value={priceNote}
                onChange={(e) => setPriceNote(e.target.value)}
                className="w-full rounded-xl border px-3 py-2.5 text-sm outline-none"
                style={inputStyle}
              />
            </div>
          </div>

          {/* Thoughts — free text notes */}
          <div>
            <label className="mb-1 block text-xs font-medium" style={{ color: "var(--color-bt-text-dim)" }}>
              Thoughts
            </label>
            <textarea
              placeholder="e.g. great pool, tons of space, perfect grilling deck"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              className="w-full resize-none rounded-xl border px-3 py-2.5 text-sm outline-none"
              style={inputStyle}
            />
          </div>
        </div>

        {/* Actions */}
        <button
          onClick={handleSubmit}
          disabled={isPending || !canSubmit}
          className="mt-5 w-full rounded-xl py-3 text-sm font-semibold transition-opacity hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed"
          style={{ background: "var(--color-bt-accent)", color: "var(--color-bt-base)" }}
        >
          {isPending
            ? isEditing ? "Saving..." : "Adding..."
            : isEditing ? "Save changes" : "Add property"}
        </button>
        <button
          onClick={onClose}
          className="mt-2 w-full rounded-xl py-2.5 text-sm transition-opacity hover:opacity-80"
          style={{ color: "var(--color-bt-text-dim)", border: "0.5px solid var(--color-bt-border)" }}
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
