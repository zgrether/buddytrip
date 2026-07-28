import { cookies } from "next/headers";
import DashboardClient from "./DashboardClient";

export const dynamic = "force-dynamic";

/**
 * The Home tab's host.
 *
 * Reads `bt-last-trip-id` on the SERVER and hands it down, so the shell's
 * Trip/Cup/Chat tabs can point at the trip the user was last in — Home is
 * "switch context", not "leave context". Reading the cookie here rather than
 * `localStorage` in an effect avoids both a hydration mismatch (the server would
 * render locked tabs, the client unlocked ones) and a cascading render.
 *
 * It is the SAME cookie the root route uses for its last-trip redirect (IA-2),
 * so the two can't disagree about which trip is "current". The client still
 * validates it against the user's actual trips — a pointer at a deleted or
 * revoked trip must not offer tabs that lead nowhere.
 */
export default async function DashboardPage() {
  const lastTripId = (await cookies()).get("bt-last-trip-id")?.value ?? null;
  return <DashboardClient lastTripId={lastTripId} />;
}
