"use client";

import { useState } from "react";
import { Check, Mail, Minus, Pencil, RotateCcw, Send, X } from "lucide-react";
import { trpc } from "@/lib/trpc-client";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { formatDateRange } from "@/lib/dates";
import type { TripData } from "../types";
import { TravelEntryForm } from "../../components/TravelEntryForm";
import { ActionCard } from "./ActionCard";

const RSVP_OPTIONS = [
  {
    value: "in" as const,
    label: "In",
    icon: Check,
    selectedBg: "var(--color-bt-vote-yes)",
    selectedText: "var(--color-bt-vote-yes-text)",
  },
  {
    value: "maybe" as const,
    label: "Maybe",
    icon: Minus,
    selectedBg: "var(--color-bt-vote-maybe)",
    selectedText: "#ffffff",
  },
  {
    value: "out" as const,
    label: "Can't make it",
    icon: X,
    selectedBg: "var(--color-bt-vote-no)",
    selectedText: "#ffffff",
  },
];

export interface RsvpActionCardProps {
  trip: TripData;
  isOwner?: boolean;
  onWriteInvitation?: () => void;
}

/**
 * RsvpActionCard — the going-stage Action Center body.
 *
 * Structure (top → bottom):
 *   1. Owner toggle row — inline switches that enable/disable the RSVP
 *      and Travel sections for everyone on the trip. Keeps the card
 *      compact when the owner doesn't want either.
 *   2. Invitation — always shown. Canned short-and-sweet default
 *      generated from trip.title / locked_destination / date range;
 *      once the owner has edited it, the edited text takes over.
 *      Owner sees Edit + Send + "Default invite" (reset) actions.
 *   3. RSVP section — only when trip.rsvp_enabled. Members vote in /
 *      maybe / out; owner sees the tallies.
 *   4. Travel section — only when trip.travel_enabled.
 */
export function RsvpActionCard({ trip, isOwner = false, onWriteInvitation }: RsvpActionCardProps) {
  const tripId = trip.id;
  const currentUser = useCurrentUser();
  const utils = trpc.useUtils();
  const { data: members = [] } = trpc.tripMembers.list.useQuery({ tripId });

  const rsvpEnabled = !!trip.rsvp_enabled;
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
  const setRsvp = trpc.tripMembers.setRsvpStatus.useMutation({
    async onMutate(vars) {
      await utils.tripMembers.list.cancel({ tripId });
      const prev = utils.tripMembers.list.getData({ tripId });
      utils.tripMembers.list.setData({ tripId }, (old) =>
        old?.map((m) =>
          m.user_id === currentUser?.id ? { ...m, rsvp_status: vars.rsvpStatus } : m
        )
      );
      return { prev };
    },
    onError(_err, _vars, context) {
      if (context?.prev) utils.tripMembers.list.setData({ tripId }, context.prev);
    },
    onSettled() {
      utils.tripMembers.list.invalidate({ tripId });
    },
  });

  const updateSettings = trpc.trips.updateActionCenterSettings.useMutation({
    async onMutate(vars) {
      await utils.trips.getById.cancel({ tripId });
      const prev = utils.trips.getById.getData({ tripId });
      utils.trips.getById.setData({ tripId }, (old: unknown) => {
        if (!old) return old;
        const trip = old as Record<string, unknown>;
        return {
          ...trip,
          ...(vars.rsvpEnabled !== undefined ? { rsvp_enabled: vars.rsvpEnabled } : {}),
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

  // ── Viewer + tallies ─────────────────────────────────────────────────
  const myMember = members.find((m) => m.user_id === currentUser?.id);
  const myRsvp = (myMember as { rsvp_status?: string | null } | undefined)?.rsvp_status ?? null;

  const inCount = members.filter(
    (m) => (m as { rsvp_status?: string | null }).rsvp_status === "in"
  ).length;
  const maybeCount = members.filter(
    (m) => (m as { rsvp_status?: string | null }).rsvp_status === "maybe"
  ).length;
  const outCount = members.filter(
    (m) => (m as { rsvp_status?: string | null }).rsvp_status === "out"
  ).length;
  const pendingCount = members.filter(
    (m) => (m as { rsvp_status?: string | null }).rsvp_status == null
  ).length;
  const rsvpSummary = `${inCount} in · ${maybeCount} maybe · ${outCount} out · ${pendingCount} pending`;

  // When RSVP collection is off the travel form can't be keyed off
  // myRsvp — treat everyone as eligible instead so the form still shows.
  const canShowTravel =
    travelEnabled && (isOwner || !rsvpEnabled || myRsvp === "in" || myRsvp === "maybe");

  return (
    <ActionCard isResolved={false}>
      {/* ── Owner toggle row ──────────────────────────────────────────── */}
      {isOwner && (
        <div
          className="mb-4 flex flex-col gap-2 rounded-lg px-3 py-2.5"
          style={{
            background: "var(--color-bt-card-raised)",
            border: "1px solid var(--color-bt-border)",
          }}
        >
          <ToggleRow
            label="Collect RSVPs"
            checked={rsvpEnabled}
            onChange={(v) => updateSettings.mutate({ tripId, rsvpEnabled: v })}
            testid="toggle-rsvp-enabled"
          />
          <ToggleRow
            label="Share travel info"
            checked={travelEnabled}
            onChange={(v) => updateSettings.mutate({ tripId, travelEnabled: v })}
            testid="toggle-travel-enabled"
          />
        </div>
      )}

      {/* ── Invitation section (always visible) ──────────────────────── */}
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
          <button
            type="button"
            data-testid="invitation-send-btn"
            className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-xl px-3 py-2 text-sm font-semibold transition-opacity hover:opacity-90"
            style={{
              background: "var(--color-bt-accent)",
              color: "var(--color-bt-base)",
              border: "1px solid var(--color-bt-accent)",
            }}
          >
            <Send size={13} />
            Send invitation
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

      {/* ── RSVP section (opt-in) ───────────────────────────────────── */}
      {rsvpEnabled && (
        <div className="mt-4 border-t pt-4" style={{ borderColor: "var(--color-bt-border)" }}>
          <p
            className="mb-2 text-xs font-semibold uppercase tracking-wider"
            style={{ color: "var(--color-bt-text-dim)" }}
          >
            RSVP
          </p>
          {isOwner ? (
            <>
              <p
                className="mb-2 text-[13px] leading-relaxed"
                style={{ color: "var(--color-bt-text-dim)" }}
              >
                Here&apos;s where the crew stands.
              </p>
              <p className="flex items-center gap-1.5 text-[13px]" style={{ color: "var(--color-bt-text)" }}>
                <Mail size={13} style={{ color: "var(--color-bt-text-dim)" }} />
                {rsvpSummary}
              </p>
            </>
          ) : (
            <>
              <p
                className="mb-3 text-[13px] leading-relaxed"
                style={{ color: "var(--color-bt-text-dim)" }}
              >
                {myRsvp == null
                  ? "Let the crew know if you're in — you can change your mind any time."
                  : myRsvp === "in"
                    ? "You're in. Change your answer below any time."
                    : myRsvp === "maybe"
                      ? "You're a maybe. Flip to in or out whenever you know."
                      : "You're out. Change your mind any time."}
              </p>
              <div className="flex gap-2">
                {RSVP_OPTIONS.map((opt) => {
                  const isSelected = myRsvp === opt.value;
                  const Icon = opt.icon;
                  return (
                    <button
                      key={opt.value}
                      onClick={() => {
                        if (isSelected) return;
                        setRsvp.mutate({ tripId, rsvpStatus: opt.value });
                      }}
                      disabled={setRsvp.isPending}
                      data-testid={`rsvp-action-btn-${opt.value}`}
                      className="flex flex-1 items-center justify-center gap-1.5 rounded-xl py-2.5 text-sm font-medium transition-all disabled:opacity-50"
                      style={{
                        background: isSelected ? opt.selectedBg : "var(--color-bt-card-raised)",
                        color: isSelected ? opt.selectedText : "var(--color-bt-text)",
                        border: isSelected ? "none" : "1px solid var(--color-bt-border)",
                      }}
                    >
                      <Icon size={14} />
                      {opt.label}
                    </button>
                  );
                })}
              </div>
            </>
          )}
        </div>
      )}

      {/* ── Travel section (opt-in) ─────────────────────────────────── */}
      {canShowTravel && (
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
              : myRsvp === "maybe"
                ? "You said you're a maybe — share any tentative travel plans so the crew can coordinate."
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
