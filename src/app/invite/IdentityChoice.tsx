"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { createClient } from "@/lib/supabase";
import InviteShell from "./InviteShell";

/**
 * Branch 2 — the link was addressed to one account and a different one is
 * signed in on this device.
 *
 * The one thing this screen must never do is decide for them. Silently signing
 * the current user out throws away a session they may be mid-round in; silently
 * continuing as them is how someone ends up entering scores under a housemate's
 * name on a shared iPad. Both options are offered explicitly, both say which
 * address they mean, and the destructive one is the secondary.
 *
 * "Continue as …" is only offered when that account can actually see the trip.
 * Offering it otherwise would be a button whose only outcome is a refusal.
 */
export default function IdentityChoice({
  tripName,
  inviterName,
  invitedEmail,
  next,
  token,
  viewerEmail,
  viewerCanSee,
}: {
  tripName: string;
  inviterName: string | null;
  invitedEmail: string;
  next: string;
  token: string;
  viewerEmail: string | null;
  viewerCanSee: boolean;
}) {
  const router = useRouter();
  const [switching, setSwitching] = useState(false);

  async function useInvitedAddress() {
    setSwitching(true);
    const supabase = createClient();
    await supabase.auth.signOut();
    // Straight back into the same routing decision, now with no session — the
    // invite page re-resolves and picks sign-in or sign-up for the invited
    // address. Deliberately NOT a hardcoded /login: one place decides.
    router.replace(`/invite?token=${encodeURIComponent(token)}`);
    router.refresh();
  }

  return (
    <InviteShell>
      <div className="space-y-5">
        <div className="space-y-2 text-center">
          <h1 className="text-lg font-semibold" style={{ color: "var(--color-bt-text)" }}>
            {inviterName ? `${inviterName} added you to ${tripName}` : `You've been added to ${tripName}`}
          </h1>
          <p className="text-sm" style={{ color: "var(--color-bt-text-dim)" }}>
            That invite went to{" "}
            <strong style={{ color: "var(--color-bt-text)" }}>{invitedEmail}</strong>, but
            you&apos;re signed in
            {viewerEmail ? (
              <>
                {" "}
                as <strong style={{ color: "var(--color-bt-text)" }}>{viewerEmail}</strong>
              </>
            ) : (
              " as someone else"
            )}
            .
          </p>
        </div>

        <div className="space-y-2">
          {viewerCanSee && (
            <button
              type="button"
              onClick={() => router.replace(next)}
              className="w-full rounded-xl py-3 text-sm font-semibold transition-opacity hover:opacity-90"
              style={{ background: "var(--color-bt-accent)", color: "var(--color-bt-base)" }}
            >
              Continue as {viewerEmail ?? "the current account"}
            </button>
          )}

          <button
            type="button"
            onClick={useInvitedAddress}
            disabled={switching}
            className="flex w-full items-center justify-center gap-2 rounded-xl border px-4 py-2.5 text-sm transition-opacity hover:opacity-90 disabled:opacity-40"
            style={{
              background: viewerCanSee ? "transparent" : "var(--color-bt-accent)",
              borderColor: viewerCanSee ? "var(--color-bt-border)" : "transparent",
              color: viewerCanSee ? "var(--color-bt-text-dim)" : "var(--color-bt-base)",
              fontWeight: viewerCanSee ? 400 : 600,
            }}
          >
            {switching && <Loader2 size={16} className="animate-spin" />}
            Sign out and use {invitedEmail}
          </button>
        </div>
      </div>
    </InviteShell>
  );
}
