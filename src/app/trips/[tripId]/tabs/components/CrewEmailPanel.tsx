"use client";

import { useEffect, useRef, useState } from "react";
import { Check, Mail, RotateCcw, Send, X } from "lucide-react";
import { trpc } from "@/lib/trpc-client";
import { Avatar } from "@/components/Avatar";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { buildCannedInvitation } from "@/lib/invitationDefault";
import { parseLocalDate } from "@/lib/dates";
import type { TripData } from "../types";

const ROLE_ORDER: Record<string, number> = { Owner: 0, Organizer: 1, Member: 2 };

type RecipientMember = {
  memberId: string;
  user_id: string | null;
  role: string;
  displayName: string;
  isGuest: boolean;
  last_emailed_at?: string | null;
  /** Times emailed. 0 → the next send is a first-contact invite; >0 → a
   *  follow-up. Drives the per-recipient Invite/Follow-up label. */
  email_count?: number | null;
  user: { email: string | null; is_guest?: boolean; avatar_icon?: string | null } | null;
};

function recipientSort(a: RecipientMember, b: RecipientMember) {
  const aOrder = ROLE_ORDER[a.role] ?? 2;
  const bOrder = ROLE_ORDER[b.role] ?? 2;
  if (aOrder !== bOrder) return aOrder - bOrder;
  if (a.isGuest !== b.isGuest) return a.isGuest ? 1 : -1;
  return a.displayName.localeCompare(b.displayName);
}

/**
 * Mirrors CrewTab's deriveStatus (minus "placeholder", which can't appear
 * here — the recipient list only holds members who already have an email).
 *   • "active"  → a real BuddyTrip account that's joined the trip.
 *   • "invited" → has an email but no account yet: a guest, or a real member
 *                 we haven't emailed about this trip (email_count === 0).
 */
function recipientStatus(m: RecipientMember): "active" | "invited" {
  if (m.role === "Owner") return "active";
  if ((m.email_count ?? 0) === 0) return "invited";
  return m.isGuest ? "invited" : "active";
}

/**
 * InvitedAvatar — the avatar + amber ✉ corner badge used on the Crew tab,
 * replicated here so the email modal speaks the same visual language. Sized
 * for the modal's "sm" avatars; the badge ring matches the recipient card.
 */
function InvitedAvatar({ name, avatarIcon }: { name: string; avatarIcon?: string | null }) {
  return (
    <div className="relative flex-shrink-0">
      <Avatar name={name} avatarIcon={avatarIcon ?? null} size="sm" />
      <span
        className="absolute -bottom-0.5 -right-0.5 flex h-3.5 w-3.5 items-center justify-center rounded-full"
        style={{
          background: "var(--color-bt-warning)",
          color: "var(--color-bt-on-accent)",
          border: "1.5px solid var(--color-bt-card-raised)",
        }}
        aria-label="Invited"
      >
        <Mail size={7} strokeWidth={3} />
      </span>
    </div>
  );
}

export interface CrewEmailPanelProps {
  trip: TripData;
  isOwner: boolean;
  /**
   * memberIds to pre-check when the panel opens. The nudges pass their
   * filtered recipient lists here so "Send invites" / "Resend invites"
   * land in the modal with the right people already selected.
   */
  preselectMemberIds?: string[];
  /**
   * Overrides the default message used to seed the draft (and the Reset
   * target) when the owner hasn't saved a custom message. The idea zone
   * passes a planning-vibe invitation here; left undefined, the panel falls
   * back to buildCannedInvitation (the going-stage "it's on" copy).
   */
  defaultMessage?: string;
  /** Closes the host modal (Cancel button + header X). */
  onClose: () => void;
}

/**
 * CrewEmailPanel — full content of the "Email the crew" modal.
 *
 * Owner-only. Renders its own header (icon + title + subtitle + close),
 * a scrollable body (editable message + recipient checklist + no-email
 * chips), and a footer (Cancel + Send). Nothing is pre-selected — the
 * owner taps recipient cards to build the list.
 */
export function CrewEmailPanel({
  trip,
  isOwner,
  preselectMemberIds,
  defaultMessage,
  onClose,
}: CrewEmailPanelProps) {
  const tripId = trip.id;
  const currentUser = useCurrentUser();
  const utils = trpc.useUtils();
  const { data: members = [] } = trpc.tripMembers.list.useQuery({ tripId });

  // Editable message (autosaves on blur). The caller can override the
  // default seed/reset copy (e.g. the idea zone's planning-vibe invite).
  const cannedInvitation = defaultMessage ?? buildCannedInvitation(trip);
  // The going-stage canned invitation. A saved about_message that merely
  // equals this isn't a genuine customization — it's the old default that
  // got autosaved. Treat it as "not custom" so an overridden default (e.g.
  // the idea zone's planning invite) still wins instead of resurfacing the
  // going-stage copy.
  const goingCanned = buildCannedInvitation(trip).trim();
  const savedMessage = trip.about_message?.trim() || "";
  const hasCustomMessage = !!savedMessage && savedMessage !== goingCanned;
  const [messageDraft, setMessageDraft] = useState(
    hasCustomMessage ? savedMessage : cannedInvitation
  );

  // Auto-grow textarea: height tracks content so a multi-paragraph invite
  // isn't squashed into a tiny scroll box.
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [messageDraft]);

  const updateAbout = trpc.trips.updateAboutMessage.useMutation({
    onSuccess() { utils.trips.getById.invalidate({ tripId }); },
  });

  const handleBlur = () => {
    const trimmed = messageDraft.trim();
    // Persist genuine customizations only. Don't save the default (canned or
    // planning) — the send carries the body explicitly, and writing a default
    // into about_message pollutes it across stages.
    if (trimmed && trimmed !== savedMessage && trimmed !== cannedInvitation.trim()) {
      updateAbout.mutate({ tripId, aboutMessage: trimmed });
    }
  };

  type Member = typeof members[number];
  const others: Member[] = members.filter((m) => m.user_id !== currentUser?.id);
  const withEmail = others
    .filter((m) => !!m.user?.email)
    .sort(recipientSort) as RecipientMember[];
  const withoutEmail = others
    .filter((m) => !m.user?.email)
    .sort(recipientSort) as RecipientMember[];

  // Seed from the nudge's recipient list (if any). The panel mounts fresh
  // each time the modal opens, so this lazy initializer captures the right
  // preselection for that open.
  const [checkedIds, setCheckedIds] = useState<Set<string>>(
    () => new Set(preselectMemberIds ?? [])
  );
  const [confirmingReset, setConfirmingReset] = useState(false);

  const toggleMember = (memberId: string) => {
    setCheckedIds((prev) => {
      const next = new Set(prev);
      if (next.has(memberId)) next.delete(memberId);
      else next.add(memberId);
      return next;
    });
  };

  const selectedMembers = withEmail.filter((m) => checkedIds.has(m.memberId));

  const blast = trpc.tripMembers.sendInvitationBlast.useMutation({
    onSuccess() {
      setCheckedIds(new Set());
      utils.tripMembers.list.invalidate({ tripId });
      utils.trips.getById.invalidate({ tripId });
      onClose();
    },
  });

  if (!isOwner || others.length === 0) return null;

  const isDefaultMessage = messageDraft.trim() === cannedInvitation.trim();

  return (
    <div className="flex max-h-[inherit] flex-col" data-testid="crew-email-panel">
      {/* ── Header ─────────────────────────────────────────────── */}
      <div
        className="flex flex-shrink-0 items-center gap-3 px-5 py-4"
        style={{ borderBottom: "1px solid var(--color-bt-border)" }}
      >
        <span
          className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl"
          style={{
            background: "var(--color-bt-accent-faint)",
            color: "var(--color-bt-accent)",
          }}
        >
          <Mail size={18} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[15px] font-bold leading-tight" style={{ color: "var(--color-bt-text)" }}>
            Email the crew
          </p>
          <p className="mt-0.5 text-xs leading-snug" style={{ color: "var(--color-bt-text-dim)" }}>
            Send your first invite, then keep everyone in the loop.
          </p>
        </div>
        <button
          onClick={onClose}
          className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full transition-opacity hover:opacity-70"
          style={{ background: "var(--color-bt-card-raised)", color: "var(--color-bt-text-dim)" }}
          aria-label="Close"
        >
          <X size={15} />
        </button>
      </div>

      {/* ── Body (scrollable) ──────────────────────────────────── */}
      <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-5 py-4">
        {/* Message */}
        <section>
          <div className="mb-2 flex items-center justify-between">
            <span
              className="text-[11px] font-bold uppercase tracking-[0.12em]"
              style={{ color: "var(--color-bt-text-dim)" }}
            >
              Message
            </span>
            {confirmingReset ? (
              <div className="flex items-center gap-2">
                <span className="text-xs" style={{ color: "var(--color-bt-text-dim)" }}>
                  Replace message?
                </span>
                <button
                  type="button"
                  onClick={() => {
                    setMessageDraft(cannedInvitation);
                    setConfirmingReset(false);
                    updateAbout.mutate({ tripId, aboutMessage: cannedInvitation });
                  }}
                  className="text-xs font-semibold"
                  style={{ color: "var(--color-bt-accent)" }}
                >
                  Yes
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmingReset(false)}
                  className="text-xs"
                  style={{ color: "var(--color-bt-text-dim)" }}
                >
                  No
                </button>
              </div>
            ) : (
              <button
                type="button"
                disabled={isDefaultMessage}
                onClick={() => setConfirmingReset(true)}
                className="flex items-center gap-1 text-xs font-semibold disabled:opacity-30"
                style={{ color: "var(--color-bt-text-dim)" }}
                title="Reset to default invitation"
              >
                <RotateCcw size={12} />
                Reset
              </button>
            )}
          </div>
          <div
            className="rounded-xl px-3.5 py-3"
            style={{
              background: "var(--color-bt-card-raised)",
              border: "1px solid var(--color-bt-border)",
            }}
          >
            <textarea
              ref={textareaRef}
              value={messageDraft}
              onChange={(e) => setMessageDraft(e.target.value)}
              onBlur={handleBlur}
              rows={3}
              className="block w-full resize-none overflow-hidden bg-transparent text-[13px] leading-relaxed outline-none"
              style={{ color: "var(--color-bt-text)" }}
              data-testid="crew-email-message"
            />
          </div>
        </section>

        {/* Recipients */}
        {withEmail.length > 0 && (
          <section>
            <div className="mb-2 flex items-center justify-between">
              <span
                className="text-[11px] font-bold uppercase tracking-[0.12em]"
                style={{ color: "var(--color-bt-text-dim)" }}
              >
                Recipients
              </span>
              <div className="flex items-center gap-2 text-xs">
                <span style={{ color: "var(--color-bt-text-dim)" }}>
                  {selectedMembers.length} selected
                </span>
                <button
                  type="button"
                  onClick={() =>
                    setCheckedIds(
                      selectedMembers.length > 0
                        ? new Set()
                        : new Set(withEmail.map((m) => m.memberId))
                    )
                  }
                  className="font-semibold"
                  style={{ color: "var(--color-bt-accent)" }}
                >
                  {selectedMembers.length > 0 ? "Clear" : "Select all"}
                </button>
              </div>
            </div>

            <div className="space-y-2">
              {withEmail.map((m) => {
                const checked = checkedIds.has(m.memberId);
                const isBTMember = !m.isGuest;
                const status = recipientStatus(m);
                return (
                  <button
                    key={m.memberId}
                    type="button"
                    onClick={() => toggleMember(m.memberId)}
                    title={
                      isBTMember
                        ? "Will be notified about the trip"
                        : "Will be invited to sign up for BuddyTrip and join the trip"
                    }
                    className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition-colors"
                    style={{
                      background: checked
                        ? "var(--color-bt-accent-faint)"
                        : "var(--color-bt-card-raised)",
                      border: `1px solid ${
                        checked ? "var(--color-bt-accent-border)" : "var(--color-bt-border)"
                      }`,
                    }}
                  >
                    {checked ? (
                      <span
                        className="flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-md"
                        style={{ background: "var(--color-bt-accent)" }}
                      >
                        <Check size={13} strokeWidth={3} style={{ color: "var(--color-bt-on-accent)" }} />
                      </span>
                    ) : (
                      <span
                        className="h-5 w-5 flex-shrink-0 rounded-md"
                        style={{ border: "1.5px solid var(--color-bt-border)" }}
                      />
                    )}
                    {/* Avatar — invited members carry the amber ✉ corner
                        badge (matches the Crew tab); real accounts use the
                        plain avatar. */}
                    {status === "invited" ? (
                      <InvitedAvatar
                        name={m.displayName}
                        avatarIcon={m.user?.avatar_icon ?? null}
                      />
                    ) : (
                      <Avatar
                        name={m.displayName}
                        avatarIcon={m.user?.avatar_icon ?? null}
                        size="sm"
                      />
                    )}
                    <div className="min-w-0 flex-1">
                      <div
                        className="truncate text-sm font-semibold"
                        style={{ color: "var(--color-bt-text)" }}
                      >
                        {m.displayName}
                      </div>
                      {/* Subline mirrors the Crew tab: email, plus an amber
                          "· pending invite" / "· invited Mar 5" suffix when
                          the account doesn't exist yet. */}
                      <div className="truncate text-xs" style={{ color: "var(--color-bt-text-dim)" }}>
                        {m.user?.email}
                        {status === "invited" && (
                          <span
                            className="ml-1"
                            style={{
                              // "pending invite" still needs action → amber.
                              // "invited Mar 5" is just informational → teal.
                              color: m.last_emailed_at
                                ? "var(--color-bt-accent)"
                                : "var(--color-bt-warning)",
                            }}
                          >
                            {m.last_emailed_at
                              ? `· invited ${parseLocalDate(m.last_emailed_at).toLocaleDateString(
                                  "en-US",
                                  { month: "short", day: "numeric" }
                                )}`
                              : "· pending invite"}
                          </span>
                        )}
                      </div>
                    </div>
                    {/* For a real account, a "Last sent" badge is all that's
                        needed — the invite state lives on invited rows
                        (avatar badge + subline) instead. */}
                    {status === "active" && (m.email_count ?? 0) > 0 && (
                      <span
                        className="flex-shrink-0 rounded-full px-2.5 py-1 text-[11px] font-semibold"
                        style={{
                          background: "var(--color-bt-accent-faint)",
                          color: "var(--color-bt-accent)",
                          border: "1px solid var(--color-bt-accent-border)",
                        }}
                      >
                        {m.last_emailed_at
                          ? `Last sent · ${parseLocalDate(m.last_emailed_at).toLocaleDateString(
                              "en-US",
                              { month: "short", day: "numeric" }
                            )}`
                          : "Last sent"}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </section>
        )}

        {/* No email yet — an informational list, not selectable chips.
            Adding emails happens on the crew tab. Rendered as a uniform
            avatar + name grid (no capsule) so widths line up and it doesn't
            mimic the selectable recipient cards above. */}
        {withoutEmail.length > 0 && (
          <section>
            <div className="mb-2 flex items-center gap-2">
              <div className="h-px flex-1" style={{ background: "var(--color-bt-border)" }} />
              <span
                className="text-[10px] font-bold uppercase tracking-[0.12em]"
                style={{ color: "var(--color-bt-text-dim)" }}
              >
                No email yet
              </span>
              <div className="h-px flex-1" style={{ background: "var(--color-bt-border)" }} />
            </div>
            <p className="mb-3 text-center text-xs" style={{ color: "var(--color-bt-text-dim)" }}>
              Add an email on the crew tab to invite them.
            </p>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fill, minmax(132px, 1fr))",
                gap: "8px 10px",
              }}
            >
              {withoutEmail.map((m) => (
                <span
                  key={m.memberId}
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: "8px",
                    minWidth: 0,
                  }}
                >
                  <Avatar name={m.displayName} avatarIcon={m.user?.avatar_icon ?? null} size="sm" muted />
                  <span
                    style={{
                      fontSize: "12.5px",
                      fontWeight: 500,
                      color: "var(--color-bt-text-dim)",
                      whiteSpace: "nowrap",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                    }}
                  >
                    {m.displayName}
                  </span>
                </span>
              ))}
            </div>
          </section>
        )}
      </div>

      {/* ── Footer ─────────────────────────────────────────────── */}
      <div
        className="flex flex-shrink-0 items-center gap-3 px-5 py-4"
        style={{ borderTop: "1px solid var(--color-bt-border)" }}
      >
        <button
          type="button"
          onClick={onClose}
          className="rounded-xl px-5 py-2.5 text-sm font-semibold transition-colors hover:bg-[var(--color-bt-hover)]"
          style={{ border: "1px solid var(--color-bt-border)", color: "var(--color-bt-text)" }}
        >
          Cancel
        </button>
        <button
          type="button"
          data-testid="crew-email-send"
          disabled={selectedMembers.length === 0 || blast.isPending}
          onClick={() => {
            if (selectedMembers.length === 0) return;
            blast.mutate({
              tripId,
              memberUserIds: selectedMembers.map((m) => m.memberId),
              // Send the exact body shown in the panel so the email matches
              // what the owner saw (planning vs. going default included).
              message: messageDraft.trim(),
            });
          }}
          className="inline-flex flex-1 items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-bold transition-opacity hover:opacity-90 disabled:opacity-50"
          style={{ background: "var(--color-bt-accent)", color: "var(--color-bt-on-accent)" }}
        >
          <Send size={15} />
          {blast.isPending
            ? "Sending…"
            : selectedMembers.length > 0
              ? `Send to ${selectedMembers.length}`
              : "Send"}
        </button>
      </div>
    </div>
  );
}
