"use client";

import { useState } from "react";
import { Crown, Mail, Plus, Trash2, UserPlus, X } from "lucide-react";
import { UserAvatar } from "@/components/UserAvatar";
import { trpc } from "@/lib/trpc-client";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { TabHeader } from "@/components/TabHeader";
import { TabFab } from "@/components/TabFab";
import { CrewSearchInput } from "@/components/CrewSearchInput";
import type { TabProps } from "./types";
import { CrewEmailPanel } from "./components/CrewEmailPanel";
import { MemberEditor } from "./components/MemberEditor";

// ── Types ─────────────────────────────────────────────────────────────────
//
// `status` (RSVP) is intentionally ignored — the spec replaces "Going /
// Maybe / Can't / Pending" with a status derived from email validity.
// We keep the field in the type so the DB query continues to work, but
// nothing in this file consumes it.

type Member = {
  memberId: string;
  user_id: string | null;
  role: string;
  status: string | null;
  displayName: string;
  isGuest: boolean;
  user: { name?: string | null; nickname?: string | null; email: string | null; is_guest?: boolean } | null;
};

/** Three derived crew states. Status is computed, not chosen. */
type DerivedStatus = "active" | "invited" | "placeholder";

function deriveStatus(m: Member): DerivedStatus {
  // Real BT account (non-guest) = active.
  if (!m.isGuest) return "active";
  // Guest with an email = waiting on signup = invited.
  if (m.user?.email) return "invited";
  // Guest without email = name-only stand-in = placeholder.
  return "placeholder";
}

// ── Role pill (Owner amber · Organizer teal · Member: no pill) ────────────

function RolePill({ role }: { role: string }) {
  if (role === "Owner") {
    return (
      <span
        className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider"
        style={{
          background: "var(--color-bt-warning-faint)",
          color: "var(--color-bt-owner)",
          border: "1px solid var(--color-bt-warning-border)",
        }}
      >
        <Crown size={10} />
        Owner
      </span>
    );
  }
  // DB stores 'Planner'; displays as 'Organizer' per CLAUDE.md rule 7.
  if (role === "Planner") {
    return (
      <span
        className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider"
        style={{
          background: "var(--color-bt-accent-faint)",
          color: "var(--color-bt-accent)",
          border: "1px solid var(--color-bt-accent-border)",
        }}
      >
        Organizer
      </span>
    );
  }
  return null;
}

// ── PlaceholderAvatar — neutral square instead of the old Ghost icon ──────

function PlaceholderAvatar({ name }: { name: string }) {
  const initials =
    name
      .split(/\s+/)
      .map((w) => w[0])
      .join("")
      .slice(0, 2)
      .toUpperCase() || "?";
  return (
    <div
      className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full text-[11px] font-semibold"
      style={{
        background: "var(--color-bt-card-raised)",
        border: "1px solid var(--color-bt-border)",
        color: "var(--color-bt-text-dim)",
      }}
      aria-label="Placeholder crew member"
    >
      {initials}
    </div>
  );
}

// ── InvitedAvatar — team-color circle + amber ✉ corner badge ──────────────

function InvitedAvatar({ name }: { name: string }) {
  return (
    <div className="relative h-8 w-8 flex-shrink-0">
      <UserAvatar name={name} avatarUrl={null} size="md" />
      <span
        className="absolute -bottom-0.5 -right-0.5 flex h-3.5 w-3.5 items-center justify-center rounded-full"
        style={{
          background: "var(--color-bt-warning)",
          color: "var(--color-bt-on-accent)",
          border: "1.5px solid var(--color-bt-card)",
        }}
        aria-label="Invited"
      >
        <Mail size={7} strokeWidth={3} />
      </span>
    </div>
  );
}

// ── CrewRow ───────────────────────────────────────────────────────────────
//
// Row is a single tap target. In organizer view, tapping opens the
// MemberEditor drawer/sheet (managed by the parent CrewTab via
// `onEdit`). All edit affordances live there — no inline expand.

function CrewRow({
  member: m,
  isOwnerView,
  isMe,
  onEdit,
}: {
  member: Member;
  isOwnerView: boolean;
  isMe: boolean;
  onEdit?: (m: Member) => void;
}) {
  const status = deriveStatus(m);
  const isOwnerRow = m.role === "Owner";
  const editable = isOwnerView && !isOwnerRow && !!onEdit;

  return (
    <div
      className="border-b last:border-b-0"
      style={{ borderColor: "var(--color-bt-subtle-border)" }}
    >
      <button
        type="button"
        disabled={!editable}
        onClick={editable ? () => onEdit!(m) : undefined}
        className="flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors disabled:cursor-default"
        style={{ background: "transparent" }}
      >
        {/* Avatar — three variants per derived status */}
        {status === "placeholder" ? (
          <PlaceholderAvatar name={m.displayName} />
        ) : status === "invited" ? (
          <InvitedAvatar name={m.displayName} />
        ) : (
          <UserAvatar name={m.displayName} avatarUrl={null} size="md" />
        )}

        {/* Nickname + subline */}
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium" style={{ color: "var(--color-bt-text)" }}>
            {m.displayName}
            {isMe && (
              <span className="ml-1 text-xs" style={{ color: "var(--color-bt-text-dim)" }}>
                (you)
              </span>
            )}
          </p>
          {/* Subline rules: email mono for active/invited, plus
              "Invited" suffix for invited. Placeholders have NO subline. */}
          {status === "active" && m.user?.email && (
            <p
              className="truncate font-mono text-[11px]"
              style={{ color: "var(--color-bt-text-dim)" }}
            >
              {m.user.email}
            </p>
          )}
          {status === "invited" && (
            <p className="truncate text-[11px]" style={{ color: "var(--color-bt-text-dim)" }}>
              <span className="font-mono">{m.user?.email}</span>
              <span className="ml-1" style={{ color: "var(--color-bt-warning)" }}>
                · invited
              </span>
            </p>
          )}
        </div>

        {/* Role pill (Owner / Organizer; Member renders nothing) */}
        <div className="flex flex-shrink-0 items-center gap-1.5">
          <RolePill role={m.role} />
        </div>
      </button>

    </div>
  );
}

// ── CrewSection — Organizers / Crew with header + count ───────────────────

function CrewSection({
  title,
  members,
  isOwnerView,
  currentUserId,
  onEditMember,
  emptyHint,
}: {
  title: string;
  members: Member[];
  isOwnerView: boolean;
  currentUserId: string | undefined;
  onEditMember?: (m: Member) => void;
  emptyHint?: string;
}) {
  return (
    <section>
      <h2
        className="mb-2 flex items-baseline gap-2 text-xs font-semibold uppercase tracking-wider"
        style={{ color: "var(--color-bt-text-dim)" }}
      >
        <span>{title}</span>
        <span style={{ color: "var(--color-bt-text-dim)", opacity: 0.7 }}>· {members.length}</span>
      </h2>
      {members.length === 0 ? (
        <p
          className="rounded-xl px-4 py-5 text-center text-xs italic"
          style={{
            background: "var(--color-bt-card)",
            border: "1px dashed var(--color-bt-border)",
            color: "var(--color-bt-text-dim)",
          }}
        >
          {emptyHint ?? "Nobody here yet."}
        </p>
      ) : (
        <div
          className="overflow-hidden rounded-xl"
          style={{
            background: "var(--color-bt-card)",
            border: "1px solid var(--color-bt-border)",
          }}
        >
          {members.map((m) => (
            <CrewRow
              key={m.memberId}
              member={m}
              isOwnerView={isOwnerView}
              isMe={m.user_id === currentUserId}
              onEdit={onEditMember}
            />
          ))}
        </div>
      )}
    </section>
  );
}

// ── StatusLegend (right rail, always visible) ─────────────────────────────

function StatusLegend() {
  return (
    <div
      className="rounded-xl p-4"
      style={{
        background: "var(--color-bt-card)",
        border: "1px solid var(--color-bt-border)",
      }}
    >
      <div
        className="mb-3 text-[11px] font-bold uppercase tracking-[0.12em]"
        style={{ color: "var(--color-bt-text-dim)" }}
      >
        Status
      </div>
      <div className="space-y-2.5 text-[11px]" style={{ color: "var(--color-bt-text)" }}>
        <div className="flex items-center gap-2.5">
          <UserAvatar name="A" avatarUrl={null} sizePx={22} />
          <div className="min-w-0 flex-1">
            <div className="font-semibold">Active</div>
            <div className="leading-snug" style={{ color: "var(--color-bt-text-dim)" }}>
              Has a BuddyTrip account.
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2.5">
          <InvitedAvatar name="I" />
          <div className="min-w-0 flex-1">
            <div className="font-semibold">Invited</div>
            <div className="leading-snug" style={{ color: "var(--color-bt-text-dim)" }}>
              Email sent, hasn&apos;t signed up yet.
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2.5">
          <PlaceholderAvatar name="P" />
          <div className="min-w-0 flex-1">
            <div className="font-semibold">Placeholder</div>
            <div className="leading-snug" style={{ color: "var(--color-bt-text-dim)" }}>
              Name only — add an email to invite.
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── AddPersonComposer (right rail) ────────────────────────────────────────

function AddPersonComposer({ tripId }: { tripId: string }) {
  return (
    <div
      className="rounded-xl p-4"
      style={{
        background: "var(--color-bt-card)",
        border: "1px solid var(--color-bt-accent-border)",
        boxShadow: "var(--shadow-raised)",
      }}
    >
      <div
        className="mb-2.5 text-[11px] font-bold uppercase tracking-[0.12em]"
        style={{ color: "var(--color-bt-accent)" }}
      >
        Add a person
      </div>
      <CrewSearchInput
        tripId={tripId}
        defaultRole="Member"
        defaultStatus="draft"
        allowGhost
        allowInvite
        showSearchIcon
        placeholder="Email or name…"
      />
      <p
        className="mt-2 text-[11px] leading-snug"
        style={{ color: "var(--color-bt-text-dim)" }}
      >
        Email matches a BuddyTrip account → Active. No match → we send an
        invite. Name only → Placeholder.
      </p>
    </div>
  );
}

// ── AddCrewComposerStandalone ─────────────────────────────────────────────
// Empty-state composer per HANDOFF-gaps-crew-empty.md §3. Two stacked
// inputs (name + monospace email) and a full-width "Add to crew"
// button. Distinct from `AddPersonComposer` (search-existing pattern)
// because the empty state's intent is "set up your first crew row,"
// not "search the directory."

function AddCrewComposerStandalone({ tripId }: { tripId: string }) {
  const utils = trpc.useUtils();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");

  const createGuest = trpc.ghostCrew.create.useMutation({
    onSuccess() {
      setName("");
      setEmail("");
      utils.tripMembers.list.invalidate({ tripId });
    },
  });

  const canSubmit = name.trim().length > 0 && !createGuest.isPending;

  const handleSubmit = () => {
    if (!canSubmit) return;
    createGuest.mutate({
      tripId,
      name: name.trim(),
      ...(email.trim() && { email: email.trim() }),
      role: "Member",
    });
  };

  const inputBase = {
    background: "var(--color-bt-card-raised)",
    borderColor: "var(--color-bt-border)",
    color: "var(--color-bt-text)",
  };

  return (
    <div
      className="flex flex-col gap-2 rounded-xl p-3.5"
      style={{
        background: "var(--color-bt-card)",
        border: "1px solid var(--color-bt-accent-border)",
        boxShadow: "var(--shadow-raised)",
      }}
    >
      <div
        className="mb-1 text-[11px] font-bold uppercase tracking-[0.12em]"
        style={{ color: "var(--color-bt-accent)" }}
      >
        Add your first crew member
      </div>

      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") handleSubmit();
        }}
        placeholder="Name (e.g. Llama)"
        className="w-full rounded-lg border px-2.5 py-2 text-[13px] outline-none"
        style={inputBase}
      />

      <input
        type="email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") handleSubmit();
        }}
        placeholder="jason@doherty.dev (optional)"
        className="w-full rounded-lg border px-2.5 py-2 font-mono text-[13px] outline-none"
        style={inputBase}
      />

      {/* The button stays at full saturation regardless of name-field
          emptiness — matching the other tabs' primary buttons. Clicking
          while name is empty is a no-op (handleSubmit early-returns) so
          the visual state isn't lying about clickability — it just
          doesn't need to telegraph "you must fill the name" with a heavy
          opacity-40 dim that reads as a different shade of teal. */}
      <button
        type="button"
        onClick={handleSubmit}
        disabled={createGuest.isPending}
        className="mt-1 rounded-lg py-2.5 text-sm font-semibold transition-opacity hover:opacity-90 disabled:opacity-60"
        style={{
          background: "var(--color-bt-accent)",
          color: "var(--color-bt-on-accent)",
        }}
      >
        {createGuest.isPending ? "Adding…" : "Add to crew"}
      </button>

      <p
        className="mt-1 text-[11px] leading-snug"
        style={{ color: "var(--color-bt-text-dim)" }}
      >
        Either field works.{" "}
        <strong className="font-semibold" style={{ color: "var(--color-bt-text)" }}>
          Email enables app access
        </strong>{" "}
        — name-only entries become placeholders you can still count for rooms,
        teams, and receipts.
      </p>
    </div>
  );
}

// ── EmptyCrewInvitation ───────────────────────────────────────────────────
// Replaces the flat dashed "Nobody on the crew yet" strip with the
// proper invitation card per HANDOFF-gaps-crew-empty.md §2. Sits inside
// the CREW section when the trip has zero non-organizer members.

function EmptyCrewInvitation() {
  return (
    <div
      className="flex flex-col items-center gap-2.5 rounded-xl px-6 py-7 text-center"
      style={{
        background: "var(--color-bt-surface-invitation)",
        border: "1.5px dashed var(--color-bt-border)",
      }}
    >
      <span
        className="flex h-11 w-11 items-center justify-center rounded-[12px]"
        style={{
          background: "var(--color-bt-accent-faint)",
          color: "var(--color-bt-accent)",
        }}
      >
        <UserPlus size={22} strokeWidth={2} />
      </span>
      <div className="text-sm font-semibold" style={{ color: "var(--color-bt-text)" }}>
        No one else yet
      </div>
      <p
        className="m-0 max-w-[360px] text-xs leading-snug"
        style={{ color: "var(--color-bt-text-dim)" }}
      >
        Use the panel on the right to add your first crew member. Add an email
        if you want them to access the trip themselves, or just a name to
        track them as a{" "}
        <strong className="font-semibold" style={{ color: "var(--color-bt-text)" }}>
          placeholder
        </strong>
        .
      </p>
    </div>
  );
}

// ── CrewTab ───────────────────────────────────────────────────────────────

export function CrewTab({ trip, canEdit, embedded }: TabProps & { embedded?: boolean }) {
  const currentUser = useCurrentUser();
  const tripId = trip.id;
  const { data: members = [] } = trpc.tripMembers.list.useQuery({ tripId });

  const [editingMemberId, setEditingMemberId] = useState<string | null>(null);
  const [showEmailModal, setShowEmailModal] = useState(false);
  const [showMobileAdd, setShowMobileAdd] = useState(false);

  const me = members.find((m) => m.user_id === currentUser?.id);
  const isOwner = me?.role === "Owner";

  // Member view sort: Owner → Organizer → Active member → Invited → Placeholder.
  const statusOrder: Record<DerivedStatus, number> = { active: 0, invited: 1, placeholder: 2 };
  const roleOrder: Record<string, number> = { Owner: 0, Planner: 1, Member: 2 };

  const sortedAll = [...members].sort((a, b) => {
    const aRole = roleOrder[a.role] ?? 2;
    const bRole = roleOrder[b.role] ?? 2;
    if (aRole !== bRole) return aRole - bRole;
    const aStatus = statusOrder[deriveStatus(a)] ?? 2;
    const bStatus = statusOrder[deriveStatus(b)] ?? 2;
    if (aStatus !== bStatus) return aStatus - bStatus;
    return a.displayName.localeCompare(b.displayName);
  });

  const organizers = sortedAll.filter((m) => m.role === "Owner" || m.role === "Planner");
  const restCrew = sortedAll.filter((m) => m.role === "Member");
  const totalCount = members.length;

  // ── Member view (read-only): single sorted list, no Add, no edit ────────
  if (!canEdit) {
    return (
      <div className={embedded ? "@container" : "@container px-4"}>
        <TabHeader
          eyebrow="Crew"
          headline={`Everyone on the trip · ${totalCount}`}
          body="Tag the Owner or any Organizer with planning questions. Roles and emails are managed by Organizers."
        />
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
          <section>
            <div
              className="overflow-hidden rounded-xl"
              style={{
                background: "var(--color-bt-card)",
                border: "1px solid var(--color-bt-border)",
              }}
            >
              {sortedAll.map((m) => (
                <CrewRow
                  key={m.memberId}
                  member={m}
                  isOwnerView={false}
                  isMe={m.user_id === currentUser?.id}
                />
              ))}
            </div>
          </section>
          <aside className="hidden lg:block">
            <StatusLegend />
          </aside>
        </div>
      </div>
    );
  }

  // ── Organizer view ──────────────────────────────────────────────────────
  // Empty = just the owner, no one else added yet. Triggers the
  // gap-fix treatment per HANDOFF-gaps-crew-empty.md.
  const isEmpty = totalCount <= 1;
  const tripDestination = trip.location ?? trip.locked_destination_location ?? null;
  const tripEyebrow = [trip.title, tripDestination]
    .filter(Boolean)
    .join(" · ")
    .toUpperCase();

  return (
    <div className={embedded ? "@container" : "@container px-4"}>
      <TabHeader
        // Empty state swaps the accent "CREW" eyebrow for a dim
        // trip-context eyebrow (trip name + location). The CREW
        // identity moves into the heading itself ("Crew · N").
        eyebrow={isEmpty ? (tripEyebrow || "Crew") : "Crew"}
        eyebrowTone={isEmpty ? "dim" : "accent"}
        headline={`Crew · ${totalCount}`}
        body={
          isEmpty
            ? "Just you so far. Add the rest of your crew — names alone work, or include emails so they can sign in and see the trip themselves."
            : "Add Organizers to share planning duties — they get nearly all the same powers you do. Everyone else rides along."
        }
        desktopAction={
          isOwner ? (
            <button
              type="button"
              onClick={() => setShowEmailModal(true)}
              aria-label="Email the crew"
              title="Email the crew"
              className="flex h-7 w-7 items-center justify-center rounded-lg transition-opacity hover:opacity-85"
              style={{
                background: "var(--color-bt-accent)",
                color: "var(--color-bt-on-accent)",
              }}
            >
              <Mail size={13} />
            </button>
          ) : undefined
        }
      />

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px] lg:gap-5">
        {/* Main column — Organizers + Crew sections */}
        <div className="flex flex-col gap-5">
          <CrewSection
            title="Organizers"
            members={organizers}
            isOwnerView={isOwner}
            currentUserId={currentUser?.id}
            onEditMember={(m) => setEditingMemberId(m.memberId)}
            emptyHint="Just you so far — add an Organizer to share planning work."
          />
          {/* CREW section: when empty + organizer view, render the
              invitation card per addendum §2. Populated state uses
              the standard CrewSection rendering. */}
          {restCrew.length === 0 && isOwner ? (
            <section>
              <h2
                className="mb-2 flex items-baseline gap-2 text-xs font-semibold uppercase tracking-wider"
                style={{ color: "var(--color-bt-text-dim)" }}
              >
                <span>Crew</span>
                <span style={{ color: "var(--color-bt-text-dim)", opacity: 0.7 }}>
                  · 0
                </span>
              </h2>
              <EmptyCrewInvitation />
            </section>
          ) : (
            <CrewSection
              title="Crew"
              members={restCrew}
              isOwnerView={isOwner}
              currentUserId={currentUser?.id}
              onEditMember={(m) => setEditingMemberId(m.memberId)}
              emptyHint="Nobody on the crew yet. Use the panel on the right to add someone."
            />
          )}
        </div>

        {/* Right rail — survives tablet stacking per global Rule 1.
            Hidden only below md so phones get the FAB → modal flow.
            Capped to 540px when stacked so it doesn't run away wide
            on a 900px tablet. */}
        <aside
          className="hidden flex-col gap-4 md:flex"
          style={{ maxWidth: 540 }}
        >
          {isOwner &&
            (isEmpty ? (
              <AddCrewComposerStandalone tripId={tripId} />
            ) : (
              <AddPersonComposer tripId={tripId} />
            ))}
          <StatusLegend />
        </aside>
      </div>

      {/* Mobile add — sheet-like inline composer triggered by the FAB.
          Phones (<md) drop the rail entirely and route through this
          inline reveal. */}
      {isOwner && showMobileAdd && (
        <div className="mt-4 md:hidden">
          {isEmpty ? (
            <AddCrewComposerStandalone tripId={tripId} />
          ) : (
            <AddPersonComposer tripId={tripId} />
          )}
        </div>
      )}

      {/* Crew Email modal — kept from the previous design; out of spec
          scope but still useful. */}
      {showEmailModal && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center sm:items-center"
          style={{ background: "var(--color-bt-overlay)" }}
          onClick={(e) => {
            if (e.target === e.currentTarget) setShowEmailModal(false);
          }}
        >
          <div
            className="relative w-full max-w-lg overflow-hidden rounded-t-2xl sm:rounded-2xl"
            style={{
              background: "var(--color-bt-base)",
              maxHeight: "90dvh",
              display: "flex",
              flexDirection: "column",
            }}
          >
            <div
              className="flex flex-shrink-0 items-center gap-3 px-4 py-3"
              style={{ borderBottom: "1px solid var(--color-bt-border)" }}
            >
              <span
                className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg"
                style={{
                  background: "var(--color-bt-accent-faint)",
                  color: "var(--color-bt-accent)",
                }}
              >
                <Mail size={15} />
              </span>
              <span
                className="flex-1 text-sm font-semibold"
                style={{ color: "var(--color-bt-text)" }}
              >
                Email the Crew
              </span>
              <button
                onClick={() => setShowEmailModal(false)}
                className="flex h-8 w-8 items-center justify-center rounded-lg transition-opacity hover:opacity-70"
                style={{
                  background: "var(--color-bt-card-raised)",
                  color: "var(--color-bt-text-dim)",
                }}
                aria-label="Close"
              >
                <X size={15} />
              </button>
            </div>
            <div className="overflow-y-auto p-4">
              <CrewEmailPanel trip={trip} isOwner={isOwner} />
            </div>
            <div
              className="flex flex-shrink-0 justify-end px-4 py-3"
              style={{ borderTop: "1px solid var(--color-bt-border)" }}
            >
              <button
                onClick={() => setShowEmailModal(false)}
                className="rounded-xl px-4 py-2 text-sm font-medium transition-opacity hover:opacity-70"
                style={{
                  background: "var(--color-bt-card-raised)",
                  color: "var(--color-bt-text)",
                }}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Member editor — drawer on desktop, bottom sheet on mobile.
          Renders when a row is tapped; closes via Cancel / X / backdrop. */}
      {editingMemberId &&
        (() => {
          const target = members.find((m) => m.memberId === editingMemberId);
          if (!target) return null;
          return (
            <MemberEditor
              tripId={tripId}
              member={target}
              canManageRoles={!!isOwner}
              onClose={() => setEditingMemberId(null)}
            />
          );
        })()}

      {/* Mobile-only FAB — toggles the inline composer above. */}
      {isOwner && (
        <TabFab
          onClick={() => setShowMobileAdd((v) => !v)}
          label="Add crew member"
          icon={<UserPlus size={20} strokeWidth={2.25} />}
          testId="add-crew-member-fab"
        />
      )}

      {/* Bottom-right primary action on small placeholder-only state. */}
      {!isOwner && totalCount === 0 && (
        <p
          className="mt-6 flex items-center gap-2 rounded-xl px-4 py-3 text-sm"
          style={{
            background: "var(--color-bt-card)",
            border: "1px solid var(--color-bt-border)",
            color: "var(--color-bt-text-dim)",
          }}
        >
          <Plus size={14} />
          The Owner hasn&apos;t added crew yet.
        </p>
      )}
    </div>
  );
}
