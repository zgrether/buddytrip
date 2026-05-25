"use client";

import { useEffect, useMemo, useState } from "react";
import { ArrowUpCircle, Check, Crown, Loader2, Mail, Send, Trash2, X } from "lucide-react";
import { trpc } from "@/lib/trpc-client";
import { useModalBackButton } from "@/hooks/useModalBackButton";
import { UserAvatar } from "@/components/UserAvatar";

// ── Types ─────────────────────────────────────────────────────────────────

export type MemberEditorTarget = {
  memberId: string;
  user_id: string | null;
  role: string;
  isGuest: boolean;
  displayName: string;
  user: {
    name?: string | null;
    nickname?: string | null;
    email: string | null;
    is_guest?: boolean;
  } | null;
};

type ValidationState = "idle" | "checking" | "match" | "invite" | "invalid";

// Mirror of CrewTab's deriveStatus — kept inline to avoid a circular import.
function deriveStatus(m: MemberEditorTarget): "active" | "invited" | "placeholder" {
  if (!m.isGuest) return "active";
  if (m.user?.email) return "invited";
  return "placeholder";
}

function statusLabel(s: ReturnType<typeof deriveStatus>) {
  switch (s) {
    case "active":
      return "Active";
    case "invited":
      return "Invited";
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
  const initialNickname = member.user?.nickname ?? member.user?.name ?? member.displayName;

  const [nickname, setNickname] = useState(initialNickname);
  const [email, setEmail] = useState(initialEmail);

  // ── Live email validation (debounced) ──────────────────────────────────
  const formatOk = useMemo(() => {
    if (!email.trim()) return null; // empty → no card
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
  }, [email]);

  const [debounced, setDebounced] = useState(email);
  useEffect(() => {
    const id = window.setTimeout(() => setDebounced(email), 400);
    return () => window.clearTimeout(id);
  }, [email]);

  const checkQuery = trpc.tripMembers.checkEmail.useQuery(
    { tripId, email: debounced.trim() },
    {
      enabled: !!debounced.trim() && formatOk === true,
      staleTime: 30_000,
    }
  );

  const validation: ValidationState = useMemo(() => {
    if (!email.trim()) return "idle";
    if (formatOk === false) return "invalid";
    // Format-valid but query hasn't settled (or is in-flight).
    if (debounced !== email || checkQuery.isFetching) return "checking";
    if (checkQuery.data?.result === "match") return "match";
    if (checkQuery.data?.result === "invalid") return "invalid";
    if (checkQuery.data?.result === "invite") return "invite";
    return "checking";
  }, [email, debounced, formatOk, checkQuery.data, checkQuery.isFetching]);

  // ── Mutations ──────────────────────────────────────────────────────────
  const updateGuest = trpc.ghostCrew.update.useMutation({
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
    const nicknameChanged = nickname.trim() !== (member.user?.nickname ?? member.user?.name ?? "");
    const emailChanged = email.trim() !== (member.user?.email ?? "");
    if (member.isGuest && member.user_id && (nicknameChanged || emailChanged)) {
      await updateGuest.mutateAsync({
        tripId,
        guestUserId: member.user_id,
        ...(nicknameChanged && { nickname: nickname.trim() }),
        ...(emailChanged && { email: email.trim() || null }),
      });
    }
    onClose();
  };

  const handleRemove = () => {
    if (!member.user_id) return;
    if (member.isGuest) removeGuest.mutate({ tripId, guestUserId: member.user_id });
    else removeMember.mutate({ tripId, userId: member.user_id });
  };

  const handleMakeOrganizer = () => {
    if (!member.user_id) return;
    updateRole.mutate({ tripId, userId: member.user_id, role: "Planner" });
  };

  const handleRemoveOrganizer = () => {
    if (!member.user_id) return;
    updateRole.mutate({ tripId, userId: member.user_id, role: "Member" });
  };

  // ── Render ─────────────────────────────────────────────────────────────
  return (
    <>
      {/* Backdrop — two tokens because drawer scrims are lighter than
          the modal/sheet ones (see Task 1). */}
      <div
        className="fixed inset-0 z-40 lg:hidden"
        style={{ background: "var(--color-bt-overlay-sheet)" }}
        onClick={onClose}
        aria-hidden
      />
      <div
        className="fixed inset-0 z-40 hidden lg:block"
        style={{ background: "var(--color-bt-overlay-drawer)" }}
        onClick={onClose}
        aria-hidden
      />

      {/* Panel — bottom-sheet (mobile) / right-side drawer (desktop). */}
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`Edit ${member.displayName}`}
        className={[
          "fixed z-50 flex flex-col",
          // Mobile: bottom-anchored sheet, ~82% height
          "inset-x-0 bottom-0 h-[82vh] rounded-t-2xl",
          // Desktop (lg+): right-anchored drawer, full height, 440px wide
          // per the canonical edit-drawer spec.
          "lg:inset-x-auto lg:bottom-auto lg:right-0 lg:top-0 lg:h-screen lg:w-[440px] lg:rounded-none",
        ].join(" ")}
        style={{
          background: "var(--color-bt-card-float)",
          boxShadow: "var(--shadow-floating)",
          borderLeft: "1px solid var(--color-bt-border)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Mobile grab handle — only on small viewports */}
        <div className="lg:hidden flex justify-center py-2">
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
            {/* Avatar — matches the row's variant logic. Placeholder
                renders a neutral square with dim initials; invited
                gets a small amber ✉ corner; active is the standard
                team-color UserAvatar. */}
            {status === "placeholder" ? (
              <span
                className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full text-xs font-semibold"
                style={{
                  background: "var(--color-bt-card-raised)",
                  border: "1px solid var(--color-bt-border)",
                  color: "var(--color-bt-text-dim)",
                }}
              >
                {(nickname || member.displayName || "?")
                  .split(/\s+/)
                  .map((w) => w[0])
                  .join("")
                  .slice(0, 2)
                  .toUpperCase()}
              </span>
            ) : status === "invited" ? (
              <span className="relative h-9 w-9 flex-shrink-0">
                <UserAvatar
                  name={nickname || member.displayName}
                  avatarUrl={null}
                  sizePx={36}
                />
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
            ) : (
              <UserAvatar
                name={nickname || member.displayName}
                avatarUrl={null}
                sizePx={36}
              />
            )}
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

        {/* Body — scrollable */}
        <div className="flex flex-1 flex-col gap-4 overflow-y-auto px-4 py-4">
          {/* Trip nickname */}
          <Field
            label="Trip nickname"
            hint={
              isOwnerRow
                ? "The Owner controls their own display name from their account settings."
                : "How the app refers to them on this trip. Only Organizers can change it."
            }
          >
            <input
              value={nickname}
              onChange={(e) => setNickname(e.target.value)}
              disabled={isOwnerRow}
              className="w-full rounded-lg border px-3 py-2 text-sm outline-none disabled:opacity-60"
              style={{
                background: "var(--color-bt-card)",
                borderColor: "var(--color-bt-border)",
                color: "var(--color-bt-text)",
              }}
            />
          </Field>

          {/* Account name — read-only, only for Active users */}
          {status === "active" && member.user?.name && (
            <Field
              label="Account name"
              hint="The name on their BuddyTrip account — they manage this themselves."
            >
              <div
                className="flex items-center justify-between rounded-lg border px-3 py-2 text-sm"
                style={{
                  background: "var(--color-bt-card-raised)",
                  borderColor: "var(--color-bt-border)",
                  color: "var(--color-bt-text-dim)",
                }}
              >
                <span>{member.user.name}</span>
                <span
                  className="text-[10px] font-bold uppercase tracking-[0.08em]"
                  style={{ color: "var(--color-bt-text-dim)" }}
                >
                  Read-only
                </span>
              </div>
            </Field>
          )}

          {/* Email — visible for every status per round-5 item C.
              Editable for invited / placeholder (the organizer entered
              the email so they can fix typos); read-only for Active
              (the email belongs to the BT account and is owned by the
              member themselves). */}
          {status === "active" ? (
            <Field
              label="Email"
              hint="This is the email on their BuddyTrip account — they manage it from their own account settings. To replace this person, remove them from the trip and re-add with the right email."
            >
              <div
                className="flex items-center justify-between rounded-lg border px-3 py-2 font-mono text-sm"
                style={{
                  background: "var(--color-bt-card-raised)",
                  borderColor: "var(--color-bt-border)",
                  color: "var(--color-bt-text-dim)",
                }}
              >
                <span className="truncate">{member.user?.email ?? "—"}</span>
                <span
                  className="ml-3 flex-shrink-0 text-[10px] font-bold uppercase tracking-[0.08em]"
                  style={{ color: "var(--color-bt-text-dim)" }}
                >
                  Read-only
                </span>
              </div>
            </Field>
          ) : (
            <Field
              label="Email"
              hint="Adding an email turns a Placeholder into Active (if the email matches a BuddyTrip account) or Invited."
            >
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder={`${member.displayName.toLowerCase().replace(/\s+/g, "")}@example.com`}
                className="w-full rounded-lg border px-3 py-2 font-mono text-sm outline-none"
                style={{
                  background: "var(--color-bt-card)",
                  borderColor: validationBorder(validation),
                  color: "var(--color-bt-text)",
                }}
              />
              <ValidationFeedback state={validation} email={email} />
            </Field>
          )}

          {/* Permissions — contextual control per spec */}
          <Field label="Permissions">
            <RoleControl
              role={member.role}
              status={status}
              canManageRoles={canManageRoles}
              onMakeOrganizer={handleMakeOrganizer}
              onRemoveOrganizer={handleRemoveOrganizer}
            />
          </Field>

          {/* Danger — remove from trip */}
          {!isOwnerRow && (
            <button
              onClick={handleRemove}
              disabled={removeMember.isPending || removeGuest.isPending}
              className="mt-2 inline-flex items-center justify-center gap-1.5 self-start rounded-lg px-3 py-2 text-xs font-semibold disabled:opacity-40"
              style={{
                background: "transparent",
                color: "var(--color-bt-danger)",
                border: "1px solid var(--color-bt-danger-border)",
              }}
            >
              <Trash2 size={13} />
              Remove from trip
            </button>
          )}
        </div>

        {/* Footer — Save / Cancel */}
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
          <button
            onClick={handleSave}
            disabled={updateGuest.isPending}
            className="flex-1 rounded-lg py-2 text-sm font-semibold transition-opacity hover:opacity-90 disabled:opacity-40"
            style={{
              background: "var(--color-bt-accent)",
              color: "var(--color-bt-on-accent)",
            }}
          >
            Save changes
          </button>
        </div>
      </div>
    </>
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

// ── ValidationFeedback — the four-state helper card ───────────────────────

function validationBorder(state: ValidationState) {
  switch (state) {
    case "checking":
    case "invite":
      return "var(--color-bt-warning)";
    case "match":
      return "var(--color-bt-accent)";
    case "invalid":
      return "var(--color-bt-danger)";
    default:
      return "var(--color-bt-border)";
  }
}

function ValidationFeedback({ state, email }: { state: ValidationState; email: string }) {
  if (state === "idle") return null;

  type Tone = "accent" | "warning" | "danger";
  const copy: { tone: Tone; icon: "check" | "send" | "x" | "spin"; title: string; body: string | null } =
    state === "checking"
      ? { tone: "warning", icon: "spin", title: "Checking BuddyTrip…", body: null }
      : state === "match"
        ? {
            tone: "accent",
            icon: "check",
            title: "Already on BuddyTrip",
            body: `${email} is an active account — they'll be in the trip the moment you save.`,
          }
        : state === "invite"
          ? {
              tone: "warning",
              icon: "send",
              title: "We'll send an invite",
              body: `No account at ${email}. We'll email an invite link when you save; they become Active once they sign up.`,
            }
          : {
              tone: "danger",
              icon: "x",
              title: "That email doesn't look right",
              body: "Or leave it blank — they'll be a placeholder.",
            };

  const tones: Record<Tone, { fg: string; bg: string; border: string }> = {
    accent: {
      fg: "var(--color-bt-accent)",
      bg: "var(--color-bt-accent-faint)",
      border: "var(--color-bt-accent-border)",
    },
    warning: {
      fg: "var(--color-bt-warning)",
      bg: "var(--color-bt-warning-faint)",
      border: "var(--color-bt-warning-border)",
    },
    danger: {
      fg: "var(--color-bt-danger)",
      bg: "var(--color-bt-danger-faint)",
      border: "var(--color-bt-danger-border)",
    },
  };
  const t = tones[copy.tone];

  return (
    <div
      className="mt-1 flex items-start gap-2.5 rounded-lg px-3 py-2"
      style={{ background: t.bg, border: `1px solid ${t.border}` }}
    >
      <span
        className="flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full"
        style={{
          background: copy.icon === "spin" ? "transparent" : t.fg,
          color: "var(--color-bt-on-accent)",
          border: copy.icon === "spin" ? `2px solid ${t.fg}` : undefined,
        }}
      >
        {copy.icon === "check" && <Check size={12} strokeWidth={3} />}
        {copy.icon === "send" && <Send size={11} strokeWidth={2.5} />}
        {copy.icon === "x" && <X size={12} strokeWidth={3} />}
        {copy.icon === "spin" && <Loader2 size={11} className="animate-spin" style={{ color: t.fg }} />}
      </span>
      <div className="min-w-0">
        <div className="text-[12px] font-semibold" style={{ color: t.fg }}>
          {copy.title}
        </div>
        {copy.body && (
          <div
            className="mt-0.5 text-[11px] leading-snug"
            style={{ color: "var(--color-bt-text-dim)" }}
          >
            {copy.body}
          </div>
        )}
      </div>
    </div>
  );
}

// ── RoleControl — contextual permission control per spec ──────────────────

function RoleControl({
  role,
  status,
  canManageRoles,
  onMakeOrganizer,
  onRemoveOrganizer,
}: {
  role: string;
  status: "active" | "invited" | "placeholder";
  canManageRoles: boolean;
  onMakeOrganizer: () => void;
  onRemoveOrganizer: () => void;
}) {
  // Owner — explainer only, no control.
  if (role === "Owner") {
    return (
      <div
        className="flex items-center gap-2.5 rounded-lg px-3 py-2.5"
        style={{
          background: "var(--color-bt-warning-faint)",
          border: "1px solid var(--color-bt-warning-border)",
        }}
      >
        <span
          className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider"
          style={{
            color: "var(--color-bt-owner)",
            border: "1px solid var(--color-bt-owner)",
          }}
        >
          <Crown size={9} />
          Owner
        </span>
        <span className="text-[12px]" style={{ color: "var(--color-bt-text)" }}>
          Created the trip. Change ownership from Trip settings.
        </span>
      </div>
    );
  }

  // Non-Active — can't be promoted yet.
  if (status !== "active") {
    return (
      <div
        className="rounded-lg px-3 py-2.5 text-[12px] leading-snug"
        style={{
          background: "var(--color-bt-card-raised)",
          border: "1px dashed var(--color-bt-border)",
          color: "var(--color-bt-text-dim)",
        }}
      >
        <strong style={{ color: "var(--color-bt-text)", fontWeight: 600 }}>
          Member (default).
        </strong>{" "}
        Only Active BuddyTrip users can be promoted to Organizer — this person becomes eligible once they sign up.
      </div>
    );
  }

  // Active Organizer — describe + danger demote.
  if (role === "Planner") {
    return (
      <div className="flex flex-col gap-2">
        <div
          className="flex items-start gap-2.5 rounded-lg px-3 py-2.5"
          style={{
            background: "var(--color-bt-accent-faint)",
            border: "1px solid var(--color-bt-accent-border)",
          }}
        >
          <span
            className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-md"
            style={{
              background: "var(--color-bt-accent)",
              color: "var(--color-bt-on-accent)",
            }}
          >
            <Check size={12} strokeWidth={3} />
          </span>
          <div className="min-w-0">
            <div className="text-[12px] font-semibold" style={{ color: "var(--color-bt-accent)" }}>
              Organizer
            </div>
            <div
              className="mt-0.5 text-[11px] leading-snug"
              style={{ color: "var(--color-bt-text-dim)" }}
            >
              Can edit destination, dates, lodging, agenda, receipts, and the crew. Cannot delete the trip or transfer ownership.
            </div>
          </div>
        </div>
        {canManageRoles && (
          <button
            onClick={onRemoveOrganizer}
            className="self-start rounded-lg border px-3 py-1.5 text-xs font-medium"
            style={{
              color: "var(--color-bt-danger)",
              borderColor: "var(--color-bt-danger-border)",
              background: "transparent",
            }}
          >
            Remove organizer status
          </button>
        )}
      </div>
    );
  }

  // Active Member — single elevate action.
  return (
    <div className="flex flex-col gap-2">
      {canManageRoles ? (
        <>
          {/* Solid teal CTA — distinct from the "is currently an
              Organizer" state card, which uses a teal check inside an
              accent-faint pill. This one's a primary action, so it
              looks like one: bt-accent fill, on-accent text, an
              arrow-up-circle promotion icon (not a check, which would
              read as "already done"). */}
          <button
            onClick={onMakeOrganizer}
            className="inline-flex items-center justify-center gap-2 self-start rounded-lg px-3.5 py-2 text-sm font-semibold transition-opacity hover:opacity-90"
            style={{
              background: "var(--color-bt-accent)",
              color: "var(--color-bt-on-accent)",
            }}
          >
            <ArrowUpCircle size={14} strokeWidth={2.5} />
            Make organizer
          </button>
          <div
            className="text-[11px] leading-snug"
            style={{ color: "var(--color-bt-text-dim)" }}
          >
            Organizers get nearly all owner permissions — useful for delegating trip planning.
          </div>
        </>
      ) : (
        <div className="text-[12px]" style={{ color: "var(--color-bt-text-dim)" }}>
          Only the Owner can promote a Member to Organizer.
        </div>
      )}
    </div>
  );
}

// Suppress unused-icon lint warning — `Mail` is referenced indirectly
// in some build configurations.
void Mail;
