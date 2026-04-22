"use client";

import { useState } from "react";
import { Ghost, Pencil, Plus, RotateCcw, Send, X } from "lucide-react";
import { trpc } from "@/lib/trpc-client";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { formatDateRange } from "@/lib/dates";
import { RoleBadge } from "@/components/RoleBadge";
import type { TripRole } from "@/server/middleware";
import type { TripData } from "../types";
import { TravelEntryForm } from "../../components/TravelEntryForm";
import { ActionCard } from "./ActionCard";

// Same sort order as the Crew tab: Owner → Planner → Member, real before
// guests within a role, then by display name.
const ROLE_ORDER: Record<string, number> = { Owner: 0, Planner: 1, Member: 2 };
function recipientSort(a: RecipientMember, b: RecipientMember) {
  const aOrder = ROLE_ORDER[a.role] ?? 2;
  const bOrder = ROLE_ORDER[b.role] ?? 2;
  if (aOrder !== bOrder) return aOrder - bOrder;
  if (a.isGuest !== b.isGuest) return a.isGuest ? 1 : -1;
  return a.displayName.localeCompare(b.displayName);
}

export interface InvitationCardProps {
  trip: TripData;
  isOwner?: boolean;
  onWriteInvitation?: () => void;
}

/**
 * InvitationCard — the going-stage Action Center body.
 *
 * Structure (owner view, top → bottom):
 *   1. Owner travel toggle — gates the travel section for everyone.
 *   2. Invitation text + Edit / Default-invite buttons (message controls).
 *   3. Recipients — grid of crew who'll receive the email, plus inline
 *      chips for crew still missing an email (tap to fill in).
 *   4. Send Invitation — full-width primary, tied to the recipient list.
 *   5. Travel section — only when trip.travel_enabled.
 *
 * Member view is slimmer: just the invitation text and (if enabled)
 * the travel form.
 */
export function InvitationCard({ trip, isOwner = false, onWriteInvitation }: InvitationCardProps) {
  const tripId = trip.id;
  const currentUser = useCurrentUser();
  const utils = trpc.useUtils();
  const { data: members = [] } = trpc.tripMembers.list.useQuery({ tripId });

  const travelEnabled = !!trip.travel_enabled;

  // ── Canned invitation default ────────────────────────────────────────
  const destination = trip.locked_destination_title?.trim() || trip.location?.trim() || "";
  const dateRange = formatDateRange(trip.start_date, trip.end_date);
  const cannedInvitation = buildCannedInvitation({
    title: trip.title,
    destination,
    dateRange,
  });
  const savedMessage = trip.about_message?.trim() || "";
  const invitationText = savedMessage || cannedInvitation;
  const isUsingDefault = !savedMessage;

  // ── Mutations ────────────────────────────────────────────────────────
  const updateSettings = trpc.trips.updateActionCenterSettings.useMutation({
    async onMutate(vars) {
      await utils.trips.getById.cancel({ tripId });
      const prev = utils.trips.getById.getData({ tripId });
      utils.trips.getById.setData({ tripId }, (old: unknown) => {
        if (!old) return old;
        const trip = old as Record<string, unknown>;
        return {
          ...trip,
          ...(vars.travelEnabled !== undefined ? { travel_enabled: vars.travelEnabled } : {}),
        } as typeof old;
      });
      return { prev };
    },
    onError(_err, _vars, context) {
      if (context?.prev) utils.trips.getById.setData({ tripId }, context.prev);
    },
    onSettled() {
      utils.trips.getById.invalidate({ tripId });
    },
  });

  const resetInvitation = trpc.trips.updateAboutMessage.useMutation({
    onSettled() {
      utils.trips.getById.invalidate({ tripId });
    },
  });

  const myMember = members.find((m) => m.user_id === currentUser?.id);

  // ── Recipient lists ──────────────────────────────────────────────────
  // Split non-self crew into "has an email" (grid) vs "missing" (chips).
  // Sort each list the same way the Crew tab does.
  type Member = typeof members[number];
  const others: Member[] = members.filter((m) => m.user_id !== currentUser?.id);
  const withEmail = others
    .filter((m) => !!m.user?.email)
    .sort(recipientSort);
  const withoutEmail = others
    .filter((m) => !m.user?.email && m.isGuest)
    .sort(recipientSort);

  return (
    <ActionCard isResolved={false}>
      {/* ── Owner travel toggle ───────────────────────────────────────── */}
      {isOwner && (
        <div
          className="mb-4 flex flex-col gap-2 rounded-lg px-3 py-2.5"
          style={{
            background: "var(--color-bt-card-raised)",
            border: "1px solid var(--color-bt-border)",
          }}
        >
          <ToggleRow
            label="Share travel info"
            checked={travelEnabled}
            onChange={(v) => updateSettings.mutate({ tripId, travelEnabled: v })}
            testid="toggle-travel-enabled"
          />
        </div>
      )}

      {/* ── Invitation message ───────────────────────────────────────── */}
      <p
        className="mb-2 text-xs font-semibold uppercase tracking-wider"
        style={{ color: "var(--color-bt-text-dim)" }}
      >
        Invitation
      </p>
      {isOwner ? (
        <p
          className="mb-3 text-[13px] leading-relaxed"
          style={{ color: "var(--color-bt-text-dim)" }}
        >
          {isUsingDefault
            ? "We drafted a short invite from your trip details. Edit it, or send it as-is."
            : "Your custom invite is what the crew will see."}
        </p>
      ) : (
        <p
          className="mb-3 text-[13px] leading-relaxed"
          style={{ color: "var(--color-bt-text-dim)" }}
        >
          A note from your host on what this trip is about.
        </p>
      )}

      <div
        className="rounded-xl px-4 py-3 text-[13px] leading-relaxed whitespace-pre-wrap"
        style={{
          background: "var(--color-bt-card-raised)",
          border: "1px solid var(--color-bt-border)",
          color: "var(--color-bt-text)",
        }}
        data-testid="invitation-message"
      >
        {invitationText}
      </div>

      {/* Message controls — Edit + Default invite (Send lives below, next
          to the recipient list). */}
      {isOwner && (
        <div className="mt-3 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={onWriteInvitation}
            disabled={!onWriteInvitation}
            data-testid="invitation-edit-btn"
            className="inline-flex items-center gap-1.5 rounded-xl px-3 py-2 text-sm font-medium transition-opacity hover:opacity-90 disabled:opacity-50"
            style={{
              background: "transparent",
              color: "var(--color-bt-accent)",
              border: "1px solid var(--color-bt-accent)",
            }}
          >
            <Pencil size={13} />
            Edit
          </button>
          {!isUsingDefault && (
            <button
              type="button"
              onClick={() => resetInvitation.mutate({ tripId, aboutMessage: null })}
              disabled={resetInvitation.isPending}
              data-testid="invitation-reset-btn"
              className="inline-flex items-center gap-1.5 rounded-xl px-3 py-2 text-sm font-medium transition-opacity hover:opacity-90 disabled:opacity-50"
              style={{
                background: "transparent",
                color: "var(--color-bt-text-dim)",
                border: "1px solid var(--color-bt-border)",
              }}
            >
              <RotateCcw size={13} />
              Default invite
            </button>
          )}
        </div>
      )}

      {/* ── Recipients (owner only) ─────────────────────────────────── */}
      {isOwner && (
        <RecipientsSection
          tripId={tripId}
          withEmail={withEmail}
          withoutEmail={withoutEmail}
          onInvalidateMembers={() => utils.tripMembers.list.invalidate({ tripId })}
        />
      )}

      {/* ── Send invitation (owner only) ─────────────────────────────── */}
      {isOwner && (
        <button
          type="button"
          data-testid="invitation-send-btn"
          disabled={withEmail.length === 0}
          className="mt-4 inline-flex w-full items-center justify-center gap-1.5 rounded-xl px-3 py-2.5 text-sm font-semibold transition-opacity hover:opacity-90 disabled:opacity-50"
          style={{
            background: "var(--color-bt-accent)",
            color: "var(--color-bt-base)",
            border: "1px solid var(--color-bt-accent)",
          }}
        >
          <Send size={13} />
          Send invitation{withEmail.length > 0 ? ` (${withEmail.length})` : ""}
        </button>
      )}

      {/* ── Travel section (opt-in) ─────────────────────────────────── */}
      {travelEnabled && (
        <div className="mt-4 border-t pt-4" style={{ borderColor: "var(--color-bt-border)" }}>
          <p
            className="mb-2 text-xs font-semibold uppercase tracking-wider"
            style={{ color: "var(--color-bt-text-dim)" }}
          >
            Travel
          </p>
          <p
            className="mb-3 text-[13px] leading-relaxed"
            style={{ color: "var(--color-bt-text-dim)" }}
          >
            {isOwner
              ? "You're the host — share your travel plans so the crew can coordinate."
              : "Share your travel plans so the crew can coordinate."}
          </p>
          <TravelEntryForm
            tripId={tripId}
            currentTravel={
              myMember as Parameters<typeof TravelEntryForm>[0]["currentTravel"]
            }
          />
        </div>
      )}
    </ActionCard>
  );
}

// ── Recipient list ───────────────────────────────────────────────────────

type RecipientMember = {
  memberId: string;
  user_id: string | null;
  role: string;
  displayName: string;
  isGuest: boolean;
  user: { email: string | null; is_guest?: boolean } | null;
};

function RecipientsSection({
  tripId,
  withEmail,
  withoutEmail,
  onInvalidateMembers,
}: {
  tripId: string;
  withEmail: RecipientMember[];
  withoutEmail: RecipientMember[];
  onInvalidateMembers: () => void;
}) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [emailDraft, setEmailDraft] = useState("");

  const updateGuest = trpc.ghostCrew.update.useMutation({
    onSuccess() {
      onInvalidateMembers();
      setEditingId(null);
      setEmailDraft("");
    },
  });

  const startEdit = (memberId: string) => {
    setEditingId(memberId);
    setEmailDraft("");
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEmailDraft("");
  };

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

      {withEmail.length === 0 ? (
        <p className="mb-2 text-[13px]" style={{ color: "var(--color-bt-text-dim)" }}>
          No one on your crew has an email yet — add one below to send the
          invite.
        </p>
      ) : (
        <div className="mb-3 grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-3 lg:grid-cols-4">
          {withEmail.map((m) => (
            <div key={m.memberId} className="flex min-w-0 flex-col">
              <div className="flex min-w-0 items-center gap-1.5">
                <RoleBadge role={m.role as TripRole} />
                <span
                  className="truncate text-[13px] font-medium"
                  style={{ color: "var(--color-bt-text)" }}
                >
                  {m.displayName}
                </span>
              </div>
              <span
                className="truncate text-xs"
                style={{ color: "var(--color-bt-text-dim)" }}
              >
                {m.user?.email}
              </span>
            </div>
          ))}
        </div>
      )}

      {withoutEmail.length > 0 && (
        <div className="mt-2">
          <p
            className="mb-1.5 text-[11px]"
            style={{ color: "var(--color-bt-text-dim)" }}
          >
            Missing an email — tap to add
          </p>
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
                          cancelEdit();
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
                      onClick={cancelEdit}
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
                  onClick={() => startEdit(m.memberId)}
                  className="flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs transition-colors hover:bg-[var(--color-bt-hover)]"
                  style={{
                    background: "var(--color-bt-card-raised)",
                    border: "1px dashed var(--color-bt-border)",
                    color: "var(--color-bt-text)",
                  }}
                >
                  <Ghost size={11} style={{ color: "var(--color-bt-text-dim)" }} />
                  <span>{m.displayName}</span>
                  <Plus size={11} style={{ color: "var(--color-bt-text-dim)" }} />
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Canned invitation builder ────────────────────────────────────────────
// Short-and-sweet single-paragraph message built from the bits we already
// know. Falls back gracefully when a field is missing.
function buildCannedInvitation({
  title,
  destination,
  dateRange,
}: {
  title: string;
  destination: string;
  dateRange: string;
}): string {
  const headline = title || destination || "Our trip";
  const where = destination && destination !== title ? ` in ${destination}` : "";
  const when = dateRange ? ` ${dateRange}` : "";
  if (!where && !when) {
    return `${headline} is on. Let me know if you're in.`;
  }
  return `${headline}${where}${when}. Let me know if you're in.`;
}

// ── Small inline toggle row ──────────────────────────────────────────────
function ToggleRow({
  label,
  checked,
  disabled,
  onChange,
  testid,
}: {
  label: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (value: boolean) => void;
  testid: string;
}) {
  return (
    <label className="flex cursor-pointer items-center justify-between gap-3">
      <span
        className="min-w-0 flex-1 text-[13px] font-medium"
        style={{ color: "var(--color-bt-text)" }}
      >
        {label}
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        disabled={disabled}
        data-testid={testid}
        onClick={() => onChange(!checked)}
        className="relative inline-flex h-5 w-9 flex-shrink-0 items-center rounded-full transition-colors disabled:opacity-50"
        style={{
          background: checked ? "var(--color-bt-accent)" : "var(--color-bt-border)",
        }}
      >
        <span
          className="inline-block h-4 w-4 transform rounded-full bg-white transition-transform"
          style={{ transform: checked ? "translateX(18px)" : "translateX(2px)" }}
        />
      </button>
    </label>
  );
}
