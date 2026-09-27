import type { SupabaseClient } from "@supabase/supabase-js";
import { rowsOrThrow } from "@/server/lib/rowOrThrow";
import { readBoardInputs, boardRow, type BoardGameRow } from "@/server/lib/boardGames";

/**
 * A trip's SIDE games — games that count toward no competition — as board rows
 * (PR 6b, ruling 1: "a game needs no competition").
 *
 * The games page lists them in the same lifecycle sections as a cup's games, so
 * each row is built by the SAME `boardRow` the leaderboard uses; a side game is
 * Ready or Live on exactly the terms a cup game is.
 *
 * What a side game does NOT have is team points, so a finished one carries its
 * WINNERS instead — the completed table shows those in place of the team
 * columns, and never a row of zeros, which would read as a result (PR 6 plan).
 * Only the three formats that record a per-person result with no competition can
 * be side games (`allowedContainers`, #1493), and each banks its standing as
 * `position` on a `user` or `play_group` row, so position 1 is the winner.
 */
export interface SideBoardGame extends BoardGameRow {
  sideGame: true;
  /** Finished side games only: everyone at position 1 (a tie lists them all).
   *  A 2v2 side is one winner, named by its members. Empty until finished. */
  winners: string[];
}

export async function computeSideBoard(supabase: SupabaseClient, tripId: string): Promise<SideBoardGame[]> {
  const games = rowsOrThrow(
    await supabase
      .from("games")
      .select("*")
      .eq("trip_id", tripId)
      .is("competition_id", null)
      .order("display_order", { ascending: true, nullsFirst: false })
      .order("created_at", { ascending: true }),
    "trip's side games"
  ) as Record<string, unknown>[];
  if (games.length === 0) return [];

  const inputs = await readBoardInputs(supabase, games as Parameters<typeof readBoardInputs>[1], "trip's");
  const winnersByGame = await readSideGameWinners(
    supabase,
    tripId,
    games.filter((g) => g.status === "complete").map((g) => g.id as string)
  );

  return games.map((g) => ({
    ...boardRow(g as Parameters<typeof boardRow>[0], inputs, null),
    sideGame: true as const,
    winners: winnersByGame.get(g.id as string) ?? [],
  }));
}

/**
 * The winners of finished side games, named by trip display name: the Games
 * page's winner line, and the `game_finished` push for a side game (PR 6b), so
 * the two cannot name a winner differently. Position-1 `user` / `play_group`
 * rows; a 2v2 winner is named by the people in its play group.
 */
export async function readSideGameWinners(supabase: SupabaseClient, tripId: string, gameIds: string[]): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>();
  if (gameIds.length === 0) return out;

  const firsts = rowsOrThrow(
    await supabase
      .from("game_results")
      .select("game_id, entity_id, entity_type")
      .in("game_id", gameIds)
      .eq("position", 1)
      .in("entity_type", ["user", "play_group"]),
    "side games' results"
  ) as { game_id: string; entity_id: string; entity_type: string }[];
  if (firsts.length === 0) return out;

  // A 2v2 winner is a play group: name it by the people in it.
  const groupIds = firsts.filter((r) => r.entity_type === "play_group").map((r) => r.entity_id);
  const members = groupIds.length
    ? (rowsOrThrow(
        await supabase.from("game_participants").select("user_id, play_group_id").in("play_group_id", groupIds),
        "side games' pairs"
      ) as { user_id: string; play_group_id: string }[])
    : [];

  const userIds = [
    ...new Set([...firsts.filter((r) => r.entity_type === "user").map((r) => r.entity_id), ...members.map((m) => m.user_id)]),
  ];
  // The TRIP display name — a trip nickname first, then the account name — the
  // same resolution `tripMembers.list` gives every other name on the board.
  const [users, members2] = userIds.length
    ? await Promise.all([
        supabase.from("users").select("id, name").in("id", userIds),
        supabase.from("trip_members").select("user_id, nickname").eq("trip_id", tripId).in("user_id", userIds),
      ]).then(([u, m]) => [
        rowsOrThrow(u, "side game winners' names") as { id: string; name: string | null }[],
        rowsOrThrow(m, "side game winners' names") as { user_id: string; nickname: string | null }[],
      ] as const)
    : ([[], []] as const);
  const nickOf = new Map(members2.map((m) => [m.user_id, m.nickname]));
  const nameOf = new Map(users.map((u) => [u.id, nickOf.get(u.id) ?? u.name ?? "Someone"]));

  for (const r of firsts) {
    const label =
      r.entity_type === "play_group"
        ? members.filter((m) => m.play_group_id === r.entity_id).map((m) => nameOf.get(m.user_id) ?? "Someone").join(" & ") || "A pair"
        : nameOf.get(r.entity_id) ?? "Someone";
    const list = out.get(r.game_id) ?? [];
    list.push(label);
    out.set(r.game_id, list);
  }
  return out;
}
