"use client";

import { useEffect, useRef, useState } from "react";
import { CheckSquare, Ghost, RotateCcw, Send, Square } from "lucide-react";
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
    },
  });

  if (!isOwner || others.length === 0) return null;

  const isDefaultMessage = messageDraft.trim() === cannedInvitation.trim();

  return (
    <div data-testid="crew-email-panel">
      {/* Reset button row */}
      <div className="mb-3 flex items-center justify-end gap-2">
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
            className="flex items-center gap-1 text-xs disabled:opacity-30"
            style={{ color: "var(--color-bt-text-dim)" }}
            title="Reset to default invitation"
          >
            <RotateCcw size={11} />
            Reset
          </button>
        )}
      </div>

      {/* Blurb */}
      <p className="mb-3 text-[13px] leading-relaxed" style={{ color: "var(--color-bt-text-dim)" }}>
        Send your first invite, then keep everyone in the loop as the trip gets closer.
      </p>

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

      {/* Recipient list */}
      {withEmail.length > 0 && (
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

          <div className="mb-3 -mx-4">
            {withEmail.map((m) => {
              const checked = checkedIds.has(m.memberId);
              const isBTMember = !m.isGuest;
              return (
                <div
                  key={m.memberId}
                  onClick={() => toggleMember(m.memberId)}
                  title={
                    isBTMember
                      ? "Will be notified about the trip"
                      : "Will be invited to sign up for BuddyTrip and join the trip"
                  }
                  className={`flex cursor-pointer items-center gap-2.5 border-b px-4 py-1.5 transition-colors duration-150${!checked ? " hover:bg-[var(--color-bt-hover)]" : ""}`}
                  style={{
                    background: checked
                      ? "var(--color-bt-accent-faint)"
                      : isBTMember
                        ? "color-mix(in srgb, var(--color-bt-accent) 5%, transparent)"
                        : undefined,
                    borderColor: "var(--color-bt-border)",
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
                      className="flex items-center gap-1.5 truncate text-[13px] font-medium"
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

      {/* No-email divider + static chips. Adding emails happens in the
          crew list dropdown, so chips here are display-only. */}
      {withoutEmail.length > 0 && (
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

      {withoutEmail.length > 0 && (
        <div className="mb-3 flex flex-wrap items-center gap-1.5">
          {withoutEmail.map((m) => (
            <span
              key={m.memberId}
              className="flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs"
              style={{
                background: "var(--color-bt-card-raised)",
                border: "1px dashed var(--color-bt-border)",
                color: "var(--color-bt-text)",
              }}
            >
              <Ghost size={11} style={{ color: "var(--color-bt-text-dim)" }} />
              <span>{m.displayName}</span>
            </span>
          ))}
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

