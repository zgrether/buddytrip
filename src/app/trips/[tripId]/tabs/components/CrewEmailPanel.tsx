"use client";

import { useEffect, useRef, useState } from "react";
import { CheckSquare, Ghost, Mail, Plus, RotateCcw, Send, Square, X } from "lucide-react";
import { trpc } from "@/lib/trpc-client";
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
  last_invited_at?: string | null;
  user: { email: string | null; is_guest?: boolean } | null;
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
}

/**
 * CrewEmailPanel — sticky desktop-only panel on the Crew tab.
 *
 * Owner-only: editable invite message, recipient checklist, and Send button.
 * Nothing is pre-selected — owner taps rows or "Select all" to build the list.
 * Send label flips to "Send reminder" after the first blast.
 */
export function CrewEmailPanel({ trip, isOwner }: CrewEmailPanelProps) {
  const tripId = trip.id;
  const currentUser = useCurrentUser();
  const utils = trpc.useUtils();
  const { data: members = [] } = trpc.tripMembers.list.useQuery({ tripId });

  const lastBlastSentAt = trip.last_blast_sent_at ?? null;

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
    .filter((m) => !m.user?.email && m.isGuest)
    .sort(recipientSort) as RecipientMember[];

  const [checkedIds, setCheckedIds] = useState<Set<string>>(new Set());
  const [lastSentCount, setLastSentCount] = useState<number | null>(null);
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

  // Ghost chips — inline email capture
  const [editingId, setEditingId] = useState<string | null>(null);
  const [emailDraft, setEmailDraft] = useState("");

  const updateGuest = trpc.ghostCrew.update.useMutation({
    onSuccess() {
      utils.tripMembers.list.invalidate({ tripId });
      setEditingId(null);
      setEmailDraft("");
    },
  });

  const saveEmail = (guestUserId: string) => {
    const email = emailDraft.trim();
    if (!email) return;
    updateGuest.mutate({ tripId, guestUserId, email });
  };

  const blast = trpc.tripMembers.sendInvitationBlast.useMutation({
    onSuccess(data) {
      setLastSentCount(data.sent);
      setCheckedIds(new Set());
      utils.tripMembers.list.invalidate({ tripId });
      utils.trips.getById.invalidate({ tripId });
    },
  });

  if (!isOwner || others.length === 0) return null;

  const isDefaultMessage = messageDraft.trim() === cannedInvitation.trim();

  return (
    <div
      className="rounded-xl p-4"
      style={{
        background: "var(--color-bt-card)",
        border: "1px solid var(--color-bt-border)",
      }}
      data-testid="crew-email-panel"
    >
      {/* Header */}
      <div className="mb-3 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2.5">
          <span
            className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg"
            style={{
              background: "var(--color-bt-accent-faint)",
              color: "var(--color-bt-accent)",
            }}
          >
            <Mail size={14} />
          </span>
          <p className="text-sm font-semibold" style={{ color: "var(--color-bt-text)" }}>
            Crew Email
          </p>
        </div>

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
              Cancel
            </button>
          </div>
        ) : (
          <button
            type="button"
            disabled={isDefaultMessage}
            onClick={() => setConfirmingReset(true)}
            className="flex items-center gap-1 text-xs disabled:opacity-30"
            style={{ color: "var(--color-bt-text-dim)" }}
            title="Reset to default invitation"
          >
            <RotateCcw size={11} />
            Reset
          </button>
        )}
      </div>

      {/* Editable message */}
      <div
        className="mb-3 rounded-xl px-3 py-2.5"
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

      {/* Success flash */}
      {lastSentCount !== null && (
        <div
          className="mb-3 rounded-lg px-3 py-2 text-[13px] font-medium"
          style={{
            background: "var(--color-bt-accent-faint)",
            color: "var(--color-bt-accent)",
            border: "1px solid var(--color-bt-accent-border)",
          }}
        >
          {lastSentCount === 0
            ? "No emails sent — something went wrong"
            : `Sent to ${lastSentCount} ${lastSentCount === 1 ? "person" : "people"}`}
        </div>
      )}

      {/* Recipient list */}
      {withEmail.length === 0 ? (
        <p className="mb-2 text-[13px]" style={{ color: "var(--color-bt-text-dim)" }}>
          No one on your crew has an email yet — add one below.
        </p>
      ) : (
        <>
          <div className="mb-2 flex items-center justify-between">
            <span className="text-xs" style={{ color: "var(--color-bt-text-dim)" }}>
              {selectedMembers.length} selected
            </span>
            <button
              type="button"
              onClick={() => {
                const allSelected = selectedMembers.length === withEmail.length;
                setCheckedIds(
                  allSelected ? new Set() : new Set(withEmail.map((m) => m.memberId))
                );
              }}
              className="text-xs font-semibold"
              style={{
                color: "var(--color-bt-accent)",
                background: "transparent",
                border: "none",
              }}
            >
              {selectedMembers.length === withEmail.length ? "Unselect all" : "Select all"}
            </button>
          </div>

          <div className="mb-3 space-y-0.5">
            {withEmail.map((m) => {
              const checked = checkedIds.has(m.memberId);
              return (
                <div
                  key={m.memberId}
                  onClick={() => toggleMember(m.memberId)}
                  className={`flex cursor-pointer items-center gap-2.5 rounded-lg px-2 py-1.5 transition-colors duration-150${!checked ? " hover:bg-[var(--color-bt-hover)]" : ""}`}
                  style={{
                    background: checked ? "var(--color-bt-accent-faint)" : "transparent",
                  }}
                >
                  {checked ? (
                    <CheckSquare
                      size={16}
                      style={{ color: "var(--color-bt-accent)", flexShrink: 0 }}
                    />
                  ) : (
                    <Square
                      size={16}
                      style={{ color: "var(--color-bt-text-dim)", flexShrink: 0 }}
                    />
                  )}
                  <div className="min-w-0 flex-1">
                    <div
                      className="truncate text-[13px] font-medium"
                      style={{ color: "var(--color-bt-text)" }}
                    >
                      {m.displayName}
                    </div>
                    <div
                      className="truncate text-xs"
                      style={{ color: "var(--color-bt-text-dim)" }}
                    >
                      {m.user?.email}
                    </div>
                  </div>
                  {m.last_invited_at && (
                    <span
                      className="flex-shrink-0 rounded-full px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider"
                      style={{
                        background: "var(--color-bt-accent-faint)",
                        color: "var(--color-bt-accent)",
                        border: "1px solid var(--color-bt-accent-border)",
                      }}
                    >
                      Sent{" "}
                      {parseLocalDate(m.last_invited_at).toLocaleDateString("en-US", {
                        month: "short",
                        day: "numeric",
                      })}
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        </>
      )}

      {/* No-email divider */}
      {withEmail.length > 0 && withoutEmail.length > 0 && (
        <div className="mb-3 flex items-center gap-2">
          <div className="h-px flex-1" style={{ background: "var(--color-bt-border)" }} />
          <span
            className="text-[9px] font-bold uppercase tracking-widest"
            style={{ color: "var(--color-bt-text-dim)" }}
          >
            No email yet
          </span>
          <div className="h-px flex-1" style={{ background: "var(--color-bt-border)" }} />
        </div>
      )}

      {/* Ghost chips */}
      {withoutEmail.length > 0 && (
        <div className="mb-3">
          <div className="flex flex-wrap items-center gap-1.5">
            {withoutEmail.map((m) => {
              const guestUserId = m.user_id;
              if (!guestUserId) return null;

              if (editingId === m.memberId) {
                return (
                  <div
                    key={m.memberId}
                    className="flex items-center gap-1.5 rounded-full px-2 py-1"
                    style={{
                      background: "var(--color-bt-card-raised)",
                      border: "1px solid var(--color-bt-accent)",
                    }}
                  >
                    <span
                      className="text-xs font-medium"
                      style={{ color: "var(--color-bt-text)" }}
                    >
                      {m.displayName}
                    </span>
                    <input
                      autoFocus
                      type="email"
                      value={emailDraft}
                      onChange={(e) => setEmailDraft(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          saveEmail(guestUserId);
                        } else if (e.key === "Escape") {
                          setEditingId(null);
                          setEmailDraft("");
                        }
                      }}
                      placeholder="email@…"
                      disabled={updateGuest.isPending}
                      className="w-44 rounded border px-1.5 py-0.5 text-xs outline-none disabled:opacity-50"
                      style={{
                        background: "var(--color-bt-base)",
                        borderColor: "var(--color-bt-border)",
                        color: "var(--color-bt-text)",
                      }}
                    />
                    <button
                      type="button"
                      onClick={() => saveEmail(guestUserId)}
                      disabled={!emailDraft.trim() || updateGuest.isPending}
                      className="rounded-full px-2 py-0.5 text-xs font-semibold disabled:opacity-40"
                      style={{
                        background: "var(--color-bt-accent)",
                        color: "var(--color-bt-base)",
                      }}
                    >
                      Save
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setEditingId(null);
                        setEmailDraft("");
                      }}
                      aria-label="Cancel"
                      className="flex h-5 w-5 items-center justify-center rounded-full"
                      style={{ color: "var(--color-bt-text-dim)" }}
                    >
                      <X size={12} />
                    </button>
                  </div>
                );
              }

              return (
                <button
                  key={m.memberId}
                  type="button"
                  onClick={() => {
                    setEditingId(m.memberId);
                    setEmailDraft("");
                  }}
                  className="flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs transition-colors hover:bg-[var(--color-bt-hover)]"
                  style={{
                    background: "var(--color-bt-card-raised)",
                    border: "1px dashed var(--color-bt-border)",
                    color: "var(--color-bt-text)",
                  }}
                >
                  <Ghost size={11} style={{ color: "var(--color-bt-text-dim)" }} />
                  <span>{m.displayName}</span>
                  <Plus size={11} strokeWidth={2.5} style={{ color: "var(--color-bt-accent)" }} />
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Send button */}
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
        className="inline-flex w-full items-center justify-center gap-1.5 rounded-xl px-3 py-2.5 text-sm font-semibold transition-opacity hover:opacity-90 disabled:opacity-50"
        style={{
          background: "var(--color-bt-accent)",
          color: "var(--color-bt-base)",
          border: "1px solid var(--color-bt-accent)",
        }}
      >
        <Send size={13} />
        {blast.isPending
          ? "Sending…"
          : `Send message${selectedMembers.length > 0 ? ` (${selectedMembers.length})` : ""}`}
      </button>
    </div>
  );
}
