import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";
import { GOLF_API_DAILY_LIMIT, GOLF_API_PROVIDER } from "@/lib/golfApiCap";

/**
 * Take one golfcourseapi call against today's cap, IN THE ROUTE that spends it.
 *
 * The cap used to be a separate tRPC call (`courses.recordApiCall`) that the
 * app was trusted to make before calling the route, so a request straight to
 * the route spent the key without counting. The server enforces its own limit
 * now, in the request that spends it.
 *
 * Returns null when the call may go ahead, or the response to send instead:
 *  - at the cap                      -> 429, and the call is not counted;
 *  - the counter could not be read   -> 503. A failed count is never "under
 *    the cap": the call does not go out.
 *
 * `record_api_call` checks and increments atomically, so two requests racing
 * at 49 cannot both pass.
 */
export async function takeGolfApiCall(): Promise<NextResponse | null> {
  try {
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("record_api_call", {
      p_provider: GOLF_API_PROVIDER,
      p_limit: GOLF_API_DAILY_LIMIT,
    });
    if (error || typeof data !== "number") {
      console.error("[golfApiCap] could not take a call:", error?.message ?? `unexpected ${String(data)}`);
      return NextResponse.json({ error: "course search unavailable" }, { status: 503 });
    }
    if (data < 0) {
      return NextResponse.json({ error: "course search is at today's limit", atCap: true }, { status: 429 });
    }
    return null;
  } catch (err) {
    console.error("[golfApiCap] could not take a call:", err);
    return NextResponse.json({ error: "course search unavailable" }, { status: 503 });
  }
}
