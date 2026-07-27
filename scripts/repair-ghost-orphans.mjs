#!/usr/bin/env node
/**
 * repair-ghost-orphans — one-off repair for trips whose competition rows still
 * point at a ghost that was auto-linked away.
 *
 * ── Why a script and not a migration ─────────────────────────────────────────
 * A data migration keyed on specific ids is the `044` anti-pattern: it cannot
 * replay from zero (the ids don't exist on a fresh DB) and CI applies the whole
 * history on every run. Repair is also a JUDGEMENT call — merging the wrong two
 * people is worse than the current broken state — so it must not run
 * unattended. Hence: a script, dry-run by default, one explicit confirmation
 * per pair.
 *
 * ── What broke ───────────────────────────────────────────────────────────────
 * `ghostCrew.update`'s auto-link branch used to repoint `trip_members` at a
 * matched account and stop. The ghost survived in `users` but stopped being a
 * trip member, so `team_assignments` / `game_participants` / `score_entries` /
 * `game_results` / JSONB match sides kept pointing at it — rosters rendered
 * "Unknown", and scoring stayed gated on the ghost. Fixed forward in the same
 * PR (the branch now calls the merge); this repairs rows already in that state.
 *
 * ── The pairing problem (read before using --apply) ──────────────────────────
 * The auto-link OVERWROTE trip_members.user_id, so nothing in the database
 * records which ghost became which account. This script can detect orphans with
 * certainty, but it can only GUESS the pairing, by name. A guess is never
 * applied: --apply requires you to restate the exact ghost=real id pair, so the
 * decision is yours and is visible in your shell history.
 *
 * ── Usage ────────────────────────────────────────────────────────────────────
 *   node scripts/repair-ghost-orphans.mjs                     # detect (default)
 *   node scripts/repair-ghost-orphans.mjs --apply \
 *        --pair ghost-abc=11111111-...  --pair ghost-def=222...
 *
 * Env: NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY (reads .env.local).
 * Point it at a target with SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY overrides.
 *
 * Repair itself calls `merge_guest_to_real_user`, the same function signup uses
 * — so a repaired row lands identically to a correctly-merged one, and the
 * coverage can't drift between the two paths.
 */
import { createClient } from "@supabase/supabase-js";
import fs from "node:fs";

// ── config ───────────────────────────────────────────────────────────────────
function env() {
  let url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  let key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if ((!url || !key) && fs.existsSync(".env.local")) {
    const f = fs.readFileSync(".env.local", "utf8");
    url ||= f.match(/NEXT_PUBLIC_SUPABASE_URL=(.*)/)?.[1]?.trim();
    key ||= f.match(/SUPABASE_SERVICE_ROLE_KEY=(.*)/)?.[1]?.trim();
  }
  if (!url || !key) {
    console.error("Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY.");
    process.exit(1);
  }
  return { url, key };
}

const args = process.argv.slice(2);
const APPLY = args.includes("--apply");
const PAIRS = args
  .map((a, i) => (a === "--pair" ? args[i + 1] : null))
  .filter(Boolean)
  .map((p) => {
    const [ghost, real] = String(p).split("=");
    if (!ghost || !real) {
      console.error(`Bad --pair "${p}" — expected <ghostId>=<realId>.`);
      process.exit(1);
    }
    return { ghost, real };
  });

const { url, key } = env();
const db = createClient(url, key);

// ── detection ────────────────────────────────────────────────────────────────
/** A team_assignments row whose user is NOT a member of that competition's trip
 *  — exactly the condition that renders "Unknown" (TeamsPanel memberById miss). */
async function findOrphans() {
  const { data: assignments, error } = await db
    .from("team_assignments")
    .select("user_id, competition_id, competitions(id, trip_id, name, trips(title))");
  if (error) throw new Error(`read team_assignments: ${error.message}`);

  const { data: members } = await db.from("trip_members").select("trip_id, user_id");
  const memberKey = new Set((members ?? []).map((m) => `${m.trip_id}|${m.user_id}`));

  const orphans = [];
  for (const a of assignments ?? []) {
    const comp = a.competitions;
    if (!comp) continue;
    if (!memberKey.has(`${comp.trip_id}|${a.user_id}`)) {
      orphans.push({
        ghostId: a.user_id,
        tripId: comp.trip_id,
        tripTitle: comp.trips?.title ?? "(untitled)",
        competitionId: comp.id,
      });
    }
  }
  return orphans;
}

/** Every row that would move, so the operator sees the true scope. */
async function refCounts(ghostId) {
  const n = async (t, col, extra) => {
    let q = db.from(t).select("*", { count: "exact", head: true }).eq(col, ghostId);
    for (const [k, v] of Object.entries(extra ?? {})) q = q.eq(k, v);
    return (await q).count ?? 0;
  };
  const { data: sides } = await db.from("game_matches").select("id, side_a, side_b");
  const jsonbSides = (sides ?? []).filter(
    (r) => r.side_a?.id === ghostId || r.side_b?.id === ghostId
  ).length;
  return {
    team_assignments: await n("team_assignments", "user_id"),
    game_participants: await n("game_participants", "user_id"),
    score_entries: await n("score_entries", "participant_id", { participant_type: "user" }),
    game_results: await n("game_results", "entity_id", { entity_type: "user" }),
    game_delegates: await n("game_delegates", "user_id"),
    match_sides: jsonbSides,
  };
}

/** Name-similarity candidates. A SUGGESTION only — never auto-applied. */
async function suggestReal(ghostId, tripId) {
  const { data: ghost } = await db.from("users").select("name").eq("id", ghostId).maybeSingle();
  const gname = (ghost?.name ?? "").trim().toLowerCase();
  if (!gname) return [];
  const { data: tm } = await db.from("trip_members").select("user_id").eq("trip_id", tripId);
  const ids = (tm ?? []).map((r) => r.user_id);
  if (!ids.length) return [];
  const { data: users } = await db
    .from("users")
    .select("id, name, email, is_guest")
    .in("id", ids)
    .eq("is_guest", false);
  return (users ?? []).filter((u) => {
    const n = (u.name ?? "").trim().toLowerCase();
    return n === gname || n.startsWith(gname + " ") || n.split(" ")[0] === gname;
  });
}

// ── main ─────────────────────────────────────────────────────────────────────
const orphans = await findOrphans();

if (!orphans.length) {
  console.log("No orphaned competition rows found. Nothing to repair.");
  process.exit(0);
}

// Group by ghost so each person is one decision, not one per assignment.
const byGhost = new Map();
for (const o of orphans) {
  if (!byGhost.has(o.ghostId)) byGhost.set(o.ghostId, { ...o, comps: new Set() });
  byGhost.get(o.ghostId).comps.add(o.competitionId);
}

console.log(`\nFound ${byGhost.size} orphaned identit${byGhost.size === 1 ? "y" : "ies"}:\n`);
for (const [ghostId, o] of byGhost) {
  const { data: g } = await db.from("users").select("name, email, is_guest").eq("id", ghostId).maybeSingle();
  const counts = await refCounts(ghostId);
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  console.log(`  ghost  ${ghostId}`);
  console.log(`  name   ${g?.name ?? "(missing users row)"}   guest=${g?.is_guest ?? "?"}  email=${g?.email ?? "null"}`);
  console.log(`  trip   ${o.tripTitle}  (${o.tripId})`);
  console.log(`  rows   ${total} — ${JSON.stringify(counts)}`);
  const cands = await suggestReal(ghostId, o.tripId);
  if (cands.length) {
    console.log(`  likely →`);
    for (const c of cands) console.log(`           ${c.id}   ${c.name}   ${c.email}`);
    console.log(`  confirm with:  --pair ${ghostId}=${cands[0].id}`);
  } else {
    console.log(`  likely → (no name match on this trip — identify the account manually)`);
  }
  console.log("");
}

if (!APPLY) {
  console.log("DRY RUN — nothing written. Re-run with --apply and one --pair per identity.");
  console.log("Verify each pairing is the SAME PERSON before applying; a wrong merge is worse");
  console.log("than the current state and is not automatically reversible.\n");
  process.exit(0);
}

if (!PAIRS.length) {
  console.error("--apply requires at least one --pair <ghostId>=<realId>. Refusing to guess.");
  process.exit(1);
}

console.log(`APPLYING ${PAIRS.length} merge(s)…\n`);
let failed = 0;
for (const { ghost, real } of PAIRS) {
  if (!byGhost.has(ghost)) {
    console.error(`  SKIP ${ghost} — not in the detected orphan set. Refusing.`);
    failed++;
    continue;
  }
  const { data: g } = await db.from("users").select("is_guest, name").eq("id", ghost).maybeSingle();
  if (!g) { console.error(`  SKIP ${ghost} — no users row.`); failed++; continue; }
  if (!g.is_guest) { console.error(`  SKIP ${ghost} — not a guest. Refusing.`); failed++; continue; }
  const { data: r } = await db.from("users").select("name, is_guest").eq("id", real).maybeSingle();
  if (!r) { console.error(`  SKIP ${real} — target account not found.`); failed++; continue; }

  // Same function signup uses, so a repaired row is indistinguishable from a
  // correctly-merged one.
  const { error } = await db.rpc("merge_guest_to_real_user", { p_ghost_id: ghost, p_real_id: real });
  if (error) {
    console.error(`  FAIL ${g.name} (${ghost}) → ${r.name} (${real}): ${error.message}`);
    failed++;
  } else {
    console.log(`  OK   ${g.name} (${ghost}) → ${r.name} (${real})`);
  }
}

const remaining = await findOrphans();
console.log(`\nDone. ${failed} failure(s). Orphaned rows remaining: ${remaining.length}.`);
process.exit(failed ? 1 : 0);
