"use client";

import { useState } from "react";
import { Mail, Plane, Plus } from "lucide-react";
import { Avatar } from "@/components/Avatar";
import { parseLocalDate } from "@/lib/dates";
import {
  TravelEditor,
  TravelModePill,
  summarizeTravel,
  formatArrivalLabel,
  type TravelMode,
} from "./TravelControls";

// ── Types ─────────────────────────────────────────────────────────────────
//
// `status` (RSVP) is intentionally ignored — the spec replaces "Going /
// Maybe / Can't / Pending" with a status derived from email validity.
// We keep the field in the type so the DB query continues to work, but
// nothing here consumes it.

export type Member = {
  memberId: string;
  user_id: string | null;
  role: string;
  status: string | null;
  displayName: string;
  isGuest: boolean;
  /** When this member was last emailed (invite or follow-up). Null until
   *  the first send; updated by sendInvitationBlast. Surfaced in the
   *  invited subline so organizers know how stale the contact is. */
  last_emailed_at?: string | null;
  /** How many times this member has been emailed. 0 = never contacted
   *  (the next send is an invite); >0 = already contacted (follow-up).
   *  Drives the "not invited yet" status for real accounts that have been
   *  added to the trip but not yet emailed. */
  email_count?: number | null;
  /** Travel fields (live on trip_members). `travel_mode` drives the
   *  at-a-glance mode pill; `travel_detail` is the single free-text
   *  description; `flight_arrival_time` is the combined arrival timestamp. */
  travel_mode?: string | null;
  travel_detail?: string | null;
  flight_airline?: string | null;
  flight_number?: string | null;
  flight_airport?: string | null;
  flight_arrival_time?: string | null;
  user: {
    name?: string | null;
    email: string | null;
    is_guest?: boolean;
    /** Tabler icon id the user chose in /profile (e.g. "flag-2") — the
     *  in-app profile avatar. We surface this, NOT users.avatar_url
     *  (the Google / OAuth-supplied photo), so crew rows reflect what
     *  the user explicitly picked as their identity in this app. */
    avatar_icon?: string | null;
  } | null;
};

/** Three derived crew states. Status is computed, not chosen. */
export type DerivedStatus = "active" | "invited" | "placeholder";

export function deriveStatus(m: Member): DerivedStatus {
  // The Owner created the trip — they're inherently on it, never "pending"
  // (their email_count is 0 because nobody emails the host an invite).
  if (m.role === "Owner") return "active";
  // Guest without an email = name-only stand-in = placeholder.
  if (m.isGuest && !m.user?.email) return "placeholder";
  // Never emailed yet (guest OR real account) = not officially invited.
  // A real BuddyTrip user added to the trip hasn't been "invited" until the
  // owner actually emails them, so they read as Pending until email_count > 0.
  if ((m.email_count ?? 0) === 0) return "invited";
  // Emailed at least once: a guest is still waiting to sign up (invited);
  // a real account is fully onboarded (active).
  return m.isGuest ? "invited" : "active";
}

// ── Role pill (Owner amber · Organizer teal · Member: no pill) ────────────

export function RolePill({ role }: { role: string }) {
  if (role === "Owner") {
    return (
      <span
        className="inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider"
        style={{
          background: "var(--color-bt-warning-faint)",
          color: "var(--color-bt-owner)",
          border: "1px solid var(--color-bt-warning-border)",
        }}
      >
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

export function PlaceholderAvatar({ name }: { name: string }) {
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

export function InvitedAvatar({ name, avatarIcon }: { name: string; avatarIcon?: string | null }) {
  return (
    <div className="relative h-8 w-8 flex-shrink-0">
      <Avatar name={name} avatarIcon={avatarIcon ?? null} size="md" />
      <span
        className="absolute -bottom-0.5 -right-0.5 flex h-3.5 w-3.5 items-center justify-center rounded-full"
        style={{
          // Pending status uses --color-bt-warning (amber). Task 61
          // briefly tried planning-blue for "softer" treatment but the
          // blue washed out against everything else; Task 62 reverted —
          // amber stands out and reads as "needs your attention" which
          // matches what the Pending state actually means.
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
// MemberEditor drawer/sheet (managed by the parent via `onEdit`). All edit
// affordances live there — no inline expand.

export function CrewRow({
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
        {/* Avatar — three variants per derived status. Surfaces the
            user's in-app profile avatar (users.avatar_icon, the Tabler
            icon they picked in /profile) with users.name as the
            initials fallback. Trip-scoped nickname does NOT drive the
            avatar. We deliberately ignore users.avatar_url (the
            Google/OAuth profile photo) so the avatar reflects an in-app
            identity choice, not the third-party login picture. */}
        {status === "placeholder" ? (
          <PlaceholderAvatar name={m.user?.name ?? m.displayName} />
        ) : status === "invited" ? (
          <InvitedAvatar
            name={m.user?.name ?? m.displayName}
            avatarIcon={m.user?.avatar_icon ?? null}
          />
        ) : (
          <Avatar
            name={m.user?.name ?? m.displayName}
            avatarIcon={m.user?.avatar_icon ?? null}
            size="md"
          />
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
              <span
                className="ml-1"
                style={{
                  // Two sub-states:
                  //  - last_emailed_at set → "· invited Mar 5" (sent but the
                  //    user hasn't signed up yet). Informational → teal.
                  //  - last_emailed_at null → "· pending invite" (added with
                  //    an email but the invite blast hasn't gone out yet).
                  //    Needs action → amber.
                  color: m.last_emailed_at
                    ? "var(--color-bt-accent)"
                    : "var(--color-bt-warning)",
                }}
              >
                {m.last_emailed_at
                  ? `· invited ${parseLocalDate(m.last_emailed_at).toLocaleDateString("en-US", {
                      month: "short",
                      day: "numeric",
                    })}`
                  : "· pending invite"}
              </span>
            </p>
          )}
        </div>

        {/* Right cluster: at-a-glance travel mode pill (blank when not
            shared — we never print "No travel") + role pill. */}
        <div className="flex flex-shrink-0 items-center gap-1.5">
          <TravelModePill mode={(m.travel_mode as TravelMode | null) ?? null} />
          <RolePill role={m.role} />
        </div>
      </button>
    </div>
  );
}

// ── CrewSection — Organizers / Crew with header + count ───────────────────

export function CrewSection({
  title,
  members,
  isOwnerView,
  currentUserId,
  onEditMember,
  emptyHint,
  tone = "dim",
}: {
  title: string;
  members: Member[];
  isOwnerView: boolean;
  currentUserId: string | undefined;
  onEditMember?: (m: Member) => void;
  emptyHint?: string;
  /** Section title color. 'accent' for Organizers, 'planning' (blue)
   *  for Crew, 'dim' for the member-view's neutral single list. */
  tone?: "accent" | "planning" | "dim";
}) {
  const TONE_STYLE: Record<
    "accent" | "planning" | "dim",
    { fg: string; bg: string; border: string }
  > = {
    accent: {
      fg: "var(--color-bt-accent)",
      bg: "var(--color-bt-accent-faint)",
      border: "var(--color-bt-accent-border)",
    },
    planning: {
      fg: "var(--color-bt-planning)",
      bg: "var(--color-bt-planning-faint)",
      border: "var(--color-bt-planning-border)",
    },
    dim: {
      fg: "var(--color-bt-text-dim)",
      bg: "transparent",
      border: "transparent",
    },
  };
  const t = TONE_STYLE[tone];

  return (
    <section>
      <h2
        className={[
          "mb-2 flex items-baseline justify-between gap-2 text-xs font-semibold uppercase tracking-wider",
          tone === "dim" ? "" : "rounded-lg px-3 py-1.5",
        ].join(" ")}
        style={{
          color: t.fg,
          background: t.bg,
        }}
      >
        <span>{title}</span>
        <span className="font-mono" style={{ color: t.fg, opacity: 0.75 }}>
          {members.length}
        </span>
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

// ── YouTile — the current user's own card + inline travel self-service ──────
//
// Pulled out of the Organizers/Crew lists into its own highlighted tile at
// the top of the Crew tab. This is the one place a member self-serves their
// travel: tapping "Add your travel" / "Edit" opens the inline TravelEditor in
// place (no drawer). Owners still edit anyone (including themselves) via the
// row → MemberEditor drawer, but the YOU tile is the fast path for "me".

export function YouTile({
  member: m,
  tripId,
  tripStartDate,
}: {
  member: Member;
  tripId: string;
  tripStartDate?: string | null;
}) {
  const [editing, setEditing] = useState(false);

  const mode = (m.travel_mode as TravelMode | null) ?? null;
  const detail = summarizeTravel(m);
  const arrivalLabel = formatArrivalLabel(m.flight_arrival_time);
  const hasTravel = !!mode;

  return (
    <section>
      <h2
        className="mb-2 flex items-baseline justify-between gap-2 rounded-lg px-3 py-1.5 text-xs font-semibold uppercase tracking-wider"
        style={{
          color: "var(--color-bt-accent)",
          background: "var(--color-bt-accent-faint)",
        }}
      >
        <span>You</span>
      </h2>

      <div
        className="overflow-hidden rounded-xl"
        style={{
          // Two states:
          //  - Resting: teal-tinted fill + teal border — marks "your section".
          //  - Editing: the teal fill floods a tall block and clashes with the
          //    nested inputs, so it steps aside. The tile becomes a neutral
          //    card with a single 3px accent left-edge as the only teal left.
          //    Left padding on the inner rows drops 2px to keep content
          //    aligned against the thicker edge.
          background: editing ? "var(--color-bt-card)" : "var(--color-bt-accent-faint)",
          border: editing
            ? "1px solid var(--color-bt-border)"
            : "1px solid var(--color-bt-accent-border)",
          borderLeft: editing ? "3px solid var(--color-bt-accent)" : undefined,
        }}
      >
        {/* Identity row */}
        <div
          className={
            editing
              ? "flex items-center gap-3 py-3 pr-4 pl-[14px]"
              : "flex items-center gap-3 px-4 py-3"
          }
        >
          <Avatar
            name={m.user?.name ?? m.displayName}
            avatarIcon={m.user?.avatar_icon ?? null}
            size="md"
          />
          <div className="min-w-0 flex-1">
            <p
              className="truncate text-sm font-medium"
              style={{ color: "var(--color-bt-text)" }}
            >
              {m.displayName}
              <span
                className="ml-1 text-xs"
                style={{ color: "var(--color-bt-text-dim)" }}
              >
                (you)
              </span>
            </p>
            {m.user?.email && (
              <p
                className="truncate font-mono text-[11px]"
                style={{ color: "var(--color-bt-text-dim)" }}
              >
                {m.user.email}
              </p>
            )}
          </div>
          <RolePill role={m.role} />
        </div>

        {/* Divider — neutral while editing to match the stepped-aside teal. */}
        <div
          style={{
            borderTop: editing
              ? "1px solid var(--color-bt-border)"
              : "1px solid var(--color-bt-accent-border)",
          }}
          aria-hidden
        />

        {/* Your travel block */}
        <div className={editing ? "py-3 pr-4 pl-[14px]" : "px-4 py-3"}>
          <div
            className="mb-2 flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider"
            style={{ color: "var(--color-bt-text-dim)" }}
          >
            <Plane size={11} strokeWidth={2.5} />
            Your travel
          </div>

          {editing ? (
            // One grouped inset (card-raised) holds the whole form so the
            // fields read as a single panel, not items floating on the tile.
            // The editor itself carries no card/border of its own, so this
            // doesn't double-box; its recessed inputs sit on base — darker
            // than this group — so the hierarchy steps down cleanly:
            // tile (card) → form group (card-raised) → inputs (base).
            <div
              style={{
                background: "var(--color-bt-card-raised)",
                border: "1px solid var(--color-bt-border)",
                borderRadius: "10px",
                padding: "13px",
              }}
            >
              <TravelEditor
                tripId={tripId}
                member={m}
                tripStartDate={tripStartDate}
                surface="recessed"
                onSaved={() => setEditing(false)}
                onCancel={() => setEditing(false)}
              />
            </div>
          ) : hasTravel ? (
            <div className="flex items-center gap-3">
              <TravelModePill mode={mode} withLabel />
              <div className="min-w-0 flex-1">
                {detail && (
                  <p
                    className="truncate text-sm"
                    style={{ color: "var(--color-bt-text)" }}
                  >
                    {detail}
                  </p>
                )}
                {arrivalLabel && (
                  <p
                    className="truncate text-[11px]"
                    style={{ color: "var(--color-bt-text-dim)" }}
                  >
                    Arriving {arrivalLabel}
                  </p>
                )}
              </div>
              <button
                type="button"
                onClick={() => setEditing(true)}
                className="flex-shrink-0 text-xs font-medium hover:underline"
                style={{ color: "var(--color-bt-accent)" }}
              >
                Edit
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setEditing(true)}
              className="inline-flex items-center gap-1.5 rounded-full border px-4 py-1.5 text-xs font-semibold transition-opacity hover:opacity-90"
              style={{
                background: "var(--color-bt-planning-faint)",
                borderColor: "var(--color-bt-planning-border)",
                color: "var(--color-bt-planning)",
              }}
            >
              <Plus size={14} strokeWidth={2.5} />
              Add your travel
            </button>
          )}
        </div>
      </div>
    </section>
  );
}
