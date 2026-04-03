"use client";

import { useEffect, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { AlertCircle, Check, Loader2 } from "lucide-react";
import { createClient } from "@/lib/supabase";

type InviteState =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "already-accepted" }
  | { kind: "processing"; tripName: string }
  | { kind: "success"; tripId: string; tripName: string };

export default function InvitePage() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const token = searchParams.get("token");
  const [state, setState] = useState<InviteState>({ kind: "loading" });

  useEffect(() => {
    if (!token) {
      setState({ kind: "error", message: "No invite token provided." });
      return;
    }

    async function processInvite() {
      const supabase = createClient();

      // Check if user is logged in
      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (!session?.user) {
        // Not logged in — store token and redirect to login
        sessionStorage.setItem("pendingInviteToken", token!);
        router.push(`/login`);
        return;
      }

      // User is logged in — validate token
      const { data: invite, error } = await supabase
        .from("invites")
        .select("id, trip_id, email, role, accepted_at, expires_at, trips(title)")
        .eq("token", token!)
        .single();

      if (error || !invite) {
        setState({
          kind: "error",
          message: "This invite link has expired or isn't valid.",
        });
        return;
      }

      if (invite.accepted_at) {
        setState({ kind: "already-accepted" });
        return;
      }

      const expiresAt = new Date(invite.expires_at);
      if (expiresAt < new Date()) {
        setState({
          kind: "error",
          message: "This invite link has expired.",
        });
        return;
      }

      const tripData = invite.trips as unknown as { title: string } | null;
      const tripName = tripData?.title ?? "the trip";

      setState({ kind: "processing", tripName });

      // Mark invite as accepted
      await supabase
        .from("invites")
        .update({ accepted_at: new Date().toISOString() })
        .eq("id", invite.id);

      // Check if already a member
      const { data: existingMember } = await supabase
        .from("trip_members")
        .select("user_id")
        .eq("trip_id", invite.trip_id)
        .eq("user_id", session.user.id)
        .maybeSingle();

      if (!existingMember) {
        // Add to trip
        await supabase.from("trip_members").insert({
          trip_id: invite.trip_id,
          user_id: session.user.id,
          role: invite.role,
          status: "in",
        });
      }

      setState({ kind: "success", tripId: invite.trip_id, tripName });

      // Auto-redirect after 1.5 seconds
      setTimeout(() => {
        router.push(`/trips/${invite.trip_id}`);
      }, 1500);
    }

    processInvite();
  }, [token, router]);

  return (
    <div
      className="flex min-h-screen items-center justify-center px-4"
      style={{ background: "var(--color-bt-base)" }}
    >
      <div
        className="w-full max-w-[400px] rounded-xl border px-6 py-8 text-center"
        style={{
          background: "var(--color-bt-card)",
          borderColor: "var(--color-bt-border)",
        }}
      >
        {/* Loading */}
        {state.kind === "loading" && (
          <div className="space-y-4">
            <Loader2
              size={32}
              className="mx-auto animate-spin"
              style={{ color: "var(--color-bt-accent)" }}
            />
            <p className="text-sm" style={{ color: "var(--color-bt-text-dim)" }}>
              Getting your invite ready...
            </p>
          </div>
        )}

        {/* Error */}
        {state.kind === "error" && (
          <div className="space-y-4">
            <AlertCircle
              size={32}
              className="mx-auto"
              style={{ color: "var(--color-bt-danger)" }}
            />
            <div>
              <h2
                className="text-lg font-semibold"
                style={{ color: "var(--color-bt-text)" }}
              >
                Invite not found
              </h2>
              <p
                className="mt-2 text-sm"
                style={{ color: "var(--color-bt-text-dim)" }}
              >
                {state.message}
              </p>
            </div>
            <button
              onClick={() => router.push("/login")}
              className="rounded-xl px-6 py-2.5 text-sm font-semibold transition-opacity hover:opacity-90"
              style={{
                background: "var(--color-bt-accent)",
                color: "var(--color-bt-base)",
              }}
            >
              Go to BuddyTrip
            </button>
          </div>
        )}

        {/* Already accepted */}
        {state.kind === "already-accepted" && (
          <div className="space-y-4">
            <Check
              size={32}
              className="mx-auto"
              style={{ color: "var(--color-bt-accent)" }}
            />
            <div>
              <h2
                className="text-lg font-semibold"
                style={{ color: "var(--color-bt-text)" }}
              >
                Already accepted
              </h2>
              <p
                className="mt-2 text-sm"
                style={{ color: "var(--color-bt-text-dim)" }}
              >
                This invite has already been accepted.
              </p>
            </div>
            <button
              onClick={() => router.push("/login")}
              className="rounded-xl px-6 py-2.5 text-sm font-semibold transition-opacity hover:opacity-90"
              style={{
                background: "var(--color-bt-accent)",
                color: "var(--color-bt-base)",
              }}
            >
              Sign in to BuddyTrip
            </button>
          </div>
        )}

        {/* Processing */}
        {state.kind === "processing" && (
          <div className="space-y-4">
            <Loader2
              size={32}
              className="mx-auto animate-spin"
              style={{ color: "var(--color-bt-accent)" }}
            />
            <p className="text-sm" style={{ color: "var(--color-bt-text-dim)" }}>
              Joining {state.tripName}...
            </p>
          </div>
        )}

        {/* Success */}
        {state.kind === "success" && (
          <div className="space-y-4">
            <div
              className="mx-auto flex h-12 w-12 items-center justify-center rounded-full"
              style={{ background: "var(--color-bt-tag-bg)" }}
            >
              <Check size={24} style={{ color: "var(--color-bt-accent)" }} />
            </div>
            <div>
              <h2
                className="text-lg font-semibold"
                style={{ color: "var(--color-bt-text)" }}
              >
                You&apos;re in!
              </h2>
              <p
                className="mt-2 text-sm"
                style={{ color: "var(--color-bt-text-dim)" }}
              >
                Taking you to {state.tripName}...
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
