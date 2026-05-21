"use client";

import { useMemo, useState } from "react";
import {
  ChevronDown,
  Crown,
  Mail,
  Plus,
  Send,
  Sparkles,
  UserPlus,
  X,
} from "lucide-react";
import { trpc } from "@/lib/trpc-client";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { TabHeader } from "@/components/TabHeader";
import { TabFab } from "@/components/TabFab";
import type { TabProps } from "./types";
import { CrewEmailPanel } from "./components/CrewEmailPanel";
import { AddCrewMemberSheet } from "./components/AddCrewMemberSheet";

// ── Types ────────────────────────────────────────────────────────────────

type Member = {
  memberId: string;
  user_id: string | null;
  role: string;
  status: string | null;
  displayName: string;
  isGuest: boolean;
  user: { email: string | null; is_guest?: boolean } | null;
};

/**
 * Five mutually-exclusive states drive the row's avatar, badge, and the
 * expanded UI underneath. Derived from role + status + email presence.
 */
type RowState = "owner" | "organizer" | "joined" | "invited" | "just-name";

function deriveRowState(m: Member): RowState {
  if (m.role === "Owner") return "owner";
  if (m.role === "Planner") return "organizer";
  // Members only from here. Members with no email = "Just Names";
  // with email and invited status = "invited"; otherwise "joined".
  const hasEmail = !!m.user?.email;
  if (!hasEmail) return "just-name";
  if (m.status === "invited") return "invited";
  return "joined";
}

function initialsOf(displayName: string): string {
  const parts = displayName.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

// ── CrewTab ─────────────────────────────────────────────────────────────

export function CrewTab({ trip, canEdit, embedded }: TabProps & { embedded?: boolean }) {
  const currentUser = useCurrentUser();
  const tripId = trip.id;
  const { data: members = [] } = trpc.tripMembers.list.useQuery({ tripId });

  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [showEmailModal, setShowEmailModal] = useState(false);
  const [showAddModal, setShowAddModal] = useState(false);

  const me = members.find((m) => m.user_id === currentUser?.id);
  const isOwner = me?.role === "Owner";

  // ── Three-section partitioning per CC_CREW_OVERHAUL.md Part 1.2 ──────
  //   Organizers  → role IN ('Owner', 'Planner')
  //   Crew        → role = 'Member' AND user.email IS NOT NULL
  //   Just Names  → role = 'Member' AND user.email IS NULL
  // Within each, sort: Owner first, then alphabetical by displayName.
  const { organizers, crew, justNames } = useMemo(() => {
    const orgs: Member[] = [];
    const cw: Member[] = [];
    const jn: Member[] = [];
    for (const m of members as Member[]) {
      if (m.role === "Owner" || m.role === "Planner") orgs.push(m);
      else if (m.user?.email) cw.push(m);
      else jn.push(m);
    }
    const byName = (a: Member, b: Member) => a.displayName.localeCompare(b.displayName);
    orgs.sort((a, b) => {
      // Owner pinned first; then alphabetical.
      if (a.role === "Owner" && b.role !== "Owner") return -1;
      if (b.role === "Owner" && a.role !== "Owner") return 1;
      return byName(a, b);
    });
    cw.sort(byName);
    jn.sort(byName);
    return { organizers: orgs, crew: cw, justNames: jn };
  }, [members]);

  const unlinkedCount = (members as Member[]).filter((m) => m.isGuest && m.status === "in").length;

  return (
    <div className={embedded ? "@container" : "@container px-4"}>
      {/* ── Unlinked-crew nudge — surfaces at the very top of the tab so
          it reads as a tab-level alert (Style Guide § Nudge banner). ── */}
      {isOwner && unlinkedCount > 0 && (
        <div
          className="mb-4 flex items-center gap-3 rounded-xl px-4 py-3"
          style={{
            background: "var(--color-bt-card)",
            border: "1px solid var(--color-bt-border)",
          }}
        >
          <span
            className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg"
            style={{ background: "var(--color-bt-accent-faint)", color: "var(--color-bt-accent)" }}
          >
            <Mail size={14} />
          </span>
          <div>
            <p className="text-[13px] font-semibold leading-tight" style={{ color: "var(--color-bt-text)" }}>
              {unlinkedCount} {unlinkedCount === 1 ? "person hasn't" : "people haven't"} joined yet
            </p>
            <p className="mt-0.5 text-[11px] leading-snug" style={{ color: "var(--color-bt-text-dim)" }}>
              Send them an email so they can see the plan
            </p>
          </div>
        </div>
      )}

      {/* Header — eyebrow + desktop actions only. CC_CREW_OVERHAUL.md
          Part 1.1: "Remove the page heading and the description paragraph
          below it. Go straight from the header row into the nudge banner
          (if applicable) and then the sections." */}
      <TabHeader
        eyebrow="Crew"
        desktopAction={
          isOwner ? (
            <>
              <button
                type="button"
                onClick={() => setShowAddModal(true)}
                data-testid="open-add-crew-modal"
                className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors hover:bg-[var(--color-bt-hover)]"
                style={{
                  background: "var(--color-bt-card-raised)",
                  color: "var(--color-bt-text)",
                  border: "1px solid var(--color-bt-border)",
                }}
              >
                <Plus size={11} />
                Add crew member
              </button>
              <button
                type="button"
                onClick={() => setShowEmailModal(true)}
                aria-label="Email the crew"
                title="Email the crew"
                className="flex h-7 w-7 items-center justify-center rounded-lg transition-opacity hover:opacity-85"
                style={{
                  background: "var(--color-bt-accent)",
                  color: "var(--color-bt-base)",
                }}
              >
                <Mail size={13} />
              </button>
            </>
          ) : undefined
        }
      />

      {/* ── Sections ─────────────────────────────────────────────────── */}
      <div className="space-y-5">
        <SectionGroup
          label="Organizers"
          count={organizers.length}
          tone="accent"
        >
          {organizers.map((m) => (
            <CrewRow
              key={m.memberId}
              member={m}
              tripId={tripId}
              isOwnerView={!!isOwner}
              canEdit={canEdit}
              isMe={m.user_id === currentUser?.id}
              isExpanded={expandedId === m.memberId}
              onToggle={() =>
                setExpandedId((cur) => (cur === m.memberId ? null : m.memberId))
              }
            />
          ))}
        </SectionGroup>

        <SectionGroup label="Crew" count={crew.length} tone="standard">
          {crew.length === 0 ? (
            <EmptyHint text="No crew members yet." />
          ) : (
            crew.map((m) => (
              <CrewRow
                key={m.memberId}
                member={m}
                tripId={tripId}
                isOwnerView={!!isOwner}
                canEdit={canEdit}
                isMe={m.user_id === currentUser?.id}
                isExpanded={expandedId === m.memberId}
                onToggle={() =>
                  setExpandedId((cur) => (cur === m.memberId ? null : m.memberId))
                }
              />
            ))
          )}
        </SectionGroup>

        {/* Just Names section — only render if there's at least one. The
            spec subtext is rendered inside the SectionGroup header slot
            so the count badge stays right-aligned. */}
        {justNames.length > 0 && (
          <SectionGroup
            label="Just Names"
            count={justNames.length}
            tone="recessed"
            subtext="Available for scheduling and scoring — add their email if they want to access the app."
          >
            {justNames.map((m) => (
              <CrewRow
                key={m.memberId}
                member={m}
                tripId={tripId}
                isOwnerView={!!isOwner}
                canEdit={canEdit}
                isMe={m.user_id === currentUser?.id}
                isExpanded={expandedId === m.memberId}
                onToggle={() =>
                  setExpandedId((cur) => (cur === m.memberId ? null : m.memberId))
                }
              />
            ))}
          </SectionGroup>
        )}
      </div>

      {/* ── Add crew member modal/sheet ─────────────────────────────── */}
      {isOwner && (
        <AddCrewMemberSheet
          tripId={tripId}
          isOpen={showAddModal}
          onClose={() => setShowAddModal(false)}
        />
      )}

      {/* ── Email-the-crew modal — wraps the existing CrewEmailPanel
          in a centered modal overlay since the panel itself has no
          close affordance (it's normally a sticky page panel). ────── */}
      {showEmailModal && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center sm:items-center"
          style={{ background: "var(--color-bt-overlay)" }}
          onClick={(e) => { if (e.target === e.currentTarget) setShowEmailModal(false); }}
        >
          <div
            className="relative w-full max-w-lg overflow-hidden rounded-t-2xl sm:rounded-2xl"
            style={{
              background: "var(--color-bt-card)",
              maxHeight: "90dvh",
              display: "flex",
              flexDirection: "column",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              onClick={() => setShowEmailModal(false)}
              aria-label="Close"
              className="absolute right-3 top-3 z-10 flex h-8 w-8 items-center justify-center rounded-full"
              style={{
                background: "var(--color-bt-card-raised)",
                color: "var(--color-bt-text-dim)",
              }}
            >
              <X size={14} />
            </button>
            {/* CrewEmailPanel's outer wrapper is bare (data-testid only);
                the parent must supply padding. pt-12 keeps the first
                paragraph clear of the absolute-positioned X button above. */}
            <div className="overflow-y-auto px-5 pb-5 pt-12">
              <CrewEmailPanel trip={trip} isOwner={!!isOwner} />
            </div>
          </div>
        </div>
      )}

      {/* ── Mobile FAB — primary "Add crew member" action ────────────── */}
      {isOwner && (
        <TabFab
          onClick={() => setShowAddModal(true)}
          label="Add crew member"
          icon={<UserPlus size={20} strokeWidth={2.25} />}
          testId="add-crew-member-fab"
        />
      )}
    </div>
  );
}

// ── SectionGroup ────────────────────────────────────────────────────────
// Label row + count chip + optional subtext + member rows below. The
// `tone` prop drives the surrounding container/row tint:
//   accent    — teal-tinted (Organizers)
//   standard  — default card surface (Crew)
//   recessed  — dimmer surface (Just Names)
//
// All three render the rows in a single bordered list so internal
// dividers handle row separation. Borders + bg shift by tone.

function SectionGroup({
  label,
  count,
  tone,
  subtext,
  children,
}: {
  label: string;
  count: number;
  tone: "accent" | "standard" | "recessed";
  subtext?: string;
  children: React.ReactNode;
}) {
  // tone → container styling. Rows inherit the tone via their own props
  // so accent-tinted Organizer rows can sit inside an accent-bordered
  // wrapper without doubling the tint.
  const containerStyle: React.CSSProperties =
    tone === "accent"
      ? {
          background: "var(--color-bt-tag-bg)",
          border: "1px solid var(--color-bt-accent-border)",
        }
      : tone === "recessed"
      ? {
          background: "var(--color-bt-past-bg)",
          border: "1px solid var(--color-bt-subtle-border)",
        }
      : {
          background: "var(--color-bt-card)",
          border: "1px solid var(--color-bt-border)",
        };

  return (
    <section>
      <div className="mb-2 flex items-baseline justify-between gap-3">
        <h2
          className="text-xs font-semibold uppercase tracking-wider"
          style={{ color: "var(--color-bt-text-dim)" }}
        >
          {label}
        </h2>
        <span
          className="text-[11px] font-medium tabular-nums"
          style={{ color: "var(--color-bt-text-dim)" }}
        >
          {count}
        </span>
      </div>
      {subtext && (
        <p
          className="mb-2 text-[11px] leading-snug"
          style={{ color: "var(--color-bt-text-dim)" }}
        >
          {subtext}
        </p>
      )}
      <div className="overflow-hidden rounded-xl" style={containerStyle}>
        {children}
      </div>
    </section>
  );
}

function EmptyHint({ text }: { text: string }) {
  return (
    <p
      className="py-6 text-center text-sm italic"
      style={{ color: "var(--color-bt-text-dim)" }}
    >
      {text}
    </p>
  );
}

// ── CrewRow ─────────────────────────────────────────────────────────────
// Fixed-slot row used in all three sections. Slot widths are CONSTANT
// across every row regardless of badge state so the avatars + names line
// up vertically across the whole roster:
//
//   [avatar 32]  [name + sub (flex-1)]   [badge 82px]   [chevron 18px]
//
// The badge slot is the only piece that varies in content; its width
// stays pinned. The chevron rotates 180° when the row is expanded.

const BADGE_SLOT_WIDTH = 82;
const CHEVRON_SLOT_WIDTH = 18;

function CrewRow({
  member: m,
  tripId,
  isOwnerView,
  canEdit,
  isMe,
  isExpanded,
  onToggle,
}: {
  member: Member;
  tripId: string;
  isOwnerView: boolean;
  canEdit: boolean;
  isMe: boolean;
  isExpanded: boolean;
  onToggle: () => void;
}) {
  const rowState = deriveRowState(m);
  const initials = initialsOf(m.displayName);

  // Owners and members all support expand for the read-only / action UI.
  // Members in any state can tap to expand for their own row too (so
  // they can see their email and any future RSVP controls). For now,
  // non-owners only get an expand affordance on rows they can act on —
  // which today is none of them, since all member-management actions
  // are owner-only. We still allow expand so future actions don't need
  // a layout shift; non-owners just see the read-only details.
  const expandable = true;

  return (
    <div
      className="border-b last:border-b-0"
      style={{
        borderColor: rowState === "owner" || rowState === "organizer"
          ? "var(--color-bt-accent-border)"
          : "var(--color-bt-border)",
      }}
      data-row-state={rowState}
      data-testid={`crew-row-${m.memberId}`}
    >
      {/* Main row */}
      <button
        type="button"
        onClick={expandable ? onToggle : undefined}
        className="flex w-full items-center gap-3 px-3 py-2.5 text-left transition-colors"
        style={{
          background: isExpanded ? "var(--color-bt-card-raised)" : "transparent",
          cursor: expandable ? "pointer" : "default",
        }}
      >
        <RowAvatar state={rowState} initials={initials} />

        <div className="min-w-0 flex-1">
          <p
            className="truncate text-sm font-medium"
            style={{ color: "var(--color-bt-text)" }}
          >
            {m.displayName}
            {isMe && (
              <span
                className="ml-1 text-xs font-normal"
                style={{ color: "var(--color-bt-text-dim)" }}
              >
                (you)
              </span>
            )}
          </p>
          {/* Sub-text — email for Owner/Organizer/Crew rows; nothing for
              Just Names per spec. */}
          {rowState !== "just-name" && m.user?.email && (
            <p
              className="truncate text-[11px]"
              style={{ color: "var(--color-bt-text-dim)" }}
            >
              {m.user.email}
            </p>
          )}
        </div>

        {/* Badge slot — fixed width so rows align across states */}
        <div
          className="flex flex-shrink-0 items-center justify-end"
          style={{ width: BADGE_SLOT_WIDTH }}
        >
          <RowBadge state={rowState} />
        </div>

        {/* Chevron slot — fixed width */}
        <div
          className="flex flex-shrink-0 items-center justify-center"
          style={{ width: CHEVRON_SLOT_WIDTH }}
        >
          {expandable && (
            <ChevronDown
              size={16}
              className="transition-transform duration-150"
              style={{
                color: "var(--color-bt-text-dim)",
                transform: isExpanded ? "rotate(180deg)" : "rotate(0deg)",
              }}
            />
          )}
        </div>
      </button>

      {/* Expanded body — state-specific UI */}
      {isExpanded && (
        <div className="px-3 pb-3">
          <ExpandedBody
            member={m}
            rowState={rowState}
            tripId={tripId}
            isOwnerView={isOwnerView}
            canEdit={canEdit}
            isMe={isMe}
            onClose={onToggle}
          />
        </div>
      )}
    </div>
  );
}

// ── RowAvatar ───────────────────────────────────────────────────────────
// Five visual variants keyed by row state. Each renders as a 32×32
// rounded-full circle so the layout doesn't shift when state changes.

function RowAvatar({ state, initials }: { state: RowState; initials: string }) {
  const baseClasses =
    "flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full text-[11px] font-semibold";

  if (state === "owner") {
    return (
      <span
        className={baseClasses}
        style={{
          background: "var(--color-bt-tag-bg)",
          color: "var(--color-bt-accent)",
          border: "1px solid var(--color-bt-accent-border)",
        }}
      >
        {initials}
      </span>
    );
  }
  if (state === "organizer" || state === "joined") {
    return (
      <span
        className={baseClasses}
        style={{
          background: "var(--color-bt-blue-bg)",
          color: "var(--color-bt-planning)",
          border: "1px solid var(--color-bt-planning-border)",
        }}
      >
        {initials}
      </span>
    );
  }
  if (state === "invited") {
    return (
      <span
        className={baseClasses}
        style={{
          background: "var(--color-bt-warning-faint)",
          color: "var(--color-bt-warning)",
          border: "1px solid var(--color-bt-warning-border)",
        }}
      >
        {initials}
      </span>
    );
  }
  // just-name → dashed border placeholder with a tiny silhouette glyph
  return (
    <span
      className={baseClasses}
      style={{
        background: "transparent",
        color: "var(--color-bt-text-dim)",
        border: "1.5px dashed var(--color-bt-border)",
        opacity: 0.85,
      }}
      aria-hidden="true"
    >
      {initials}
    </span>
  );
}

// ── RowBadge ────────────────────────────────────────────────────────────
// Five badge variants. Pill style + icon + label for the four labelled
// states; Just Names returns null so the slot is empty (but width-fixed).

function RowBadge({ state }: { state: RowState }) {
  const pillBase: React.CSSProperties = {
    fontSize: 10,
    borderRadius: 9999,
    padding: "2px 8px",
    display: "inline-flex",
    alignItems: "center",
    gap: 3,
    fontWeight: 600,
    letterSpacing: "0.02em",
    whiteSpace: "nowrap",
  };

  if (state === "owner") {
    return (
      <span
        style={{
          ...pillBase,
          background: "var(--color-bt-warning-faint)",
          color: "var(--color-bt-owner)",
          border: "1px solid var(--color-bt-warning-border)",
        }}
      >
        <Crown size={9} strokeWidth={2.5} />
        Owner
      </span>
    );
  }
  if (state === "organizer") {
    return (
      <span
        style={{
          ...pillBase,
          background: "var(--color-bt-accent-faint)",
          color: "var(--color-bt-accent)",
          border: "1px solid var(--color-bt-accent-border)",
        }}
      >
        <Sparkles size={9} strokeWidth={2.5} />
        Organizer
      </span>
    );
  }
  if (state === "invited") {
    return (
      <span
        style={{
          ...pillBase,
          background: "var(--color-bt-warning-faint)",
          color: "var(--color-bt-warning)",
          border: "1px solid var(--color-bt-warning-border)",
        }}
      >
        Invited
      </span>
    );
  }
  if (state === "joined") {
    return (
      <svg
        viewBox="0 0 16 16"
        width={14}
        height={14}
        fill="none"
        stroke="var(--color-bt-accent)"
        strokeWidth={2.5}
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-label="Joined"
      >
        <path d="M3 8.5L6.5 12L13 5" />
      </svg>
    );
  }
  // just-name → empty slot
  return null;
}

// ── ExpandedBody ────────────────────────────────────────────────────────
// State-specific UI that appears when a row is tapped. Non-owners always
// see read-only details (email if present). Owners get the action sets
// defined in CC_CREW_OVERHAUL.md Part 1.4.

function ExpandedBody({
  member: m,
  rowState,
  tripId,
  isOwnerView,
  canEdit,
  isMe,
  onClose,
}: {
  member: Member;
  rowState: RowState;
  tripId: string;
  isOwnerView: boolean;
  canEdit: boolean;
  isMe: boolean;
  onClose: () => void;
}) {
  // Non-owners (and the user's own row) get a read-only detail view —
  // never actionable. Owners get the state-specific action set.
  const showActions = isOwnerView && !isMe;

  if (rowState === "owner") {
    // Owner row — read-only email display regardless of who's viewing.
    return <EmailReadOnly email={m.user?.email ?? null} />;
  }

  if (rowState === "organizer") {
    return (
      <>
        <EmailReadOnly email={m.user?.email ?? null} />
        {showActions && (
          <div className="mt-2 flex flex-wrap gap-2">
            <RoleActionButton
              tripId={tripId}
              userId={m.user_id ?? ""}
              targetRole="Member"
              label="Remove organizer"
              onSuccess={onClose}
            />
            <RemoveButton
              member={m}
              tripId={tripId}
              label="Remove from trip"
              onSuccess={onClose}
            />
          </div>
        )}
      </>
    );
  }

  if (rowState === "joined") {
    return (
      <>
        <EmailReadOnly email={m.user?.email ?? null} />
        {showActions && (
          <div className="mt-2 flex flex-wrap gap-2">
            <RoleActionButton
              tripId={tripId}
              userId={m.user_id ?? ""}
              targetRole="Planner"
              label="Make organizer"
              onSuccess={onClose}
            />
            <RemoveButton
              member={m}
              tripId={tripId}
              label="Remove"
              onSuccess={onClose}
            />
          </div>
        )}
      </>
    );
  }

  if (rowState === "invited") {
    return (
      <>
        <EmailReadOnly email={m.user?.email ?? null} />
        <div className="mt-2 flex flex-wrap gap-2">
          {canEdit && (
            <ResendInviteButton
              tripId={tripId}
              userId={m.user_id ?? ""}
            />
          )}
          {showActions && (
            <>
              <RoleActionButton
                tripId={tripId}
                userId={m.user_id ?? ""}
                targetRole="Planner"
                label="Make organizer"
                onSuccess={onClose}
              />
              <RemoveButton
                member={m}
                tripId={tripId}
                label="Remove"
                onSuccess={onClose}
              />
            </>
          )}
        </div>
      </>
    );
  }

  // just-name — name only on the row, expanded body lets the user (canEdit)
  // attach an email + send invite, or the owner remove the placeholder.
  return (
    <JustNameExpanded
      member={m}
      tripId={tripId}
      isOwnerView={isOwnerView}
      canEdit={canEdit}
      onClose={onClose}
    />
  );
}

// ── EmailReadOnly ───────────────────────────────────────────────────────

function EmailReadOnly({ email }: { email: string | null }) {
  return (
    <div className="mt-1">
      <p
        className="mb-1 text-[10px] font-semibold uppercase tracking-wider"
        style={{ color: "var(--color-bt-text-dim)" }}
      >
        Email
      </p>
      <div
        className="rounded-lg px-3 py-2 text-sm"
        style={{
          background: "var(--color-bt-base)",
          border: "1px solid var(--color-bt-border)",
          color: email ? "var(--color-bt-text)" : "var(--color-bt-text-dim)",
        }}
      >
        {email ?? "No email on record"}
      </div>
    </div>
  );
}

// ── Action buttons ──────────────────────────────────────────────────────

function RoleActionButton({
  tripId,
  userId,
  targetRole,
  label,
  onSuccess,
}: {
  tripId: string;
  userId: string;
  targetRole: "Planner" | "Member";
  label: string;
  onSuccess: () => void;
}) {
  const utils = trpc.useUtils();
  const mut = trpc.tripMembers.updateRole.useMutation({
    onMutate: async (vars) => {
      await utils.tripMembers.list.cancel({ tripId });
      const prev = utils.tripMembers.list.getData({ tripId });
      utils.tripMembers.list.setData({ tripId }, (old) =>
        (old ?? []).map((m) =>
          m.user_id === vars.userId ? { ...m, role: vars.role } : m
        )
      );
      return { prev };
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.prev) utils.tripMembers.list.setData({ tripId }, ctx.prev);
    },
    onSuccess: () => onSuccess(),
    onSettled: () => utils.tripMembers.list.invalidate({ tripId }),
  });
  return (
    <button
      type="button"
      disabled={mut.isPending || !userId}
      onClick={() => mut.mutate({ tripId, userId, role: targetRole })}
      className="rounded-lg px-3 py-1.5 text-xs font-semibold transition-opacity disabled:opacity-50"
      style={{
        background: "var(--color-bt-card-raised)",
        color: "var(--color-bt-text)",
        border: "1px solid var(--color-bt-border)",
      }}
    >
      {mut.isPending ? "..." : label}
    </button>
  );
}

function RemoveButton({
  member: m,
  tripId,
  label,
  onSuccess,
}: {
  member: Member;
  tripId: string;
  label: string;
  onSuccess: () => void;
}) {
  const [confirm, setConfirm] = useState(false);
  const utils = trpc.useUtils();
  const removeMember = trpc.tripMembers.remove.useMutation({
    onSuccess: () => { utils.tripMembers.list.invalidate({ tripId }); onSuccess(); },
  });
  const removeGuest = trpc.ghostCrew.remove.useMutation({
    onSuccess: () => { utils.tripMembers.list.invalidate({ tripId }); onSuccess(); },
  });
  const pending = removeMember.isPending || removeGuest.isPending;

  const doRemove = () => {
    if (!m.user_id) return;
    if (m.isGuest) removeGuest.mutate({ tripId, guestUserId: m.user_id });
    else removeMember.mutate({ tripId, userId: m.user_id });
  };

  if (confirm) {
    return (
      <div
        className="flex items-center gap-2 rounded-lg px-2 py-1.5"
        style={{ border: "1px solid var(--color-bt-danger-border)", background: "var(--color-bt-danger-faint)" }}
      >
        <span className="text-xs" style={{ color: "var(--color-bt-danger)" }}>
          Remove?
        </span>
        <button
          type="button"
          onClick={doRemove}
          disabled={pending}
          className="rounded-md px-2 py-0.5 text-xs font-semibold disabled:opacity-50"
          style={{ background: "var(--color-bt-danger)", color: "white" }}
        >
          Yes
        </button>
        <button
          type="button"
          onClick={() => setConfirm(false)}
          disabled={pending}
          className="rounded-md px-2 py-0.5 text-xs"
          style={{ color: "var(--color-bt-text-dim)" }}
        >
          Cancel
        </button>
      </div>
    );
  }
  return (
    <button
      type="button"
      onClick={() => setConfirm(true)}
      className="rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors"
      style={{
        background: "transparent",
        color: "var(--color-bt-danger)",
        border: "1px solid var(--color-bt-danger-border)",
      }}
    >
      {label}
    </button>
  );
}

function ResendInviteButton({ tripId, userId }: { tripId: string; userId: string }) {
  const [justSent, setJustSent] = useState(false);
  const mut = trpc.tripMembers.resendInvite.useMutation({
    onSuccess: () => {
      setJustSent(true);
      setTimeout(() => setJustSent(false), 3000);
    },
  });
  return (
    <button
      type="button"
      disabled={mut.isPending || !userId}
      onClick={() => mut.mutate({ tripId, userId })}
      className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition-opacity disabled:opacity-50"
      style={{
        background: "var(--color-bt-card-raised)",
        color: "var(--color-bt-text)",
        border: "1px solid var(--color-bt-border)",
      }}
    >
      <Send size={11} />
      {mut.isPending ? "Sending..." : justSent ? "Sent ✓" : "Resend invite"}
    </button>
  );
}

// ── JustNameExpanded ────────────────────────────────────────────────────
// Email input + Send invite + Remove from trip. The email input writes to
// the ghost user's email via ghostCrew.update; the Send invite button
// then issues the invite. Keeping these as two explicit steps mirrors
// what the user is actually doing (add an email, then send) and lets the
// existing inviteByEmail mutation handle the upgrade-to-invited flow.

function JustNameExpanded({
  member: m,
  tripId,
  isOwnerView,
  canEdit,
  onClose,
}: {
  member: Member;
  tripId: string;
  isOwnerView: boolean;
  canEdit: boolean;
  onClose: () => void;
}) {
  const utils = trpc.useUtils();
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);

  const inviteByEmail = trpc.tripMembers.inviteByEmail.useMutation();
  const removeGuest = trpc.ghostCrew.remove.useMutation();

  async function handleSendInvite() {
    const trimmed = email.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
      setError("Enter a valid email.");
      return;
    }
    setError(null);
    try {
      // First drop the existing ghost placeholder (so inviteByEmail can
      // create a fresh guest with the new email + send the invite).
      // Note: this fires the "removed from trip" system message; the
      // subsequent inviteByEmail then fires "invite sent to <name>".
      // Trade-off worth a single-row noise event.
      if (m.user_id) {
        await removeGuest.mutateAsync({ tripId, guestUserId: m.user_id });
      }
      await inviteByEmail.mutateAsync({
        tripId,
        email: trimmed,
        role: "Member",
        name: m.displayName,
      });
      utils.tripMembers.list.invalidate({ tripId });
      onClose();
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Couldn't send invite. Please try again."
      );
    }
  }

  return (
    <div className="space-y-2">
      {canEdit && (
        <>
          <p
            className="text-[10px] font-semibold uppercase tracking-wider"
            style={{ color: "var(--color-bt-text-dim)" }}
          >
            Add email to invite
          </p>
          <div className="flex items-stretch gap-2">
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="brad@example.com"
              className="min-w-0 flex-1 rounded-lg border px-2.5 py-1.5 text-sm outline-none focus:ring-1"
              style={{
                background: "var(--color-bt-base)",
                borderColor: "var(--color-bt-border)",
                color: "var(--color-bt-text)",
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" && email.trim()) {
                  e.preventDefault();
                  handleSendInvite();
                }
              }}
            />
            <button
              type="button"
              onClick={handleSendInvite}
              disabled={!email.trim() || inviteByEmail.isPending || removeGuest.isPending}
              className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold disabled:opacity-50"
              style={{
                background: "var(--color-bt-accent)",
                color: "var(--color-bt-base)",
              }}
            >
              <Send size={11} />
              {inviteByEmail.isPending || removeGuest.isPending ? "..." : "Send invite"}
            </button>
          </div>
          {error && (
            <p className="text-xs" style={{ color: "var(--color-bt-danger)" }}>
              {error}
            </p>
          )}
        </>
      )}
      {isOwnerView && (
        <div className="pt-1">
          <RemoveButton
            member={m}
            tripId={tripId}
            label="Remove from trip"
            onSuccess={onClose}
          />
        </div>
      )}
    </div>
  );
}
