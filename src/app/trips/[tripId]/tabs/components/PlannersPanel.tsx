"use client";

import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { ConfirmDeleteButton } from "@/components/ConfirmDeleteButton";
import { Avatar } from "@/components/Avatar";
import {
  useEmailValidation,
  validationBorder,
  ValidationFeedback,
} from "@/components/emailValidation";
import { trpc } from "@/lib/trpc-client";

// ── Types ─────────────────────────────────────────────────────────────────

export interface PlannerWithVoteStatus {
  userId: string;
  name: string;
  avatarIcon?: string | null;
  email?: string | null;
  role: "owner" | "planner";
  hasVoted: boolean;
  isMe: boolean;
  /** True when added by email but no BuddyTrip account exists yet */
  isGuest: boolean;
}

interface PlannersPanelProps {
  tripId: string;
  planners: PlannerWithVoteStatus[];
  isOwner: boolean;
}

// ── PlannerRow ────────────────────────────────────────────────────────────

function PlannerRow({
  planner,
  tripId,
  isOwner,
}: {
  planner: PlannerWithVoteStatus;
  tripId: string;
  isOwner: boolean;
}) {
  const utils = trpc.useUtils();
  const [isExpanded, setIsExpanded] = useState(false);

  const removeMember = trpc.tripMembers.remove.useMutation({
    onSuccess() {
      utils.tripMembers.list.invalidate({ tripId });
    },
  });

  const isOwnerRow = planner.role === "owner";
  const expandable = isOwner && !planner.isMe && !isOwnerRow;

  return (
    <div
      className="border-b last:border-b-0"
      style={{
        borderColor: "var(--color-bt-subtle-border)",
        background: isExpanded ? "var(--color-bt-card-raised)" : "transparent",
      }}
    >
      {/* Main row */}
      <div
        className="flex items-center gap-3 py-2.5 px-3"
        style={{ cursor: expandable ? "pointer" : undefined }}
        onClick={
          expandable
            ? () => setIsExpanded((e) => !e)
            : undefined
        }
      >
        <Avatar name={planner.name} avatarIcon={planner.avatarIcon ?? null} sizePx={32} />

        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium" style={{ color: "var(--color-bt-text)" }}>
            {planner.name}
            {planner.isMe && (
              <span className="ml-1 text-xs" style={{ color: "var(--color-bt-text-dim)" }}>(you)</span>
            )}
          </p>
          {planner.email && (
            <p className="truncate font-mono text-[11px]" style={{ color: "var(--color-bt-text-dim)" }}>
              {planner.email}
            </p>
          )}
        </div>

        <div className="flex flex-shrink-0 items-center gap-1.5">
          {/* Pending badge — guest planners without a BT account */}
          {planner.isGuest && (
            <span
              className="rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider"
              style={{
                background: "color-mix(in srgb, var(--color-bt-warning) 12%, transparent)",
                color: "var(--color-bt-warning)",
                border: "1px solid color-mix(in srgb, var(--color-bt-warning) 25%, transparent)",
              }}
            >
              Pending
            </span>
          )}

          {/* Owner badge — plain text, matches CrewTab RolePill */}
          {isOwnerRow && (
            <span
              className="inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider"
              style={{
                background: "var(--color-bt-warning-faint)",
                color: "var(--color-bt-owner)",
                border: "1px solid var(--color-bt-warning-border)",
              }}
            >
              Owner
            </span>
          )}

          {/* Organizer badge */}
          {!isOwnerRow && (
            <span
              className="inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider"
              style={{
                background: "var(--color-bt-accent-faint)",
                color: "var(--color-bt-accent)",
                border: "1px solid var(--color-bt-accent-border)",
              }}
            >
              Organizer
            </span>
          )}

          {expandable && (
            <ChevronDown
              size={16}
              className="transition-transform duration-150"
              style={{
                color: "var(--color-bt-text-dim)",
                transform: isExpanded ? "rotate(180deg)" : "rotate(0deg)",
              }}
            />
          )}
        </div>
      </div>

      {/* Expanded panel — canonical danger-action button (matches crew edit modal) */}
      {isExpanded && expandable && (
        <div className="flex gap-3 px-3 pb-3">
          <div className="w-8 flex-shrink-0" aria-hidden />
          <div className="min-w-0 flex-1">
            <ConfirmDeleteButton
              label={`Remove ${planner.name} from trip`}
              confirmLabel="Remove"
              pendingLabel="Removing…"
              prompt={`Remove ${planner.name} from the trip?`}
              pending={removeMember.isPending}
              onConfirm={() => removeMember.mutate({ tripId, userId: planner.userId })}
            />
          </div>
        </div>
      )}
    </div>
  );
}

// ── AddOrganizerComposer ──────────────────────────────────────────────────
// Mirrors CrewTab's AddCrewComposer chrome exactly, with two differences:
// email is REQUIRED (with the same live validation as the edit-crew drawer),
// and anyone added here lands as an Organizer (role: "Planner") rather than a
// plain Member. Owner-only — gated by the caller.

export function AddOrganizerComposer({ tripId }: { tripId: string }) {
  const utils = trpc.useUtils();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const validation = useEmailValidation(tripId, email);

  const createGuest = trpc.ghostCrew.create.useMutation({
    onMutate() {
      setErrorMsg(null);
    },
    onSuccess() {
      setName("");
      setEmail("");
      utils.tripMembers.list.invalidate({ tripId });
    },
    onError(err) {
      setErrorMsg(err.message);
    },
  });

  // Email is required here, so derive the name from the email's local-part
  // when the name field is blank ("alice@x.com" → "alice").
  const trimmedName = name.trim();
  const trimmedEmail = email.trim();
  const derivedName =
    trimmedName || trimmedEmail.split("@")[0]?.replace(/[._-]+/g, " ").trim();

  // Only an address that resolves (existing account → "match", or a valid
  // address with no account yet → "invite") may be submitted. "invalid",
  // "idle", and the in-flight "checking" state all hold the button.
  const emailOk = validation === "match" || validation === "invite";
  const canSubmit = !!derivedName && emailOk && !createGuest.isPending;

  const handleSubmit = () => {
    if (!canSubmit || !derivedName) return;
    createGuest.mutate({
      tripId,
      name: derivedName,
      email: trimmedEmail,
      role: "Planner",
    });
  };

  const inputBase = {
    background: "var(--color-bt-card-raised)",
    borderColor: "var(--color-bt-border)",
    color: "var(--color-bt-text)",
  };

  return (
    <div
      className="flex flex-col gap-2 rounded-xl p-3.5"
      style={{
        background: "var(--color-bt-card)",
        border: "1px solid var(--color-bt-border)",
      }}
    >
      <div
        className="mb-1 text-[11px] font-bold uppercase tracking-[0.12em]"
        style={{ color: "var(--color-bt-text-dim)" }}
      >
        Add an organizer
      </div>

      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") handleSubmit();
        }}
        placeholder="Name (optional)"
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
        placeholder="email@example.com"
        className="w-full rounded-lg border px-2.5 py-2 font-mono text-[13px] outline-none"
        style={{ ...inputBase, borderColor: validationBorder(validation) }}
      />

      <ValidationFeedback state={validation} email={email} allowBlank={false} />

      <button
        type="button"
        onClick={handleSubmit}
        disabled={!canSubmit}
        className="mt-1 rounded-lg py-2.5 text-sm font-semibold transition-opacity enabled:hover:opacity-90 disabled:opacity-40"
        style={{
          background: "var(--color-bt-accent)",
          color: "var(--color-bt-on-accent)",
          cursor: canSubmit ? "pointer" : "not-allowed",
        }}
      >
        {createGuest.isPending ? "Adding…" : "Add organizer"}
      </button>

      {errorMsg && (
        <p className="text-[11px] leading-snug" style={{ color: "var(--color-bt-danger)" }}>
          {errorMsg}
        </p>
      )}

      <p className="mt-1 text-[11px] leading-snug" style={{ color: "var(--color-bt-text-dim)" }}>
        Organizers help shape the trip — they can add ideas, vote, and weigh in.{" "}
        <strong className="font-semibold" style={{ color: "var(--color-bt-text)" }}>
          An email is required
        </strong>{" "}
        so they can sign in and join the conversation.
      </p>
    </div>
  );
}

// ── PlannersPanel ─────────────────────────────────────────────────────────

export function PlannersPanel({
  tripId,
  planners,
  isOwner,
}: PlannersPanelProps) {
  const hasMultiplePlanners = planners.length > 1;

  // Owners and organizers get different framing: the owner is inviting people
  // to help; organizers are being told what they can do here.
  const description = isOwner
    ? "Invite people who want to help shape the trip. They can add ideas, vote, and weigh in before the trip is officially on. Everyone else gets added when you're ready to go."
    : "You're an organizer on this trip. Add your input on the ideas below and vote for your favorite — your voice helps decide where the crew lands.";

  return (
    <div
      className="rounded-xl overflow-hidden"
      style={{
        background: "var(--color-bt-card)",
        border: hasMultiplePlanners
          ? "1px solid var(--color-bt-border)"
          : "1.5px dashed var(--color-bt-border)",
      }}
    >
      {/* Header — ORGANIZERS section header with count (matches CrewTab) */}
      <div className="flex items-center gap-2 px-3 pt-3 pb-2">
        <h2
          className="flex flex-1 items-baseline justify-between gap-2 rounded-lg px-3 py-1.5 text-xs font-semibold uppercase tracking-wider"
          style={{ color: "var(--color-bt-accent)", background: "var(--color-bt-accent-faint)" }}
        >
          <span>Organizers</span>
          <span className="font-mono" style={{ opacity: 0.75 }}>{planners.length}</span>
        </h2>
      </div>

      {/* Description */}
      <p
        style={{
          fontSize: 12,
          color: "var(--color-bt-text-dim)",
          lineHeight: 1.5,
          padding: "0 16px 12px",
          borderBottom: "1px solid var(--color-bt-border)",
        }}
      >
        {description}
      </p>

      {/* Planner rows */}
      {planners.length > 0 && (
        <div>
          {planners.map((p) => (
            <PlannerRow key={p.userId} planner={p} tripId={tripId} isOwner={isOwner} />
          ))}
        </div>
      )}
    </div>
  );
}
