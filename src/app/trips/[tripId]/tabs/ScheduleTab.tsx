"use client";

import {
  Calendar,
  Hotel,
  Clock,
  Utensils,
  Car,
  Plus,
  X,
} from "lucide-react";
import { trpc } from "@/lib/trpc-client";
import { parseLocalDate } from "@/lib/dates";
import { ExpensesSection, type ExpenseMember } from "./ExpensesSection";
import type { TabProps } from "./types";

// ── Types ────────────────────────────────────────────────────────────────

type ReservationType = "accommodation" | "tee-time" | "restaurant" | "transport";

interface Reservation {
  id: string;
  type: ReservationType;
  title: string;
  date?: string | null;
  start_time?: string | null;
  confirmation_number?: string | null;
  notes?: string | null;
}

// ── Helpers ──────────────────────────────────────────────────────────────

const RES_ICON: Record<ReservationType, React.ReactNode> = {
  accommodation: <Hotel size={16} />,
  "tee-time": <Calendar size={16} />,
  restaurant: <Utensils size={16} />,
  transport: <Car size={16} />,
};

function fmtDate(d: string) {
  return parseLocalDate(d).toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

// ── Reservations section ─────────────────────────────────────────────────

function ReservationsSection({
  tripId,
  canEdit,
}: {
  tripId: string;
  canEdit: boolean;
}) {
  const utils = trpc.useUtils();
  const { data: reservations = [] } = trpc.reservations.list.useQuery({ tripId });

  const removeRes = trpc.reservations.remove.useMutation({
    onSuccess: () => utils.reservations.list.invalidate({ tripId }),
  });

  if (reservations.length === 0) {
    return (
      <p className="text-sm" style={{ color: "var(--color-bt-text-dim)" }}>
        No reservations yet.{" "}
        {canEdit && "Add tee times, hotels, and more from the planner view."}
      </p>
    );
  }

  return (
    <div className="space-y-2">
      {(reservations as Reservation[]).map((res) => (
        <div
          key={res.id}
          data-testid={`reservation-${res.id}`}
          className="flex items-start gap-3 rounded-xl p-4"
          style={{ background: "var(--color-bt-card)", border: "1px solid var(--color-bt-border)" }}
        >
          <span style={{ color: "var(--color-bt-accent)" }}>{RES_ICON[res.type]}</span>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium" style={{ color: "var(--color-bt-text)" }}>
              {res.title}
            </p>
            <div
              className="mt-1 flex flex-wrap gap-2 text-xs"
              style={{ color: "var(--color-bt-text-dim)" }}
            >
              {res.date && (
                <span className="flex items-center gap-1">
                  <Calendar size={10} />
                  {fmtDate(res.date)}
                </span>
              )}
              {res.start_time && (
                <span className="flex items-center gap-1">
                  <Clock size={10} />
                  {res.start_time}
                </span>
              )}
              {res.confirmation_number && (
                <span>#{res.confirmation_number}</span>
              )}
            </div>
            {res.notes && (
              <p className="mt-1 text-xs" style={{ color: "var(--color-bt-text-dim)" }}>
                {res.notes}
              </p>
            )}
          </div>
          {canEdit && (
            <button
              onClick={() =>
                removeRes.mutate({ tripId, reservationId: res.id })
              }
              className="flex h-6 w-6 items-center justify-center rounded-full"
              style={{ color: "var(--color-bt-text-dim)" }}
            >
              <X size={14} />
            </button>
          )}
        </div>
      ))}
    </div>
  );
}

// ── ScheduleTab ─────────────────────────────────────────────────────────

export function ScheduleTab({ trip, canEdit }: TabProps) {
  const { data: members = [] } = trpc.tripMembers.list.useQuery({ tripId: trip.id });

  return (
    <div className="space-y-6 px-4">
      <section>
        <h2
          className="mb-3 text-sm font-semibold uppercase tracking-wider"
          style={{ color: "var(--color-bt-text-dim)" }}
        >
          Reservations
        </h2>
        <ReservationsSection tripId={trip.id} canEdit={canEdit} />
      </section>

      {/* Expenses — moved from More tab per SPEC 2 */}
      <section>
        <h2
          className="mb-3 text-sm font-semibold uppercase tracking-wider"
          style={{ color: "var(--color-bt-text-dim)" }}
        >
          Expenses
        </h2>
        <ExpensesSection
          tripId={trip.id}
          members={members as ExpenseMember[]}
          canEdit={canEdit}
        />
      </section>
    </div>
  );
}
