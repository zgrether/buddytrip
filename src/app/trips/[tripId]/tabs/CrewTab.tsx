"use client";

import { useState } from "react";
import { Search, UserPlus } from "lucide-react";
import { trpc } from "@/lib/trpc-client";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { RoleBadge } from "@/components/RoleBadge";
import type { TabProps } from "./types";
import type { TripRole } from "@/server/middleware";

// ── RSVP status config ────────────────────────────────────────────────────

const RSVP_LABEL: Record<string, { label: string; color: string }> = {
  in: { label: "In", color: "var(--color-bt-accent)" },
  likely: { label: "Likely", color: "var(--color-bt-ready)" },
  maybe: { label: "Maybe", color: "var(--color-bt-planning)" },
  out: { label: "Out", color: "var(--color-bt-danger)" },
};

type RsvpStatus = "in" | "likely" | "maybe" | "out";

function RsvpBadge({ status }: { status: string }) {
  const cfg = RSVP_LABEL[status] ?? { label: status, color: "var(--color-bt-text-dim)" };
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
      style={{ background: "var(--color-bt-card)", border: "1px solid var(--color-bt-border)" }}
    >
      <p className="mb-3 text-sm font-medium" style={{ color: "var(--color-bt-text)" }}>
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
                background: active ? `${cfg.color}22` : "var(--color-bt-base)",
                border: `1px solid ${active ? cfg.color : "var(--color-bt-border)"}`,
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

// ── InviteMember ──────────────────────────────────────────────────────────

function InviteMember({
  tripId,
  existingMemberIds,
}: {
  tripId: string;
  existingMemberIds: string[];
}) {
  const utils = trpc.useUtils();
  const [query, setQuery] = useState("");
  const [addedId, setAddedId] = useState<string | null>(null);

  const { data: results = [], isFetching } = trpc.users.search.useQuery(
    { query },
    { enabled: query.trim().length >= 2 }
  );

  const addMember = trpc.tripMembers.add.useMutation({
    onSuccess: (_, vars) => {
      utils.tripMembers.list.invalidate({ tripId });
      setAddedId(vars.userId);
      setQuery("");
    },
  });

  const filtered = results.filter((u) => !existingMemberIds.includes(u.id));

  return (
    <div
      className="space-y-3 rounded-xl p-4"
      style={{ background: "var(--color-bt-card)", border: "1px solid var(--color-bt-border)" }}
    >
      <p className="text-sm font-medium" style={{ color: "var(--color-bt-text)" }}>
        Add to Trip
      </p>

      {/* Search input */}
      <div className="relative">
        <Search
          size={14}
          className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2"
          style={{ color: "var(--color-bt-text-dim)" }}
        />
        <input
          data-testid="invite-search-input"
          type="email"
          placeholder="Search by email…"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setAddedId(null);
          }}
          className="w-full rounded-lg border py-2 pl-8 pr-3 text-sm outline-none"
          style={{
            background: "var(--color-bt-base)",
            borderColor: "var(--color-bt-border)",
            color: "var(--color-bt-text)",
          }}
        />
      </div>

      {/* Results */}
      {query.trim().length >= 2 && (
        <div className="space-y-1.5">
          {isFetching ? (
            <p className="text-xs" style={{ color: "var(--color-bt-text-dim)" }}>
              Searching…
            </p>
          ) : filtered.length === 0 ? (
            <p className="text-xs" style={{ color: "var(--color-bt-text-dim)" }}>
              No users found. They must sign up first.
            </p>
          ) : (
            filtered.map((user) => {
              const displayName = user.name ?? user.email ?? user.id;
              const justAdded = addedId === user.id;
              return (
                <div
                  key={user.id}
                  className="flex items-center gap-3 rounded-lg px-3 py-2"
                  style={{ background: "var(--color-bt-base)", border: "1px solid var(--color-bt-border)" }}
                >
                  <div
                    className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full text-xs font-semibold"
                    style={{ background: "var(--color-bt-past-bg)", color: "var(--color-bt-text-dim)" }}
                  >
                    {displayName.charAt(0).toUpperCase()}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm" style={{ color: "var(--color-bt-text)" }}>
                      {displayName}
                    </p>
                    {user.name && (
                      <p className="truncate text-xs" style={{ color: "var(--color-bt-text-dim)" }}>
                        {user.email}
                      </p>
                    )}
                  </div>
                  <button
                    data-testid={`invite-btn-${user.id}`}
                    disabled={addMember.isPending || justAdded}
                    onClick={() =>
                      addMember.mutate({ tripId, userId: user.id, role: "Member" })
                    }
                    className="flex flex-shrink-0 items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs font-medium disabled:opacity-40"
                    style={{ background: "var(--color-bt-accent-faint)", color: "var(--color-bt-accent)", border: "1px solid var(--color-bt-accent-border)" }}
                  >
                    <UserPlus size={12} />
                    {justAdded ? "Added!" : "Add"}
                  </button>
                </div>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}

// ── CrewTab ───────────────────────────────────────────────────────────────

export function CrewTab({ trip, canEdit }: TabProps) {
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
          style={{ color: "var(--color-bt-text-dim)" }}
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
                style={{ background: "var(--color-bt-card)", border: "1px solid var(--color-bt-border)" }}
              >
                {/* Avatar */}
                <div
                  className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full text-sm font-semibold"
                  style={{
                    background: isMe ? "var(--color-bt-tag-bg)" : "var(--color-bt-past-bg)",
                    color: isMe ? "var(--color-bt-accent)" : "var(--color-bt-text-dim)",
                  }}
                >
                  {initial}
                </div>

                {/* Info */}
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <p
                      className="truncate text-sm font-medium"
                      style={{ color: "var(--color-bt-text)" }}
                    >
                      {displayName}
                      {isMe && (
                        <span className="ml-1 text-xs" style={{ color: "var(--color-bt-text-dim)" }}>
                          (you)
                        </span>
                      )}
                    </p>
                  </div>
                  {member.user?.email && (
                    <p
                      className="truncate text-xs"
                      style={{ color: "var(--color-bt-text-dim)" }}
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

      {canEdit && (
        <section>
          <h2
            className="mb-3 text-sm font-semibold uppercase tracking-wider"
            style={{ color: "var(--color-bt-text-dim)" }}
          >
            Invite
          </h2>
          <InviteMember
            tripId={trip.id}
            existingMemberIds={members.map((m) => m.user_id)}
          />
        </section>
      )}
    </div>
  );
}
