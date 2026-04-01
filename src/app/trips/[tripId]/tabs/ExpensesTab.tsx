"use client";

import { trpc } from "@/lib/trpc-client";
import { ExpensesSection, type ExpenseMember } from "./ExpensesSection";
import type { TabProps } from "./types";

export function ExpensesTab({ trip, canEdit, isOwner }: TabProps) {
  const { data: members = [] } = trpc.tripMembers.list.useQuery({ tripId: trip.id });

  return (
    <div className="px-4">
      <h2
        className="mt-0 mb-3 text-xs font-semibold uppercase tracking-wider"
        style={{ color: "var(--color-bt-text-dim)" }}
      >
        Expenses
      </h2>
      <ExpensesSection
        tripId={trip.id}
        members={members as ExpenseMember[]}
        canEdit={canEdit}
        isOwner={isOwner ?? false}
      />
    </div>
  );
}
