import type { SupabaseClient } from "@supabase/supabase-js";
import { deleteTestTrips } from "./deleteTestTrips";

/**
 * What a test run leaves behind, found and removed at the end of the run (#1516).
 *
 * Measured 2026-09-28: every full run left ~6 trips, ~16 guest users and ~370
 * `push_send_log` rows in the local stack, which reached 972 trips and made the
 * local suite red on every run for reasons that were not regressions.
 *
 * Runs in the global TEARDOWN, after every file has finished, so it cannot race
 * a test still using a row. It only touches rows CREATED DURING THIS RUN
 * (`created_at >= since`), so hand-built look fixtures and earlier data are safe.
 *
 *  - TRIPS are a LEAK: TestContext tracks every trip it creates, so one surviving
 *    the run means a file's cleanup missed it. They are reported by title (which
 *    names the file) and removed; in CI a leaked trip FAILS the run, so a new leak
 *    is loud rather than quietly swept (the caller decides, see `global-setup`).
 *  - GUESTS are not a leak in the same sense: the app's own invite / claim /
 *    placeholder procedures mint them, and no test holds their ids. Removed when
 *    they belong to no trip any more.
 *  - `push_send_log` is append-only by design; a run's rows are removed.
 *
 * Caveat, stated rather than hidden: a SECOND test run against the same stack
 * in the same window would have its rows swept too. CLAUDE.md already says not
 * to run concurrent suites against the shared local stack; CI has its own.
 */
export type SweepReport = {
  leakedTrips: { id: string; title: string }[];
  guestsRemoved: number;
  sendLogRemoved: number;
  failures: string[];
};

export async function sweepRunLeftovers(admin: SupabaseClient, sinceIso: string): Promise<SweepReport> {
  const failures: string[] = [];

  const trips = await admin
    .from("trips")
    .select("id, title")
    .like("id", "test-trip-%")
    .gte("created_at", sinceIso);
  if (trips.error) failures.push(`read trips: ${trips.error.message}`);
  const leakedTrips = (trips.data ?? []) as { id: string; title: string }[];
  failures.push(...(await deleteTestTrips(admin, leakedTrips.map((t) => t.id))));

  // Guests minted during the run that no trip holds any more. Read the
  // candidates, then keep only those with no membership, so a guest still on a
  // (fixture) trip is never touched.
  let guestsRemoved = 0;
  const guests = await admin.from("users").select("id").eq("is_guest", true).gte("created_at", sinceIso);
  if (guests.error) failures.push(`read guests: ${guests.error.message}`);
  const guestIds = ((guests.data ?? []) as { id: string }[]).map((g) => g.id);
  if (guestIds.length > 0) {
    const held = await admin.from("trip_members").select("user_id").in("user_id", guestIds);
    if (held.error) {
      failures.push(`read guest memberships: ${held.error.message}`);
    } else {
      const heldIds = new Set(((held.data ?? []) as { user_id: string }[]).map((m) => m.user_id));
      const orphans = guestIds.filter((id) => !heldIds.has(id));
      if (orphans.length > 0) {
        const del = await admin.from("users").delete({ count: "exact" }).in("id", orphans);
        if (del.error) failures.push(`delete guests: ${del.error.message}`);
        else guestsRemoved = del.count ?? 0;
      }
    }
  }

  let sendLogRemoved = 0;
  const log = await admin.from("push_send_log").delete({ count: "exact" }).gte("created_at", sinceIso);
  if (log.error) failures.push(`delete push_send_log: ${log.error.message}`);
  else sendLogRemoved = log.count ?? 0;

  return { leakedTrips, guestsRemoved, sendLogRemoved, failures };
}
