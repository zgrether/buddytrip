export const dynamic = "force-dynamic";

import LoginClient from "./LoginClient";
import { safeNextPath } from "@/lib/nextPath";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ mode?: string; next?: string }>;
}) {
  const params = await searchParams;
  const initialMode = params.mode === "signup" ? "signup" : "signin";
  // `?next=` — where an involuntary session expiry bounced the user from
  // (authExpiry.ts). Validated same-origin here so an unchecked value can never
  // reach a redirect; an invalid one is dropped and login lands on "/" as usual.
  const next = safeNextPath(params.next);
  return <LoginClient initialMode={initialMode} next={next} />;
}
