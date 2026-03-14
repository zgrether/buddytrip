"use client";

import { useState } from "react";
import {
  Calendar,
  Check,
  X,
  Hotel,
  Clock,
  Utensils,
  Car,
  Plus,
} from "lucide-react";
import { trpc } from "@/lib/trpc-client";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { parseLocalDate } from "@/lib/dates";
import type { TabProps } from "./types";

// ── Types ────────────────────────────────────────────────────────────────

type VoteAnswer = "yes" | "no";
type ReservationType = "accommodation" | "tee-time" | "restaurant" | "transport";

interface DateWindow {
  id: string;
  start_date: string;
  end_date: string;
  votes: { window_id: string; user_id: string; answer: string }[];
}

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

const VOTE_ICON: Record<VoteAnswer, React.ReactNode> = {
  yes: <Check size={14} style={{ color: "var(--color-bt-accent)" }} />,
  no: <X size={14} style={{ color: "var(--color-bt-danger)" }} />,
};

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

// ── DatePoll section ────────────────────────────────────────────────────

function DatePollSection({
  tripId,
  canEdit,
}: {
  tripId: string;
  canEdit: boolean;
}) {
  const currentUser = useCurrentUser();
  const utils = trpc.useUtils();

  const { data: poll } = trpc.datePoll.get.useQuery({ tripId });
  const addWindow = trpc.datePoll.addWindow.useMutation({
    onSuccess: () => utils.datePoll.get.invalidate({ tripId }),
  });
  const vote = trpc.datePoll.vote.useMutation({
    onSuccess: () => utils.datePoll.get.invalidate({ tripId }),
  });

  const [addingWindow, setAddingWindow] = useState(false);
  const [newStart, setNewStart] = useState("");
  const [newEnd, setNewEnd] = useState("");

  const windows = (poll?.windows ?? []) as DateWindow[];

  const myVoteFor = (windowId: string): VoteAnswer | undefined => {
    const w = windows.find((w) => w.id === windowId);
    return w?.votes.find((v) => v.user_id === currentUser?.id)?.answer as
      | VoteAnswer
      | undefined;
  };

  return (
    <div className="space-y-3">
      {windows.length === 0 && (
        <p className="text-sm" style={{ color: "var(--color-bt-text-dim)" }}>
          No date options yet.{" "}
          {canEdit ? "Add some below." : "Waiting for a planner to add dates."}
        </p>
      )}

      {windows.map((w) => {
        const myVote = myVoteFor(w.id);
        const yesCount = w.votes.filter((v) => v.answer === "yes").length;
        const noCount = w.votes.filter((v) => v.answer === "no").length;

        return (
          <div
            key={w.id}
            className="rounded-xl p-4"
            style={{ background: "var(--color-bt-card)", border: "1px solid var(--color-bt-border)" }}
          >
            <p className="mb-3 text-sm font-medium" style={{ color: "var(--color-bt-text)" }}>
              {fmtDate(w.start_date)} – {fmtDate(w.end_date)}
            </p>
            <div
              className="mb-3 flex items-center gap-3 text-xs"
              style={{ color: "var(--color-bt-text-dim)" }}
            >
              <span>{yesCount} yes</span>
              <span>{noCount} no</span>
            </div>
            {currentUser && (
              <div className="flex gap-2">
                {(["yes", "no"] as VoteAnswer[]).map((ans) => (
                  <button
                    key={ans}
                    data-testid={`vote-${w.id}-${ans}`}
                    onClick={() =>
                      vote.mutate({ tripId, windowId: w.id, answer: ans })
                    }
                    className="flex flex-1 items-center justify-center gap-1.5 rounded-lg py-1.5 text-xs font-medium transition-all"
                    style={{
                      background:
                        myVote === ans
                          ? ans === "yes"
                            ? "var(--color-bt-tag-bg)"
                            : "var(--color-bt-danger-bg)"
                          : "var(--color-bt-base)",
                      border: `1px solid ${
                        myVote === ans
                          ? ans === "yes"
                            ? "var(--color-bt-accent)"
                            : "var(--color-bt-danger)"
                          : "var(--color-bt-border)"
                      }`,
                      color: ans === "yes" ? "var(--color-bt-accent)" : "var(--color-bt-danger)",
                    }}
                  >
                    {VOTE_ICON[ans]}
                    {ans === "yes" ? "Yes" : "No"}
                  </button>
                ))}
              </div>
            )}
          </div>
        );
      })}

      {canEdit &&
        (addingWindow ? (
          <div
            className="space-y-3 rounded-xl p-4"
            style={{ background: "var(--color-bt-card)", border: "1px solid var(--color-bt-border)" }}
          >
            <p className="text-sm font-medium" style={{ color: "var(--color-bt-text)" }}>
              Add date window
            </p>
            <div className="grid grid-cols-2 gap-3">
              <input
                type="date"
                value={newStart}
                onChange={(e) => setNewStart(e.target.value)}
                className="rounded-lg border px-3 py-2 text-sm outline-none"
                style={{
                  background: "var(--color-bt-base)",
                  borderColor: "var(--color-bt-border)",
                  color: "var(--color-bt-text)",
                  colorScheme: "inherit",
                }}
              />
              <input
                type="date"
                value={newEnd}
                min={newStart}
                onChange={(e) => setNewEnd(e.target.value)}
                className="rounded-lg border px-3 py-2 text-sm outline-none"
                style={{
                  background: "var(--color-bt-base)",
                  borderColor: "var(--color-bt-border)",
                  color: "var(--color-bt-text)",
                  colorScheme: "inherit",
                }}
              />
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => setAddingWindow(false)}
                className="flex-1 rounded-lg border py-2 text-sm"
                style={{ borderColor: "var(--color-bt-border)", color: "var(--color-bt-text-dim)" }}
              >
                Cancel
              </button>
              <button
                disabled={!newStart || !newEnd || addWindow.isPending}
                onClick={() => {
                  addWindow.mutate({
                    tripId,
                    id: crypto.randomUUID(),
                    startDate: newStart,
                    endDate: newEnd,
                  });
                  setAddingWindow(false);
                  setNewStart("");
                  setNewEnd("");
                }}
                className="flex-1 rounded-lg py-2 text-sm font-medium disabled:opacity-40"
                style={{ background: "var(--color-bt-accent)", color: "var(--color-bt-base)" }}
              >
                Add
              </button>
            </div>
          </div>
        ) : (
          <button
            onClick={() => setAddingWindow(true)}
            className="flex w-full items-center justify-center gap-2 rounded-xl border py-2.5 text-sm transition-colors hover:bg-[var(--color-bt-hover)]"
            style={{ borderColor: "var(--color-bt-border)", color: "var(--color-bt-accent)" }}
          >
            <Plus size={16} />
            Add date option
          </button>
        ))}
    </div>
  );
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
  return (
    <div className="space-y-6 px-4">
      <section>
        <h2
          className="mb-3 text-sm font-semibold uppercase tracking-wider"
          style={{ color: "var(--color-bt-text-dim)" }}
        >
          Date Poll
        </h2>
        <DatePollSection tripId={trip.id} canEdit={canEdit} />
      </section>

      <section>
        <h2
          className="mb-3 text-sm font-semibold uppercase tracking-wider"
          style={{ color: "var(--color-bt-text-dim)" }}
        >
          Reservations
        </h2>
        <ReservationsSection tripId={trip.id} canEdit={canEdit} />
      </section>
    </div>
  );
}
