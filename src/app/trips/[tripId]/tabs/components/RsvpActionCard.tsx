"use client";

import { Check, Minus, Plane, X } from "lucide-react";
import { trpc } from "@/lib/trpc-client";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { TravelEntryForm } from "../../components/TravelEntryForm";
import { ActionCard } from "./ActionCard";

const RSVP_OPTIONS = [
  {
    value: "in" as const,
    label: "In",
    icon: Check,
    selectedBg: "var(--color-bt-vote-yes)",
    selectedText: "var(--color-bt-vote-yes-text)",
  },
  {
    value: "maybe" as const,
    label: "Maybe",
    icon: Minus,
    selectedBg: "var(--color-bt-vote-maybe)",
    selectedText: "#ffffff",
  },
  {
    value: "out" as const,
    label: "Can't make it",
    icon: X,
    selectedBg: "var(--color-bt-vote-no)",
    selectedText: "#ffffff",
  },
];

export interface RsvpActionCardProps {
  tripId: string;
}

/**
 * RsvpActionCard — the going-stage Action Center surface that asks
 * "Are you in?". Uses the shared ActionCard shell. Keeps the yes/maybe/no
 * selector always visible so users can toggle their answer at any time;
 * when the viewer picks "in", the TravelEntryForm expands inside the card
 * so they can record how they're getting there.
 */
export function RsvpActionCard({ tripId }: RsvpActionCardProps) {
  const currentUser = useCurrentUser();
  const utils = trpc.useUtils();
  const { data: members = [] } = trpc.tripMembers.list.useQuery({ tripId });

  const setRsvp = trpc.tripMembers.setRsvpStatus.useMutation({
    async onMutate(vars) {
      await utils.tripMembers.list.cancel({ tripId });
      const prev = utils.tripMembers.list.getData({ tripId });
      utils.tripMembers.list.setData({ tripId }, (old) =>
        old?.map((m) =>
          m.user_id === currentUser?.id ? { ...m, rsvp_status: vars.rsvpStatus } : m
        )
      );
      return { prev };
    },
    onError(_err, _vars, context) {
      if (context?.prev) utils.tripMembers.list.setData({ tripId }, context.prev);
    },
    onSettled() {
      utils.tripMembers.list.invalidate({ tripId });
    },
  });

  const myMember = members.find((m) => m.user_id === currentUser?.id);
  const myRsvp = (myMember as { rsvp_status?: string | null } | undefined)?.rsvp_status ?? null;

  const inCount = members.filter(
    (m) => (m as { rsvp_status?: string | null }).rsvp_status === "in"
  ).length;
  const maybeCount = members.filter(
    (m) => (m as { rsvp_status?: string | null }).rsvp_status === "maybe"
  ).length;
  const outCount = members.filter(
    (m) => (m as { rsvp_status?: string | null }).rsvp_status === "out"
  ).length;
  const pendingCount = members.filter(
    (m) => (m as { rsvp_status?: string | null }).rsvp_status == null
  ).length;

  const summary = `${inCount} in · ${maybeCount} maybe · ${outCount} out · ${pendingCount} pending`;

  const title =
    myRsvp === "in"
      ? "You're in — tell the crew how you're getting there"
      : myRsvp === "maybe"
        ? "You're a maybe — change your mind any time"
        : myRsvp === "out"
          ? "You're out — change your mind any time"
          : "Are you in?";

  return (
    <ActionCard
      icon={<Plane size={14} />}
      title={title}
      subtitle={myRsvp == null ? "Let the crew know your RSVP." : undefined}
      isResolved={false}
    >
      <div className="flex gap-2">
        {RSVP_OPTIONS.map((opt) => {
          const isSelected = myRsvp === opt.value;
          const Icon = opt.icon;
          return (
            <button
              key={opt.value}
              onClick={() => {
                if (isSelected) return;
                setRsvp.mutate({ tripId, rsvpStatus: opt.value });
              }}
              disabled={setRsvp.isPending}
              data-testid={`rsvp-action-btn-${opt.value}`}
              className="flex flex-1 items-center justify-center gap-1.5 rounded-xl py-2.5 text-sm font-medium transition-all disabled:opacity-50"
              style={{
                background: isSelected ? opt.selectedBg : "var(--color-bt-card-raised)",
                color: isSelected ? opt.selectedText : "var(--color-bt-text)",
                border: isSelected ? "none" : "1px solid var(--color-bt-border)",
              }}
            >
              <Icon size={14} />
              {opt.label}
            </button>
          );
        })}
      </div>
      <p className="mt-3 text-[13px]" style={{ color: "var(--color-bt-text-dim)" }}>
        {summary}
      </p>

      {myRsvp === "in" && (
        <div className="mt-3 border-t pt-3" style={{ borderColor: "var(--color-bt-border)" }}>
          <TravelEntryForm
            tripId={tripId}
            currentTravel={
              myMember as Parameters<typeof TravelEntryForm>[0]["currentTravel"]
            }
          />
        </div>
      )}
    </ActionCard>
  );
}
