import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Delete test trips and everything hanging off them, in the order that works
 * (children without a cascade first). Returns one line per failed delete
 * instead of dropping it: an unchecked delete here is how trips used to
 * survive a "clean" run without anybody knowing (#1516).
 */
// `idea_comments` and `reservations` were deleted here for months after migration
// 023 dropped them: every call errored and nothing checked (#1516 found it).
export async function deleteTestTrips(admin: SupabaseClient, tripIds: string[]): Promise<string[]> {
  const failures: string[] = [];
  const check = (what: string, tripId: string, r: { error: { message: string } | null }) => {
    if (r.error) failures.push(`${tripId} ${what}: ${r.error.message}`);
  };
  for (const tripId of tripIds) {
    check("messages", tripId, await admin.from("messages").delete().eq("trip_id", tripId));
    check("idea_votes", tripId, await admin.from("idea_votes").delete().eq("trip_id", tripId));
    check("ideas", tripId, await admin.from("ideas").delete().eq("trip_id", tripId));
    const windows = await admin.from("date_windows").select("id").eq("trip_id", tripId);
    check("date_windows read", tripId, windows);
    for (const win of windows.data ?? []) {
      check("date_poll_votes", tripId, await admin.from("date_poll_votes").delete().eq("window_id", win.id));
    }
    check("date_windows", tripId, await admin.from("date_windows").delete().eq("trip_id", tripId));
    const expenses = await admin.from("expenses").select("id").eq("trip_id", tripId);
    check("expenses read", tripId, expenses);
    const expenseIds = (expenses.data ?? []).map((e: { id: string }) => e.id);
    if (expenseIds.length > 0) {
      check("expense_splits", tripId, await admin.from("expense_splits").delete().in("expense_id", expenseIds));
    }
    check("expenses", tripId, await admin.from("expenses").delete().eq("trip_id", tripId));
    check("quick_info_tiles", tripId, await admin.from("quick_info_tiles").delete().eq("trip_id", tripId));
    check("trip_members", tripId, await admin.from("trip_members").delete().eq("trip_id", tripId));
    check("trips", tripId, await admin.from("trips").delete().eq("id", tripId));
  }
  return failures;
}
