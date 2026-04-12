"use client";

import { useState } from "react";
import { useModalBackButton } from "@/hooks/useModalBackButton";
import { trpc } from "@/lib/trpc-client";
import type { IdeaLodgingOption } from "./IdeaZonePanel";

// ── Types ─────────────────────────────────────────────────────────────────

type Source = "vrbo" | "airbnb" | "hotel" | "other";

export interface AddIdeaLodgingSheetProps {
  tripId: string;
  ideaId: string;
  item?: IdeaLodgingOption; // present = edit mode
  onClose: () => void;
}

const SOURCE_OPTIONS: { value: Source; label: string }[] = [
  { value: "vrbo", label: "VRBO" },
  { value: "airbnb", label: "Airbnb" },
  { value: "hotel", label: "Hotel" },
  { value: "other", label: "Other" },
];

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

  const [source, setSource] = useState<Source | null>(
    (item?.source as Source) ?? null
  );
  const [name, setName] = useState(item?.name ?? "");
  const [sleeps, setSleeps] = useState(
    item?.sleeps != null ? String(item.sleeps) : ""
  );
  const [priceNote, setPriceNote] = useState(item?.price_note ?? "");
  const [url, setUrl] = useState(item?.url ?? "");

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

    if (isEditing) {
      update.mutate({
        id: item.id,
        tripId,
        name: name.trim(),
        source: source ?? null,
        sleeps: sleepsNum ?? null,
        priceNote: priceNote.trim() || null,
        url: url.trim() || null,
      });
    } else {
      create.mutate({
        ideaId,
        tripId,
        name: name.trim(),
        source: source ?? undefined,
        sleeps: sleepsNum,
        priceNote: priceNote.trim() || undefined,
        url: url.trim() || undefined,
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
        <div className="mx-auto mb-4 h-1 w-10 rounded-full lg:hidden" style={{ background: "var(--color-bt-border)" }} />

        <h2 className="mb-4 text-lg font-semibold" style={{ color: "var(--color-bt-text)" }}>
          {isEditing ? "Edit property" : "Add a property"}
        </h2>

        {/* Source pill selector */}
        <div className="mb-4">
          <p className="mb-2 text-xs font-medium" style={{ color: "var(--color-bt-text-dim)" }}>
            Platform
          </p>
          <div className="flex flex-wrap gap-2">
            {SOURCE_OPTIONS.map((opt) => {
              const isSelected = source === opt.value;
              return (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => setSource(isSelected ? null : opt.value)}
                  className="rounded-full px-3 py-1.5 text-sm font-medium transition-colors"
                  style={
                    isSelected
                      ? {
                          background: "var(--color-bt-accent)",
                          color: "var(--color-bt-base)",
                          border: "1px solid var(--color-bt-accent)",
                        }
                      : {
                          background: "var(--color-bt-card-raised)",
                          color: "var(--color-bt-text-dim)",
                          border: "1px solid var(--color-bt-border)",
                        }
                  }
                >
                  {opt.label}
                </button>
              );
            })}
          </div>
        </div>

        {/* Fields */}
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
              className="w-full rounded-xl border px-3 py-2.5 text-sm outline-none focus:ring-1"
              style={inputStyle}
            />
          </div>

          {/* Sleeps */}
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
              className="w-full rounded-xl border px-3 py-2.5 text-sm outline-none focus:ring-1"
              style={inputStyle}
            />
          </div>

          {/* Estimated price */}
          <div>
            <label className="mb-1 block text-xs font-medium" style={{ color: "var(--color-bt-text-dim)" }}>
              Estimated price
            </label>
            <input
              type="text"
              placeholder={`"$230/night", "~$2,300 total", etc.`}
              value={priceNote}
              onChange={(e) => setPriceNote(e.target.value)}
              className="w-full rounded-xl border px-3 py-2.5 text-sm outline-none focus:ring-1"
              style={inputStyle}
            />
          </div>

          {/* Link to listing */}
          <div>
            <label className="mb-1 block text-xs font-medium" style={{ color: "var(--color-bt-text-dim)" }}>
              Link to listing
            </label>
            <input
              type="url"
              placeholder="https://airbnb.com/rooms/…"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              className="w-full rounded-xl border px-3 py-2.5 text-sm outline-none focus:ring-1"
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
