"use client";

import { useEffect, useMemo, useState } from "react";
import { Check, Loader2, Send, X } from "lucide-react";
import { trpc } from "@/lib/trpc-client";

// ── Types ─────────────────────────────────────────────────────────────────

export type ValidationState =
  | "idle"
  | "checking"
  | "match"
  | "invite"
  | "invalid";

// ── Hook — debounced live email validation ────────────────────────────────
//
// Mirrors the edit-crew drawer: format-check locally, then (once the format is
// valid) ask the server whether the address maps to an existing BuddyTrip
// account. Returns a single ValidationState the UI can switch on.

export function useEmailValidation(tripId: string, email: string): ValidationState {
  const formatOk = useMemo(() => {
    if (!email.trim()) return null; // empty → no card
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
  }, [email]);

  const [debounced, setDebounced] = useState(email);
  useEffect(() => {
    const id = window.setTimeout(() => setDebounced(email), 400);
    return () => window.clearTimeout(id);
  }, [email]);

  const checkQuery = trpc.tripMembers.checkEmail.useQuery(
    { tripId, email: debounced.trim() },
    {
      enabled: !!debounced.trim() && formatOk === true,
      staleTime: 30_000,
    }
  );

  return useMemo(() => {
    if (!email.trim()) return "idle";
    if (formatOk === false) return "invalid";
    // Format-valid but query hasn't settled (or is in-flight).
    if (debounced !== email || checkQuery.isFetching) return "checking";
    if (checkQuery.data?.result === "match") return "match";
    if (checkQuery.data?.result === "invalid") return "invalid";
    if (checkQuery.data?.result === "invite") return "invite";
    return "checking";
  }, [email, debounced, formatOk, checkQuery.data, checkQuery.isFetching]);
}

// ── validationBorder — input border color for a given state ────────────────

export function validationBorder(state: ValidationState) {
  switch (state) {
    case "checking":
    case "invite":
      return "var(--color-bt-warning)";
    case "match":
      return "var(--color-bt-accent)";
    case "invalid":
      return "var(--color-bt-danger)";
    default:
      return "var(--color-bt-border)";
  }
}

// ── ValidationFeedback — the four-state helper card ────────────────────────

export function ValidationFeedback({
  state,
  email,
  allowBlank = true,
}: {
  state: ValidationState;
  email: string;
  /** When false, the "invalid" card drops the "leave it blank" hint —
   *  used where an email is required (e.g. adding an organizer). */
  allowBlank?: boolean;
}) {
  if (state === "idle") return null;

  type Tone = "accent" | "warning" | "danger";
  const copy: {
    tone: Tone;
    icon: "check" | "send" | "x" | "spin";
    title: string;
    body: string | null;
  } =
    state === "checking"
      ? { tone: "warning", icon: "spin", title: "Checking BuddyTrip…", body: null }
      : state === "match"
        ? {
            tone: "accent",
            icon: "check",
            title: "Already on BuddyTrip",
            body: `${email} is an active account — they'll be in the trip the moment you save.`,
          }
        : state === "invite"
          ? {
              tone: "warning",
              icon: "send",
              title: "No account yet",
              body: `No account at ${email}. You can send an invite after you save your changes.`,
            }
          : {
              tone: "danger",
              icon: "x",
              title: "That email doesn't look right",
              body: allowBlank ? "Or leave it blank — they'll be a placeholder." : null,
            };

  const tones: Record<Tone, { fg: string; bg: string; border: string }> = {
    accent: {
      fg: "var(--color-bt-accent)",
      bg: "var(--color-bt-accent-faint)",
      border: "var(--color-bt-accent-border)",
    },
    warning: {
      fg: "var(--color-bt-warning)",
      bg: "var(--color-bt-warning-faint)",
      border: "var(--color-bt-warning-border)",
    },
    danger: {
      fg: "var(--color-bt-danger)",
      bg: "var(--color-bt-danger-faint)",
      border: "var(--color-bt-danger-border)",
    },
  };
  const t = tones[copy.tone];

  return (
    <div
      className="mt-1 flex items-start gap-2.5 rounded-lg px-3 py-2"
      style={{ background: t.bg, border: `1px solid ${t.border}` }}
    >
      <span
        className="flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full"
        style={{
          background: copy.icon === "spin" ? "transparent" : t.fg,
          color: "var(--color-bt-on-accent)",
          border: copy.icon === "spin" ? `2px solid ${t.fg}` : undefined,
        }}
      >
        {copy.icon === "check" && <Check size={12} strokeWidth={3} />}
        {copy.icon === "send" && <Send size={11} strokeWidth={2.5} />}
        {copy.icon === "x" && <X size={12} strokeWidth={3} />}
        {copy.icon === "spin" && (
          <Loader2 size={11} className="animate-spin" style={{ color: t.fg }} />
        )}
      </span>
      <div className="min-w-0">
        <div className="text-[12px] font-semibold" style={{ color: t.fg }}>
          {copy.title}
        </div>
        {copy.body && (
          <div
            className="mt-0.5 text-[11px] leading-snug"
            style={{ color: "var(--color-bt-text-dim)" }}
          >
            {copy.body}
          </div>
        )}
      </div>
    </div>
  );
}
