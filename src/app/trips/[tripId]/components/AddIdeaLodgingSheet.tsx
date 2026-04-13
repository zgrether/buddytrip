"use client";

import { useState } from "react";
import { Globe, Link } from "lucide-react";
import { useModalBackButton } from "@/hooks/useModalBackButton";
import { trpc } from "@/lib/trpc-client";
import type { IdeaLodgingOption } from "./IdeaZonePanel";

// ── Platform detection ────────────────────────────────────────────────────

type Source = "vrbo" | "airbnb" | "hotel" | "other";

const SOURCE_LABEL: Record<Source, string> = {
  airbnb: "AirBnB",
  vrbo:   "VRBO",
  hotel:  "Hotel",
  other:  "Listing",
};

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

function extractDomain(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

function isValidUrl(str: string): boolean {
  try {
    const u = new URL(str);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

/** Prepend https:// if the user forgot the protocol */
function ensureProtocol(val: string): string {
  const t = val.trim();
  if (!t || /^https?:\/\//i.test(t)) return t;
  return `https://${t}`;
}

// ── Link preview card ─────────────────────────────────────────────────────

function LinkPreviewCard({ url, name, source }: { url: string; name: string; source: Source }) {
  const domain = extractDomain(url);
  return (
    <div
      className="overflow-hidden rounded-xl"
      style={{ border: "1px solid var(--color-bt-accent-border)" }}
    >
      <div
        className="flex items-center gap-1.5 px-3 py-2"
        style={{ background: "var(--color-bt-tag-bg)" }}
      >
        <Globe size={11} style={{ color: "var(--color-bt-accent)" }} />
        <span className="text-[11px] font-medium" style={{ color: "var(--color-bt-accent)" }}>
          {domain}
        </span>
        <span
          className="ml-auto rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider"
          style={{ background: "var(--color-bt-accent)", color: "var(--color-bt-base)" }}
        >
          {SOURCE_LABEL[source]}
        </span>
      </div>
      <div className="px-3 py-2.5" style={{ background: "var(--color-bt-card-raised)" }}>
        {name ? (
          <p className="text-xs font-semibold" style={{ color: "var(--color-bt-text)" }}>{name}</p>
        ) : (
          <p className="text-xs italic" style={{ color: "var(--color-bt-text-dim)" }}>
            Add a nickname below if you&apos;d like
          </p>
        )}
        <p className="mt-0.5 truncate text-[11px]" style={{ color: "var(--color-bt-text-dim)" }}>
          {url.length > 55 ? url.slice(0, 52) + "…" : url}
        </p>
      </div>
    </div>
  );
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

  // Seed URL — edit mode: pre-fill
  const existingUrl = item?.url ?? "";
  const existingName = item?.name ?? "";

  const [url, setUrl] = useState(existingUrl);
  const [name, setName] = useState(existingName);
  const [sleeps, setSleeps] = useState(item?.sleeps != null ? String(item.sleeps) : "");
  const [priceNote, setPriceNote] = useState(item?.price_note ?? "");
  const [notes, setNotes] = useState(item?.notes ?? "");

  // Manual mode — skip URL requirement
  const [manualMode, setManualMode] = useState(isEditing && !existingUrl);

  const validUrl = isValidUrl(url);
  const source = validUrl ? detectSource(url) : "other";
  const showExpanded = validUrl || manualMode || isEditing;

  // In manual mode name is required; in URL mode name is optional (falls back to domain)
  const canSubmit =
    showExpanded &&
    (validUrl || manualMode) &&
    (!manualMode || name.trim().length > 0);

  const handleUrlBlur = () => {
    const prefixed = ensureProtocol(url);
    if (prefixed !== url) setUrl(prefixed);
  };

  const create = trpc.ideaLodging.create.useMutation({
    onSuccess: () => { utils.ideaLodging.list.invalidate({ ideaId }); onClose(); },
  });
  const update = trpc.ideaLodging.update.useMutation({
    onSuccess: () => { utils.ideaLodging.list.invalidate({ ideaId }); onClose(); },
  });

  const isPending = create.isPending || update.isPending;

  const handleSubmit = () => {
    if (!canSubmit) return;
    const sleepsNum = sleeps.trim() ? parseInt(sleeps.trim(), 10) : undefined;
    const trimmedUrl = url.trim() || undefined;
    // Fall back to domain if no name provided
    const resolvedName = name.trim() || (trimmedUrl ? extractDomain(trimmedUrl) : "Property");

    if (isEditing) {
      update.mutate({
        id: item.id,
        tripId,
        name: resolvedName,
        source: trimmedUrl ? detectSource(trimmedUrl) : null,
        sleeps: sleepsNum ?? null,
        priceNote: priceNote.trim() || null,
        url: trimmedUrl ?? null,
        notes: notes.trim() || null,
      });
    } else {
      create.mutate({
        ideaId,
        tripId,
        name: resolvedName,
        source: trimmedUrl ? detectSource(trimmedUrl) : undefined,
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

        {/* Header */}
        <h2 className="text-lg font-semibold" style={{ color: "var(--color-bt-text)" }}>
          {isEditing ? "Edit property" : "Add a property"}
        </h2>
        {!isEditing && !manualMode && (
          <p className="mt-0.5 text-sm" style={{ color: "var(--color-bt-text-dim)" }}>
            Paste a listing link, or{" "}
            <button
              onClick={() => setManualMode(true)}
              className="underline"
              style={{ color: "var(--color-bt-accent)" }}
            >
              enter manually
            </button>
          </p>
        )}

        {/* URL field */}
        <div className="relative mt-4">
          <Link
            size={15}
            className="absolute left-3 top-1/2 -translate-y-1/2"
            style={{ color: validUrl ? "var(--color-bt-accent)" : "var(--color-bt-text-dim)" }}
          />
          <input
            type="url"
            placeholder="https://airbnb.com/rooms/…"
            value={url}
            onChange={(e) => setUrl(e.target.value.trim())}
            onBlur={handleUrlBlur}
            // eslint-disable-next-line jsx-a11y/no-autofocus
            autoFocus={!isEditing && !manualMode}
            className="w-full rounded-xl border py-2.5 pl-9 pr-3 text-sm outline-none"
            style={{
              ...inputStyle,
              borderColor: validUrl ? "var(--color-bt-accent-border)" : "var(--color-bt-border)",
            }}
          />
        </div>

        {/* Link preview */}
        {validUrl && (
          <div className="mt-3">
            <p className="mb-1.5 text-[11px] font-medium uppercase tracking-wider" style={{ color: "var(--color-bt-text-dim)" }}>
              Preview
            </p>
            <LinkPreviewCard url={url} name={name} source={source} />
          </div>
        )}

        {/* Expanded optional fields */}
        {showExpanded && (
          <>
            <div className="mt-4 mb-3 flex items-center gap-2">
              <div className="flex-1 border-t" style={{ borderColor: "var(--color-bt-border)" }} />
              <span className="text-[11px] font-medium uppercase tracking-wider" style={{ color: "var(--color-bt-text-dim)" }}>
                {manualMode && !isEditing ? "Property Details" : "Optional"}
              </span>
              <div className="flex-1 border-t" style={{ borderColor: "var(--color-bt-border)" }} />
            </div>

            <div className="space-y-3">
              {/* Name — required in manual mode, optional with URL */}
              <input
                type="text"
                placeholder={manualMode && !isEditing ? "Property name *" : "Nickname — e.g. Beach House"}
                value={name}
                onChange={(e) => setName(e.target.value)}
                // eslint-disable-next-line jsx-a11y/no-autofocus
                autoFocus={manualMode && !isEditing}
                className="w-full rounded-xl border px-3 py-2.5 text-sm outline-none"
                style={{
                  ...inputStyle,
                  borderColor:
                    manualMode && !isEditing && name.trim()
                      ? "var(--color-bt-accent-border)"
                      : "var(--color-bt-border)",
                }}
              />

              {/* Sleeps + Est. price side by side */}
              <div className="grid grid-cols-2 gap-2">
                <input
                  type="number"
                  placeholder="Sleeps — e.g. 12"
                  min={1}
                  max={99}
                  value={sleeps}
                  onChange={(e) => setSleeps(e.target.value)}
                  className="w-full rounded-xl border px-3 py-2.5 text-sm outline-none"
                  style={inputStyle}
                />
                <input
                  type="text"
                  placeholder="~$2,300 total"
                  value={priceNote}
                  onChange={(e) => setPriceNote(e.target.value)}
                  className="w-full rounded-xl border px-3 py-2.5 text-sm outline-none"
                  style={inputStyle}
                />
              </div>

              {/* Thoughts */}
              <textarea
                placeholder="e.g. great pool, tons of space, perfect grilling deck"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={2}
                className="w-full resize-none rounded-xl border px-3 py-2.5 text-sm outline-none"
                style={inputStyle}
              />
            </div>
          </>
        )}

        {/* Actions */}
        <button
          onClick={handleSubmit}
          disabled={isPending || !canSubmit}
          className="mt-5 w-full rounded-xl py-3 text-sm font-semibold transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
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
