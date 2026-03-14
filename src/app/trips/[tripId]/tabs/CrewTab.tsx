"use client";

import { useState } from "react";
import { Ghost, Search, UserPlus } from "lucide-react";
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
  const currentUser = useCurrentUser();
  const updateRsvp = trpc.tripMembers.updateRsvp.useMutation({
    async onMutate({ status }) {
      await utils.tripMembers.list.cancel({ tripId });
      const prev = utils.tripMembers.list.getData({ tripId });
      utils.tripMembers.list.setData({ tripId }, (prev ?? []).map((m) =>
        m.user_id === currentUser?.id ? { ...m, status } : m
      ));
      return { prev };
    },
    onError(_err, _vars, context) {
      if (context?.prev !== undefined) utils.tripMembers.list.setData({ tripId }, context.prev);
    },
    onSettled() {
      utils.tripMembers.list.invalidate({ tripId });
    },
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

// ── NoAccountFound ───────────────────────────────────────────────────────
// Shown when an email search returns no BuddyTrip account.
// Lets the owner add them as a ghost crew member with the email pre-filled.

function NoAccountFound({
  email,
  tripId,
  onAdded,
}: {
  email: string;
  tripId: string;
  onAdded: () => void;
}) {
  const utils = trpc.useUtils();
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);

  const createGhost = trpc.ghostCrew.create.useMutation({
    onSuccess() {
      utils.tripMembers.list.invalidate({ tripId });
      onAdded();
    },
    onError(err) {
      setError(err.message);
    },
  });

  return (
    <div className="space-y-2 rounded-lg p-3" style={{ background: "var(--color-bt-base)", border: "1px solid var(--color-bt-border)" }}>
      <p className="text-xs" style={{ color: "var(--color-bt-text-dim)" }}>
        No BuddyTrip account found for <span style={{ color: "var(--color-bt-text)" }}>{email}</span>.
        Add them as a guest with this email saved for later.
      </p>
      <input
        data-testid="no-account-name-input"
        type="text"
        placeholder="Their name (e.g. Andy)"
        value={name}
        onChange={(e) => { setName(e.target.value); setError(null); }}
        className="w-full rounded-lg border py-1.5 px-3 text-sm outline-none"
        style={{ background: "var(--color-bt-base)", borderColor: "var(--color-bt-border)", color: "var(--color-bt-text)" }}
      />
      {error && <p className="text-xs" style={{ color: "var(--color-bt-danger)" }}>{error}</p>}
      <button
        data-testid="add-as-guest-btn"
        disabled={!name.trim() || createGhost.isPending}
        onClick={() =>
          createGhost.mutate({
            tripId,
            id: crypto.randomUUID(),
            name: name.trim(),
            email,
            role: "Member",
          })
        }
        className="flex w-full items-center justify-center gap-1.5 rounded-lg py-1.5 text-xs font-medium disabled:opacity-40"
        style={{ background: "var(--color-bt-accent-faint)", color: "var(--color-bt-accent)", border: "1px solid var(--color-bt-accent-border)" }}
      >
        <Ghost size={12} />
        {createGhost.isPending ? "Adding…" : "Add as Guest"}
      </button>
    </div>
  );
}

// ── InviteMember (real account search) ───────────────────────────────────

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
    async onMutate(vars) {
      await utils.tripMembers.list.cancel({ tripId });
      const prev = utils.tripMembers.list.getData({ tripId });
      const searchData = utils.users.search.getData({ query });
      const userInfo = searchData?.find((u) => u.id === vars.userId) ?? null;
      utils.tripMembers.list.setData({ tripId }, [
        ...(prev ?? []),
        {
          id: crypto.randomUUID(),
          trip_id: tripId,
          user_id: vars.userId,
          guest_crew_id: null,
          role: vars.role ?? "Member",
          status: "maybe",
          joined_at: new Date().toISOString(),
          user: userInfo
            ? { id: userInfo.id, name: userInfo.name ?? null, nickname: null, email: userInfo.email ?? null }
            : null,
          guestCrew: null,
          memberId: vars.userId,
          isGuest: false,
          displayName: userInfo?.name ?? userInfo?.email ?? vars.userId,
        },
      ]);
      return { prev };
    },
    onError(_err, _vars, context) {
      if (context?.prev !== undefined) utils.tripMembers.list.setData({ tripId }, context.prev);
    },
    onSuccess(_, vars) {
      setAddedId(vars.userId);
      setQuery("");
    },
    onSettled() {
      utils.tripMembers.list.invalidate({ tripId });
    },
  });

  const filtered = results.filter((u) => !existingMemberIds.includes(u.id));

  return (
    <div
      className="space-y-3 rounded-xl p-4"
      style={{ background: "var(--color-bt-card)", border: "1px solid var(--color-bt-border)" }}
    >
      <p className="text-sm font-medium" style={{ color: "var(--color-bt-text)" }}>
        Add by Email
      </p>

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

      {query.trim().length >= 2 && (
        <div className="space-y-1.5">
          {isFetching ? (
            <p className="text-xs" style={{ color: "var(--color-bt-text-dim)" }}>
              Searching…
            </p>
          ) : filtered.length === 0 ? (
            <NoAccountFound email={query.trim()} tripId={tripId} onAdded={() => setQuery("")} />
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

// ── AddGhostCrew ──────────────────────────────────────────────────────────

function AddGhostCrew({ tripId }: { tripId: string }) {
  const utils = trpc.useUtils();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);

  const createGhost = trpc.ghostCrew.create.useMutation({
    onSuccess() {
      setName("");
      setEmail("");
      setError(null);
      utils.tripMembers.list.invalidate({ tripId });
    },
    onError(err) {
      if (err.data?.code === "PRECONDITION_FAILED") {
        setError("This email belongs to an existing account. Use the email search above to add them.");
      } else if (err.data?.code === "CONFLICT") {
        setError("A crew member with this email already exists.");
      } else {
        setError(err.message);
      }
    },
  });

  return (
    <div
      className="space-y-3 rounded-xl p-4"
      style={{ background: "var(--color-bt-card)", border: "1px solid var(--color-bt-border)" }}
    >
      <p className="text-sm font-medium" style={{ color: "var(--color-bt-text)" }}>
        Add Guest (no account needed)
      </p>

      <input
        data-testid="ghost-name-input"
        type="text"
        placeholder="Name (e.g. Andy)"
        value={name}
        onChange={(e) => { setName(e.target.value); setError(null); }}
        className="w-full rounded-lg border py-2 px-3 text-sm outline-none"
        style={{
          background: "var(--color-bt-base)",
          borderColor: "var(--color-bt-border)",
          color: "var(--color-bt-text)",
        }}
      />

      <input
        data-testid="ghost-email-input"
        type="email"
        placeholder="Email (optional — for future invite)"
        value={email}
        onChange={(e) => { setEmail(e.target.value); setError(null); }}
        className="w-full rounded-lg border py-2 px-3 text-sm outline-none"
        style={{
          background: "var(--color-bt-base)",
          borderColor: "var(--color-bt-border)",
          color: "var(--color-bt-text)",
        }}
      />

      {error && (
        <p className="text-xs" style={{ color: "var(--color-bt-danger)" }}>
          {error}
        </p>
      )}

      <button
        data-testid="add-ghost-btn"
        disabled={!name.trim() || createGhost.isPending}
        onClick={() =>
          createGhost.mutate({
            tripId,
            id: crypto.randomUUID(),
            name: name.trim(),
            email: email.trim() || undefined,
            role: "Member",
          })
        }
        className="flex w-full items-center justify-center gap-2 rounded-lg py-2 text-sm font-medium disabled:opacity-40"
        style={{ background: "var(--color-bt-accent-faint)", color: "var(--color-bt-accent)", border: "1px solid var(--color-bt-accent-border)" }}
      >
        <Ghost size={14} />
        {createGhost.isPending ? "Adding…" : "Add Guest"}
      </button>
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
  // All memberIds for duplicate prevention in invite search
  const existingMemberIds = members
    .filter((m) => m.user_id)
    .map((m) => m.user_id as string);

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

            return (
              <div
                key={member.memberId}
                data-testid={`member-${member.memberId}`}
                className="flex items-center gap-3 rounded-xl px-4 py-3"
                style={{ background: "var(--color-bt-card)", border: "1px solid var(--color-bt-border)" }}
              >
                {/* Avatar */}
                <div
                  className="relative flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full text-sm font-semibold"
                  style={{
                    background: isMe ? "var(--color-bt-tag-bg)" : "var(--color-bt-past-bg)",
                    color: isMe ? "var(--color-bt-accent)" : "var(--color-bt-text-dim)",
                  }}
                >
                  {member.displayName.charAt(0).toUpperCase()}
                  {member.isGuest && (
                    <span
                      className="absolute -bottom-0.5 -right-0.5 flex h-4 w-4 items-center justify-center rounded-full"
                      style={{ background: "var(--color-bt-base)", color: "var(--color-bt-text-dim)" }}
                    >
                      <Ghost size={9} />
                    </span>
                  )}
                </div>

                {/* Info */}
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <p
                      className="truncate text-sm font-medium"
                      style={{ color: "var(--color-bt-text)" }}
                    >
                      {member.displayName}
                      {isMe && (
                        <span className="ml-1 text-xs" style={{ color: "var(--color-bt-text-dim)" }}>
                          (you)
                        </span>
                      )}
                    </p>
                  </div>
                  {member.isGuest ? (
                    <p className="text-xs italic" style={{ color: "var(--color-bt-text-dim)" }}>
                      {member.guestCrew?.email ?? "Guest · no account"}
                    </p>
                  ) : (
                    member.user?.email && (
                      <p
                        className="truncate text-xs"
                        style={{ color: "var(--color-bt-text-dim)" }}
                      >
                        {member.user.email}
                      </p>
                    )
                  )}
                </div>

                {/* Badges */}
                <div className="flex flex-shrink-0 flex-col items-end gap-1">
                  <RoleBadge role={member.role as TripRole} />
                  {!member.isGuest && member.status && (
                    <RsvpBadge status={member.status} />
                  )}
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
            Add to Trip
          </h2>
          <div className="space-y-3">
            <InviteMember
              tripId={trip.id}
              existingMemberIds={existingMemberIds}
            />
            <AddGhostCrew tripId={trip.id} />
          </div>
        </section>
      )}
    </div>
  );
}
