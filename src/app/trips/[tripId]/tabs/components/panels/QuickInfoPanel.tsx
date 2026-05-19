"use client";

import { useState } from "react";
import { Info, X } from "lucide-react";
import { trpc } from "@/lib/trpc-client";
import { AddTileModal, QuickInfoSection } from "../../../components/QuickInfoSection";
import { QuickInfoIntroModal } from "../modals/QuickInfoIntroModal";
import { InvitationCard } from "@/components/InvitationCard";
import type { TripData } from "../../types";

// ── Types ────────────────────────────────────────────────────────────────

interface QuickInfoPanelProps {
  tripId: string;
  isOwner: boolean;
  /** True once the owner has activated the panel via QuickInfoIntroModal. */
  isActivated: boolean;
}

// ── Component ────────────────────────────────────────────────────────────

/**
 * QuickInfoPanel — home tab panel for owner-curated tiles (door codes,
 * check-in times, WiFi passwords, etc.).
 *
 * State machine — mirrors GettingTherePanel / ItineraryPanel:
 *   1. Member, not activated  → render nothing (Quick Info is owner-curated)
 *   2. Owner, not activated   → standard InvitationCard ("Enable Quick Info
 *                               Tiles"). Tap → QuickInfoIntroModal →
 *                               onActivate fires trips.enableQuickInfoTiles
 *                               which flips quick_info_enabled = true.
 *   3. Owner, activated,
 *      no tiles yet           → rich skeleton mock-up (4-column grid of
 *                               sample tiles at reduced opacity) that hints
 *                               at the populated shape. Tap → AddTileModal
 *                               so the user can add their first tile.
 *   4. Tiles exist (any role) → live QuickInfoSection (no panel shell).
 *
 * QuickInfoSection owns its own QUICK INFO header + Add button; the +Add
 * and edit affordances inside are already gated by isOwner so members see
 * a read-only grid automatically.
 */
export function QuickInfoPanel({ tripId, isOwner, isActivated }: QuickInfoPanelProps) {
  const utils = trpc.useUtils();
  const [introOpen, setIntroOpen] = useState(false);
  const [addTileOpen, setAddTileOpen] = useState(false);
  const { data: tiles = [] } = trpc.quickInfoTiles.list.useQuery({ tripId });
  const hasItems = tiles.length > 0;

  const enableQuickInfoTiles = trpc.trips.enableQuickInfoTiles.useMutation({
    async onMutate() {
      await utils.trips.getById.cancel({ tripId });
      const prev = utils.trips.getById.getData({ tripId });
      utils.trips.getById.setData({ tripId }, (old: TripData | undefined) =>
        old ? { ...old, quick_info_enabled: true } : old
      );
      return { prev };
    },
    onError(_e, _v, ctx) {
      if (ctx?.prev !== undefined) utils.trips.getById.setData({ tripId }, ctx.prev);
    },
    onSuccess() {
      setIntroOpen(false);
    },
    onSettled() {
      utils.trips.getById.invalidate({ tripId });
    },
  });

  // Disable mutation — wired to the skeleton's X button so the owner can
  // back out of the activated empty state and return to the invitation card.
  const disableQuickInfoTiles = trpc.trips.disableQuickInfoTiles.useMutation({
    async onMutate() {
      await utils.trips.getById.cancel({ tripId });
      const prev = utils.trips.getById.getData({ tripId });
      utils.trips.getById.setData({ tripId }, (old: TripData | undefined) =>
        old ? { ...old, quick_info_enabled: false } : old
      );
      return { prev };
    },
    onError(_e, _v, ctx) {
      if (ctx?.prev !== undefined) utils.trips.getById.setData({ tripId }, ctx.prev);
    },
    onSettled() {
      utils.trips.getById.invalidate({ tripId });
    },
  });

  // ── State 4: live (no panel shell — section is its own surface) ──────
  if (hasItems) {
    return <QuickInfoSection tripId={tripId} isOwner={isOwner} />;
  }

  // ── State 1: member, not activated ───────────────────────────────────
  if (!isOwner) {
    return null;
  }

  // ── State 2: owner, not activated — standard InvitationCard ──────────
  if (!isActivated) {
    return (
      <>
        <InvitationCard
          Icon={Info}
          title="Enable Quick Info Tiles"
          body="Door codes, check-in times — the stuff everyone asks about, pinned for the crew."
          onClick={() => setIntroOpen(true)}
          testId="quick-info-invitation"
        />
        {introOpen && (
          <QuickInfoIntroModal
            isOpen
            onClose={() => setIntroOpen(false)}
            onActivate={() => enableQuickInfoTiles.mutate({ tripId })}
            isActivating={enableQuickInfoTiles.isPending}
          />
        )}
      </>
    );
  }

  // ── State 3: owner, activated, no tiles — rich skeleton mock-up ──────
  // Acts as the post-activation empty state. Mirrors the live tile grid
  // structure so the user can see exactly what they're about to build.
  // Tap the body → AddTileModal. Tap the X (top-right) → disable the
  // panel and revert to the invitation card.
  return (
    <>
      <div
        className="relative rounded-xl p-4"
        style={{
          background: "var(--color-bt-base)",
          border: "1px dashed var(--color-bt-border)",
        }}
        data-testid="quick-info-skeleton"
      >
        {/* X — disable the panel and pop back to the InvitationCard. Sits
            absolutely positioned above the body button so its own click
            doesn't bubble into the add-tile flow. */}
        <button
          type="button"
          onClick={() => disableQuickInfoTiles.mutate({ tripId })}
          aria-label="Disable Quick Info"
          data-testid="quick-info-skeleton-close"
          className="absolute right-2 top-2 z-10 flex h-7 w-7 items-center justify-center rounded-full transition-colors hover:bg-[var(--color-bt-hover)]"
          style={{ color: "var(--color-bt-text-dim)" }}
        >
          <X size={14} />
        </button>

        <button
          type="button"
          onClick={() => setAddTileOpen(true)}
          className="block w-full text-left"
          style={{ background: "transparent", border: "none", cursor: "pointer" }}
        >
          <div className="flex flex-col items-center text-center">
            <div
              className="mb-3 flex h-12 w-12 items-center justify-center rounded-2xl"
              style={{
                background: "var(--color-bt-accent-faint)",
                color: "var(--color-bt-accent)",
              }}
            >
              <Info size={22} />
            </div>
            <p
              className="text-sm font-bold"
              style={{ color: "var(--color-bt-text)" }}
            >
              Pin the stuff everyone asks about
            </p>
            <p
              className="mt-1 max-w-[280px] text-xs leading-snug"
              style={{ color: "var(--color-bt-text-dim)" }}
            >
              Door codes, check-in times, WiFi passwords, addresses — anything
              the crew will need at a glance.
            </p>
          </div>

          {/* Skeleton tile preview — 4-col grid mirroring the live state */}
          <div className="mt-4 grid grid-cols-4 gap-2" style={{ opacity: 0.65 }}>
            <SkeletonTile label="Door code" value="1234#" />
            <SkeletonTile label="Check-in" value="3:00 PM" />
            <SkeletonTile label="WiFi" value="BT_Guest" />
            <SkeletonTile label="Address" value="42 Oak St" />
          </div>
        </button>
      </div>

      {addTileOpen && (
        <AddTileModal tripId={tripId} onClose={() => setAddTileOpen(false)} />
      )}
    </>
  );
}

// ── SkeletonTile ─────────────────────────────────────────────────────────
// Compact mock tile used in the activated empty state. Mirrors the live
// tile structure so the empty state hints at the populated shape.

function SkeletonTile({ label, value }: { label: string; value: string }) {
  return (
    <div
      className="rounded-xl p-3"
      style={{
        background: "var(--color-bt-card)",
        border: "1px solid var(--color-bt-border)",
      }}
    >
      <p className="text-[10px]" style={{ color: "var(--color-bt-text-dim)" }}>
        {label}
      </p>
      <p
        className="mt-0.5 text-sm font-medium"
        style={{ color: "var(--color-bt-text)" }}
      >
        {value}
      </p>
    </div>
  );
}
