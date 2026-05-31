"use client";

import { useEffect, useRef, useState } from "react";
import { Check, Ghost, Mail, RotateCcw, Send, X } from "lucide-react";
import { trpc } from "@/lib/trpc-client";
import { Avatar } from "@/components/Avatar";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { buildCannedInvitation } from "@/lib/invitationDefault";
import { parseLocalDate } from "@/lib/dates";
import type { TripData } from "../types";

const ROLE_ORDER: Record<string, number> = { Owner: 0, Planner: 1, Member: 2 };

type RecipientMember = {
  memberId: string;
  user_id: string | null;
  role: string;
  displayName: string;
  isGuest: boolean;
  last_emailed_at?: string | null;
  user: { email: string | null; is_guest?: boolean; avatar_icon?: string | null } | null;
};

function recipientSort(a: RecipientMember, b: RecipientMember) {
  const aOrder = ROLE_ORDER[a.role] ?? 2;
  const bOrder = ROLE_ORDER[b.role] ?? 2;
  if (aOrder !== bOrder) return aOrder - bOrder;
  if (a.isGuest !== b.isGuest) return a.isGuest ? 1 : -1;
  return a.displayName.localeCompare(b.displayName);
}

export interface CrewEmailPanelProps {
  trip: TripData;
  isOwner: boolean;
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
export function CrewEmailPanel({ trip, isOwner, onClose }: CrewEmailPanelProps) {
  const tripId = trip.id;
  const currentUser = useCurrentUser();
  const utils = trpc.useUtils();
  const { data: members = [] } = trpc.tripMembers.list.useQuery({ tripId });

  // Editable message (autosaves on blur)
  const cannedInvitation = buildCannedInvitation(trip);
  const savedMessage = trip.about_message?.trim() || "";
  const [messageDraft, setMessageDraft] = useState(savedMessage || cannedInvitation);

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
    if (trimmed && trimmed !== savedMessage) {
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

  const [checkedIds, setCheckedIds] = useState<Set<string>>(new Set());
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
                    <Avatar
                      name={m.displayName}
                      avatarIcon={m.user?.avatar_icon ?? null}
                      size="sm"
                    />
                    <div className="min-w-0 flex-1">
                      <div
                        className="flex items-center gap-1.5 truncate text-sm font-semibold"
                        style={{ color: "var(--color-bt-text)" }}
                      >
                        {m.isGuest && (
                          <Ghost
                            size={12}
                            className="flex-shrink-0"
                            style={{ color: "var(--color-bt-text-dim)" }}
                          />
                        )}
                        <span className="truncate">{m.displayName}</span>
                      </div>
                      <div className="truncate text-xs" style={{ color: "var(--color-bt-text-dim)" }}>
                        {m.user?.email}
                      </div>
                    </div>
                    {m.last_emailed_at && (
                      <span
                        className="flex-shrink-0 rounded-full px-2.5 py-1 text-[11px] font-semibold"
                        style={{
                          background: "var(--color-bt-accent-faint)",
                          color: "var(--color-bt-accent)",
                          border: "1px solid var(--color-bt-accent-border)",
                        }}
                      >
                        Sent ·{" "}
                        {parseLocalDate(m.last_emailed_at).toLocaleDateString("en-US", {
                          month: "short",
                          day: "numeric",
                        })}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </section>
        )}

        {/* No email yet — display-only chips. Adding emails happens on the
            crew tab, so these are not selectable here. */}
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
            <div className="flex flex-wrap items-center justify-center gap-2">
              {withoutEmail.map((m) => (
                <span
                  key={m.memberId}
                  className="flex items-center gap-2 rounded-full py-1 pl-1 pr-3"
                  style={{
                    background: "var(--color-bt-card-raised)",
                    border: "1px solid var(--color-bt-border)",
                    color: "var(--color-bt-text)",
                  }}
                >
                  <Avatar name={m.displayName} avatarIcon={m.user?.avatar_icon ?? null} size="sm" muted />
                  <span className="text-xs font-medium">{m.displayName}</span>
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
