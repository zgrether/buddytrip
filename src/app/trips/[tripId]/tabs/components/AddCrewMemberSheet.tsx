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
 * a crew member.
 *
 * Form (CC_MODAL_AUDIT.md Part 1.1):
 *   Display Name — trip-local display label (not the user's BT account
 *                  name); optional
 *   Email        — optional
 *
 *   Helper line below the body: "Enter a name, an email, or both."
 *
 * Submit is enabled as long as at least one field is filled in (display
 * name OR a syntactically-valid email). Both empty → disabled.
 *
 * Account lookup (CC_MODAL_AUDIT.md Part 1.2):
 *   - 500 ms debounce on the email input
 *   - Lookup is purely informational. It NEVER writes into the Display
 *     Name field. When the user hasn't typed a display name and an
 *     account is found, the account's name surfaces as the field's
 *     placeholder (HTML placeholder behaviour: greyed/italic by default,
 *     instantly replaced the moment the user types).
 *
 * Outcomes on submit (CC_MODAL_AUDIT.md Part 1.3):
 *   Display Name only                     ghostCrew.create — Just Names
 *   Email only, account found             tripMembers.inviteByEmail Path A
 *   Email only, no account                tripMembers.inviteByEmail Path B
 *                                         (router falls back to email-stem
 *                                          for users.name; display_name
 *                                          stays NULL → roster shows the
 *                                          email-stem in italic)
 *   Both                                  trip-local display_name override
 *                                         wins over any account name —
 *                                         the typed name surfaces on the
 *                                         crew list (Path A or B).
 */
export function AddCrewMemberSheet({
  tripId,
  isOpen,
  onClose,
}: AddCrewMemberSheetProps) {
  const utils = trpc.useUtils();

  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  // Reset form when the sheet closes so a re-open starts fresh.
  useEffect(() => {
    if (!isOpen) {
      setDisplayName("");
      setEmail("");
      setSubmitError(null);
      setSubmitting(false);
    }
  }, [isOpen]);

  useModalBackButton(isOpen ? onClose : () => {});

  // ── Email account lookup (debounced + cancellable) ───────────────────

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
    if (!trimmed) {
      setLookup({ kind: "idle" });
      return;
    }
    if (!EMAIL_RE.test(trimmed)) {
      setLookup({ kind: "idle" });
      return;
    }
    const existing = existingMemberByEmail.get(trimmed);
    if (existing) {
      setLookup({ kind: "already-member", displayName: existing.displayName });
      return;
    }
    if (lastQueried.current === trimmed && lookup.kind !== "idle") return;

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

  const trimmedName = displayName.trim();
  const trimmedEmail = email.trim().toLowerCase();
  const hasName = trimmedName.length > 0;
  const hasValidEmail = EMAIL_RE.test(trimmedEmail);
  const hasInvalidEmail = trimmedEmail.length > 0 && !hasValidEmail;

  // Validation rule per Part 1.1: at least one of {name, valid email}.
  // Both empty → disabled. Invalid email format → disabled. Already a
  // trip member → disabled.
  const canSubmit =
    (hasName || hasValidEmail) &&
    !hasInvalidEmail &&
    !submitting &&
    lookup.kind !== "looking" &&
    lookup.kind !== "already-member";

  // Display Name placeholder per Part 1.2: when the user has NOT typed
  // anything in the field, surface the account name (if found) as a
  // greyed-out placeholder. The placeholder vanishes the moment they
  // type — their input is authoritative.
  const namePlaceholder =
    lookup.kind === "found" ? lookup.accountName : "What you'll call them";

  async function handleSubmit() {
    if (!canSubmit) return;
    setSubmitError(null);
    setSubmitting(true);
    try {
      if (!hasValidEmail) {
        // Display Name only → ghostCrew.create — lands in Just Names.
        await createGuest.mutateAsync({
          tripId,
          name: trimmedName,
          role: "Member",
        });
      } else {
        // Email present (with or without typed name). inviteByEmail
        // handles both Path A (existing account) and Path B
        // (guest + invite); the typed name (if any) is carried through
        // as a trip-local display_name override.
        await inviteByEmail.mutateAsync({
          tripId,
          email: trimmedEmail,
          role: "Member",
          ...(hasName ? { name: trimmedName } : {}),
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
        className="flex w-full max-w-[480px] flex-col overflow-hidden rounded-t-2xl sm:rounded-2xl"
        style={{
          background: "var(--color-bt-card)",
          border: "1px solid var(--color-bt-border)",
          boxShadow: "var(--shadow-floating)",
          maxHeight: "min(85dvh, 640px)",
        }}
        onClick={(e) => e.stopPropagation()}
        data-testid="add-crew-member-sheet"
      >
        {/* Header — canonical modal pattern (CC_MODAL_AUDIT.md Part 2.1):
            title + close X, px-5 py-4, border-bottom. */}
        <div
          className="flex flex-shrink-0 items-center justify-between px-5 py-4"
          style={{ borderBottom: "1px solid var(--color-bt-border)" }}
        >
          <p
            className="text-base font-semibold"
            style={{ color: "var(--color-bt-text)" }}
          >
            Add crew member
          </p>
          <button
            onClick={onClose}
            aria-label="Close"
            className="flex h-8 w-8 items-center justify-center rounded-full transition-colors hover:bg-[var(--color-bt-hover)]"
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
        <div className="flex-1 overflow-y-auto px-5 py-4">
          <div className="space-y-4">
            {/* Display Name */}
            <div>
              <label
                htmlFor="add-crew-display-name"
                className="mb-1 block text-[10px] font-medium uppercase tracking-[0.06em]"
                style={{ color: "var(--color-bt-text-dim)" }}
              >
                Display Name{" "}
                <span
                  className="font-normal normal-case"
                  style={{ color: "var(--color-bt-text-dim)", letterSpacing: 0 }}
                >
                  — optional
                </span>
              </label>
              <input
                id="add-crew-display-name"
                data-testid="add-crew-display-name-input"
                type="text"
                autoFocus
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && canSubmit) {
                    e.preventDefault();
                    handleSubmit();
                  }
                }}
                maxLength={100}
                placeholder={namePlaceholder}
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
                className="mb-1 block text-[10px] font-medium uppercase tracking-[0.06em]"
                style={{ color: "var(--color-bt-text-dim)" }}
              >
                Email{" "}
                <span
                  className="font-normal normal-case"
                  style={{ color: "var(--color-bt-text-dim)", letterSpacing: 0 }}
                >
                  — optional
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
              <LookupNote state={lookup} hasInvalid={hasInvalidEmail} />
            </div>

            {/* Helper text — guidance that replaces the old `*` required
                indicator. Applies to the form as a whole (Part 1.1). */}
            <p
              className="text-[11px]"
              style={{ color: "var(--color-bt-text-dim)" }}
            >
              Enter a name, an email, or both.
            </p>

            {/* Submit error */}
            {submitError && (
              <p
                className="text-xs"
                style={{ color: "var(--color-bt-danger)" }}
              >
                {submitError}
              </p>
            )}
          </div>
        </div>

        {/* Footer — canonical modal pattern: px-5 py-4, border-top, right-
            aligned actions, gap-3, Medium button size, Ghost + Primary
            variants. */}
        <div
          className="flex flex-shrink-0 items-center justify-end gap-3 px-5 py-4"
          style={{ borderTop: "1px solid var(--color-bt-border)" }}
        >
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl px-4 py-2.5 text-sm font-medium"
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
            className="flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold transition-opacity disabled:opacity-40"
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
  );
}

// ── LookupNote ───────────────────────────────────────────────────────────

function LookupNote({
  state,
  hasInvalid,
}: {
  state: LookupState;
  hasInvalid: boolean;
}) {
  if (hasInvalid) {
    return (
      <p
        className="mt-1.5 text-[11px]"
        style={{ color: "var(--color-bt-danger)" }}
      >
        Enter a valid email address.
      </p>
    );
  }
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
  return (
    <p
      className="mt-1.5 text-[11px]"
      style={{ color: "var(--color-bt-warning)" }}
    >
      Already on this trip — {state.displayName}
    </p>
  );
}
