"use client";

import { useState } from "react";
import { Mail, Plus, UserPlus, X } from "lucide-react";
import { Avatar } from "@/components/Avatar";
import { trpc } from "@/lib/trpc-client";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { TabHeader } from "@/components/TabHeader";
import { TabFab } from "@/components/TabFab";
import type { TabProps } from "./types";
import { CrewEmailPanel } from "./components/CrewEmailPanel";
import { MemberEditor } from "./components/MemberEditor";
import {
  type Member,
  type DerivedStatus,
  deriveStatus,
  InvitedAvatar,
  PlaceholderAvatar,
  CrewRow,
  CrewSection,
} from "./components/CrewRoster";

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

  // Descriptions match the spec's longer-form copy
  // (explorations-screens.jsx lines 504-506) — the legend earns the
  // panel title "WHAT THESE MEAN" by actually explaining the
  // implications of each state, not just naming them.
  const rows: Array<{
    key: DerivedStatus;
    label: string;
    body: string;
    avatar: React.ReactNode;
  }> = [
    {
      key: "active",
      label: "Active",
      body:
        "Email matches a BuddyTrip user. On the trip with full app access. Can be promoted to organizer.",
      avatar: <Avatar name="A" avatarIcon={null} size="md" />,
    },
    {
      // Umbrella for the two sub-states a guest-with-email can be in:
      // "pending invite" (added, blast not sent yet) and "invited"
      // (blast sent, recipient hasn't signed up). The legend uses the
      // single label "Pending" to keep one row per status — the row
      // sublines + Owner nudges carry the finer distinction.
      key: "invited",
      label: "Pending",
      body: "Has an email but hasn't been invited yet — a guest waiting to sign up, or a BuddyTrip user you haven't emailed about this trip. Send the invite to bring them in; they turn Active once they're emailed and signed in.",
      avatar: <InvitedAvatar name="P" />,
    },
    {
      key: "placeholder",
      label: "Placeholder",
      body:
        "No email. Counted in widgets (rooms, teams, expenses) but can’t access the app.",
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
                  {counts[r.key]}
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

// ── CompactStatusLegend ───────────────────────────────────────────────────
// Single-row variant of the legend, rendered inline below the crew
// list at narrow widths where the right rail is gone. Lets users
// always know what the role/status pills mean without losing the
// full descriptive cards above the fold on a phone.

function CompactStatusLegend({ members }: { members: Member[] }) {
  const counts = members.reduce(
    (acc, m) => {
      const s = deriveStatus(m);
      acc[s] += 1;
      return acc;
    },
    { active: 0, invited: 0, placeholder: 0 } as Record<DerivedStatus, number>
  );

  const items: Array<{ key: DerivedStatus; label: string; dot: string }> = [
    { key: "active", label: "Active", dot: "var(--color-bt-accent)" },
    { key: "invited", label: "Pending", dot: "var(--color-bt-warning)" },
    { key: "placeholder", label: "Placeholder", dot: "var(--color-bt-text-dim)" },
  ];

  return (
    <div
      className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[11px]"
      style={{ color: "var(--color-bt-text)" }}
    >
      {items.map((it) => (
        <span key={it.key} className="inline-flex items-center gap-1.5">
          <span
            className="h-2 w-2 flex-shrink-0 rounded-full"
            style={{ background: it.dot }}
            aria-hidden
          />
          <span className="font-semibold">{it.label}</span>
          <span
            className="font-mono"
            style={{ color: "var(--color-bt-text-dim)" }}
          >
            {counts[it.key]}
          </span>
        </span>
      ))}
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

function AddCrewComposer({
  tripId,
  boosted,
  variant = "rail",
  onAdded,
}: {
  tripId: string;
  boosted: boolean;
  /**
   * "rail" (default) — full chrome: card background, border, optional
   *   raised shadow when boosted, rounded corners, internal padding,
   *   uppercase eyebrow row. This is the canonical right-rail / stacked
   *   composer presentation.
   * "sheet" — chrome stripped. The composer is rendered inside the
   *   mobile bottom-sheet modal, which already supplies the surface,
   *   elevation, radius, padding, and a title bar above the form. The
   *   composer's own card would read as a nested duplicate. Inputs sit
   *   directly on the sheet's card-float background.
   */
  variant?: "rail" | "sheet";
  /** Fired after a successful add — used by the mobile sheet wrapper
   *  to dismiss the modal once the user has committed a crew member. */
  onAdded?: () => void;
}) {
  const utils = trpc.useUtils();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");

  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const createGuest = trpc.ghostCrew.create.useMutation({
    onMutate() {
      setErrorMsg(null);
    },
    onSuccess() {
      setName("");
      setEmail("");
      utils.tripMembers.list.invalidate({ tripId });
      onAdded?.();
    },
    onError(err) {
      // Surface the server's message so duplicates / conflicts don't
      // silently swallow the click.
      setErrorMsg(err.message);
    },
  });

  // Either name or email is enough — derive a sensible name from the
  // email's local-part when the name field is left blank ("alice@x.com"
  // → "alice"). Matches the spec hint "Either field works."
  const trimmedName = name.trim();
  const trimmedEmail = email.trim();
  const derivedName =
    trimmedName || trimmedEmail.split("@")[0]?.replace(/[._-]+/g, " ").trim();
  const canSubmit = !!derivedName && !createGuest.isPending;

  const handleSubmit = () => {
    if (!canSubmit || !derivedName) return;
    createGuest.mutate({
      tripId,
      name: derivedName,
      ...(trimmedEmail && { email: trimmedEmail }),
      role: "Member",
    });
  };

  const inputBase = {
    background: "var(--color-bt-card-raised)",
    borderColor: "var(--color-bt-border)",
    color: "var(--color-bt-text)",
  };

  const isSheet = variant === "sheet";

  return (
    <div
      className={
        isSheet
          ? "flex flex-col gap-2"
          : "flex flex-col gap-2 rounded-xl p-3.5"
      }
      style={
        isSheet
          ? undefined
          : {
              background: "var(--color-bt-card)",
              border: boosted
                ? "1px solid var(--color-bt-accent-border)"
                : "1px solid var(--color-bt-border)",
              boxShadow: boosted ? "var(--shadow-raised)" : undefined,
            }
      }
    >
      {/* Eyebrow row — redundant inside the sheet because the sheet's
          title bar already says "Add crew member". Rail-only. */}
      {!isSheet && (
        <div
          className="mb-1 text-[11px] font-bold uppercase tracking-[0.12em]"
          style={{
            color: boosted ? "var(--color-bt-accent)" : "var(--color-bt-text-dim)",
          }}
        >
          {boosted ? "Add your first crew member" : "Add a crew member"}
        </div>
      )}

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

      {/* Button reflects the actual canSubmit state — both empty fields
          AND in-flight pending dim it. Earlier iteration kept it at full
          saturation when name+email were blank ("the CTA is always the
          CTA") but that conflicted with the hover-glow + had no visual
          cue for *why* the click did nothing. Now hover only lifts when
          enabled, and disabled state reads at 40% opacity. */}
      <button
        type="button"
        onClick={handleSubmit}
        disabled={!canSubmit}
        className="mt-1 rounded-lg py-2.5 text-sm font-semibold transition-opacity enabled:hover:opacity-90 disabled:opacity-40"
        style={{
          background: "var(--color-bt-accent)",
          color: "var(--color-bt-on-accent)",
          // cursor needs to be inline because globals.css's
          // unlayered `button { cursor: pointer }` rule wins against
          // the Tailwind `disabled:cursor-not-allowed` utility (the
          // utility lives in @layer utilities, the global rule is
          // unlayered → unlayered always wins).
          cursor: canSubmit ? "pointer" : "not-allowed",
        }}
      >
        {createGuest.isPending ? "Adding…" : "Add to crew"}
      </button>

      {/* Server-side error surface — duplicate / conflict / etc. The
          composer used to silently swallow these. */}
      {errorMsg && (
        <p
          className="text-[11px] leading-snug"
          style={{ color: "var(--color-bt-danger)" }}
        >
          {errorMsg}
        </p>
      )}

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

// ── CrewNudge ─────────────────────────────────────────────────────────────
// Shared chrome for the two Owner nudges that sit above the roster: one
// for "pending invite" (added with email, never sent), one for "invited
// but not signed up yet". Each carries a right-justified action button
// that opens the email-blast modal — the previously-redundant header
// email button was retired (Task 59) and consolidated here.
function CrewNudge({
  title,
  body,
  ctaLabel,
  onCta,
}: {
  title: string;
  body: string;
  ctaLabel: string;
  onCta: () => void;
}) {
  return (
    <div
      className="flex items-center gap-3 rounded-xl px-4 py-3"
      style={{
        background: "var(--color-bt-card)",
        border: "1px solid var(--color-bt-border)",
      }}
    >
      <span
        className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg"
        style={{
          background: "var(--color-bt-warning-faint)",
          color: "var(--color-bt-warning)",
        }}
        aria-hidden
      >
        <Mail size={14} />
      </span>
      <div className="min-w-0 flex-1">
        <p
          className="text-[13px] font-semibold leading-tight"
          style={{ color: "var(--color-bt-text)" }}
        >
          {title}
        </p>
        <p
          className="mt-0.5 text-[11px] leading-snug"
          style={{ color: "var(--color-bt-text-dim)" }}
        >
          {body}
        </p>
      </div>
      <button
        type="button"
        onClick={onCta}
        aria-label={ctaLabel}
        className="ml-auto inline-flex flex-shrink-0 items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition-opacity hover:opacity-90"
        style={{
          background: "var(--color-bt-accent)",
          color: "var(--color-bt-on-accent)",
        }}
      >
        <Mail size={12} strokeWidth={2.5} />
        {ctaLabel}
      </button>
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
        {/* Location prompt swaps with the rail's three layout states
            (Task 45 / Task 48). The rail is to the right at ≥900,
            stacks below content at 640-899, and disappears behind the
            mobile FAB at <640 — so the copy needs three variants. We
            render all three spans and let media queries pick exactly
            one; using arbitrary variants on both edges so Tailwind's
            sort puts them in numerical order. */}
        <span className="min-[640px]:hidden">
          Tap the <strong className="font-semibold" style={{ color: "var(--color-bt-text)" }}>+</strong> button to add your first crew member.
        </span>
        <span className="hidden min-[640px]:inline min-[900px]:hidden">
          Use the panel below to add your first crew member.
        </span>
        <span className="hidden min-[900px]:inline">
          Use the panel on the right to add your first crew member.
        </span>{" "}
        Add an email if you want them to access the trip themselves, or just
        a name to track them as a{" "}
        <strong className="font-semibold" style={{ color: "var(--color-bt-text)" }}>
          placeholder
        </strong>
        .
      </p>
    </div>
  );
}

// ── CrewTab ───────────────────────────────────────────────────────────────

export function CrewTab({ trip, embedded }: TabProps & { embedded?: boolean }) {
  // Crew tab doesn't read canEdit anymore — see the `if (!isOwner)` gate
  // below. Roster management (add/remove/rename/role changes) is
  // intentionally Owner-only this iteration. canEdit still flows to
  // Lodging / Schedule / Comp via the same TabProps shape.
  const currentUser = useCurrentUser();
  const tripId = trip.id;
  const { data: members = [] } = trpc.tripMembers.list.useQuery({ tripId });

  const [editingMemberId, setEditingMemberId] = useState<string | null>(null);
  const [showEmailModal, setShowEmailModal] = useState(false);
  const [showMobileAdd, setShowMobileAdd] = useState(false);
  // Recipients to pre-check when the email modal opens. The nudges populate
  // this so "Send invites" / "Resend invites" land on the modal with exactly
  // the people that nudge is about already selected; opening the modal from
  // the header button passes [] (nothing pre-selected).
  const [emailPreselectIds, setEmailPreselectIds] = useState<string[]>([]);
  const openEmailModal = (memberIds: string[] = []) => {
    setEmailPreselectIds(memberIds);
    setShowEmailModal(true);
  };

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

  // Email-the-crew is available whenever at least one *other* member has an
  // email on file (the current user can't email themselves). Drives the
  // header-corner button below.
  const hasEmailableCrew = members.some(
    (m) => m.user_id !== currentUser?.id && !!m.user?.email
  );

  // ── Read-only roster view: Owner gets the management chrome below;
  // everyone else (including Planner/Organizer) sees this read-only
  // list. We gate on isOwner rather than the broader canEdit because
  // crew-management privileges (add/remove/rename, role changes) are
  // intentionally Owner-only for now — Planners can edit Lodging /
  // Schedule / Comp via canEdit elsewhere, but the roster itself is
  // a single-person responsibility this iteration. ────────────────────
  if (!isOwner) {
    return (
      <div className={embedded ? "@container" : "@container px-4"}>
        <TabHeader
          // Member view picks up the same teal-eyebrow common pattern
          // as the organizer view — only the headline shifts to the
          // member-facing framing.
          eyebrow={`Crew · ${totalCount}`}
          eyebrowTone="accent"
          headline="Everyone on the trip"
          body="Tag the Owner with planning questions. Roles, emails, and the roster itself are managed by the Owner."
        />
        {/* Member view grid — same shrink-and-collapse rules as the
            organizer view (see Task 44 comment below). */}
        <div className="grid gap-4 min-[900px]:grid-cols-[minmax(0,1fr)_minmax(280px,320px)]">
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
          {/* Member view rail — just the legend (no composer). Visible
              at sm+ (stacked below content sm-899; in-grid right
              column at ≥900). Member view never gets two side-by-side
              cards because there's only one card to render. */}
          <aside className="hidden sm:block">
            <StatusLegend members={members} />
          </aside>
        </div>

        {/* Compact horizontal legend — visible only at < sm where the
            full rail legend has gone away. Mirrors the Owner view so
            non-owners on mobile also get the Active / Pending /
            Placeholder vocabulary instead of staring at unexplained
            avatar variants. */}
        <div className="mt-4 sm:hidden">
          <CompactStatusLegend members={members} />
        </div>
      </div>
    );
  }

  // ── Organizer view ──────────────────────────────────────────────────────
  // Empty = just the owner, no one else added yet. Triggers the
  // gap-fix treatment per HANDOFF-gaps-crew-empty.md.
  const isEmpty = totalCount <= 1;
  return (
    <div className={embedded ? "@container" : "@container px-4"}>
      <TabHeader
        // Round-4 item 4 supersedes round-3 C3-1: Crew now folds into
        // the common tab pattern — teal "CREW · N" eyebrow (same
        // 11px/700/0.12em treatment as Lodging/Agenda/Receipts), heading
        // becomes "Who's on the trip". The dim trip-context eyebrow is
        // redundant with the trip header strip above the tab bar, so
        // it's gone. Section banners below still carry the role
        // breakdown.
        eyebrow={`Crew · ${totalCount}`}
        eyebrowTone="accent"
        headline="Who's on the trip"
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
        // Header-corner "Email the crew" button — visible/enabled whenever
        // any other crew member has an email on file. Stays visible at
        // every viewport (actionAlwaysVisible) since the FAB only
        // substitutes for the *add* CTA, not this secondary action.
        desktopAction={
          hasEmailableCrew ? (
            <button
              type="button"
              onClick={() => openEmailModal()}
              data-testid="email-crew-btn"
              className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors hover:bg-[var(--color-bt-hover)]"
              style={{
                background: "var(--color-bt-card-raised)",
                color: "var(--color-bt-text)",
                border: "1px solid var(--color-bt-border)",
              }}
            >
              <Mail size={13} />
              Email the crew
            </button>
          ) : undefined
        }
        actionAlwaysVisible
      />

      {/* Two crew nudges — only fire for Owner.
          - Pending: invite-eligible (guest + email) rows where the blast
            has never been sent (last_emailed_at is null). The Owner
            added them but never hit "send invites" — the nudge prompts
            that send.
          - Invited: blast has gone out (last_emailed_at set) but the
            recipient hasn't signed up yet. Resend nudge.
          Each carries a right-justified Send/Resend email button that
          opens the blast modal — the previously-redundant header-corner
          email button is gone (Task 59). */}
      {isOwner &&
        (() => {
          const pending = members.filter(
            (m) => deriveStatus(m) === "invited" && !m.last_emailed_at
          );
          const invited = members.filter(
            (m) => deriveStatus(m) === "invited" && !!m.last_emailed_at
          );
          if (pending.length === 0 && invited.length === 0) return null;
          return (
            <div className="mb-4 flex flex-col gap-2">
              {pending.length > 0 && (
                <CrewNudge
                  title={
                    pending.length === 1
                      ? "1 person is ready to invite"
                      : `${pending.length} people are ready to invite`
                  }
                  body="You haven't emailed them yet — send them a link to join the trip."
                  ctaLabel="Send invites"
                  onCta={() => openEmailModal(pending.map((m) => m.memberId))}
                />
              )}
              {invited.length > 0 && (
                <CrewNudge
                  title={
                    invited.length === 1
                      ? "1 person hasn't joined yet"
                      : `${invited.length} people haven't joined yet`
                  }
                  body="They got an invite but haven't created an account — send a follow-up."
                  ctaLabel="Follow up"
                  onCta={() => openEmailModal(invited.map((m) => m.memberId))}
                />
              )}
            </div>
          );
        })()}

      {/* Crew grid — collapse threshold tightened from lg (1024) to
          900px per round-9. At lg+ the rail had room, but the page
          read cramped because the rail competed for visual weight at
          its fixed 320px. Rail column is now `minmax(280px, 320px)`
          so it shrinks gradually as the viewport narrows toward 900,
          then stacks. 280px floor keeps the composer + legend
          readable; 320px ceiling keeps it from over-padding on wider
          screens. Below 900px the grid collapses to a single column
          and the rail (still .sm:flex visible) stacks below content. */}
      <div className="grid gap-4 min-[900px]:grid-cols-[minmax(0,1fr)_minmax(280px,320px)] min-[900px]:gap-5">
        {/* Main column — Organizers + Crew sections */}
        <div className="flex flex-col gap-5">
          <CrewSection
            title="Organizers"
            tone="accent"
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
                className="mb-2 flex items-baseline justify-between gap-2 rounded-lg px-3 py-1.5 text-xs font-semibold uppercase tracking-wider"
                style={{
                  color: "var(--color-bt-planning)",
                  background: "var(--color-bt-planning-faint)",
                }}
              >
                <span>Crew</span>
                <span
                  className="font-mono"
                  style={{ color: "var(--color-bt-planning)", opacity: 0.75 }}
                >
                  0
                </span>
              </h2>
              <EmptyCrewInvitation />
            </section>
          ) : (
            <CrewSection
              title="Crew"
              tone="planning"
              members={restCrew}
              isOwnerView={isOwner}
              currentUserId={currentUser?.id}
              onEditMember={(m) => setEditingMemberId(m.memberId)}
              // This branch only renders when the viewer is NOT the
              // owner (owners get EmptyCrewInvitation above), so the
              // copy doesn't point at the add panel — only Organizers
              // can grow the crew from here.
              emptyHint="Nobody on the crew yet. Ask an Organizer to add the rest of the trip."
            />
          )}
        </div>

        {/* Right rail — composer + full legend.
            Three responsive states (round-10):
              ≥900  : single column inside the outer grid's narrow
                      right track (composer above legend) — flex-col.
              640-899: stacked below content as TWO side-by-side columns
                      (composer | legend), each filling its half of the
                      horizontal space the stacked layout gives them.
              <640  : hidden — FAB + compact legend take over (Task 43).
            Both breakpoints use arbitrary variants (`min-[640px]:` /
            `min-[900px]:`) so Tailwind v4 sorts them numerically by
            min-width — mixing `sm:` with `min-[900px]:` puts the named
            variant later in the cascade and lets `sm:grid` beat
            `min-[900px]:flex` at vw≥900. */}
        <aside
          className={[
            "hidden gap-5",
            isOwner
              ? "min-[640px]:grid min-[640px]:grid-cols-2"
              : "min-[640px]:block",
            "min-[900px]:flex min-[900px]:flex-col min-[900px]:gap-4",
          ].join(" ")}
        >
          {isOwner &&
            <AddCrewComposer tripId={tripId} boosted={isEmpty} />}
          <StatusLegend members={members} />
        </aside>
      </div>

      {/* Compact horizontal legend — visible only at < sm where the
          full legend has gone away. Keeps the role/status grammar on
          every screen so users always know what the pills mean. */}
      <div className="mt-4 sm:hidden">
        <CompactStatusLegend members={members} />
      </div>

      {/* Mobile add — sheet-like inline composer triggered by the FAB.
          Phones (<md) drop the rail entirely and route through this
          inline reveal. */}
      {/* Mobile Add Crew — bottom sheet modal, not the inline reveal it
          used to be. Brings the FAB → modal pattern in line with the
          other tabs (Add Property, Add Receipt, Add Agenda) per
          round-4 item 9. */}
      {isOwner && showMobileAdd && (
        <div className="fixed inset-0 z-50 sm:hidden">
          <div
            className="absolute inset-0"
            style={{ background: "var(--color-bt-overlay-sheet)" }}
            onClick={() => setShowMobileAdd(false)}
            aria-hidden
          />
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Add crew member"
            className="absolute inset-x-0 bottom-0 flex flex-col rounded-t-2xl"
            style={{
              background: "var(--color-bt-card-float)",
              boxShadow: "var(--shadow-floating)",
              maxHeight: "85vh",
            }}
          >
            <div className="flex justify-center py-2">
              <span
                className="block h-1 w-9 rounded-full"
                style={{ background: "var(--color-bt-border)" }}
              />
            </div>
            <div
              className="flex items-center justify-between px-4 pb-3"
              style={{ borderBottom: "1px solid var(--color-bt-subtle-border)" }}
            >
              <span
                className="text-sm font-semibold"
                style={{ color: "var(--color-bt-text)" }}
              >
                Add crew member
              </span>
              <button
                type="button"
                onClick={() => setShowMobileAdd(false)}
                aria-label="Close"
                className="flex h-7 w-7 items-center justify-center rounded-full"
                style={{
                  background: "var(--color-bt-card-raised)",
                  color: "var(--color-bt-text-dim)",
                }}
              >
                <X size={14} />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-4">
              {/* variant='sheet' strips the composer's card chrome
                  (background, border, shadow, radius, padding, eyebrow).
                  The bottom-sheet already provides framing + a title
                  bar above, so the composer's own card would read as a
                  nested duplicate. */}
              <AddCrewComposer
                tripId={tripId}
                boosted={isEmpty}
                variant="sheet"
                onAdded={() => setShowMobileAdd(false)}
              />
            </div>
          </div>
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
            className="relative flex w-full max-w-lg flex-col overflow-hidden rounded-t-2xl sm:rounded-2xl"
            style={{
              background: "var(--color-bt-card)",
              maxHeight: "90dvh",
            }}
          >
            <CrewEmailPanel
              trip={trip}
              isOwner={isOwner}
              preselectMemberIds={emailPreselectIds}
              onClose={() => setShowEmailModal(false)}
            />
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

      {/* Crew FAB — visible only below sm (640px), matching the
          aside's sm+ visibility so the two affordances swap at the
          same threshold (round-8 item 4). The TabFab's global
          md:hidden gets tightened here via a sm:hidden wrapper so
          Lodging / Receipts / Agenda keep their existing md threshold
          unchanged. */}
      {isOwner && (
        <div className="sm:hidden">
          <TabFab
            onClick={() => setShowMobileAdd((v) => !v)}
            label="Add crew member"
            icon={<UserPlus size={20} strokeWidth={2.25} />}
            testId="add-crew-member-fab"
          />
        </div>
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
