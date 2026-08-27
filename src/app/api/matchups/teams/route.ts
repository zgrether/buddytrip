import { NextRequest, NextResponse } from "next/server";
import { leagueById, normalizeTeams, teamsUrl, type MatchupTeam } from "@/lib/matchupApi";

/**
 * GET /api/matchups/teams?league=cfb
 *
 * The team index, normalized. Proxied rather than fetched from the browser for
 * one reason that matters: ESPN's college-football list is **1.85 MB** of raw
 * JSON for 759 teams, and the client needs four fields per team. Normalizing
 * here turns that into ~45 KB.
 *
 * Cached for 24h. ESPN's team lists move about once a year (a school changes
 * conference, a franchise relocates), so this is generous rather than tight —
 * and keeping volume low is part of the deal with an undocumented endpoint.
 *
 * FAILS TO EMPTY, never to an error. `[]` means the search box finds nothing
 * and the runner types the game, which is the base case anyway. A 500 here
 * would take a working manual form down with it.
 */
const REVALIDATE_SECONDS = 60 * 60 * 24;

export async function GET(req: NextRequest) {
  const league = leagueById(req.nextUrl.searchParams.get("league"));
  if (!league) return NextResponse.json([] satisfies MatchupTeam[]);

  try {
    const res = await fetch(teamsUrl(league), {
      next: { revalidate: REVALIDATE_SECONDS },
      headers: { accept: "application/json" },
    });
    if (!res.ok) return NextResponse.json([] satisfies MatchupTeam[]);
    return NextResponse.json(normalizeTeams(await res.json(), league.id));
  } catch {
    // Unreachable, DNS-blocked, timed out — all the same answer to the caller.
    return NextResponse.json([] satisfies MatchupTeam[]);
  }
}
