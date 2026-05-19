"use client";

import { useState } from "react";
import { Hotel, Plus } from "lucide-react";
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

  return (
    <div className={embedded ? undefined : "px-4"}>
      <TabHeader
        eyebrow="Lodging"
        headline="Where everyone's staying"
        body="Drop in the places you're considering so the crew can compare — links, prices, sleep counts, anything helpful. Confirm the winner once it's booked and it locks onto the official trip details."
        desktopAction={
          canEdit ? (
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
          testId="add-property-fab"
        />
      )}
    </div>
  );
}
