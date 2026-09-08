import { cookies } from "next/headers";
import DashboardClient from "./DashboardClient";
import { isQuickGameFormat } from "@/lib/quickGame";

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
export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const lastTripId = (await cookies()).get("bt-last-trip-id")?.value ?? null;
  /**
   * `?setup=<format>` — "open this Quick Game tile's setup sheet on arrival".
   *
   * Written by the round's own Reset game / Play again, which send you back to
   * the tile you started from rather than to a second setup screen. Read on the
   * SERVER for the same reason `lastTripId` is: this page already established
   * that handing a first-render fact down as a prop beats an effect that
   * discovers it afterwards, and the client half of this one has to open a
   * modal, where a cascading render is a history entry in the wrong place.
   *
   * VALIDATED, not passed through — the shared `isQuickGameFormat`, so a hand-
   * typed `?setup=nonsense` opens nothing instead of a sheet for a format that
   * does not exist.
   */
  const setup = (await searchParams).setup;
  return (
    <DashboardClient
      lastTripId={lastTripId}
      openSetupFormat={isQuickGameFormat(setup) ? setup : null}
    />
  );
}
