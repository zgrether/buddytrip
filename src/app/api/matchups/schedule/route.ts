import { NextRequest, NextResponse } from "next/server";
import { leagueById, normalizeSchedule, scheduleUrl, type Matchup } from "@/lib/matchupApi";
import { routeCaller } from "@/server/lib/routeCaller";

/** Backstop against a stalled upstream (#1258). The reasoning, and why 60 and
 *  not less, is on the tRPC route — that is the one whose value also bounds
 *  `afterResponse` work. */
export const maxDuration = 60;

/**
 * GET /api/matchups/schedule?league=cfb&teamId=194
 *
 * One team's schedule, normalized to `{ espnEventId, away, home, startsAt,
 * neutralSite }`. THE ONLY endpoint a keystroke can eventually reach — search
 * itself runs locally against the cached index, so this fires on selection, not
 * on typing.
 *
 * Cached for 6h rather than 24: a schedule can move (weather, a network flex)
 * where a team list effectively cannot.
 *
 * Fails to empty for the same reason as the team route — manual entry is the
 * base case and must not be taken down by an unofficial API having a bad day.
 */
const REVALIDATE_SECONDS = 60 * 60 * 6;

export async function GET(req: NextRequest) {
  // The route decides who is calling, not the middleware: see routeCaller.ts.
  const caller = await routeCaller();
  if (!caller.ok) return caller.response;
  const league = leagueById(req.nextUrl.searchParams.get("league"));
  const teamId = req.nextUrl.searchParams.get("teamId")?.trim();
  if (!league || !teamId) return NextResponse.json([] satisfies Matchup[]);

  try {
    const res = await fetch(scheduleUrl(league, teamId), {
      next: { revalidate: REVALIDATE_SECONDS },
      headers: { accept: "application/json" },
    });
    // ESPN unreachable or refusing is an ERROR status, never `[]` (#1611). A
    // team's schedule can really be empty, so `[]` must mean only that; the
    // picker used to render a failure as "No games found".
    if (!res.ok) return NextResponse.json({ error: "schedule unavailable" }, { status: 502 });
    return NextResponse.json(normalizeSchedule(await res.json()));
  } catch {
    return NextResponse.json({ error: "schedule unavailable" }, { status: 502 });
  }
}
