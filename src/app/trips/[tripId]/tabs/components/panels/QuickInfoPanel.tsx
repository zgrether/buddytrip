"use client";

import { useState } from "react";
import { Hash, Plus } from "lucide-react";
import { trpc } from "@/lib/trpc-client";
import { AddTileModal, QuickInfoSection } from "../../../components/QuickInfoSection";

// ── Types ────────────────────────────────────────────────────────────────

interface QuickInfoPanelProps {
  tripId: string;
  isOwner: boolean;
}

// ── Component ────────────────────────────────────────────────────────────

/**
 * QuickInfoPanel — home tab panel for owner-curated tiles (door codes,
 * check-in times, WiFi passwords, etc.).
 *
 * There's no activation gate anymore — the panel's empty state IS the
 * invitation. Tapping "Add quick info" opens AddTileModal directly; there's
 * no intermediate intro modal or quick_info_enabled flag to flip first.
 *
 * State machine:
 *   1. Tiles exist (any role) → live QuickInfoSection (its own surface,
 *      owns its QUICK INFO header + Add button, gated by isOwner).
 *   2. Owner, no tiles        → invitation card with a "+ Add quick info"
 *                               CTA that opens AddTileModal.
 *   3. Member, no tiles       → render nothing (Quick Info is owner-curated).
 */
export function QuickInfoPanel({ tripId, isOwner }: QuickInfoPanelProps) {
  const [addTileOpen, setAddTileOpen] = useState(false);
  const { data: tiles = [] } = trpc.quickInfoTiles.list.useQuery({ tripId });
  const hasItems = tiles.length > 0;

  // ── State 1: live (no panel shell — section is its own surface) ──────
  if (hasItems) {
    return <QuickInfoSection tripId={tripId} isOwner={isOwner} />;
  }

  // ── State 3: member, no tiles ────────────────────────────────────────
  if (!isOwner) {
    return null;
  }

  // ── State 2: owner, no tiles — invitation card straight to AddTileModal ─
  return (
    <>
      <div
        className="flex items-center gap-3 rounded-xl px-4 py-3.5"
        style={{
          background: "var(--color-bt-surface-invitation)",
          border: "1.5px dashed var(--color-bt-border)",
        }}
        data-testid="quick-info-invitation"
      >
        <div
          className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl"
          style={{
            background: "var(--color-bt-accent-faint)",
            color: "var(--color-bt-accent)",
          }}
        >
          <Hash size={18} />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-bold" style={{ color: "var(--color-bt-text)" }}>
            Pin the stuff everyone asks about
          </p>
          <p
            className="mt-0.5 text-xs leading-snug"
            style={{ color: "var(--color-bt-text-dim)" }}
          >
            {/* Copy tightens on phones where the card has little room next to
                the button; the fuller pitch returns at sm+. */}
            <span className="sm:hidden">Door codes, WiFi, check-in — one place.</span>
            <span className="hidden sm:inline">
              Door codes, WiFi, check-in times, the lockbox — one glance, no
              scrolling the chat for it.
            </span>
          </p>
        </div>
        <button
          type="button"
          onClick={() => setAddTileOpen(true)}
          data-testid="quick-info-add-btn"
          className="flex flex-shrink-0 items-center gap-1.5 rounded-lg px-3.5 py-2 text-xs font-semibold transition-opacity hover:opacity-90"
          style={{
            background: "var(--color-bt-accent)",
            color: "var(--color-bt-on-accent)",
          }}
        >
          <Plus size={14} strokeWidth={2.5} />
          <span className="hidden sm:inline">Add quick info</span>
          <span className="sm:hidden">Add</span>
        </button>
      </div>

      {addTileOpen && (
        <AddTileModal tripId={tripId} onClose={() => setAddTileOpen(false)} />
      )}
    </>
  );
}
