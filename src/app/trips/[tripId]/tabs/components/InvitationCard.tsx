"use client";

import { useState, useEffect } from "react";
import { CheckSquare, Ghost, Pencil, Plus, Send, Square, X } from "lucide-react";
import { trpc } from "@/lib/trpc-client";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { buildCannedInvitation } from "@/lib/invitationDefault";
import { parseLocalDate } from "@/lib/dates";
import type { TripData } from "../types";
import { ActionCard } from "./ActionCard";

// Same sort order as the Crew tab: Owner → Planner → Member, real before
// guests within a role, then by display name.
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

// Members sent in the last blast (last_invited_at >= last_blast_sent_at) are
// unchecked by default so the owner sees "new" people pre-selected on re-blast.
function computeDefaultChecked(
  withEmail: RecipientMember[],
  lastBlastSentAt: string | null
): Set<string> {
  return new Set(
    withEmail
      .filter((m) => {
        if (!lastBlastSentAt) return true;
        const inv = m.last_invited_at ?? null;
        if (!inv) return true;
        return inv < lastBlastSentAt;
      })
      .map((m) => m.memberId)
  );
}

export interface InvitationCardProps {
  trip: TripData;
  isOwner?: boolean;
  onWriteInvitation?: () => void;
}

/** Crew Email card — going-stage Action Center. Owner sees blast controls; members see read-only invite text. */
export function InvitationCard({ trip, isOwner = false, onWriteInvitation }: InvitationCardProps) {
  const tripId = trip.id;
  const currentUser = useCurrentUser();
  const utils = trpc.useUtils();
  const { data: members = [] } = trpc.tripMembers.list.useQuery({ tripId });

  const lastBlastSentAt = trip.last_blast_sent_at ?? null;

  const cannedInvitation = buildCannedInvitation(trip);
  const savedMessage = trip.about_message?.trim() || "";
  const invitationText = savedMessage || cannedInvitation;
  const isUsingDefault = !savedMessage;

  type Member = typeof members[number];
  const others: Member[] = members.filter((m) => m.user_id !== currentUser?.id);
  const withEmail = others
    .filter((m) => !!m.user?.email)
    .sort(recipientSort) as RecipientMember[];
  const withoutEmail = others
    .filter((m) => !m.user?.email && m.isGuest)
    .sort(recipientSort) as RecipientMember[];

  return (
    <ActionCard isResolved={false}>
      {/* ── Crew email header ───────────────────────────────────────── */}
      <p
        className="mb-2 text-xs font-semibold uppercase tracking-wider"
        style={{ color: "var(--color-bt-text-dim)" }}
      >
        Crew Email
      </p>
      {isOwner ? (
        <p
          className="mb-3 text-[13px] leading-relaxed"
          style={{ color: "var(--color-bt-text-dim)" }}
        >
          {isUsingDefault
            ? "We drafted a short invite from your trip details. Edit it, or send as-is — come back here any time to blast updates to the crew."
            : "Your custom message is set. Use this card any time to blast updates to the crew."}
        </p>
      ) : (
        <p
          className="mb-3 text-[13px] leading-relaxed"
          style={{ color: "var(--color-bt-text-dim)" }}
        >
          A note from your host about the trip — they&apos;ll also use this space to send crew updates.
        </p>
      )}

      <div
        className="relative rounded-xl px-4 py-3 text-[13px] leading-relaxed whitespace-pre-wrap"
        style={{
          background: "var(--color-bt-card-raised)",
          border: "1px solid var(--color-bt-border)",
          color: "var(--color-bt-text)",
        }}
        data-testid="invitation-message"
      >
        {isOwner && onWriteInvitation && (
          <button
            type="button"
            onClick={onWriteInvitation}
            data-testid="invitation-edit-btn"
            aria-label="Edit invitation"
            className="absolute right-2 top-2 flex h-6 w-6 items-center justify-center rounded"
          >
            <Pencil size={13} style={{ color: "var(--color-bt-text-dim)" }} />
          </button>
        )}
        <div className={isOwner && onWriteInvitation ? "pr-8" : undefined}>
          {invitationText}
        </div>
      </div>

      {/* ── Blast section (owner only) ───────────────────────────────── */}
      {isOwner && (
        <BlastSection
          key={lastBlastSentAt ?? "never"}
          tripId={tripId}
          withEmail={withEmail}
          withoutEmail={withoutEmail}
          lastBlastSentAt={lastBlastSentAt}
          onSuccess={() => {
            utils.tripMembers.list.invalidate({ tripId });
            utils.trips.getById.invalidate({ tripId });
          }}
          onInvalidateMembers={() => utils.tripMembers.list.invalidate({ tripId })}
        />
      )}

    </ActionCard>
  );
}

// ── Blast section ────────────────────────────────────────────────────────────

function BlastSection({
  tripId,
  withEmail,
  withoutEmail,
  lastBlastSentAt,
  onSuccess,
  onInvalidateMembers,
}: {
  tripId: string;
  withEmail: RecipientMember[];
  withoutEmail: RecipientMember[];
  lastBlastSentAt: string | null;
  onSuccess: () => void;
  onInvalidateMembers: () => void;
}) {
  const [checkedIds, setCheckedIds] = useState<Set<string>>(new Set());
  const [lastSentCount, setLastSentCount] = useState<number | null>(null);

  // Ghost email inline editing
  const [editingId, setEditingId] = useState<string | null>(null);
  const [emailDraft, setEmailDraft] = useState("");

  const updateGuest = trpc.ghostCrew.update.useMutation({
    onSuccess() {
      onInvalidateMembers();
      setEditingId(null);
      setEmailDraft("");
    },
  });

  const blast = trpc.tripMembers.sendInvitationBlast.useMutation({
    onSuccess(data) {
      setLastSentCount(data.sent);
      onSuccess();
    },
  });

  const toggleMember = (memberId: string) => {
    setCheckedIds((prev) => {
      const next = new Set(prev);
      if (next.has(memberId)) next.delete(memberId);
      else next.add(memberId);
      return next;
    });
  };

  const selectedMembers = withEmail.filter((m) => checkedIds.has(m.memberId));

  const saveEmail = (guestUserId: string) => {
    const email = emailDraft.trim();
    if (!email) return;
    updateGuest.mutate({ tripId, guestUserId, email });
  };

  return (
    <div className="mt-4 border-t pt-4" style={{ borderColor: "var(--color-bt-border)" }}>
      <p
        className="mb-2 text-xs font-semibold uppercase tracking-wider"
        style={{ color: "var(--color-bt-text-dim)" }}
      >
        Going out to
      </p>

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
          Invitation sent to {lastSentCount} {lastSentCount === 1 ? "person" : "people"}
        </div>
      )}

      {/* Checkbox rows — members with email */}
      {withEmail.length === 0 ? (
        <p className="mb-2 text-[13px]" style={{ color: "var(--color-bt-text-dim)" }}>
          No one on your crew has an email yet — add one below to send the invite.
        </p>
      ) : (
        <>
          {/* Toolbar: count + Select defaults */}
          <div className="mb-2 flex items-center justify-between">
            <span className="text-xs" style={{ color: "var(--color-bt-text-dim)" }}>
              {selectedMembers.length}{" "}
              {selectedMembers.length === 1 ? "person" : "people"} will receive an email
            </span>
            <button
              type="button"
              onClick={() => setCheckedIds(computeDefaultChecked(withEmail, lastBlastSentAt))}
              className="text-xs font-semibold"
              style={{ color: "var(--color-bt-accent)", background: "transparent", border: "none" }}
            >
              Select defaults
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
                      className="flex-shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase"
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

      {/* Divider + "No email yet" label — only between two populated groups */}
      {withEmail.length > 0 && withoutEmail.length > 0 && (
        <div className="mb-3 flex items-center gap-2">
          <div className="h-px flex-1" style={{ background: "var(--color-bt-border)" }} />
          <span
            className="text-[10px] font-semibold uppercase tracking-widest"
            style={{ color: "var(--color-bt-text-dim)" }}
          >
            No email yet
          </span>
          <div className="h-px flex-1" style={{ background: "var(--color-bt-border)" }} />
        </div>
      )}

      {/* Ghost chips — members missing an email */}
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
        data-testid="invitation-send-btn"
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
          : `Send invitation${selectedMembers.length > 0 ? ` (${selectedMembers.length})` : ""}`}
      </button>
    </div>
  );
}

