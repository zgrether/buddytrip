"use client";

import { trpc } from "@/lib/trpc-client";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { RoleBadge } from "@/components/RoleBadge";
import type { TabProps } from "./types";
import type { TripRole } from "@/server/middleware";

// ── RSVP status config ────────────────────────────────────────────────────

const RSVP_LABEL: Record<string, { label: string; color: string }> = {
  in: { label: "In", color: "#00d4aa" },
  likely: { label: "Likely", color: "#a78bfa" },
  maybe: { label: "Maybe", color: "#7c93d4" },
  out: { label: "Out", color: "#ef4444" },
};

type RsvpStatus = "in" | "likely" | "maybe" | "out";

function RsvpBadge({ status }: { status: string }) {
  const cfg = RSVP_LABEL[status] ?? { label: status, color: "#8b949e" };
  return (
    <span
      className="inline-block rounded-full px-2 py-0.5 text-[10px] font-semibold"
      style={{ background: `${cfg.color}22`, color: cfg.color }}
    >
      {cfg.label}
    </span>
  );
}

// ── My RSVP selector ─────────────────────────────────────────────────────

function MyRsvpSelector({
  tripId,
  currentStatus,
}: {
  tripId: string;
  currentStatus?: string;
}) {
  const utils = trpc.useUtils();
  const updateRsvp = trpc.tripMembers.updateRsvp.useMutation({
    onSuccess: () => utils.tripMembers.list.invalidate({ tripId }),
  });

  return (
    <div
      className="rounded-xl p-4"
      style={{ background: "#161b22", border: "1px solid #30363d" }}
    >
      <p className="mb-3 text-sm font-medium" style={{ color: "#e6edf3" }}>
        My RSVP
      </p>
      <div className="flex gap-2">
        {(["in", "likely", "maybe", "out"] as RsvpStatus[]).map((s) => {
          const cfg = RSVP_LABEL[s];
          const active = currentStatus === s;
          return (
            <button
              key={s}
              data-testid={`rsvp-${s}`}
              onClick={() => updateRsvp.mutate({ tripId, status: s })}
              className="flex-1 rounded-lg py-1.5 text-xs font-medium transition-all"
              style={{
                background: active ? `${cfg.color}22` : "#0d1117",
                border: `1px solid ${active ? cfg.color : "#30363d"}`,
                color: cfg.color,
              }}
            >
              {cfg.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ── CrewTab ───────────────────────────────────────────────────────────────

export function CrewTab({ trip, isOwner }: TabProps) {
  const currentUser = useCurrentUser();
  const { data: members = [] } = trpc.tripMembers.list.useQuery({
    tripId: trip.id,
  });

  const me = members.find((m) => m.user_id === currentUser?.id);

  return (
    <div className="space-y-5 px-4">
      {/* My RSVP */}
      {me && (
        <MyRsvpSelector tripId={trip.id} currentStatus={me.status ?? undefined} />
      )}

      {/* Members list */}
      <section>
        <h2
          className="mb-3 text-sm font-semibold uppercase tracking-wider"
          style={{ color: "#8b949e" }}
        >
          Members ({members.length})
        </h2>

        <div className="space-y-2">
          {members.map((member) => {
            const isMe = member.user_id === currentUser?.id;
            const displayName =
              member.user?.name ?? member.user?.email ?? "Unknown";
            const initial = displayName.charAt(0).toUpperCase();

            return (
              <div
                key={member.user_id}
                data-testid={`member-${member.user_id}`}
                className="flex items-center gap-3 rounded-xl px-4 py-3"
                style={{ background: "#161b22", border: "1px solid #30363d" }}
              >
                {/* Avatar */}
                <div
                  className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full text-sm font-semibold"
                  style={{
                    background: isMe ? "#0d2a22" : "#1f1f1f",
                    color: isMe ? "#00d4aa" : "#8b949e",
                  }}
                >
                  {initial}
                </div>

                {/* Info */}
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <p
                      className="truncate text-sm font-medium"
                      style={{ color: "#e6edf3" }}
                    >
                      {displayName}
                      {isMe && (
                        <span className="ml-1 text-xs" style={{ color: "#8b949e" }}>
                          (you)
                        </span>
                      )}
                    </p>
                  </div>
                  {member.user?.email && (
                    <p
                      className="truncate text-xs"
                      style={{ color: "#8b949e" }}
                    >
                      {member.user.email}
                    </p>
                  )}
                </div>

                {/* Badges */}
                <div className="flex flex-shrink-0 flex-col items-end gap-1">
                  <RoleBadge role={member.role as TripRole} />
                  {member.status && <RsvpBadge status={member.status} />}
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {isOwner && (
        <p className="text-center text-xs" style={{ color: "#8b949e" }}>
          To invite members, use the trip settings in the More tab.
        </p>
      )}
    </div>
  );
}
