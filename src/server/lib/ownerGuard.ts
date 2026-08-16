import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * The "don't orphan a trip" guard (#957).
 *
 * A trip whose only Owner loses their membership survives, populated, with
 * ZERO Owners — and every Owner-gated action becomes unreachable by anyone,
 * including `trips.delete` itself (`requireTripRole("Owner")` can never be
 * satisfied). The trip can then only be removed by direct SQL. #914 found five
 * trips in exactly that state.
 *
 * ── Why this is an application-layer predicate and not a DB trigger ─────────
 * A `BEFORE DELETE ON trip_members` trigger is the tempting structural fix and
 * it is WRONG here: `merge_guest_to_real_user` legitimately DELETEs a
 * membership row (the ghost's, when the real account is already on that trip)
 * and that merge runs INSIDE the `handle_new_user` signup trigger. A trigger
 * refusing the orphaning delete would also refuse the merge's delete — turning
 * a rare hazard into a **failed signup** for anyone with a colliding
 * placeholder.
 *
 * The general rule, worth keeping: **the database cannot distinguish a delete
 * that orphans a trip from a delete that is one step of a merge.** Same row,
 * same operation, different intent — and intent only exists at the layer that
 * knows why it is deleting.
 *
 * ── Why RLS doesn't cover it either ────────────────────────────────────────
 * The live policy is
 *   `(user_id = auth.uid()::text) OR has_trip_role(trip_id, ARRAY['Owner'])`
 * and an Owner removing THEIR OWN row satisfies both clauses. That is correct:
 * this is not a permission failure. The Owner IS allowed to do it. It is a
 * CONSEQUENCE failure, which is the shape this guard exists for — and the
 * reason it keys on the resulting state rather than on who is asking.
 */

export interface OrphanBlocker {
  tripId: string;
  title: string;
  /** A non-Owner, non-guest, status-"in" member exists to hand the trip to.
   *  Mirrors `TripSettingsModal`'s `transferCandidates` filter exactly — if the
   *  two drift, the refusal message points at a transfer the UI won't offer. */
  hasTransferTarget: boolean;
  /** Other members would be stranded. False = the user is alone on the trip. */
  hasOtherMembers: boolean;
}

/**
 * Trips that would be left with NO Owner if `userId` stopped being a member.
 *
 * Empty array = the removal is safe. Scope to one trip with `tripId` (the
 * per-trip callers); omit it for account-wide checks.
 *
 * A trip with a SECOND Owner is never blocking — the survivor keeps the trip
 * administrable, which is the whole thing being protected.
 */
export async function findOrphanBlockers(
  supabase: SupabaseClient,
  userId: string,
  opts: { tripId?: string } = {}
): Promise<OrphanBlocker[]> {
  // Trips this user owns (optionally just the one being acted on).
  let ownedQ = supabase
    .from("trip_members")
    .select("trip_id")
    .eq("user_id", userId)
    .eq("role", "Owner");
  if (opts.tripId) ownedQ = ownedQ.eq("trip_id", opts.tripId);

  const { data: owned, error: ownedErr } = await ownedQ;
  if (ownedErr) throw new Error(`Failed to read trip ownership: ${ownedErr.message}`);
  const tripIds = [...new Set((owned ?? []).map((r) => r.trip_id as string))];
  if (tripIds.length === 0) return [];

  // One read for every member of every candidate trip — not per-trip, so this
  // stays two queries regardless of how many trips the user owns.
  const { data: rosters, error: rosterErr } = await supabase
    .from("trip_members")
    .select("trip_id, user_id, role, status, users!inner(is_guest)")
    .in("trip_id", tripIds);
  if (rosterErr) throw new Error(`Failed to read trip rosters: ${rosterErr.message}`);

  const { data: trips, error: tripsErr } = await supabase
    .from("trips")
    .select("id, title")
    .in("id", tripIds);
  if (tripsErr) throw new Error(`Failed to read trips: ${tripsErr.message}`);
  const titleOf = new Map((trips ?? []).map((t) => [t.id as string, (t.title as string) ?? "Untitled trip"]));

  type Row = {
    trip_id: string;
    user_id: string;
    role: string;
    status: string | null;
    users: { is_guest: boolean } | { is_guest: boolean }[] | null;
  };
  const isGuest = (r: Row) => {
    const u = r.users;
    return Array.isArray(u) ? !!u[0]?.is_guest : !!u?.is_guest;
  };

  const blockers: OrphanBlocker[] = [];
  for (const tripId of tripIds) {
    const roster = ((rosters ?? []) as unknown as Row[]).filter((r) => r.trip_id === tripId);
    const owners = roster.filter((r) => r.role === "Owner");
    // Another Owner remains → nothing is orphaned.
    if (owners.length > 1) continue;

    const others = roster.filter((r) => r.user_id !== userId);
    blockers.push({
      tripId,
      title: titleOf.get(tripId) ?? "Untitled trip",
      hasOtherMembers: others.length > 0,
      hasTransferTarget: others.some((r) => r.role !== "Owner" && !isGuest(r) && r.status === "in"),
    });
  }
  return blockers;
}

/**
 * The refusal message. Branches on whether a transfer is actually POSSIBLE,
 * because "transfer ownership first" is a dead end when there is nobody
 * eligible to transfer to — the user would have no move at all.
 *
 * Both branches name the specific trips, so the message is actionable without
 * a support request (§4.4).
 */
export function orphanRefusalMessage(blockers: OrphanBlocker[], action: "delete-account" | "leave-trip"): string {
  const names = blockers.map((b) => `"${b.title}"`).join(", ");
  const plural = blockers.length > 1;
  const subject = action === "delete-account" ? "delete your account" : "leave";

  const transferable = blockers.filter((b) => b.hasTransferTarget);
  const stuck = blockers.filter((b) => !b.hasTransferTarget);

  // Every blocker has somewhere to go — the normal path.
  if (stuck.length === 0) {
    return (
      `You're the only Owner of ${plural ? "these trips" : "this trip"}: ${names}. ` +
      `Transfer ownership to another member first, then ${subject} — otherwise ` +
      `${plural ? "they'd be left" : "it would be left"} with no Owner and nobody could manage ` +
      `${plural ? "them" : "it"} again.`
    );
  }

  // At least one trip has nobody eligible. Say so plainly and give the real
  // exit rather than implying an option that doesn't exist.
  const stuckNames = stuck.map((b) => `"${b.title}"`).join(", ");
  const onlyGuests = stuck.some((b) => b.hasOtherMembers);
  const stuckClause = onlyGuests
    ? `${stuck.length > 1 ? "have" : "has"} no other full member to hand ${stuck.length > 1 ? "them" : "it"} to ` +
      `(placeholder crew can't own a trip)`
    : `${stuck.length > 1 ? "have" : "has"} no other members`;

  const parts = [
    `You're the only Owner of ${stuckNames}, which ${stuckClause}. ` +
      `Delete ${stuck.length > 1 ? "those trips" : "that trip"} first, then ${subject}.`,
  ];
  if (transferable.length > 0) {
    parts.push(
      `You'll also need to transfer ownership of ${transferable.map((b) => `"${b.title}"`).join(", ")}.`
    );
  }
  return parts.join(" ");
}
