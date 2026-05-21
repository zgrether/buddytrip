"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Loader2, X } from "lucide-react";
import { trpc } from "@/lib/trpc-client";
import { useModalBackButton } from "@/hooks/useModalBackButton";

// ── Types ────────────────────────────────────────────────────────────────

interface AddCrewMemberSheetProps {
  tripId: string;
  isOpen: boolean;
  onClose: () => void;
}

// Account-lookup state for the inline note under the email input.
type LookupState =
  | { kind: "idle" }
  | { kind: "looking" }
  | { kind: "found"; accountName: string; userId: string }
  | { kind: "no-account" }                    // valid email, no BT account
  | { kind: "already-member"; displayName: string }; // email matches existing trip member

// Basic email shape check — accepts most real addresses and rejects
// gibberish. The server does its own validation; this is just to gate the
// debounced lookup.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// ── Component ────────────────────────────────────────────────────────────

/**
 * AddCrewMemberSheet — modal (desktop) / bottom sheet (mobile) for adding
 * a crew member. Replaces the inline name-only field that lived in the
 * old CrewTab.
 *
 * Form:
 *   Name *           — required, autofocused
 *   Email (optional) — debounced account lookup on change/blur
 *
 * The email-lookup note below the email input reflects one of four states
 * (see LookupState above). Add-to-crew is disabled when the email matches
 * an existing trip member.
 *
 * Outcomes on submit (CC_CREW_OVERHAUL.md Part 1.5):
 *   Name only                          → ghostCrew.create — "Just Names"
 *   Name + Email, account found        → tripMembers.inviteByEmail
 *                                        (Path A — added as joined Member)
 *   Name + Email, no account           → tripMembers.inviteByEmail
 *                                        (Path B — guest + invite sent)
 *
 * The user's typed name is carried through both paths via the optional
 * `name` argument added to inviteByEmail. For Path A the existing
 * account's stored name remains authoritative for the crew roster — the
 * typed name acts as confirmation copy inside the modal only.
 */
export function AddCrewMemberSheet({
  tripId,
  isOpen,
  onClose,
}: AddCrewMemberSheetProps) {
  const utils = trpc.useUtils();

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  // Reset form when the sheet closes so a re-open starts fresh.
  useEffect(() => {
    if (!isOpen) {
      setName("");
      setEmail("");
      setSubmitError(null);
      setSubmitting(false);
    }
  }, [isOpen]);

  useModalBackButton(isOpen ? onClose : () => {});

  // ── Email account lookup (debounced + cancellable) ───────────────────
  // Fires when the email field has a parseable value. State machine lives
  // in `lookup`; the debounce timer + lastQueriedEmail are refs so quick
  // typing doesn't fire stale requests.

  const { data: members = [] } = trpc.tripMembers.list.useQuery({ tripId });
  const existingMemberByEmail = useMemo(() => {
    const map = new Map<string, { displayName: string; userId: string }>();
    for (const m of members as Array<{
      user: { email?: string | null } | null;
      displayName: string;
      user_id: string | null;
    }>) {
      const e = m.user?.email?.toLowerCase().trim();
      if (e && m.user_id) {
        map.set(e, { displayName: m.displayName, userId: m.user_id });
      }
    }
    return map;
  }, [members]);

  const [lookup, setLookup] = useState<LookupState>({ kind: "idle" });
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastQueried = useRef<string | null>(null);

  useEffect(() => {
    const trimmed = email.trim().toLowerCase();
    // Empty or malformed → idle, nothing to look up.
    if (!trimmed) {
      setLookup({ kind: "idle" });
      return;
    }
    if (!EMAIL_RE.test(trimmed)) {
      setLookup({ kind: "idle" });
      return;
    }
    // Already a member of this trip — short-circuit; no need to hit the
    // users.search endpoint.
    const existing = existingMemberByEmail.get(trimmed);
    if (existing) {
      setLookup({ kind: "already-member", displayName: existing.displayName });
      return;
    }
    // Same email we last queried → keep showing the cached result.
    if (lastQueried.current === trimmed && lookup.kind !== "idle") return;

    // 500ms debounce before firing users.search
    if (debounceTimer.current) clearTimeout(debounceTimer.current);
    setLookup({ kind: "looking" });
    debounceTimer.current = setTimeout(async () => {
      try {
        const results = await utils.users.search.fetch({ query: trimmed });
        lastQueried.current = trimmed;
        const hit = results?.[0];
        if (hit) {
          const accountName =
            (hit as { nickname?: string | null }).nickname ??
            (hit as { name?: string | null }).name ??
            (hit as { email?: string | null }).email ??
            trimmed;
          setLookup({
            kind: "found",
            accountName,
            userId: (hit as { id: string }).id,
          });
        } else {
          setLookup({ kind: "no-account" });
        }
      } catch {
        // Network/server error — fall back to "no-account" so the user
        // can still proceed; server-side validation will catch any real
        // issues at submit time.
        setLookup({ kind: "no-account" });
      }
    }, 500);

    return () => {
      if (debounceTimer.current) clearTimeout(debounceTimer.current);
    };
  }, [email, existingMemberByEmail, utils, lookup.kind]);

  // ── Mutations ────────────────────────────────────────────────────────

  const createGuest = trpc.ghostCrew.create.useMutation({
    onSettled: () => utils.tripMembers.list.invalidate({ tripId }),
  });
  const inviteByEmail = trpc.tripMembers.inviteByEmail.useMutation({
    onSettled: () => utils.tripMembers.list.invalidate({ tripId }),
  });

  const trimmedName = name.trim();
  const trimmedEmail = email.trim().toLowerCase();
  const hasName = trimmedName.length > 0;
  const hasValidEmail = EMAIL_RE.test(trimmedEmail);
  const canSubmit =
    hasName &&
    !submitting &&
    lookup.kind !== "looking" &&
    lookup.kind !== "already-member";

  async function handleSubmit() {
    if (!canSubmit) return;
    setSubmitError(null);
    setSubmitting(true);
    try {
      if (!hasValidEmail) {
        // Name only → Just Names
        await createGuest.mutateAsync({
          tripId,
          name: trimmedName,
          role: "Member",
        });
      } else {
        // Name + email — inviteByEmail handles both Path A (existing
        // account) and Path B (guest + invite). The typed name carries
        // through for Path B; Path A keeps the existing user's name.
        await inviteByEmail.mutateAsync({
          tripId,
          email: trimmedEmail,
          role: "Member",
          name: trimmedName,
        });
      }
      onClose();
    } catch (err) {
      setSubmitError(
        err instanceof Error
          ? err.message
          : "Failed to add crew member. Please try again."
      );
    } finally {
      setSubmitting(false);
    }
  }

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center p-0 sm:items-center sm:p-4"
      style={{ background: "var(--color-bt-overlay)" }}
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Add crew member"
    >
      <div
        className="w-full max-w-[480px] overflow-hidden rounded-t-2xl sm:rounded-2xl"
        style={{
          background: "var(--color-bt-card)",
          border: "1px solid var(--color-bt-border)",
          boxShadow: "var(--shadow-floating)",
          maxHeight: "min(85dvh, 640px)",
        }}
        onClick={(e) => e.stopPropagation()}
        data-testid="add-crew-member-sheet"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 pb-3 pt-5">
          <p className="text-base font-bold" style={{ color: "var(--color-bt-text)" }}>
            Add crew member
          </p>
          <button
            onClick={onClose}
            aria-label="Close"
            className="flex h-8 w-8 items-center justify-center rounded-full"
            style={{
              background: "var(--color-bt-card-raised)",
              color: "var(--color-bt-text-dim)",
              border: "none",
              cursor: "pointer",
            }}
          >
            <X size={14} />
          </button>
        </div>

        {/* Body */}
        <div className="space-y-4 px-5 pb-5">
          {/* Name */}
          <div>
            <label
              htmlFor="add-crew-name"
              className="mb-1.5 block text-xs font-semibold uppercase tracking-wider"
              style={{ color: "var(--color-bt-text-dim)" }}
            >
              Name <span style={{ color: "var(--color-bt-danger)" }}>*</span>
            </label>
            <input
              id="add-crew-name"
              data-testid="add-crew-name-input"
              type="text"
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && canSubmit) {
                  e.preventDefault();
                  handleSubmit();
                }
              }}
              maxLength={100}
              placeholder="Brad"
              className="w-full rounded-lg border px-3 py-2 text-sm outline-none focus:ring-1"
              style={{
                background: "var(--color-bt-base)",
                borderColor: "var(--color-bt-border)",
                color: "var(--color-bt-text)",
              }}
            />
          </div>

          {/* Email */}
          <div>
            <label
              htmlFor="add-crew-email"
              className="mb-1.5 block text-xs font-semibold uppercase tracking-wider"
              style={{ color: "var(--color-bt-text-dim)" }}
            >
              Email{" "}
              <span
                className="text-[10px] font-normal normal-case"
                style={{ color: "var(--color-bt-text-dim)" }}
              >
                (optional)
              </span>
            </label>
            <input
              id="add-crew-email"
              data-testid="add-crew-email-input"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && canSubmit) {
                  e.preventDefault();
                  handleSubmit();
                }
              }}
              placeholder="brad@example.com"
              className="w-full rounded-lg border px-3 py-2 text-sm outline-none focus:ring-1"
              style={{
                background: "var(--color-bt-base)",
                borderColor: "var(--color-bt-border)",
                color: "var(--color-bt-text)",
              }}
            />
            <LookupNote state={lookup} />
          </div>

          {/* Submit error */}
          {submitError && (
            <p
              className="text-xs"
              style={{ color: "var(--color-bt-danger)" }}
            >
              {submitError}
            </p>
          )}

          {/* Footer actions */}
          <div className="flex items-center justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={onClose}
              className="rounded-xl px-4 py-2 text-sm font-medium"
              style={{
                background: "transparent",
                color: "var(--color-bt-text-dim)",
                border: "0.5px solid var(--color-bt-border)",
              }}
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleSubmit}
              disabled={!canSubmit}
              data-testid="add-crew-submit"
              className="flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-semibold transition-opacity disabled:opacity-40"
              style={{
                background: "var(--color-bt-accent)",
                color: "var(--color-bt-base)",
              }}
            >
              {submitting && <Loader2 size={14} className="animate-spin" />}
              Add to crew
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── LookupNote ───────────────────────────────────────────────────────────
// Inline status message under the email input. Four states map 1:1 to
// the spec's account-lookup states.

function LookupNote({ state }: { state: LookupState }) {
  if (state.kind === "idle") return null;

  if (state.kind === "looking") {
    return (
      <p
        className="mt-1.5 flex items-center gap-1.5 text-[11px]"
        style={{ color: "var(--color-bt-text-dim)" }}
      >
        <Loader2 size={11} className="animate-spin" />
        Looking up...
      </p>
    );
  }
  if (state.kind === "found") {
    return (
      <p
        className="mt-1.5 text-[11px]"
        style={{ color: "var(--color-bt-accent)" }}
      >
        ✓ Account found: {state.accountName}
      </p>
    );
  }
  if (state.kind === "no-account") {
    return (
      <p
        className="mt-1.5 text-[11px]"
        style={{ color: "var(--color-bt-text-dim)" }}
      >
        Invite will be sent
      </p>
    );
  }
  // already-member
  return (
    <p
      className="mt-1.5 text-[11px]"
      style={{ color: "var(--color-bt-warning)" }}
    >
      Already on this trip — {state.displayName}
    </p>
  );
}
