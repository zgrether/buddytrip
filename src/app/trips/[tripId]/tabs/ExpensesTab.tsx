"use client";

import { useState } from "react";
import { Plus, Receipt } from "lucide-react";
import { trpc } from "@/lib/trpc-client";
import { ExpensesSection, type ExpenseMember } from "./ExpensesSection";
import { TabHeader } from "@/components/TabHeader";
import { TabFab } from "@/components/TabFab";
import type { TabProps } from "./types";

/**
 * Receipts tab — what users see as "Receipts" in the tab bar even though
 * the underlying tRPC router, table, and types still use the `expenses`
 * name.
 *
 * Layout follows the shared entry-tab cadence:
 *   1. TabHeader  — eyebrow + headline + body, desktop action pill on the right
 *   2. Content    — ExpensesSection (receipts list + balances panel)
 *   3. TabFab     — mobile-only floating "+" pinned to the bottom-right
 *
 * The add-receipt modal state is lifted up to this tab so all three
 * triggers (desktop header pill, mobile FAB, and any future surface)
 * open the same AddExpenseModal inside ExpensesSection.
 */
export function ExpensesTab({ trip, canEdit, isOwner }: TabProps) {
  const { data: members = [] } = trpc.tripMembers.list.useQuery({ tripId: trip.id });
  const { data: expenses = [] } = trpc.expenses.list.useQuery({ tripId: trip.id });

  const [addOpen, setAddOpen] = useState(false);
  const openAdd = () => setAddOpen(true);

  // Anyone can log a receipt (expenses.create is requireTripMember, not
  // Planner), so the header pill isn't gated by canEdit. On the empty
  // state the boosted rail composer is the primary CTA, so the redundant
  // header pill only appears once there's at least one receipt.
  const showHeaderAction = expenses.length > 0;

  return (
    <div className="px-4">
      <TabHeader
        eyebrow="Receipts"
        domain="receipts"
        headline="Track who paid for what"
        body="Log anything the crew pays for — group dinners, lodging, green fees, rentals. Pick who paid and who's splitting it and we'll keep balances straight so nobody chases anyone for money at the end."
        desktopAction={
          showHeaderAction ? (
            <button
              type="button"
              onClick={openAdd}
              data-testid="show-add-expense-btn"
              className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors hover:bg-[var(--color-bt-hover)]"
              style={{
                background: "var(--color-bt-card-raised)",
                color: "var(--color-bt-text)",
                border: "1px solid var(--color-bt-border)",
              }}
            >
              <Receipt size={13} />
              <Plus size={11} />
              Receipt
            </button>
          ) : undefined
        }
      />

      <ExpensesSection
        tripId={trip.id}
        members={members as ExpenseMember[]}
        canEdit={canEdit}
        isOwner={isOwner ?? false}
        addOpen={addOpen}
        onAddOpenChange={setAddOpen}
      />

      <TabFab
        onClick={openAdd}
        label="Add receipt"
        // Lucide doesn't ship a ReceiptPlus combo, so we stack a Receipt
        // glyph with a small Plus tucked at the top-right — same visual
        // grammar as UserPlus / CalendarPlus / HousePlus elsewhere.
        icon={
          <span className="relative inline-flex items-center justify-center">
            <Receipt size={20} strokeWidth={2.25} />
            <Plus
              size={11}
              strokeWidth={3.5}
              className="absolute -right-1.5 -top-1"
            />
          </span>
        }
        testId="show-add-expense-fab"
      />
    </div>
  );
}
