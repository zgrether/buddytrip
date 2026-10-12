import { buildDecided, buildDecidedFromOutcomes, matchState, strokeHoles, type HoleOutcomeRow } from "@/lib/matchPlay";
import { gloriousConfig } from "@/lib/gloriousHoles";
import { effectiveStrokes } from "@/lib/handicap";
import { playerStats } from "@/lib/rackNStack";
import { getGameTypeDefinition } from "@/lib/gameTypes";
import { skinsGloriousConfig, tallyGrouping } from "@/lib/skins";
import { computeStrokeLeaderboard, netStrokeEntriesByHole } from "@/lib/strokePlay";
import { strokeIndexOf, unitsFromSchema } from "@/lib/strokePlayConfig";
import { scoringOf } from "@/lib/stableford";
import { thruLabel } from "@/lib/thruLabel";
import { sheetPoints, resolvedCount, type ScoredPick, type ScoredSlateGame } from "@/lib/pickemScoring";
import { isMatchesGame, isPickemGame } from "@/lib/resultStrategy";
import type { OwnStanding } from "@/lib/ownStanding";
import { MATCH_PLAY_TYPES, RACK_TYPE, SCRAMBLE_TYPE, SKINS_TYPE } from "@/server/lib/gameReadiness";
import type { GameProjectionData, LiveProjectionInput } from "@/server/lib/liveProjection";

const STROKE_TYPE = "gtt_stroke_play";

type Side = { type: string; id: string } | null;

/**
 * The VIEWER's own standing in one live game (#1599), from the data the board's
 * live-projection pass already read. Pure: no reads, no other player's value in
 * the result.
 *
 * Returns null when the viewer isn't PLAYING in the game (running it as a
 * delegate isn't playing), or for a format with no live standing. It sits
 * OUTSIDE the projection's early returns on purpose: a game that pays nothing
 * (`no_points`) or ranks only a complete round (`round_incomplete`) still has a
 * standing for the person playing it.
 *
 * Each arm calls the same pure function the game's own page and finalize use,
 * so the card can't disagree with the scorecard.
 */
export function computeOwnStanding(
  g: LiveProjectionInput,
  data: GameProjectionData & { config?: unknown },
  viewerId: string
): OwnStanding | null {
  const t = g.gameTypeId;
  const me = data.parts.find((p) => p.user_id === viewerId) ?? null;
  // A side is the viewer's when it IS them (1v1) or their play group (2v2).
  const isMine = (s: Side) =>
    !!s?.id && (s.type === "play_group" ? s.id === me?.play_group_id : s.id === viewerId);

  if (isPickemGame(t, g.competitionFormat)) return pickemStanding(data, viewerId, me != null);
  if (isMatchesGame(t, g.competitionFormat)) {
    const m = data.matches.find((x) => isMine(x.side_a) || isMine(x.side_b));
    if (!m) return null;
    if (m.result == null) return { kind: "result", result: "pending" };
    if (m.result === "halve") return { kind: "result", result: "tied" };
    const mineIsA = isMine(m.side_a);
    return { kind: "result", result: (m.result === "a_win") === mineIsA ? "won" : "lost" };
  }
  if (!me) return null;
  if (t && MATCH_PLAY_TYPES.has(t)) return matchStanding(g, data, isMine);
  if (t === RACK_TYPE) return rackStanding(g, data, me);
  if (t === SKINS_TYPE) return skinsStanding(g, data, viewerId, me.play_group_id);
  if (t === STROKE_TYPE || t === SCRAMBLE_TYPE) return strokeStanding(t, data, viewerId, me);
  return null;
}

function matchStanding(g: LiveProjectionInput, data: GameProjectionData, isMine: (s: Side) => boolean): OwnStanding | null {
  const m = data.matches.find((x) => x.side_a?.id && x.side_b?.id && (isMine(x.side_a) || isMine(x.side_b)));
  if (!m || !m.side_a || !m.side_b) return null; // in the game, on no paired match
  const schema = data.schema;
  const holeCount = schema?.units?.count;
  const glorious = gloriousConfig(g.gameTypeId, data.modifiers, g.outcomeMode ? "outcome" : "score");
  // The same build the projection and the match page run.
  const hcap = new Map<string, number>();
  for (const p of data.parts) hcap.set(p.user_id, effectiveStrokes(p));
  for (const pg of data.playGroups) hcap.set(pg.id, effectiveStrokes(pg));
  const decided = g.outcomeMode
    ? buildDecidedFromOutcomes(
        data.outcomes.filter((o) => o.match_id === m.id).map((o): HoleOutcomeRow => ({ hole: o.hole_number, result: o.result }))
      )
    : buildDecided(
        data.gross.get(m.side_a.id) ?? {},
        data.gross.get(m.side_b.id) ?? {},
        hcap.get(m.side_a.id) ?? 0,
        hcap.get(m.side_b.id) ?? 0,
        schema?.units?.metadata?.handicap_index,
        holeCount
      );
  const st = matchState(decided, holeCount, glorious);
  if (st.thru === 0 && !st.over) return { kind: "not_started" };
  const lead = isMine(m.side_a) ? st.diff : -st.diff;
  return { kind: "match", lead, thru: st.thru, over: st.over, margin: st.margin };
}

function rackStanding(g: LiveProjectionInput, data: GameProjectionData, me: GameProjectionData["parts"][number]): OwnStanding | null {
  // The same effective course the projection uses: the snapshot, else the format's default.
  let schema = data.schema;
  if (!schema?.units?.metadata?.par && g.gameTypeId) {
    schema = (getGameTypeDefinition(g.gameTypeId)?.scorecardSchema as typeof schema) ?? null;
  }
  const par = schema?.units?.metadata?.par;
  const strokeIndex = schema?.units?.metadata?.handicap_index;
  if (!par || !strokeIndex) return null;
  const s = playerStats(data.gross.get(me.user_id) ?? {}, effectiveStrokes(me), par, strokeIndex);
  if (s.thru === 0) return { kind: "not_started" };
  return { kind: "to_par", toPar: s.netToPar, thru: thruLabel(s.thru, par.length) };
}

function skinsStanding(g: LiveProjectionInput, data: GameProjectionData, viewerId: string, groupingId: string | null): OwnStanding | null {
  if (!groupingId) return null; // in the game, in no grouping: outside the field
  const holeCount = unitsFromSchema(data.schema as Parameters<typeof unitsFromSchema>[0]).length || 18;
  const tally = tallyGrouping(groupingId, data.skins?.[groupingId] ?? [], holeCount, skinsGloriousConfig(g.gameTypeId, data.modifiers));
  // The GROUP's holes recorded: skins are decided per hole for the whole group.
  const played = tally.lines.filter((l) => l.status !== "unplayed").length;
  if (played === 0) return { kind: "not_started" };
  return { kind: "skins", skins: tally.skinsBy[viewerId] ?? 0, thru: thruLabel(played, holeCount) };
}

function strokeStanding(
  t: string,
  data: GameProjectionData & { config?: unknown },
  viewerId: string,
  me: GameProjectionData["parts"][number]
): OwnStanding | null {
  // Scramble keys its score to the viewer's GROUP; stroke play to the viewer.
  const scramble = t === SCRAMBLE_TYPE;
  const unitId = scramble ? me.play_group_id : viewerId;
  if (!unitId) return null;
  const handicap = scramble
    ? effectiveStrokes(data.playGroups.find((pg) => pg.id === unitId) ?? {})
    : effectiveStrokes(me);
  const units = unitsFromSchema(data.schema as Parameters<typeof unitsFromSchema>[0]);
  const stroked = new Set([...strokeHoles(handicap, strokeIndexOf(units))].map(String));
  const raw = Object.entries(data.gross.get(unitId) ?? {}).map(([unit_label, value]) => ({ participant_id: unitId, unit_label, value }));
  const parByHole = Object.fromEntries(units.map((u) => [u.label, u.par ?? 0]));
  const { rubric } = scoringOf(data.config);
  // The finalize's own ranking function over a field of one: toPar, holes and
  // points are right; position means nothing here and is not used.
  const row = computeStrokeLeaderboard([unitId], netStrokeEntriesByHole(raw, { [unitId]: stroked }), parByHole, rubric)[0];
  if (!row?.started) return { kind: "not_started" };
  const thru = thruLabel(row.holesPlayed, units.length);
  return rubric ? { kind: "points", points: row.points, thru } : { kind: "to_par", toPar: row.toPar, thru };
}

function pickemStanding(data: GameProjectionData, viewerId: string, inGame: boolean): OwnStanding | null {
  const pk = data.pickem;
  if (!pk) return null;
  const mine = pk.picks.filter((p) => p.user_id === viewerId);
  // Playing = entered in the game or holding a sheet. No sheet is NOTHING, not 0.
  if (!inGame && mine.length === 0) return null;
  const slate: ScoredSlateGame[] = pk.slate.map((s) => ({
    id: s.id as string,
    multiplier: (s.multiplier as number | null) ?? null,
    result: (s.result as ScoredSlateGame["result"]) ?? null,
  }));
  const { resolved, total } = resolvedCount(slate);
  if (mine.length === 0) return { kind: "pickem", points: null, resolved, total };
  const picks: ScoredPick[] = mine.map((p) => ({
    slateGameId: p.slate_game_id as string,
    pick: p.pick as ScoredPick["pick"],
    confidence: (p.confidence as number | null) ?? null,
  }));
  // The finalize's default: confidence is on unless the game turned it off.
  const useConfidence = (pk.cfg?.use_confidence as boolean | null) ?? true;
  return { kind: "pickem", points: sheetPoints(slate, picks, useConfidence), resolved, total };
}
