// Seed step 2: the focus cup's games, made THROUGH THE APP (tRPC over HTTP),
// so every row has the shape the app writes.
//
//   node scripts/load/seed-games.mjs [complete=6] [live=1] [pending=2]
//
// Needs the app running at LOAD_APP_URL against the same stack.
//
// The two payloads below were captured from the real client on 2026-11-16
// (add-game sheet, then the stroke settings page's Save with four groups and
// scoring switched on) and are sent unchanged apart from ids and names.
// `groupsStructureDirty` is sent because the client sends it: the RPC treats a
// MISSING dirty flag as dirty (CLAUDE.md, "a fixture that does not send what
// the real caller sends").
import { assertLocal, admin, signIn, trpcQuery, trpcMutation, userEmail, FOCUS_TRIP, FOCUS_COMP } from "./lib.mjs";

assertLocal();
const [COMPLETE, LIVE, PENDING] = [process.argv[2] ?? 6, process.argv[3] ?? 1, process.argv[4] ?? 2].map(Number);
const PLAYERS = 16;
const HOLES = 18;

const owner = await signIn(userEmail(1));
const db = admin();
const { data: members, error } = await db
  .from("trip_members")
  .select("user_id, nickname")
  .eq("trip_id", FOCUS_TRIP);
if (error) throw new Error(error.message);
const players = members
  .sort((a, b) => Number(a.nickname.split(" ")[1]) - Number(b.nickname.split(" ")[1]))
  .slice(0, PLAYERS)
  .map((m) => m.user_id);

const ok = (label, r) => {
  if (!r.ok) throw new Error(`${label} failed: HTTP ${r.status} ${r.error ?? ""}`);
  return r.data;
};

async function createGame(name, { scoring }) {
  const game = ok(
    "games.create",
    await trpcMutation(owner, "games.create", {
      tripId: FOCUS_TRIP,
      gameTypeId: "gtt_stroke_play",
      name,
      competitionId: FOCUS_COMP,
      pointsDistribution: null,
      pointsTotal: 0,
    })
  );
  if (!scoring) return game.id;
  const hash = ok("games.configHash", await trpcQuery(owner, "games.configHash", { tripId: FOCUS_TRIP, gameId: game.id }));
  ok(
    "games.saveConfig",
    await trpcMutation(owner, "games.saveConfig", {
      tripId: FOCUS_TRIP,
      gameId: game.id,
      baseHash: typeof hash === "string" ? hash : hash.hash,
      payload: {
        name,
        rulesForToday: null,
        competitionFormat: null,
        scoringEnabled: true,
        pointsTotal: 10,
        pointsDistribution: { type: "placement", values: [10] },
        courseId: null,
        backCourseId: null,
        scorecardSchema: null,
        modifiers: {},
        participants: [],
        config: { scoringType: "traditional", rollUp: "individual" },
        groups: [0, 1, 2, 3].map((g) => ({ name: `Group ${g + 1}`, userIds: players.slice(g * 4, g * 4 + 4) })),
        groupsStructureDirty: true,
      },
    })
  );
  return game.id;
}

async function playToFinish(gameId) {
  for (let hole = 1; hole <= HOLES; hole++) {
    // one hole for all players at once, as four scorers would
    const results = await Promise.all(
      players.map((participantId, i) =>
        trpcMutation(owner, "scores.upsertEntry", {
          tripId: FOCUS_TRIP,
          gameId,
          participantId,
          unitLabel: String(hole),
          value: 3 + ((hole * 7 + i * 3) % 4),
          participantType: "user",
        })
      )
    );
    results.forEach((r) => ok("scores.upsertEntry", r));
  }
  ok("games.finish", await trpcMutation(owner, "games.finish", { tripId: FOCUS_TRIP, gameId }));
}

const out = { complete: [], live: [], pending: [] };
for (let i = 1; i <= COMPLETE; i++) {
  const id = await createGame(`Load Round ${i}`, { scoring: true });
  await playToFinish(id);
  out.complete.push(id);
}
for (let i = 1; i <= LIVE; i++) out.live.push(await createGame(`Load Live ${i}`, { scoring: true }));
for (let i = 1; i <= PENDING; i++) out.pending.push(await createGame(`Load Later ${i}`, { scoring: false }));
console.log(JSON.stringify(out));
