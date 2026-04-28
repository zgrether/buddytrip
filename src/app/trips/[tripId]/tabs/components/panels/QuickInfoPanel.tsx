"use client";

import { useState } from "react";
import { ArrowRight, Info, X } from "lucide-react";
import { trpc } from "@/lib/trpc-client";
import { AddTileModal, QuickInfoSection } from "../../../components/QuickInfoSection";
import { QuickInfoIntroModal } from "../modals/QuickInfoIntroModal";
import type { TripData } from "../../types";

// ── Types ────────────────────────────────────────────────────────────────

interface QuickInfoPanelProps {
  tripId: string;
  isOwner: boolean;
  /** Owner has X'd out the empty state — panel renders nothing. */
  isDismissed: boolean;
}

// ── Component ────────────────────────────────────────────────────────────

/**
 * QuickInfoPanel — home tab panel for owner-curated tiles (door codes,
 * check-in times, WiFi passwords, etc.).
 *
 * State machine:
 *   1. Member, no tiles  → render nothing (Quick Info is owner-curated)
 *   2. Owner, no tiles   → invitation card → opens QuickInfoIntroModal,
 *                           which routes through to the existing
 *                           QuickInfoSection's empty-state add flow
 *   3. Tiles exist       → render QuickInfoSection directly (no panel
 *                           shell). The section already owns its QUICK INFO
 *                           header + add button + tile grid; the +Add and
 *                           edit affordances inside QuickInfoSection are
 *                           already gated by isOwner so member-mode just
 *                           drops them automatically.
 */
export function QuickInfoPanel({ tripId, isOwner, isDismissed }: QuickInfoPanelProps) {
  const [introOpen, setIntroOpen] = useState(false);
  const [addTileOpen, setAddTileOpen] = useState(false);
  const { data: tiles = [] } = trpc.quickInfoTiles.list.useQuery({ tripId });
  const hasItems = tiles.length > 0;
  const utils = trpc.useUtils();

  const dismissQuickInfo = trpc.trips.dismissQuickInfo.useMutation({
    async onMutate() {
      await utils.trips.getById.cancel({ tripId });
      const prev = utils.trips.getById.getData({ tripId });
      utils.trips.getById.setData({ tripId }, (old: TripData | undefined) =>
        old ? { ...old, quick_info_dismissed: true } : old
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

  const restoreQuickInfo = trpc.trips.restoreQuickInfo.useMutation({
    async onMutate() {
      await utils.trips.getById.cancel({ tripId });
      const prev = utils.trips.getById.getData({ tripId });
      utils.trips.getById.setData({ tripId }, (old: TripData | undefined) =>
        old ? { ...old, quick_info_dismissed: false } : old
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

  // ── State 3: live (no panel shell — section is its own surface) ──────
  if (hasItems) {
    return <QuickInfoSection tripId={tripId} isOwner={isOwner} />;
  }

  // ── State 1: member, no tiles ────────────────────────────────────────
  if (!isOwner) {
    return null;
  }

  // ── State 4: owner, dismissed — "Enable Quick Info Tiles" CTA card ──
  // Tapping the CTA opens the intro modal but does NOT change any flags
  // yet — the user needs to confirm via the modal CTA.
  //   - Cancel → stay dismissed.
  //   - Confirm → un-dismiss + close modal. The user lands on the rich
  //     empty state (the not-dismissed branch below). They can tap that
  //     to open the modal again and add a tile if they want — this
  //     deliberately doesn't auto-open AddTileModal so the user actually
  //     sees the rich empty state they just enabled.
  if (isDismissed) {
    return (
      <>
        <DismissedInvitationCard onClick={() => setIntroOpen(true)} />
        {introOpen && (
          <QuickInfoIntroModal
            isOpen
            onClose={() => setIntroOpen(false)}
            onActivate={() => {
              restoreQuickInfo.mutate({ tripId });
              setIntroOpen(false);
            }}
            isActivating={false}
          />
        )}
      </>
    );
  }

  // ── State 2: owner, no tiles, invitation w/ skeleton mock-up ─────────
  // Empty state matches Itinerary / Getting There: dashed card on the
  // base surface (not surface-invitation), 1px border, X in top-right
  // to dismiss.
  return (
    <>
      <div
        className="relative rounded-xl p-4"
        style={{
          background: "var(--color-bt-base)",
          border: "1px dashed var(--color-bt-border)",
        }}
        data-testid="quick-info-invitation"
      >
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            dismissQuickInfo.mutate({ tripId });
          }}
          aria-label="Dismiss Quick Info"
          data-testid="quick-info-empty-cancel"
          className="absolute right-2 top-2 flex h-7 w-7 items-center justify-center rounded-full transition-colors hover:bg-[var(--color-bt-hover)]"
          style={{ color: "var(--color-bt-text-dim)" }}
        >
          <X size={14} />
        </button>

        <button
          type="button"
          onClick={() => setIntroOpen(true)}
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
            <p className="text-sm font-bold" style={{ color: "var(--color-bt-text)" }}>
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
          <div
            className="mt-4 grid grid-cols-4 gap-2"
            style={{ opacity: 0.65 }}
          >
            <SkeletonTile label="Door code" value="1234#" />
            <SkeletonTile label="Check-in" value="3:00 PM" />
            <SkeletonTile label="WiFi" value="BT_Guest" />
            <SkeletonTile label="Address" value="42 Oak St" />
          </div>
        </button>
      </div>

      {introOpen && (
        <QuickInfoIntroModal
          isOpen
          onClose={() => setIntroOpen(false)}
          onActivate={() => {
            // Drop straight into the add-first-tile flow — close the intro
            // and open AddTileModal back to back.
            setIntroOpen(false);
            setAddTileOpen(true);
          }}
          isActivating={false}
        />
      )}
      {addTileOpen && (
        <AddTileModal tripId={tripId} onClose={() => setAddTileOpen(false)} />
      )}
    </>
  );
}

// ── DismissedInvitationCard ──────────────────────────────────────────────
// Smaller "Add Quick Info" CTA card shown when the owner has dismissed the
// rich empty-state mock-up. Same shape as the Itinerary / Getting There
// invitation cards. Tap → un-dismiss, the rich mock-up reappears.

function DismissedInvitationCard({ onClick }: { onClick: () => void }) {
  const [hover, setHover] = useState(false);
  return (
    <button
      type="button"
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      data-testid="quick-info-restore"
      className="w-full rounded-xl px-4 py-5 text-left transition-colors"
      style={{
        background: hover
          ? "var(--color-bt-accent-faint)"
          : "var(--color-bt-surface-invitation)",
        border: `1.5px dashed ${
          hover ? "var(--color-bt-accent-border)" : "var(--color-bt-border)"
        }`,
        cursor: "pointer",
      }}
    >
      <div className="flex items-start gap-3">
        <div
          className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl"
          style={{
            background: "var(--color-bt-accent-faint)",
            color: "var(--color-bt-accent)",
          }}
        >
          <Info size={18} />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-bold" style={{ color: "var(--color-bt-text)" }}>
            Enable Quick Info Tiles
          </p>
          <p
            className="mt-1 text-xs leading-snug"
            style={{ color: "var(--color-bt-text-dim)" }}
          >
            Door codes, check-in times — the stuff everyone asks about,
            pinned for the crew.
          </p>
        </div>
        <ArrowRight
          size={16}
          style={{
            color: "var(--color-bt-accent)",
            flexShrink: 0,
            opacity: hover ? 1 : 0,
            transition: "opacity 150ms",
          }}
        />
      </div>
    </button>
  );
}

// ── SkeletonTile ─────────────────────────────────────────────────────────
// Compact mock tile used in the invitation empty state. Mirrors the
// live tile structure so the empty state hints at the populated shape.

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

