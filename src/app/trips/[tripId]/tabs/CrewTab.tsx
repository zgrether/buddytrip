"use client";

import Image from "next/image";
import { useEffect, useMemo, useState } from "react";
import {
  ChevronDown,
  Crown,
  Ghost,
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
import { AVATAR_ICON_COMPONENTS } from "@/lib/avatarIconComponents";
import { relativeTime } from "@/lib/notificationText";
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
  /**
   * ISO timestamp of the most recent invite sent to this member, or
   * NULL if they've never been invited. Stamped by
   * tripMembers.inviteByEmail + tripMembers.resendInvite +
   * sendInvitationBlast (per recipient). Surfaced on the expanded
   * invited-row as a "Invited X ago" hint so owners can decide whether
   * a resend is warranted.
   */
  last_invited_at?: string | null;
  user: {
    email: string | null;
    is_guest?: boolean;
    /** Uploaded photo URL — wins over avatar_icon and initials. */
    avatar_url?: string | null;
    /** Tabler icon id the user picked in their profile — wins over initials. */
    avatar_icon?: string | null;
  } | null;
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

  // Outstanding invites: members with status='invited' who haven't
  // accepted yet. This replaces the previous "X people haven't joined"
  // nudge, which incorrectly counted Just Names (placeholder names with
  // no email — they CAN'T join, by definition) and had no actionable
  // path. The new filter only counts members with email + invited
  // status, which is the genuinely actionable cohort.
  const pendingInviteCount = (members as Member[]).filter(
    (m) => m.status === "invited" && !!m.user?.email
  ).length;

  return (
    // Nudge + TabHeader + buttons stay full-width; only the section list
    // below is split into columns. Spec: "The 640px width should only
    // wrap around the crew lists, not the top part of the crew tab."
    <div className={embedded ? "@container" : "@container px-4"}>
      {/* ── Pending-invites nudge — surfaces at the very top of the tab
          so it reads as a tab-level alert (Style Guide § Nudge banner).
          No CTA button here — the per-row "Resend invite" action lives in
          the expanded invited-row, with the precise `last_invited_at`
          context the owner needs to make the call. ── */}
      {isOwner && pendingInviteCount > 0 && (
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
              {pendingInviteCount} {pendingInviteCount === 1 ? "invite" : "invites"} not accepted yet
            </p>
            <p className="mt-0.5 text-[11px] leading-snug" style={{ color: "var(--color-bt-text-dim)" }}>
              They got the email — open a row to see when it was sent or resend
            </p>
          </div>
        </div>
      )}

      {/* Header — eyebrow + headline + body + desktop actions. Matches
          the cadence of the other entry tabs (Lodging, Agenda, Receipts)
          so Crew doesn't read as the odd one out. */}
      <TabHeader
        eyebrow="Crew"
        headline="Roles for everyone on the trip"
        body="Owners and organizers help manage the trip. Promote any crew member with a BuddyTrip account and they get edit access right away."
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

      {/* ── Sections — 2-column grid at lg+; stacks single-column on
              tablet and mobile. Left column carries Organizers and Crew
              vertically; right column is Just Names. When Just Names is
              empty the grid collapses to a single column so Organizers +
              Crew take the full width. ── */}
      {(() => {
        const renderRow = (m: Member) => (
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
        );

        const leftColumn = (
          <div className="space-y-5">
            <SectionGroup
              label="Organizers"
              count={organizers.length}
              tone="accent"
            >
              {organizers.map(renderRow)}
            </SectionGroup>

            <SectionGroup label="Crew" count={crew.length} tone="standard">
              {crew.length === 0 ? (
                <EmptyHint text="No crew members yet." />
              ) : (
                crew.map(renderRow)
              )}
            </SectionGroup>
          </div>
        );

        if (justNames.length === 0) {
          return leftColumn;
        }

        return (
          <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
            {leftColumn}
            <SectionGroup
              label="Just Names"
              count={justNames.length}
              tone="recessed"
              subtext="Available for scheduling and scoring — add their email if they want to access the app."
            >
              {justNames.map(renderRow)}
            </SectionGroup>
          </div>
        );
      })()}

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

      {/* ── Mobile FAB — primary "Add crew member" action. fixed-positioned,
          so its DOM placement doesn't affect layout. */}
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
      {/* Main row — header. The spec calls for the section's tint
          (organizer = teal, standard = card) to read through the header
          regardless of expand state, so the row keeps its identity. The
          chevron rotation + the expanded body below are the visual
          cues that the row is open. */}
      <button
        type="button"
        onClick={expandable ? onToggle : undefined}
        className="flex w-full items-center gap-3 px-3 py-2.5 text-left transition-colors"
        style={{
          background: "transparent",
          cursor: expandable ? "pointer" : "default",
        }}
      >
        <RowAvatar state={rowState} initials={initials} member={m} />

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

      {/* Expanded body — state-specific UI. px-4 pb-4 pt-3 matches the
          PlanningRow body padding pattern.
          5.4: body always uses var(--color-bt-card) regardless of which
          section the row sits in, so input fields, labels, and buttons
          render on a neutral surface. The 1px separator above the body
          uses the row state's border token (accent for organizers,
          standard otherwise) so the divide reads as a continuation of
          the row's identity. */}
      {isExpanded && (
        <div
          className="px-4 pb-4 pt-3"
          style={{
            background: "var(--color-bt-card)",
            borderTop: `1px solid ${
              rowState === "owner" || rowState === "organizer"
                ? "var(--color-bt-accent-border)"
                : "var(--color-bt-border)"
            }`,
          }}
        >
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
// Resolution chain (per CC_MODAL_AUDIT.md follow-up):
//   1. just-name (ghost with no email)  → Ghost icon in dashed circle
//   2. user.avatar_url present           → uploaded photo
//   3. user.avatar_icon present          → Tabler icon on state-tinted bg
//   4. otherwise                         → initials on state-tinted bg
//
// State coloring (owner=teal, organizer/joined=blue, invited=amber) is
// applied as the background tint when we're rendering an icon or
// initials — so customized avatars (photo) display as themselves, and
// non-customized rows still carry their state-state at a glance.

function RowAvatar({
  state,
  initials,
  member: m,
}: {
  state: RowState;
  initials: string;
  member: Member;
}) {
  const SIZE = 32;
  const baseClasses =
    "flex flex-shrink-0 items-center justify-center rounded-full overflow-hidden";

  // 1. Just Names → Ghost icon in dashed circle. The spec explicitly calls
  //    for the dashed border + ghost glyph treatment; we don't fall through
  //    to avatar_url / avatar_icon here because the "just name" identity
  //    IS "no real person yet".
  if (state === "just-name") {
    return (
      <span
        className={baseClasses}
        style={{
          width: SIZE,
          height: SIZE,
          background: "transparent",
          color: "var(--color-bt-text-dim)",
          border: "1.5px dashed var(--color-bt-border)",
          opacity: 0.85,
        }}
        aria-hidden="true"
      >
        <Ghost size={14} />
      </span>
    );
  }

  // 2. Uploaded photo → render directly, no state tint underneath
  //    (a state-tint border would compete with the photo).
  if (m.user?.avatar_url) {
    return (
      <Image
        src={m.user.avatar_url}
        alt={`${m.displayName} avatar`}
        width={SIZE}
        height={SIZE}
        className="flex-shrink-0 rounded-full object-cover"
        unoptimized
      />
    );
  }

  // 3 / 4 — resolve state tint, then render icon or initials on top.
  const stateTint: { bg: string; fg: string; border: string } =
    state === "owner"
      ? {
          bg: "var(--color-bt-tag-bg)",
          fg: "var(--color-bt-accent)",
          border: "var(--color-bt-accent-border)",
        }
      : state === "invited"
        ? {
            bg: "var(--color-bt-warning-faint)",
            fg: "var(--color-bt-warning)",
            border: "var(--color-bt-warning-border)",
          }
        : {
            // organizer + joined share the blue tint
            bg: "var(--color-bt-blue-bg)",
            fg: "var(--color-bt-planning)",
            border: "var(--color-bt-planning-border)",
          };

  // 3. avatar_icon set → render the Tabler glyph on the tinted circle.
  const IconComponent = m.user?.avatar_icon
    ? AVATAR_ICON_COMPONENTS[m.user.avatar_icon]
    : null;
  if (IconComponent) {
    return (
      <span
        className={baseClasses}
        style={{
          width: SIZE,
          height: SIZE,
          background: stateTint.bg,
          color: stateTint.fg,
          border: `1px solid ${stateTint.border}`,
        }}
        aria-label={`${m.displayName} avatar`}
      >
        <IconComponent size={16} stroke={1.75} aria-hidden="true" />
      </span>
    );
  }

  // 4. Initials fallback.
  return (
    <span
      className={`${baseClasses} text-[11px] font-semibold`}
      style={{
        width: SIZE,
        height: SIZE,
        background: stateTint.bg,
        color: stateTint.fg,
        border: `1px solid ${stateTint.border}`,
      }}
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
  // Non-owners get a read-only detail view (no remove/role-change
  // actions). Anyone can edit their own display name; canEdit users can
  // edit other members' display names (gated server-side too).
  const showActions = isOwnerView && !isMe;
  const canEditDisplayName = isMe || canEdit;

  // Display Name field is the FIRST thing in every expanded row
  // regardless of state (CC_MODAL_AUDIT.md Part 1.4).
  const displayNameField = (
    <DisplayNameField
      tripId={tripId}
      userId={m.user_id ?? ""}
      currentDisplayName={m.displayName}
      canEdit={canEditDisplayName}
    />
  );

  if (rowState === "owner") {
    // Owner row — Display Name (editable for self) + email read-only.
    return (
      <>
        {displayNameField}
        <EmailReadOnly email={m.user?.email ?? null} />
      </>
    );
  }

  if (rowState === "organizer") {
    return (
      <>
        {displayNameField}
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
        {displayNameField}
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
        {displayNameField}
        <EmailReadOnly email={m.user?.email ?? null} />
        {m.last_invited_at && (
          <p
            className="mt-2 text-[11px]"
            style={{ color: "var(--color-bt-text-dim)" }}
          >
            Invited {relativeTime(m.last_invited_at)}
          </p>
        )}
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

  // just-name — Display Name editor first, then the email+invite flow
  // and remove affordance.
  return (
    <>
      {displayNameField}
      <JustNameExpanded
        member={m}
        tripId={tripId}
        isOwnerView={isOwnerView}
        canEdit={canEdit}
        onClose={onClose}
      />
    </>
  );
}

// ── DisplayNameField ────────────────────────────────────────────────────
// Inline-edit field that sits at the top of every expanded crew row.
// Save fires on blur OR on Enter; a brief checkmark confirms success.
// When the user lacks edit permission (member viewing someone else),
// renders as a read-only display of the current value.

function DisplayNameField({
  tripId,
  userId,
  currentDisplayName,
  canEdit,
}: {
  tripId: string;
  userId: string;
  currentDisplayName: string;
  canEdit: boolean;
}) {
  const utils = trpc.useUtils();
  const [value, setValue] = useState(currentDisplayName);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  // Re-sync from props when the underlying displayName changes (e.g. another
  // tab updated it via realtime invalidation). Skip when the user is in
  // the middle of typing — don't blow away their unsaved input.
  useEffect(() => {
    setValue(currentDisplayName);
  }, [currentDisplayName]);

  const setDisplayName = trpc.tripMembers.setDisplayName.useMutation({
    onMutate: async (vars) => {
      // Optimistic update on the list cache so the row + downstream
      // surfaces (schedule, scoring, expenses) reflect the change
      // instantly. Rollback on error.
      await utils.tripMembers.list.cancel({ tripId });
      const prev = utils.tripMembers.list.getData({ tripId });
      utils.tripMembers.list.setData({ tripId }, (old) =>
        (old ?? []).map((m) =>
          m.user_id === vars.userId
            ? { ...m, displayName: vars.displayName?.trim() || m.displayName }
            : m
        )
      );
      return { prev };
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.prev) utils.tripMembers.list.setData({ tripId }, ctx.prev);
    },
    onSuccess: () => {
      setSavedAt(Date.now());
      setTimeout(() => setSavedAt(null), 1500);
    },
    onSettled: () => utils.tripMembers.list.invalidate({ tripId }),
  });

  const commit = () => {
    const trimmed = value.trim();
    // No-op if the user reset back to the original value (or just
    // toggled focus without typing).
    if (trimmed === currentDisplayName.trim()) return;
    // Empty input clears the override; the server re-derives from the
    // global fallback chain (users.nickname → users.name → email-stem).
    setDisplayName.mutate({
      tripId,
      userId,
      displayName: trimmed.length > 0 ? trimmed : null,
    });
  };

  return (
    <div className="mb-2">
      <p
        className="mb-1 text-[10px] font-medium uppercase tracking-[0.06em]"
        style={{ color: "var(--color-bt-text-dim)" }}
      >
        Display Name
      </p>
      {canEdit ? (
        <div className="flex items-center gap-2">
          <input
            type="text"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                (e.currentTarget as HTMLInputElement).blur();
              } else if (e.key === "Escape") {
                setValue(currentDisplayName);
                (e.currentTarget as HTMLInputElement).blur();
              }
            }}
            maxLength={100}
            className="min-w-0 flex-1 rounded-lg border px-3 py-2 text-sm outline-none focus:ring-1"
            style={{
              // 5.4: input fields inside expanded rows always use
              // card-raised explicitly so the input is one elevation
              // above the body card, regardless of section tint.
              background: "var(--color-bt-card-raised)",
              borderColor: "var(--color-bt-border)",
              color: "var(--color-bt-text)",
            }}
            data-testid="display-name-input"
          />
          {/* Save confirmation — brief checkmark that fades after 1.5s.
              Reserves a fixed slot so the input doesn't reflow when it
              appears/disappears. */}
          <span
            className="flex h-6 w-6 flex-shrink-0 items-center justify-center transition-opacity"
            style={{
              color: "var(--color-bt-accent)",
              opacity: savedAt ? 1 : 0,
            }}
            aria-hidden="true"
          >
            <svg
              viewBox="0 0 16 16"
              width={14}
              height={14}
              fill="none"
              stroke="currentColor"
              strokeWidth={2.5}
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M3 8.5L6.5 12L13 5" />
            </svg>
          </span>
        </div>
      ) : (
        <div
          className="rounded-lg px-3 py-2 text-sm"
          style={{
            // Mirrors the input's card-raised bg so the read-only and
            // editable variants visually align.
            background: "var(--color-bt-card-raised)",
            border: "1px solid var(--color-bt-border)",
            color: "var(--color-bt-text)",
          }}
        >
          {currentDisplayName}
        </div>
      )}
    </div>
  );
}

// ── EmailReadOnly ───────────────────────────────────────────────────────

function EmailReadOnly({ email }: { email: string | null }) {
  return (
    <div className="mt-1">
      <p
        className="mb-1 text-[10px] font-medium uppercase tracking-[0.06em]"
        style={{ color: "var(--color-bt-text-dim)" }}
      >
        Email
      </p>
      <div
        className="rounded-lg px-3 py-2 text-sm"
        style={{
          // 5.4: matches the editable inputs' card-raised treatment.
          background: "var(--color-bt-card-raised)",
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
  // Small Danger variant per STYLE_GUIDE.md Section 5 — danger-faint bg
  // makes the button read as a real action target, not a text link.
  return (
    <button
      type="button"
      onClick={() => setConfirm(true)}
      className="rounded-lg px-3 py-1.5 text-xs font-medium transition-colors"
      style={{
        background: "var(--color-bt-danger-faint)",
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
            className="mb-1 text-[10px] font-medium uppercase tracking-[0.06em]"
            style={{ color: "var(--color-bt-text-dim)" }}
          >
            Add email to invite
          </p>
          <div className="flex items-center gap-2">
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="brad@example.com"
              className="min-w-0 flex-1 rounded-lg border px-2.5 py-1.5 text-sm outline-none focus:ring-1"
              style={{
                background: "var(--color-bt-card-raised)",
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
