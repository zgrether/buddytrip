"use client";

import { useState } from "react";
import { Crown, Mail, Plus, Trash2, UserPlus, X } from "lucide-react";
import { UserAvatar } from "@/components/UserAvatar";
import { trpc } from "@/lib/trpc-client";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { TabHeader } from "@/components/TabHeader";
import { TabFab } from "@/components/TabFab";
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

function StatusLegend({ members }: { members: Member[] }) {
  const counts = members.reduce(
    (acc, m) => {
      const s = deriveStatus(m);
      acc[s] += 1;
      return acc;
    },
    { active: 0, invited: 0, placeholder: 0 } as Record<DerivedStatus, number>
  );

  const rows: Array<{
    key: DerivedStatus;
    label: string;
    body: string;
    avatar: React.ReactNode;
  }> = [
    {
      key: "active",
      label: "Active",
      body: "Has a BuddyTrip account.",
      avatar: <UserAvatar name="A" avatarUrl={null} size="md" />,
    },
    {
      key: "invited",
      label: "Invited",
      body: "Email sent, hasn't signed up yet.",
      avatar: <InvitedAvatar name="I" />,
    },
    {
      key: "placeholder",
      label: "Placeholder",
      body: "Name only — add an email to invite.",
      avatar: <PlaceholderAvatar name="P" />,
    },
  ];

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
        What these mean
      </div>
      <div className="space-y-2.5 text-[11px]" style={{ color: "var(--color-bt-text)" }}>
        {rows.map((r) => (
          <div key={r.key} className="flex items-center gap-2.5">
            {r.avatar}
            <div className="min-w-0 flex-1">
              <div className="flex items-baseline justify-between gap-2">
                <span className="font-semibold">{r.label}</span>
                <span
                  className="font-mono text-[11px]"
                  style={{ color: "var(--color-bt-text-dim)" }}
                >
                  · {counts[r.key]}
                </span>
              </div>
              <div className="leading-snug" style={{ color: "var(--color-bt-text-dim)" }}>
                {r.body}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── AddCrewComposer ───────────────────────────────────────────────────────
// Single two-input form per spec (`AddCrewComposer` in explorations-screens.jsx
// for populated state, `AddCrewComposerStandalone` for empty). The
// `boosted` flag controls chrome and copy only — the underlying
// inputs + submission logic are identical.
//
//   boosted=true   → empty-state primary CTA: accent border, raised
//                    shadow, accent eyebrow, "Add your first crew
//                    member" title, longer hint about placeholders.
//   boosted=false  → populated-state composer: default border, no
//                    shadow, dim eyebrow, "Add a person" title,
//                    one-line hint.
//
// Replaces the prior Find-by-email AddPersonComposer (which lived in
// CrewSearchInput) so the populated and empty states share the same
// affordance shape — different chrome, same flow.

function AddCrewComposer({ tripId, boosted }: { tripId: string; boosted: boolean }) {
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
        border: boosted
          ? "1px solid var(--color-bt-accent-border)"
          : "1px solid var(--color-bt-border)",
        boxShadow: boosted ? "var(--shadow-raised)" : undefined,
      }}
    >
      <div
        className="mb-1 text-[11px] font-bold uppercase tracking-[0.12em]"
        style={{
          color: boosted ? "var(--color-bt-accent)" : "var(--color-bt-text-dim)",
        }}
      >
        {boosted ? "Add your first crew member" : "Add a person"}
      </div>

      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") handleSubmit();
        }}
        placeholder={boosted ? "Name (e.g. Llama)" : "Name (optional)"}
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
        placeholder={boosted ? "jason@doherty.dev (optional)" : "email@example.com (optional)"}
        className="w-full rounded-lg border px-2.5 py-2 font-mono text-[13px] outline-none"
        style={inputBase}
      />

      {/* Button stays at full saturation regardless of name emptiness —
          clicking while name is empty is a no-op (handleSubmit
          early-returns) so the visual state matches "this is the CTA"
          rather than "you must fill the name first." */}
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
        {boosted ? (
          <>
            Either field works.{" "}
            <strong className="font-semibold" style={{ color: "var(--color-bt-text)" }}>
              Email enables app access
            </strong>{" "}
            — name-only entries become placeholders you can still count for rooms,
            teams, and receipts.
          </>
        ) : (
          <>
            Either field is enough.{" "}
            <strong className="font-semibold" style={{ color: "var(--color-bt-text)" }}>
              Email enables app access
            </strong>{" "}
            — name-only entries are placeholders.
          </>
        )}
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
            <StatusLegend members={members} />
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
        // Crew is the only tab where the eyebrow conveys trip context
        // ("BBMI · Pinehurst, NC") instead of tab identity — the
        // heading "Crew · N" already carries the tab name. Applies to
        // both empty and populated states per round-3 C3-1.
        eyebrow={tripEyebrow || "Crew"}
        eyebrowTone="dim"
        headline={`Crew · ${totalCount}`}
        // Populated copy per round-3 C3-2: surfaces the **placeholder**
        // defined term and pins ownership/permissions correctly.
        body={
          isEmpty ? (
            "Just you so far. Add the rest of your crew — names alone work, or include emails so they can sign in and see the trip themselves."
          ) : (
            <>
              Owner and organizers manage the trip. Everyone else is a member
              — including{" "}
              <strong className="font-semibold" style={{ color: "var(--color-bt-text)" }}>
                placeholders
              </strong>{" "}
              (name-only entries that get counted but can&apos;t sign in).
            </>
          )
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
            <AddCrewComposer tripId={tripId} boosted={isEmpty} />}
          <StatusLegend members={members} />
        </aside>
      </div>

      {/* Mobile add — sheet-like inline composer triggered by the FAB.
          Phones (<md) drop the rail entirely and route through this
          inline reveal. */}
      {isOwner && showMobileAdd && (
        <div className="mt-4 md:hidden">
          <AddCrewComposer tripId={tripId} boosted={isEmpty} />
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
