"use client";

import { useState } from "react";
import { Info } from "lucide-react";
import { trpc } from "@/lib/trpc-client";
import { AddTileModal, QuickInfoSection } from "../../../components/QuickInfoSection";
import { QuickInfoIntroModal } from "../modals/QuickInfoIntroModal";
import { InvitationCard } from "@/components/InvitationCard";

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
 * State machine:
 *   1. Member, no tiles  → render nothing (Quick Info is owner-curated)
 *   2. Owner, no tiles   → standard InvitationCard → opens
 *                          QuickInfoIntroModal → user confirms → drops the
 *                          user into AddTileModal so they can add their
 *                          first tile straight away.
 *   3. Tiles exist       → render QuickInfoSection directly (no panel
 *                          shell). The section already owns its QUICK INFO
 *                          header + add button + tile grid; the +Add and
 *                          edit affordances inside QuickInfoSection are
 *                          already gated by isOwner so member-mode just
 *                          drops them automatically.
 *
 * The previous rich-skeleton mock-up + X-to-dismiss workflow has been
 * retired so this panel matches the canonical InvitationCard pattern used
 * by Travel Plans, Itinerary, and Competition.
 */
export function QuickInfoPanel({ tripId, isOwner }: QuickInfoPanelProps) {
  const [introOpen, setIntroOpen] = useState(false);
  const [addTileOpen, setAddTileOpen] = useState(false);
  const { data: tiles = [] } = trpc.quickInfoTiles.list.useQuery({ tripId });
  const hasItems = tiles.length > 0;

  // ── State 3: live (no panel shell — section is its own surface) ──────
  if (hasItems) {
    return <QuickInfoSection tripId={tripId} isOwner={isOwner} />;
  }

  // ── State 1: member, no tiles ────────────────────────────────────────
  if (!isOwner) {
    return null;
  }

  // ── State 2: owner, no tiles — standard invitation card ──────────────
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
          onActivate={() => {
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
