"use client";

import { useState } from "react";
import { Hotel, HousePlus, Plus } from "lucide-react";
import { trpc } from "@/lib/trpc-client";
import { LodgingPanel } from "../components/LodgingPanel";
import { TabHeader } from "@/components/TabHeader";
import { TabFab } from "@/components/TabFab";
import type { TabProps } from "./types";

/**
 * Lodging tab — "where is everyone staying" surface.
 *
 * Follows the shared entry-tab cadence: TabHeader on top, content list
 * in the middle, mobile TabFab pinned to the bottom-right. The lodging
 * panel (in inline mode) renders the optional out-of-range nudge and
 * the property list; this tab owns the header, body copy, and add
 * affordance.
 */
export function LodgingTab({ trip, canEdit, embedded }: TabProps & { embedded?: boolean }) {
  const [addOpen, setAddOpen] = useState(false);
  const openAdd = () => setAddOpen(true);

  // Shares the tRPC cache with LodgingPanel — used here only to suppress
  // the header pill on the empty desktop state, where the boosted
  // RailComposer is the canonical primary CTA.
  const { data: items = [] } = trpc.logistics.list.useQuery({ tripId: trip.id });
  const lodgingCount = items.filter((i) => i.type === "lodging").length;
  const showHeaderAction = canEdit && lodgingCount > 0;

  return (
    <div className={embedded ? undefined : "px-4"}>
      <TabHeader
        eyebrow="Lodging"
        headline="Where everyone's staying"
        body="Drop in the places you're considering so the crew can compare — links, prices, sleep counts. Confirm the one(s) you book, and they're locked in as official trip details. Multi-property and multi-leg trips are fine — confirm as many as you need."
        desktopAction={
          showHeaderAction ? (
            <button
              type="button"
              onClick={openAdd}
              className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors hover:bg-[var(--color-bt-hover)]"
              style={{
                background: "var(--color-bt-card-raised)",
                color: "var(--color-bt-text)",
                border: "1px solid var(--color-bt-border)",
              }}
            >
              <Hotel size={13} />
              <Plus size={11} />
              Property
            </button>
          ) : undefined
        }
      />

      <LodgingPanel
        tripId={trip.id}
        canEdit={canEdit}
        isOpen={true}
        onToggle={() => {}}
        inline
        addOpen={addOpen}
        onAddOpenChange={setAddOpen}
      />

      {canEdit && (
        <TabFab
          onClick={openAdd}
          label="Add property"
          icon={<HousePlus size={20} strokeWidth={2.25} />}
          testId="add-property-fab"
        />
      )}
    </div>
  );
}
