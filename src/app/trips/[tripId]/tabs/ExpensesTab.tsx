"use client";

import { trpc } from "@/lib/trpc-client";
import { ExpensesSection, type ExpenseMember } from "./ExpensesSection";
import type { TabProps } from "./types";

/**
 * Receipts tab — what users see as "Receipts" in the tab bar even though
 * the underlying tRPC router, table, and types still use the `expenses`
 * name. Structure mirrors Schedule and Lodging: uppercase section header,
 * 1-2 sentence blurb, then an always-on add-on-top button followed by the
 * list (handled inside ExpensesSection).
 */
export function ExpensesTab({ trip, canEdit, isOwner }: TabProps) {
  const { data: members = [] } = trpc.tripMembers.list.useQuery({ tripId: trip.id });

  return (
    <div className="px-4">
      <section>
        <h2
          className="mb-2 text-xs font-semibold uppercase tracking-wider"
          style={{ color: "var(--color-bt-text-dim)" }}
        >
          Receipts
        </h2>

        <p
          className="mb-3 text-[13px] leading-relaxed"
          style={{ color: "var(--color-bt-text-dim)" }}
        >
          Log anything the crew pays for — group dinners, lodging, green
          fees, rentals. Pick who paid and who&apos;s splitting it and
          we&apos;ll keep the running balances straight so nobody has to
          chase anyone for money at the end of the trip.
        </p>

        <ExpensesSection
          tripId={trip.id}
          members={members as ExpenseMember[]}
          canEdit={canEdit}
          isOwner={isOwner ?? false}
        />
      </section>
    </div>
  );
}
