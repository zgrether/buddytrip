// Seed step 1: sign-in-able users and one realistic "focus" trip with a cup.
//
//   node scripts/load/seed-scaffold.mjs [users=40]
//
// The rows are written in the shapes e2e/critical-path.spec.ts seeds (trip,
// members, competition, two teams, assignments). Games are NOT seeded here:
// seed-games.mjs creates them through the app's own tRPC procedures, so their
// shape is whatever the app writes.
import { assertLocal, admin, userEmail, PASSWORD, FOCUS_TRIP, FOCUS_COMP } from "./lib.mjs";

assertLocal();
const COUNT = Number(process.argv[2] ?? 40);
const db = admin();

const must = (label, { error, data }) => {
  if (error) throw new Error(`${label}: ${error.message}`);
  return data;
};

// 1. Auth users (handle_new_user creates the public.users row).
const existing = new Map();
for (let page = 1; ; page++) {
  const data = must("listUsers", await db.auth.admin.listUsers({ page, perPage: 1000 }));
  data.users.forEach((u) => existing.set(u.email, u.id));
  if (data.users.length < 1000) break;
}
const ids = [];
for (let n = 1; n <= COUNT; n++) {
  const email = userEmail(n);
  let id = existing.get(email);
  if (!id) {
    const data = must(
      `createUser ${email}`,
      await db.auth.admin.createUser({ email, password: PASSWORD, email_confirm: true, user_metadata: { name: `Load User ${n}` } })
    );
    id = data.user.id;
  }
  ids.push(id);
}

// 2. Trip. locked_destination_at is set: trips_select hides an unlocked trip
//    from Members, which would bounce every watcher to the dashboard.
must(
  "trip",
  await db.from("trips").upsert({
    id: FOCUS_TRIP,
    title: "Load Focus Trip",
    locked_destination_title: "Load Focus Trip",
    locked_destination_at: new Date().toISOString(),
  })
);
must(
  "members",
  await db.from("trip_members").upsert(
    ids.map((user_id, i) => ({ trip_id: FOCUS_TRIP, user_id, role: i === 0 ? "Owner" : "Member", nickname: `Load ${i + 1}` })),
    { onConflict: "trip_id,user_id" }
  )
);

// 3. Cup with two teams; everyone is on one.
must(
  "competition",
  await db.from("competitions").upsert({ id: FOCUS_COMP, trip_id: FOCUS_TRIP, name: "Load Cup", scoring_model: "points", status: "upcoming" })
);
let teams = must("teams read", await db.from("teams").select("id").eq("competition_id", FOCUS_COMP).order("created_at"));
if (teams.length === 0) {
  teams = must(
    "teams",
    await db
      .from("teams")
      .insert([
        { competition_id: FOCUS_COMP, name: "Team A", short_name: "A", color: "#3b82f6", color_dim: "#0a1a2a" },
        { competition_id: FOCUS_COMP, name: "Team B", short_name: "B", color: "#ef4444", color_dim: "#2a0a0a" },
      ])
      .select("id")
  );
}
must(
  "assignments",
  await db.from("team_assignments").upsert(
    ids.map((user_id, i) => ({ competition_id: FOCUS_COMP, user_id, team_id: teams[i % 2].id, sort_order: Math.floor(i / 2) })),
    { onConflict: "competition_id,user_id" }
  )
);

console.log(JSON.stringify({ users: ids.length, trip: FOCUS_TRIP, competition: FOCUS_COMP, teams: teams.map((t) => t.id) }));
