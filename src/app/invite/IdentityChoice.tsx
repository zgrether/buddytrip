"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { createClient } from "@/lib/supabase";
import { trpc } from "@/lib/trpc-client";
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
 *
 * ── The third option: claim (migration 141) ────────────────────────────────
 *
 * The case this screen was BUILT for is the one it served worst. When the
 * signed-in account is not on the roster — invited at a work address, signed in
 * with the Google account they carry on their phone — `viewerCanSee` is false,
 * so the only offer above is "sign out and use an address you may not want".
 * A dead end on the front door.
 *
 * `claimable` adds the missing move: attach the placeholder to the account
 * they are already in. It is a SECOND, EXPLICIT action after authenticating,
 * and the confirm step NAMES the placeholder — that sentence is the whole
 * narrowing on a token that can be forwarded. Someone who was forwarded this
 * link reads a name that is not theirs and stops.
 *
 * The plain "Continue as …" stays exactly as it was. Continuing without
 * claiming is legitimate, and a claim is not something to be nudged into.
 */
export default function IdentityChoice({
  tripName,
  inviterName,
  invitedEmail,
  next,
  token,
  viewerEmail,
  viewerCanSee,
  claimable,
}: {
  tripName: string;
  inviterName: string | null;
  invitedEmail: string;
  next: string;
  token: string;
  viewerEmail: string | null;
  viewerCanSee: boolean;
  /** The placeholder this token names, when it is still claimable BY THIS
   *  viewer. Already null in the cases the RPC would refuse — the page decides
   *  that, so this component never renders an offer that cannot succeed. */
  claimable: { name: string } | null;
}) {
  const router = useRouter();
  const [switching, setSwitching] = useState(false);
  const [confirming, setConfirming] = useState(false);

  const claim = trpc.invites.claim.useMutation({
    onSuccess: (res) => {
      // Straight to the trip. `router.refresh()` first so the server components
      // re-resolve with the membership the claim just created — without it the
      // trip page can paint against a cache that predates the merge.
      router.refresh();
      router.replace(next || `/trips/${res.tripId}`);
    },
  });

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
          {/* Suppressed while confirming: the panel below restates both
              addresses, and saying each of them twice on one screen makes the
              reader skim past the pair that actually needs checking. */}
          {!(confirming && claimable) && (
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
          )}
        </div>

        {confirming && claimable ? (
          /* ── The consent step ──────────────────────────────────────────
             Says what will happen, names both identities, and re-states the
             address the invite went to. A person who was forwarded this link
             reads someone else's name here and backs out. */
          <div className="space-y-4">
            {/* The two facts a person has to check are a NAME and an ADDRESS.
                In prose they read as filler and get skimmed; as labelled rows
                they read as a form of identification, which is what they are.
                Someone who was forwarded this link sees a name that is not
                theirs next to an address that is not theirs. */}
            <div
              className="rounded-xl border px-4 py-3"
              style={{ borderColor: "var(--color-bt-border)" }}
            >
              <dl className="space-y-2.5 text-sm">
                <div className="flex items-baseline justify-between gap-3">
                  <dt style={{ color: "var(--color-bt-text-dim)" }}>You&apos;d join as</dt>
                  <dd
                    className="text-right font-semibold"
                    style={{ color: "var(--color-bt-text)" }}
                  >
                    {claimable.name}
                  </dd>
                </div>
                <div className="flex items-baseline justify-between gap-3">
                  <dt style={{ color: "var(--color-bt-text-dim)" }}>Invite was sent to</dt>
                  <dd
                    className="break-all text-right font-mono text-[12px]"
                    style={{ color: "var(--color-bt-text)" }}
                  >
                    {invitedEmail}
                  </dd>
                </div>
                <div className="flex items-baseline justify-between gap-3">
                  <dt style={{ color: "var(--color-bt-text-dim)" }}>You&apos;re signed in as</dt>
                  <dd
                    className="break-all text-right font-mono text-[12px]"
                    style={{ color: "var(--color-bt-text)" }}
                  >
                    {viewerEmail ?? "this account"}
                  </dd>
                </div>
              </dl>
            </div>

            <p className="text-sm" style={{ color: "var(--color-bt-text-dim)" }}>
              Any scores already entered for {claimable.name} become yours. Only continue if that
              invite was meant for you.
            </p>

            {claim.error && (
              <p className="text-sm" style={{ color: "var(--color-bt-warning)" }}>
                {claim.error.message}
              </p>
            )}

            <div className="space-y-2">
              <button
                type="button"
                onClick={() => claim.mutate({ token })}
                disabled={claim.isPending}
                className="flex w-full items-center justify-center gap-2 rounded-xl py-3 text-sm font-semibold transition-opacity hover:opacity-90 disabled:opacity-40"
                style={{ background: "var(--color-bt-accent)", color: "var(--color-bt-base)" }}
              >
                {claim.isPending && <Loader2 size={16} className="animate-spin" />}
                Yes — I&apos;m {claimable.name}
              </button>

              <button
                type="button"
                onClick={() => setConfirming(false)}
                disabled={claim.isPending}
                className="w-full rounded-xl border px-4 py-2.5 text-sm transition-opacity hover:opacity-90 disabled:opacity-40"
                style={{
                  borderColor: "var(--color-bt-border)",
                  color: "var(--color-bt-text-dim)",
                }}
              >
                Back
              </button>
            </div>
          </div>
        ) : (
          <div className="space-y-2">
            {claimable && (
              <button
                type="button"
                onClick={() => setConfirming(true)}
                className="w-full rounded-xl py-3 text-sm font-semibold transition-opacity hover:opacity-90"
                style={{ background: "var(--color-bt-accent)", color: "var(--color-bt-base)" }}
              >
                Continue as {viewerEmail ?? "this account"} and join as {claimable.name}
              </button>
            )}

            {viewerCanSee && (
              <button
                type="button"
                onClick={() => router.replace(next)}
                className="w-full rounded-xl py-3 text-sm font-semibold transition-opacity hover:opacity-90"
                style={
                  claimable
                    ? {
                        background: "transparent",
                        border: "1px solid var(--color-bt-border)",
                        color: "var(--color-bt-text-dim)",
                        fontWeight: 400,
                      }
                    : { background: "var(--color-bt-accent)", color: "var(--color-bt-base)" }
                }
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
                background: viewerCanSee || claimable ? "transparent" : "var(--color-bt-accent)",
                borderColor:
                  viewerCanSee || claimable ? "var(--color-bt-border)" : "transparent",
                color:
                  viewerCanSee || claimable ? "var(--color-bt-text-dim)" : "var(--color-bt-base)",
                fontWeight: viewerCanSee || claimable ? 400 : 600,
              }}
            >
              {switching && <Loader2 size={16} className="animate-spin" />}
              Sign out and use {invitedEmail}
            </button>
          </div>
        )}
      </div>
    </InviteShell>
  );
}
