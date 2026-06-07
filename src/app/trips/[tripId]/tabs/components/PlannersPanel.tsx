"use client";

import { useState } from "react";
import {
  useEmailValidation,
  validationBorder,
  ValidationFeedback,
} from "@/components/emailValidation";
import { trpc } from "@/lib/trpc-client";

// ── AddOrganizerComposer ──────────────────────────────────────────────────
// Mirrors CrewTab's AddCrewComposer chrome exactly, with two differences:
// email is REQUIRED (with the same live validation as the edit-crew drawer),
// and anyone added here lands as an Organizer (role: "Organizer") rather than a
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
      role: "Organizer",
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
