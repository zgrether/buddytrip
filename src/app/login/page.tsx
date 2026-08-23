export const dynamic = "force-dynamic";

import LoginClient, { type DeepLinkContext } from "./LoginClient";
import { safeNextPath } from "@/lib/nextPath";
import { resolveInviteLink } from "@/server/lib/inviteLink";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ mode?: string; next?: string; invite?: string }>;
}) {
  const params = await searchParams;

  // `?invite=` — a capability token that supplies CONTEXT: the trip's name, who
  // sent it, and the address to prefill. Resolved here, server-side, rather than
  // passed as query params, for two reasons: the anon client cannot read
  // `invites` at all (RLS), and display copy taken from the URL would be
  // attacker-authored text on an auth screen — "Zach invited you to X, sign in"
  // is a phishing template if anyone can write the X.
  const invite = params.invite ? await resolveInviteLink(params.invite) : null;

  // `?next=` — where to go once authed. Generic and pre-existing: an involuntary
  // session expiry (authExpiry.ts) and the middleware bounce both set it, and an
  // invite is simply a third producer. Validated same-origin so an unchecked
  // value can never reach a redirect; an invalid one falls back to the invite's
  // own target, then to "/".
  const next = safeNextPath(params.next) ?? invite?.target.path ?? null;

  // An invite whose address has no account is the one case where the page's
  // default mode is wrong: #980 is precisely "the invite link greets a new
  // person with Welcome back". An explicit ?mode= still wins, so switching
  // modes by hand survives a reload.
  const defaultMode = invite && !invite.addressee.hasAccount ? "signup" : "signin";
  const initialMode =
    params.mode === "signup" ? "signup" : params.mode === "signin" ? "signin" : defaultMode;

  const context: DeepLinkContext | null = invite
    ? {
        resourceName: invite.target.resourceName,
        inviterName: invite.inviterName,
        prefillEmail: invite.addressee.email,
        // Only set when a placeholder is actually standing and claimable, so the
        // sign-in offer the header makes is one the app can keep. It is the
        // claim (migration 141) that makes "sign in with the account you already
        // have" work at all — before that, the sentence would have been a lie.
        claimableName: invite.placeholder?.name ?? null,
      }
    : null;

  return <LoginClient initialMode={initialMode} next={next} context={context} />;
}
