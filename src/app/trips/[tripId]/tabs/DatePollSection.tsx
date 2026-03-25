"use client";

import { useState } from "react";
import { Check, X, Plus } from "lucide-react";
import { trpc } from "@/lib/trpc-client";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { parseLocalDate } from "@/lib/dates";

type VoteAnswer = "yes" | "no";

interface DateWindow {
  id: string;
  start_date: string;
  end_date: string;
  votes: { window_id: string; user_id: string; answer: string }[];
}

const VOTE_ICON: Record<VoteAnswer, React.ReactNode> = {
  yes: <Check size={14} style={{ color: "var(--color-bt-accent)" }} />,
  no: <X size={14} style={{ color: "var(--color-bt-danger)" }} />,
};

function fmtDate(d: string) {
  return parseLocalDate(d).toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

export function DatePollSection({
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
    async onMutate(vars) {
      await utils.datePoll.get.cancel({ tripId });
      const prev = utils.datePoll.get.getData({ tripId });
      utils.datePoll.get.setData({ tripId }, {
        windows: [
          ...(prev?.windows ?? []),
          {
            id: vars.id,
            trip_id: tripId,
            start_date: vars.startDate,
            end_date: vars.endDate,
            created_at: new Date().toISOString(),
            votes: [],
          },
        ],
      });
      return { prev };
    },
    onError(_err, _vars, context) {
      if (context?.prev !== undefined) utils.datePoll.get.setData({ tripId }, context.prev);
    },
    onSettled() {
      utils.datePoll.get.invalidate({ tripId });
    },
  });
  const vote = trpc.datePoll.vote.useMutation({
    async onMutate(vars) {
      await utils.datePoll.get.cancel({ tripId });
      const prev = utils.datePoll.get.getData({ tripId });
      utils.datePoll.get.setData({ tripId }, {
        windows: (prev?.windows ?? []).map((w) => {
          if (w.id !== vars.windowId) return w;
          const existingVote = w.votes.find((v) => v.user_id === currentUser?.id);
          if (existingVote) {
            if (existingVote.answer === vars.answer) {
              return { ...w, votes: w.votes.filter((v) => v.user_id !== currentUser?.id) };
            }
            return {
              ...w,
              votes: w.votes.map((v) =>
                v.user_id === currentUser?.id ? { ...v, answer: vars.answer } : v
              ),
            };
          }
          return {
            ...w,
            votes: [
              ...w.votes,
              { window_id: vars.windowId, user_id: currentUser?.id ?? "", answer: vars.answer, created_at: new Date().toISOString() },
            ],
          };
        }),
      });
      return { prev };
    },
    onError(_err, _vars, context) {
      if (context?.prev !== undefined) utils.datePoll.get.setData({ tripId }, context.prev);
    },
    onSettled() {
      utils.datePoll.get.invalidate({ tripId });
    },
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
