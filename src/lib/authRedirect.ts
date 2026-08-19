import { safeNextPath } from "./nextPath";

/**
 * Building the URL Supabase sends people back to.
 *
 * Every flow that leaves the app and comes back — OAuth, magic link, and the
 * signup CONFIRMATION EMAIL — hands Supabase a `redirect_to`, which Supabase
 * puts in the link it mails and bounces the browser to once the token is
 * verified. `/auth/callback` establishes the session there and then honors
 * `?next=`. So the whole "signup → confirmation email → callback → the trip"
 * chain is carried by one query param surviving one round trip through
 * Supabase, and this is the single place it is built.
 *
 * Extracted from `LoginClient` so the hop can be unit-tested. It previously
 * lived inline as a hardcoded `?next=/dashboard` on the signup call, which is
 * exactly why an invited person's confirmation email landed them on the
 * dashboard instead of the trip they had just been invited to.
 */

/** Where an unaddressed signup should land. Deliberately kept: landing on the
 *  dashboard after confirming is the correct FALLBACK when a link doesn't name
 *  somewhere better. It is a default, not a bug. */
export const DEFAULT_SIGNUP_DESTINATION = "/dashboard";

/**
 * `${origin}/auth/callback` with a validated `?next=`, or bare when there is
 * nowhere in particular to go. `next` is re-validated here even though callers
 * validate it server-side: this is the value that ends up in an emailed URL,
 * and deny-by-default at every layer is cheaper than reasoning about which
 * caller checked (`safeNextPath` refuses anything that isn't plainly a rooted
 * same-origin path — see `nextPath.ts` for the open-redirect it exists to stop).
 */
export function authCallbackUrl(origin: string, next: string | null | undefined): string {
  const safe = safeNextPath(next);
  const base = `${origin}/auth/callback`;
  return safe ? `${base}?next=${encodeURIComponent(safe)}` : base;
}

/**
 * The `emailRedirectTo` for signup confirmation. Same as above but with the
 * dashboard fallback applied, so a plain signup keeps working exactly as it
 * did and only an addressed one is redirected somewhere specific.
 */
export function signupConfirmationUrl(origin: string, next: string | null | undefined): string {
  return authCallbackUrl(origin, safeNextPath(next) ?? DEFAULT_SIGNUP_DESTINATION);
}
