import { test, expect, type Page } from "@playwright/test";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * TEMPORARY MEASUREMENT — item 6 of PR #833 (correction-mode transition).
 *
 * Not a merge-blocking assertion spec: it instruments the real transition and
 * prints numbers. It measures the span a user actually waits — the tap on
 * "Correct a score" to the moment the UI reflects the correcting state — and
 * attributes it to the individual tRPC round trips in between.
 *
 * Run it (needs a PRODUCTION build served on :3000 and the local Supabase stack):
 *
 *     npm run build
 *     MEASURE=1 npx playwright test --project=measure --reporter=list
 *
 * The project is registered ONLY under `MEASURE=1` — CI runs a bare
 * `npx playwright test`, which would otherwise pick it up.
 *
 * Deliberate choices:
 *  - **Panel path, not the standalone route.** Per CLAUDE.md #12 the board stays
 *    MOUNTED beneath the game panel, so `competitions.faceBootstrap` and
 *    `games.listByTrip` are ACTIVE queries and their invalidations really do
 *    refetch. On the standalone route they are unmounted and `invalidate()`
 *    would be a no-op — which would understate the cascade.
 *  - **Production build.** `next dev` inflates both the server handler and the
 *    React render; measuring dev would be measuring the dev server.
 *  - **In-page marks.** Tap time and unlock time are recorded inside the page
 *    (capture-phase listener + MutationObserver), so no Playwright IPC latency
 *    lands inside the measured span.
 *
 * Format under test is NON-GOLF. All four views run the same handler shape —
 * mutation, then an AWAITED `games.getById` refetch, then the board
 * invalidations — so the structure being measured is shared. Non-golf is the
 * one that needs no course, groupings, or hole scores to reach a posted game.
 */

const OWNER_EMAIL = "test-owner@buddytrip.app";
const PASSWORD = "BuddyTripTest2026!";
const POSTED_GAME_NAME = "Bench Posted Game";
const ITERATIONS = 6;

type Entry = "panel" | "standalone" | "isolated";

let admin: SupabaseClient;
let tripId: string;
let ownerId: string;
let compId: string;
let postedGameId: string;
const gameIds: string[] = [];

interface FetchRecord {
  url: string;
  start: number;
  /** When `fetch()` RESOLVED — i.e. response headers, NOT the parsed body. */
  end: number;
  /** When the response BODY finished streaming. This is the number that matters:
   *  tRPC cannot put anything in the cache until the body is read and parsed. */
  bodyAt?: number;
  bytes?: number;
  /** For a `games.getById` response: did the payload already say corrections_open? */
  correctionsOpen?: boolean;
}
/** One rAF sample of which lifecycle CTA is in the DOM. */
interface DomSample {
  t: number;
  state: string;
}
interface Marks {
  tap: number;
  unlocked: number;
  fetches: FetchRecord[];
  dom: DomSample[];
}

declare global {
  interface Window {
    __fetchLog: FetchRecord[];
    __marks: { tap?: number; unlocked?: number };
    __dom: DomSample[];
    __sampling: boolean;
  }
}

async function ensureUser(email: string, name: string): Promise<string> {
  const { data: list, error } = await admin.auth.admin.listUsers();
  if (error) throw new Error(`listUsers failed: ${error.message}`);
  const found = list?.users?.find((u) => u.email === email);
  if (found) return found.id;
  const { data, error: createErr } = await admin.auth.admin.createUser({
    email, password: PASSWORD, email_confirm: true, user_metadata: { name },
  });
  if (createErr || !data.user) throw new Error(`createUser ${email} failed: ${createErr?.message}`);
  return data.user.id;
}

function median(xs: number[]) {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}
function fmt(n: number) {
  return n.toFixed(1).padStart(7);
}
function report(label: string, xs: number[]) {
  if (!xs.length) return console.log(`${label.padEnd(34)} (no samples)`);
  console.log(
    `${label.padEnd(34)} median ${fmt(median(xs))} ms   min ${fmt(Math.min(...xs))} ms   max ${fmt(Math.max(...xs))} ms`
  );
}
/** `/api/trpc/games.openCorrection?batch=1&input=…` → `games.openCorrection` */
function opsOf(url: string): string {
  const m = url.match(/\/api\/trpc\/([^?]+)/);
  return m ? decodeURIComponent(m[1]) : url;
}

test.beforeAll(async () => {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("needs NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY");
  admin = createClient(url, key);

  ownerId = await ensureUser(OWNER_EMAIL, "Test Owner");

  tripId = `e2e-corr-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const { error: tErr } = await admin.from("trips").insert({ id: tripId, title: "E2E Correction Latency" });
  if (tErr) throw new Error(`seed trip failed: ${tErr.message}`);
  const { error: mErr } = await admin.from("trip_members").insert([
    { trip_id: tripId, user_id: ownerId, role: "Owner", status: "in", nickname: "Bench Owner" },
  ]);
  if (mErr) throw new Error(`seed members failed: ${mErr.message}`);

  compId = `e2e-corr-comp-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const { error: cErr } = await admin.from("competitions").insert({
    id: compId, trip_id: tripId, name: "Bench Cup", scoring_model: "points", status: "active",
  });
  if (cErr) throw new Error(`seed competition failed: ${cErr.message}`);

  const { data: teams, error: teamErr } = await admin
    .from("teams")
    .insert([
      { competition_id: compId, name: "Blue", short_name: "BLU", color: "#3b82f6", color_dim: "#0a1a2a" },
      { competition_id: compId, name: "Red", short_name: "RED", color: "#ef4444", color_dim: "#2a0a0a" },
    ])
    .select("id, name");
  if (teamErr || !teams) throw new Error(`seed teams failed: ${teamErr?.message}`);
  const [blue, red] = teams as { id: string; name: string }[];

  const { error: aErr } = await admin
    .from("team_assignments")
    .insert([{ competition_id: compId, team_id: blue.id, user_id: ownerId }]);
  if (aErr) throw new Error(`seed assignment failed: ${aErr.message}`);

  // SIX games, not one — `faceBootstrap` and `listByTrip` both scale with the
  // game count, and a one-game competition would flatter the board refetch.
  for (let i = 0; i < 6; i++) {
    const id = crypto.randomUUID();
    const posted = i === 0;
    const { error } = await admin.from("games").insert({
      id,
      trip_id: tripId,
      competition_id: compId,
      game_type_id: "gtt_manual",
      name: posted ? POSTED_GAME_NAME : `Bench Game ${i + 1}`,
      points_distribution: { type: "placement", values: [5, 3] },
      points_total: 8,
      status: posted ? "complete" : "pending",
      scoring_enabled: true,
      corrections_open: false,
    });
    if (error) throw new Error(`seed game ${i} failed: ${error.message}`);
    gameIds.push(id);
    if (posted) {
      postedGameId = id;
      // Same rows `writeManualResults` writes for a manual finish.
      const { error: rErr } = await admin.from("game_results").insert([
        { id: crypto.randomUUID(), game_id: id, entity_id: blue.id, entity_type: "team", position: 1, raw_score: 1 },
        { id: crypto.randomUUID(), game_id: id, entity_id: red.id, entity_type: "team", position: 2, raw_score: 2 },
      ]);
      if (rErr) throw new Error(`seed results failed: ${rErr.message}`);
    }
  }
});

test.afterAll(async () => {
  if (gameIds.length) {
    await admin.from("score_entries").delete().in("game_id", gameIds);
    await admin.from("game_results").delete().in("game_id", gameIds);
    await admin.from("game_delegates").delete().in("game_id", gameIds);
    await admin.from("games").delete().in("id", gameIds);
  }
  await admin.from("team_assignments").delete().eq("competition_id", compId);
  await admin.from("teams").delete().eq("competition_id", compId);
  await admin.from("competitions").delete().eq("id", compId);
  await admin.from("trip_members").delete().eq("trip_id", tripId);
  await admin.from("trips").delete().eq("id", tripId);
});

/** Wrap fetch before any app code runs, so every tRPC request is timed. */
async function instrument(page: Page) {
  await page.addInitScript(() => {
    window.__fetchLog = [];
    window.__marks = {};
    window.__dom = [];
    const orig = window.fetch;
    window.fetch = async function (...args: Parameters<typeof fetch>) {
      const req = args[0];
      const url = typeof req === "string" ? req : req instanceof URL ? req.href : req.url;
      const start = performance.now();
      let res: Response | undefined;
      try {
        res = await orig.apply(window, args);
        return res;
      } finally {
        const rec: {
          url: string;
          start: number;
          end: number;
          bodyAt?: number;
          bytes?: number;
          correctionsOpen?: boolean;
        } = { url, start, end: performance.now() };
        window.__fetchLog.push(rec);
        // Read the payload off a CLONE so the app's own consumer is untouched.
        // `fetch()` resolves on HEADERS; the body streams after. Timing the body
        // separates "the server answered" from "the client can use the answer".
        if (res) {
          void res
            .clone()
            .text()
            .then((body) => {
              rec.bodyAt = performance.now();
              rec.bytes = body.length;
              if (url.includes("games.getById")) {
                rec.correctionsOpen = /"corrections_open"\s*:\s*true/.test(body);
              }
            })
            .catch(() => {});
        }
      }
    } as typeof fetch;
  });
}

/**
 * Reach the posted game's scoreboard and arm the in-page marks.
 *
 * Three variants, each removing one suspected contributor so the residue is
 * attributable:
 *  - `panel` — the REAL path (#12). The board stays mounted beneath, so the
 *    trailing `faceBootstrap` / `listByTrip` invalidations hit ACTIVE queries
 *    and really refetch.
 *  - `standalone` — the board is not mounted, so those same invalidations match
 *    nothing and are no-ops. Isolates the cost of the board refetches.
 *  - `isolated` — standalone AND with the two BACKGROUND wake-ups silenced: the
 *    Realtime socket (migration 096's broadcast + `useRealtimeGame`, both of
 *    which fire on a `corrections_open` flip) and the `games.configHash` poll
 *    (#16). What is left is ONLY the handler's own mutation → awaited refetch.
 *    If the UI still lags behind the data here, the lag is render-side and no
 *    amount of removing round trips will fix it.
 */
async function openAndArm(page: Page, entry: Entry) {
  if (entry === "panel") {
    await page.goto(`/trips/${tripId}/leaderboard`);
    const row = page.locator('[data-testid="open-game-panel"]').filter({ hasText: POSTED_GAME_NAME });
    await row.first().waitFor({ state: "visible", timeout: 30_000 });
    await row.first().click();
  } else {
    await page.goto(`/trips/${tripId}/games/manual?game=${postedGameId}`);
  }

  const correct = page.locator('[data-testid="game-correct"]');
  await correct.waitFor({ state: "visible", timeout: 30_000 });

  // Let the board's own opening traffic settle so it isn't attributed to the tap.
  await page.waitForTimeout(1500);

  await page.evaluate(() => {
    window.__marks = {};
    window.__fetchLog = [];
    window.__dom = [];

    // Sample the lifecycle CTA every frame. If the surface goes BLANK between the
    // refetch landing and the relock CTA appearing, that gap is a render/loading
    // state, not a round trip — and the two need different fixes.
    window.__sampling = true;
    const sample = () => {
      if (!window.__sampling) return;
      const has = (id: string) => !!document.querySelector(`[data-testid="${id}"]`);
      const state = has("game-relock")
        ? "relock"
        : has("game-correct")
          ? "correct"
          : has("game-finalize")
            ? "finalize"
            : "none";
      const prev = window.__dom[window.__dom.length - 1];
      if (!prev || prev.state !== state) window.__dom.push({ t: performance.now(), state });
      requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);

    const btn = document.querySelector('[data-testid="game-correct"] button');
    btn?.addEventListener(
      "click",
      () => {
        window.__marks.tap = performance.now();
      },
      { capture: true, once: true }
    );
    const obs = new MutationObserver(() => {
      if (window.__marks.unlocked === undefined && document.querySelector('[data-testid="game-relock"]')) {
        window.__marks.unlocked = performance.now();
        obs.disconnect();
      }
    });
    obs.observe(document.body, { childList: true, subtree: true, attributes: true });
  });
}

test.describe("correction-mode transition latency", () => {
  for (const entry of ["panel", "standalone", "isolated"] as const) {
  test(`tap 'Correct a score' → UI reflects correcting [${entry}]`, async ({ page }) => {
    test.setTimeout(300_000);
    await instrument(page);

    if (entry === "isolated") {
      // Intercept the Realtime socket and never connect it upstream: the app
      // believes it has a socket, but no broadcast or postgres_changes event can
      // arrive to trigger a second invalidation wave.
      await page.routeWebSocket(/\/realtime\/v1/, () => {});
      // And silence the config-hash sync probe, whose hash moves when the flag
      // flips and which then pulls the full config again.
      await page.route(/\/api\/trpc\/games\.configHash/, (r) => r.abort());
    }

    const spans: number[] = [];
    const mutationRT: number[] = [];
    const getByIdRT: number[] = [];
    const mutationEndFromTap: number[] = [];
    const allSamples: Marks[] = [];

    for (let i = 0; i < ITERATIONS; i++) {
      // Back to LOCKED for the next run.
      await admin.from("games").update({ corrections_open: false }).eq("id", postedGameId);

      await openAndArm(page, entry);
      await page.locator('[data-testid="game-correct"] button').click();
      await page.locator('[data-testid="game-relock"]').waitFor({ state: "visible", timeout: 30_000 });

      // Give the trailing board invalidations time to land before reading the log.
      await page.waitForTimeout(2500);

      const marks = (await page.evaluate(() => {
        window.__sampling = false;
        return {
          tap: window.__marks.tap,
          unlocked: window.__marks.unlocked,
          fetches: window.__fetchLog,
          dom: window.__dom,
        };
      })) as Marks;

      expect(marks.tap, "tap mark missing").toBeTruthy();
      expect(marks.unlocked, "unlock mark missing").toBeTruthy();
      allSamples.push(marks);
      spans.push(marks.unlocked - marks.tap);

      const after = marks.fetches.filter((f) => f.start >= marks.tap - 5);
      const mut = after.find((f) => opsOf(f.url).includes("games.openCorrection"));
      const get = after.find(
        (f) => opsOf(f.url).includes("games.getById") && (!mut || f.start >= mut.end - 5)
      );
      if (mut) {
        mutationRT.push(mut.end - mut.start);
        mutationEndFromTap.push(mut.end - marks.tap);
      }
      if (get) getByIdRT.push(get.end - get.start);
    }

    // ---- Output -----------------------------------------------------------
    console.log(`\n=== correction transition [${entry}] — production build, local Supabase (n=${ITERATIONS}) ===`);
    report("TAP → UI shows correcting", spans);
    console.log("");
    report("  1. openCorrection round trip", mutationRT);
    report("     …mutation done, from tap", mutationEndFromTap);
    report("  2. getById round trip (AWAITED)", getByIdRT);

    // The decisive number: when did a payload carrying corrections_open:true
    // first land in the client, versus when the UI showed it.
    const lagFromHeaders: number[] = [];
    const lagFromBody: number[] = [];
    for (const s of allSamples) {
      const firstTrue = s.fetches
        .filter((f) => f.correctionsOpen === true && f.end >= s.tap)
        .sort((a, b) => a.end - b.end)[0];
      if (firstTrue) {
        lagFromHeaders.push(s.unlocked - firstTrue.end);
        if (firstTrue.bodyAt) lagFromBody.push(s.unlocked - firstTrue.bodyAt);
      }
    }
    console.log("");
    report("  UI lag after 1st TRUE headers", lagFromHeaders);
    report("  UI lag after 1st TRUE body", lagFromBody);

    console.log(`\n--- request timeline of the last run (ms from tap) ---`);
    const last = allSamples[allSamples.length - 1];
    for (const f of last.fetches.filter((x) => x.end >= last.tap - 5)) {
      const startRel = f.start - last.tap;
      const endRel = f.end - last.tap;
      const marker = endRel <= last.unlocked - last.tap ? "(before unlock)" : "(after unlock)";
      const payload = f.correctionsOpen === undefined ? "" : f.correctionsOpen ? "  <= corrections_open:TRUE" : "  <= corrections_open:false";
      const body = f.bodyAt ? `body@${(f.bodyAt - last.tap).toFixed(0)} ${((f.bytes ?? 0) / 1024).toFixed(0)}kB` : "body:?";
      console.log(
        `${startRel.toFixed(1).padStart(9)} → ${endRel.toFixed(1).padStart(8)} ms  ` +
          `[${(f.end - f.start).toFixed(1).padStart(7)} ms]  ${body.padEnd(18)} ${marker}  ${opsOf(f.url)}${payload}`
      );
    }

    console.log(`\n--- what the CTA showed, last run (ms from tap) ---`);
    for (const d of last.dom) console.log(`${(d.t - last.tap).toFixed(1).padStart(9)} ms   ${d.state}`);
    console.log(`\nUNLOCK at ${(last.unlocked - last.tap).toFixed(1)} ms from tap\n`);
  });
  }
});
