"use client";

import { useEffect, useMemo, useState } from "react";
import { Check, Mail, Plane, Shield, Users, X, type LucideIcon } from "lucide-react";
import { ConfirmDeleteButton } from "@/components/ConfirmDeleteButton";
import { trpc } from "@/lib/trpc-client";
import { useModalBackButton } from "@/hooks/useModalBackButton";
import { ScrollLock } from "@/hooks/useScrollLock";
import { Avatar } from "@/components/Avatar";
import {
  useEmailValidation,
  validationBorder,
  ValidationFeedback,
  type ValidationState,
} from "@/components/emailValidation";
import {
  TravelFields,
  travelMemberToForm,
  travelFormToPayload,
  travelFormsEqual,
  TRAVEL_CLEAR_PAYLOAD,
  type TravelFormValue,
} from "./TravelControls";

// ── Types ─────────────────────────────────────────────────────────────────

export type MemberEditorTarget = {
  memberId: string;
  user_id: string | null;
  role: string;
  isGuest: boolean;
  displayName: string;
  /**
   * Trip-scoped nickname from trip_members.nickname (null when unset). When
   * set, overrides users.name for display on this trip only. Edited via
   * tripMembers.updateNickname.
   */
  nickname?: string | null;
  /** Times this member has been emailed. 0 = not invited yet → reads as
   *  Pending even for a real account; >0 = contacted. Mirrors CrewTab. */
  email_count?: number | null;
  /** Travel fields (live on trip_members). The owner edits these for any
   *  member (incl. placeholders) via the Travel section below. */
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
    /** Tabler icon id the user chose in /profile (e.g. "flag-2"). The
     *  drawer header surfaces this, NOT users.avatar_url (the OAuth /
     *  Google photo), so the avatar reflects the user's explicit
     *  in-app identity rather than their login provider's photo. */
    avatar_icon?: string | null;
  } | null;
};

// Mirror of CrewTab's deriveStatus — kept inline to avoid a circular import.
function deriveStatus(m: MemberEditorTarget): "active" | "invited" | "placeholder" {
  // Owner is inherently on the trip — always active.
  if (m.role === "Owner") return "active";
  // Guest with no email = name-only stand-in.
  if (m.isGuest && !m.user?.email) return "placeholder";
  // Never emailed (guest OR real account) = not officially invited yet.
  if ((m.email_count ?? 0) === 0) return "invited";
  // Emailed: guest still waiting to sign up (invited); real account = active.
  return m.isGuest ? "invited" : "active";
}

function statusLabel(s: ReturnType<typeof deriveStatus>) {
  switch (s) {
    case "active":
      return "Active";
    case "invited":
      // Matches the "Pending" umbrella in the StatusLegend / CompactStatusLegend
      // — covers both "pending invite" (added, not sent) and "invited"
      // (sent, not signed up) so the drawer reads consistently with the
      // rail legend.
      return "Pending";
    case "placeholder":
      return "Placeholder (no email)";
  }
}

// ── MemberEditor (drawer on desktop, bottom sheet on mobile) ──────────────

interface MemberEditorProps {
  tripId: string;
  member: MemberEditorTarget;
  /** True when the current user is the trip Owner — enables role changes. */
  canManageRoles: boolean;
  onClose: () => void;
}

export function MemberEditor({ tripId, member, canManageRoles, onClose }: MemberEditorProps) {
  useModalBackButton(onClose);
  const utils = trpc.useUtils();

  const initialEmail = member.user?.email ?? "";
  // Nickname source-of-truth is the trip-scoped trip_members.nickname column.
  // Falls back to the user's account name, then the resolved displayName.
  const initialNickname =
    member.nickname ?? member.user?.name ?? member.displayName;

  const [nickname, setNickname] = useState(initialNickname);
  const [email, setEmail] = useState(initialEmail);
  // Surfaces a failed save (e.g. the email collides with another member)
  // so the drawer explains itself instead of silently refusing to close.
  const [saveError, setSaveError] = useState<string | null>(null);
  // Travel — this is an edit drawer, so the fields are always present (no
  // add/edit toggle). State lives here and is persisted by the drawer's own
  // Save button rather than an inner Save/Cancel.
  const initialTravelForm = useMemo(() => travelMemberToForm(member), [member]);
  const [travelForm, setTravelForm] = useState<TravelFormValue>(initialTravelForm);
  // Clear/reset flag — set by the "Clear" button, which empties the fields and
  // marks travel for removal. Persisted on the drawer's Save as travelMode:null
  // (so the row reads "no travel"). Editing any field re-engages → flag clears.
  const [travelCleared, setTravelCleared] = useState(false);
  const handleTravelChange = (next: TravelFormValue) => {
    setTravelCleared(false);
    setTravelForm(next);
  };
  const hadSavedTravel = !!member.travel_mode;
  const travelDirty = travelCleared
    ? hadSavedTravel
    : !travelFormsEqual(travelForm, initialTravelForm);

  // ── Live email validation (debounced) ──────────────────────────────────
  const validation: ValidationState = useEmailValidation(tripId, email);

  // ── Mutations ──────────────────────────────────────────────────────────
  const updateGuest = trpc.ghostCrew.update.useMutation({
    onSuccess: () => utils.tripMembers.list.invalidate({ tripId }),
  });
  // Trip-scoped nickname update — works for guest AND active members alike,
  // because the nickname now lives on trip_members rather than users.
  const updateNickname = trpc.tripMembers.updateNickname.useMutation({
    onSuccess: () => utils.tripMembers.list.invalidate({ tripId }),
  });
  // Owner-edits-anyone travel write (works for placeholders too). Fired as
  // part of handleSave when the travel fields are dirty.
  const updateMemberTravel = trpc.tripMembers.updateMemberTravel.useMutation({
    onSuccess: () => utils.tripMembers.list.invalidate({ tripId }),
  });
  const removeMember = trpc.tripMembers.remove.useMutation({
    onSuccess: () => {
      utils.tripMembers.list.invalidate({ tripId });
      onClose();
    },
  });
  const removeGuest = trpc.ghostCrew.remove.useMutation({
    onSuccess: () => {
      utils.tripMembers.list.invalidate({ tripId });
      onClose();
    },
  });
  const updateRole = trpc.tripMembers.updateRole.useMutation({
    async onMutate(vars) {
      await utils.tripMembers.list.cancel({ tripId });
      const prev = utils.tripMembers.list.getData({ tripId });
      utils.tripMembers.list.setData({ tripId }, (old) =>
        (old ?? []).map((row) =>
          row.user_id === vars.userId ? { ...row, role: vars.role } : row
        )
      );
      return { prev };
    },
    onError(_e, _v, ctx) {
      if (ctx?.prev) utils.tripMembers.list.setData({ tripId }, ctx.prev);
    },
    onSettled: () => utils.tripMembers.list.invalidate({ tripId }),
  });

  const status = deriveStatus(member);
  const isOwnerRow = member.role === "Owner";

  const handleSave = async () => {
    if (!member.user_id) {
      onClose();
      return;
    }

    setSaveError(null);
    const nameChanged = nickname.trim() !== initialNickname.trim();
    const emailChanged = email.trim() !== (member.user?.email ?? "");
    const tasks: Promise<unknown>[] = [];

    if (member.isGuest) {
      // ── Ghost (placeholder / invited) ──────────────────────────────
      // A ghost has no real account and no profile to self-edit, so the
      // name field edits users.name *directly* — it's the single source
      // of truth, not a trip-scoped override. (Renaming a ghost via the
      // nickname override left the original typo frozen in users.name;
      // now we just fix the name.) Name + email both flow through one
      // ghostCrew.update call.
      const guestUpdate: {
        tripId: string;
        guestUserId: string;
        name?: string;
        email?: string | null;
      } = { tripId, guestUserId: member.user_id };
      if (nameChanged && nickname.trim()) guestUpdate.name = nickname.trim();
      if (emailChanged) guestUpdate.email = email.trim() || null;
      if (guestUpdate.name !== undefined || guestUpdate.email !== undefined) {
        tasks.push(updateGuest.mutateAsync(guestUpdate));
      }
      // Clear any legacy trip-nickname override so users.name is the only
      // name in play (older ghosts renamed under the previous model still
      // carry one; without this, the stale override would keep winning).
      if (member.nickname) {
        tasks.push(
          updateNickname.mutateAsync({ tripId, userId: member.user_id, nickname: "" })
        );
      }
    } else {
      // ── Real account ───────────────────────────────────────────────
      // Never touch their users.name (they own it via their profile);
      // the name field edits the trip-scoped nickname override only.
      if (nameChanged) {
        tasks.push(
          updateNickname.mutateAsync({
            tripId,
            userId: member.user_id,
            nickname: nickname.trim(),
          })
        );
      }
    }

    // Travel — persist alongside name/email when the always-on fields changed.
    // A cleared form sends the wipe payload (travelMode:null) so the row reads
    // "no travel"; otherwise send the form's current values.
    if (travelDirty) {
      tasks.push(
        updateMemberTravel.mutateAsync({
          tripId,
          targetUserId: member.user_id,
          ...(travelCleared ? TRAVEL_CLEAR_PAYLOAD : travelFormToPayload(travelForm)),
        })
      );
    }

    try {
      if (tasks.length > 0) {
        await Promise.all(tasks);
      }
      onClose();
    } catch (err) {
      // Keep the drawer open and explain why instead of silently failing.
      setSaveError(
        err instanceof Error ? err.message : "Couldn't save your changes. Please try again."
      );
    }
  };

  const handleRemove = () => {
    if (!member.user_id) return;
    if (member.isGuest) removeGuest.mutate({ tripId, guestUserId: member.user_id });
    else removeMember.mutate({ tripId, userId: member.user_id });
  };

  // ── Role-change is instant, not part of Save (Task 54) ───────────────
  //
  // Role buttons fire `updateRole` the moment they're tapped — they
  // don't enable Save, and Cancel won't roll them back. This makes the
  // mental model crisp: typed input = Save; buttons = immediate.
  //
  // To soften the irreversibility, we show a transient confirmation
  // row ("✓ Promoted to organizer · Undo") for ~6 seconds after the
  // change. Undo flips the role back. After the window closes, the
  // row disappears and the Permissions section settles into the new
  // steady-state card (Organizer state-card + Demote button, or
  // Member + Make-organizer button).
  const [recentRoleChange, setRecentRoleChange] = useState<{
    toRole: "Planner" | "Member";
    fromRole: "Planner" | "Member";
  } | null>(null);

  useEffect(() => {
    if (!recentRoleChange) return;
    const timer = window.setTimeout(() => setRecentRoleChange(null), 6000);
    return () => window.clearTimeout(timer);
  }, [recentRoleChange]);

  const handleMakeOrganizer = () => {
    if (!member.user_id) return;
    updateRole.mutate({ tripId, userId: member.user_id, role: "Planner" });
    setRecentRoleChange({ toRole: "Planner", fromRole: "Member" });
  };

  const handleRemoveOrganizer = () => {
    if (!member.user_id) return;
    updateRole.mutate({ tripId, userId: member.user_id, role: "Member" });
    setRecentRoleChange({ toRole: "Member", fromRole: "Planner" });
  };

  const handleUndoRoleChange = () => {
    if (!recentRoleChange || !member.user_id) return;
    updateRole.mutate({
      tripId,
      userId: member.user_id,
      role: recentRoleChange.fromRole,
    });
    setRecentRoleChange(null);
  };

  // ── Access (role) display — pill in the group header, description +
  //    a single change button below. Owner is never editable here. ─────────
  const isOrganizer = member.role === "Planner";
  const roleBadge = isOwnerRow
    ? { label: "Owner", color: "var(--color-bt-owner)", bg: "transparent", border: "1px solid var(--color-bt-owner)" }
    : isOrganizer
      ? { label: "Organizer", color: "var(--color-bt-accent)", bg: "var(--color-bt-accent-faint)", border: "1px solid var(--color-bt-accent-border)" }
      : { label: "Member", color: "var(--color-bt-text-dim)", bg: "var(--color-bt-card-raised)", border: "1px solid var(--color-bt-border)" };
  const roleDescription = isOwnerRow
    ? "Created the trip. Change ownership from Trip settings."
    : status !== "active"
      ? "Only Active BuddyTrip users can be promoted to Organizer — they become eligible once they sign up."
      : isOrganizer
        ? "Can edit destination, dates, lodging, agenda, receipts, and the crew. Can't delete the trip or transfer ownership."
        : "Counts for rooms, teams, and receipts. Only Organizers and the Owner can edit trip details.";
  const showRoleButton = !isOwnerRow && status === "active";
  const roleButtonLabel = isOrganizer ? "Demote to member" : "Make organizer";
  const onRoleButton = isOrganizer ? handleRemoveOrganizer : handleMakeOrganizer;

  const rolePill = (
    <span
      className="inline-flex flex-shrink-0 items-center rounded px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider"
      style={{ color: roleBadge.color, background: roleBadge.bg, border: roleBadge.border }}
    >
      {roleBadge.label}
    </span>
  );

  // ── Render ─────────────────────────────────────────────────────────────
  return (
    <ScrollLock>
      {/* Backdrop — two tokens because drawer scrims are lighter than
          the modal/sheet ones (see Task 1). */}
      <div
        className="fixed inset-0 z-40 sm:hidden"
        style={{ background: "var(--color-bt-overlay-sheet)" }}
        onClick={onClose}
        aria-hidden
      />
      <div
        className="fixed inset-0 z-40 hidden sm:block"
        style={{ background: "var(--color-bt-overlay-drawer)" }}
        onClick={onClose}
        aria-hidden
      />

      {/* Panel — bottom-sheet (<640px) / right-side drawer (≥640px).
          Per Task 51 the breakpoint dropped from lg (1024) to sm (640):
          bottom sheets are a mobile pattern, and at tablet widths the
          right drawer keeps working without obscuring most of the page. */}
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`Edit ${member.displayName}`}
        className={[
          "fixed z-50 flex flex-col",
          // Mobile (<640): bottom-anchored sheet that sizes to content
          // (capped at 90vh), matching the other edit sheets.
          "inset-x-0 bottom-0 max-h-[90vh] rounded-t-2xl",
          // Tablet + desktop (≥640): right-anchored drawer, full height,
          // 440px wide per the canonical edit-drawer spec.
          "sm:inset-x-auto sm:bottom-auto sm:right-0 sm:top-0 sm:h-screen sm:max-h-screen sm:w-[440px] sm:rounded-none",
        ].join(" ")}
        style={{
          background: "var(--color-bt-card-float)",
          boxShadow: "var(--shadow-floating)",
          borderLeft: "1px solid var(--color-bt-border)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Mobile grab handle — only on small viewports */}
        <div className="sm:hidden flex justify-center py-2">
          <span
            className="block h-1 w-9 rounded-full"
            style={{ background: "var(--color-bt-border)" }}
          />
        </div>

        {/* Header */}
        <div
          className="flex items-center justify-between px-4 py-3"
          style={{ borderBottom: "1px solid var(--color-bt-subtle-border)" }}
        >
          <div className="flex min-w-0 items-center gap-3">
            {/* Avatar — surfaces the user's in-app profile choice
                (users.avatar_icon, the Tabler icon picked in /profile)
                with users.name as the initials fallback. Trip-scoped
                nickname does NOT drive the avatar — typing a new
                nickname here leaves the avatar alone. We deliberately
                ignore users.avatar_url (Google/OAuth photo) so what
                shows up is what the user explicitly picked in-app. */}
            {(() => {
              const accountName = member.user?.name ?? member.displayName;
              const accountIcon = member.user?.avatar_icon ?? null;
              if (status === "placeholder") {
                return (
                  <span
                    className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full text-xs font-semibold"
                    style={{
                      background: "var(--color-bt-card-raised)",
                      border: "1px solid var(--color-bt-border)",
                      color: "var(--color-bt-text-dim)",
                    }}
                  >
                    {(accountName || "?")
                      .split(/\s+/)
                      .map((w) => w[0])
                      .join("")
                      .slice(0, 2)
                      .toUpperCase()}
                  </span>
                );
              }
              if (status === "invited") {
                return (
                  <span className="relative h-9 w-9 flex-shrink-0">
                    <Avatar name={accountName} avatarIcon={accountIcon} size="md" />
                    <span
                      className="absolute -bottom-0.5 -right-0.5 flex h-4 w-4 items-center justify-center rounded-full"
                      style={{
                        background: "var(--color-bt-warning)",
                        color: "var(--color-bt-on-accent)",
                        border: "1.5px solid var(--color-bt-card-float)",
                      }}
                      aria-label="Invited"
                    >
                      <Mail size={8} strokeWidth={3} />
                    </span>
                  </span>
                );
              }
              return <Avatar name={accountName} avatarIcon={accountIcon} size="md" />;
            })()}
            <div className="min-w-0">
              <div
                className="text-[10px] font-bold uppercase tracking-[0.12em]"
                style={{ color: "var(--color-bt-text-dim)" }}
              >
                Edit crew member
              </div>
              <div className="mt-0.5 truncate text-[15px] font-bold" style={{ color: "var(--color-bt-text)" }}>
                {nickname || member.displayName || "Untitled person"}
              </div>
              <div className="text-[11px]" style={{ color: "var(--color-bt-text-dim)" }}>
                {member.role !== "Member" && `${member.role === "Planner" ? "Organizer" : member.role} · `}
                {statusLabel(status)}
              </div>
            </div>
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full"
            style={{
              background: "var(--color-bt-card-raised)",
              color: "var(--color-bt-text-dim)",
            }}
          >
            <X size={14} />
          </button>
        </div>

        {/* Body — scrollable, organized into three titled groups
            (Identity · Access · Travel) separated by hairlines. */}
        <div className="flex flex-1 flex-col overflow-y-auto px-4">
          {/* ── Identity ──────────────────────────────────────────────── */}
          <Group icon={Users} title="Identity" first>
            <Field label="Trip nickname" hint="What the app calls them on this trip.">
              <input
                value={nickname}
                onChange={(e) => setNickname(e.target.value)}
                disabled={isOwnerRow}
                className="w-full rounded-lg border px-3 py-2 text-sm outline-none disabled:opacity-60"
                style={{
                  background: "var(--color-bt-base)",
                  borderColor: "var(--color-bt-border)",
                  color: "var(--color-bt-text)",
                }}
              />
            </Field>

            {/* Account name — read-only mirror of their BuddyTrip account. */}
            {status === "active" && member.user?.name && (
              <Field label="Account name">
                <ReadOnlyInput value={member.user.name} />
              </Field>
            )}

            {/* Email — read-only mirror for Active; editable for
                invited/placeholder (the organizer typed it, so they can fix it). */}
            {status === "active" ? (
              <Field label="Email" hint="They manage name & email from their own account.">
                <ReadOnlyInput value={member.user?.email ?? "—"} mono />
              </Field>
            ) : (
              <Field
                label="Email"
                hint="Adding an email turns a Placeholder into Active (if it matches a BuddyTrip account) or Invited."
              >
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder={`${member.displayName.toLowerCase().replace(/\s+/g, "")}@example.com`}
                  className="w-full rounded-lg border px-3 py-2 font-mono text-sm outline-none"
                  style={{
                    background: "var(--color-bt-base)",
                    borderColor: validationBorder(validation),
                    color: "var(--color-bt-text)",
                  }}
                />
                <ValidationFeedback state={validation} email={email} />
              </Field>
            )}
          </Group>

          {/* ── Access ──────────────────────────────────────────────────
              The role pill only shows for Active members (Owner/Organizer are
              always Active). A placeholder / pending person isn't a BuddyTrip
              member yet, so a "MEMBER" badge would be misleading — hide it. */}
          <Group icon={Shield} title="Access" action={status === "active" ? rolePill : undefined}>
            <p
              className="text-[12px] italic leading-snug"
              style={{ color: "var(--color-bt-text-dim)" }}
            >
              {roleDescription}
            </p>
            {showRoleButton &&
              (canManageRoles ? (
                <button
                  type="button"
                  onClick={onRoleButton}
                  className="self-start rounded-lg border px-3 py-1.5 text-xs font-medium transition-opacity hover:opacity-85"
                  style={{
                    color: "var(--color-bt-text)",
                    borderColor: "var(--color-bt-border)",
                    background: "transparent",
                  }}
                >
                  {roleButtonLabel}
                </button>
              ) : (
                <p className="text-[11px]" style={{ color: "var(--color-bt-text-dim)" }}>
                  Only the Owner can change crew roles.
                </p>
              ))}
          </Group>

          {/* ── Travel ────────────────────────────────────────────────── */}
          {member.user_id && (
            <Group
              icon={Plane}
              title="Travel"
              action={
                travelForm.mode !== null ? (
                  <button
                    type="button"
                    onClick={() => {
                      setTravelForm(travelMemberToForm({}));
                      setTravelCleared(true);
                    }}
                    className="flex-shrink-0 rounded-lg px-2.5 py-1 text-[11px] font-medium transition-colors hover:bg-[var(--color-bt-accent-faint)]"
                    style={{ color: "var(--color-bt-accent)", background: "transparent" }}
                  >
                    Clear
                  </button>
                ) : undefined
              }
            >
              <p className="text-[11px] leading-snug" style={{ color: "var(--color-bt-text-dim)" }}>
                How they&rsquo;re getting in — shows on the roster and the itinerary.
              </p>
              {/* No empty hint here — the group hint + segmented control
                  above already say what to do. */}
              <TravelFields
                value={travelForm}
                onChange={handleTravelChange}
                surface="recessed"
                emptyHint=""
              />
              {travelCleared && hadSavedTravel && (
                <p className="text-[11px]" style={{ color: "var(--color-bt-text-dim)" }}>
                  Travel will be removed when you save.
                </p>
              )}
            </Group>
          )}

          {/* Remove from trip — danger action, set off by its own hairline.
              Space above comes from the Travel group's paddingBottom. */}
          {!isOwnerRow && (
            <div style={{ borderTop: "1px solid var(--color-bt-subtle-border)", paddingTop: 18, paddingBottom: 16 }}>
              <ConfirmDeleteButton
                label="Remove from trip"
                confirmLabel="Remove"
                prompt="Remove this person from the trip?"
                pending={removeMember.isPending || removeGuest.isPending}
                onConfirm={handleRemove}
              />
            </div>
          )}
        </div>

        {/* Role-change toast — sits above the Save/Cancel row when a
            role change just fired. Auto-fades after 6s (timer lives on
            the recentRoleChange state). Lives in the footer region —
            not inside the Permissions section — so the Permissions card
            itself stays steady-state per the Task 55 spec. */}
        {recentRoleChange && (
          <div
            className="flex-shrink-0 px-4 pt-3"
            role="status"
            aria-live="polite"
          >
            <div
              className="flex items-center justify-between gap-3 rounded-lg px-3 py-2"
              style={{
                background: "var(--color-bt-accent-faint)",
                border: "1px solid var(--color-bt-accent-border)",
              }}
            >
              <span
                className="inline-flex items-center gap-1.5 text-[12px] font-semibold"
                style={{ color: "var(--color-bt-accent)" }}
              >
                <Check size={13} strokeWidth={3} />
                {recentRoleChange.toRole === "Planner"
                  ? "Promoted to organizer"
                  : "Demoted to member"}
              </span>
              <button
                type="button"
                onClick={handleUndoRoleChange}
                className="text-[12px] font-semibold underline-offset-2 transition-opacity hover:underline hover:opacity-80"
                style={{
                  color: "var(--color-bt-accent)",
                  background: "transparent",
                  border: "none",
                  padding: 0,
                }}
              >
                Undo
              </button>
            </div>
          </div>
        )}

        {/* Footer — Cancel/Save row. The destructive "Remove from trip"
            action lives at the end of the scrollable body (danger-above
            pattern), matching the other edit modals. */}
        {saveError && (
          <div
            className="mx-4 mt-3 flex items-start gap-2.5 rounded-lg px-3 py-2"
            style={{
              background: "var(--color-bt-danger-faint)",
              border: "1px solid var(--color-bt-danger-border)",
            }}
          >
            <span
              className="flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full"
              style={{ background: "var(--color-bt-danger)", color: "var(--color-bt-on-accent)" }}
            >
              <X size={12} strokeWidth={3} />
            </span>
            <div className="min-w-0 text-[12px] font-medium" style={{ color: "var(--color-bt-danger)" }}>
              {saveError}
            </div>
          </div>
        )}

        <div
          className="flex gap-2 px-4 py-3"
          style={{ borderTop: "1px solid var(--color-bt-subtle-border)" }}
        >
          <button
            onClick={onClose}
            className="rounded-lg border px-4 py-2 text-sm font-medium"
            style={{
              borderColor: "var(--color-bt-border)",
              color: "var(--color-bt-text-dim)",
              background: "transparent",
            }}
          >
            Cancel
          </button>
          {(() => {
            // Save reflects actual unsaved diffs — typed input only.
            // Role changes don't enable Save (they fire instantly via
            // RoleControl; see Task 54). Email only counts as dirty
            // for guest rows because real accounts manage their email
            // through account settings.
            // Mirror handleSave's diff exactly (against the resolved
            // initialNickname, not the override-only value) so the
            // button state matches what Save will actually do.
            const nicknameDirty = nickname.trim() !== initialNickname.trim();
            const emailDirty =
              member.isGuest && email.trim() !== (member.user?.email ?? "");
            const canSave = nicknameDirty || emailDirty || travelDirty;
            const isPending =
              updateNickname.isPending ||
              updateGuest.isPending ||
              updateMemberTravel.isPending;
            return (
              <button
                onClick={handleSave}
                disabled={!canSave || isPending}
                className="flex-1 rounded-lg py-2 text-sm font-semibold transition-opacity enabled:hover:opacity-90 disabled:opacity-40"
                style={{
                  background: "var(--color-bt-accent)",
                  color: "var(--color-bt-on-accent)",
                  cursor: !canSave || isPending ? "not-allowed" : "pointer",
                }}
              >
                {isPending ? "Saving…" : "Save changes"}
              </button>
            );
          })()}
        </div>
      </div>
    </ScrollLock>
  );
}

// ── Field — labeled control + optional helper text ────────────────────────

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1.5">
      <span
        className="text-[11px] font-bold uppercase tracking-[0.08em]"
        style={{ color: "var(--color-bt-text-dim)" }}
      >
        {label}
      </span>
      {children}
      {hint && (
        <span
          className="text-[11px] leading-snug"
          style={{ color: "var(--color-bt-text-dim)" }}
        >
          {hint}
        </span>
      )}
    </label>
  );
}

// ── ReadOnlyInput — inert mirror of an account field (name / email) ───────
// Read-only fields use the card surface (vs base for editable inputs) and
// carry a "Read-only" tag so it's clear they mirror the member's own account.

function ReadOnlyInput({ value, mono = false }: { value: string; mono?: boolean }) {
  return (
    <div
      className={`flex items-center justify-between rounded-lg border px-3 py-2 text-sm ${mono ? "font-mono" : ""}`}
      style={{
        background: "var(--color-bt-card)",
        borderColor: "var(--color-bt-border)",
        color: "var(--color-bt-text-dim)",
      }}
    >
      <span className="truncate">{value}</span>
      <span
        className="ml-3 flex-shrink-0 text-[10px] font-bold uppercase tracking-[0.08em]"
        style={{ color: "var(--color-bt-text-dim)" }}
      >
        Read-only
      </span>
    </div>
  );
}

// ── Group — a titled section (icon + uppercase title), set off from the
//    previous group by a hairline + generous top padding. ─────────────────

function Group({
  icon: Icon,
  title,
  action,
  first = false,
  children,
}: {
  icon: LucideIcon;
  title: string;
  /** Optional control rendered at the right of the header row (role pill, Clear). */
  action?: React.ReactNode;
  /** First group skips the top hairline. */
  first?: boolean;
  children: React.ReactNode;
}) {
  return (
    <section
      className="flex flex-col"
      style={{
        borderTop: first ? "none" : "1px solid var(--color-bt-subtle-border)",
        // Symmetric padding around the hairline: each group pads its top
        // (below the divider) and bottom (above the next divider) so the line
        // is never flush against content.
        paddingTop: first ? 14 : 18,
        paddingBottom: 18,
      }}
    >
      <div className="mb-3 flex items-center justify-between gap-2">
        <span
          className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-[0.12em]"
          style={{ color: "var(--color-bt-text)" }}
        >
          <Icon size={13} strokeWidth={1.75} style={{ color: "var(--color-bt-accent)" }} />
          {title}
        </span>
        {action}
      </div>
      <div className="flex flex-col gap-[13px]">{children}</div>
    </section>
  );
}
