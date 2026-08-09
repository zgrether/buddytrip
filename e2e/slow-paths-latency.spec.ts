import { test, expect, type Page } from "@playwright/test";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * PHASE 0 MEASUREMENT — the three slow paths, instrumented at identical marks.
 *
 *   1. tap Home           → /dashboard painted
 *   2. tap "Correct a score" → the CTA reads "Save scoring changes"
 *   3. tap "Save scoring changes" → the game panel is gone
 *
 * Registered only under `MEASURE=1`, like the other measurement specs — it
 * prints numbers and drives real lifecycle writes in a loop, neither of which
 * belongs in a merge gate.
 *
 *     npm run build
 *     E2E_PORT=3100 MEASURE=1 npx playwright test --project=measure-slow-paths --reporter=list
 *
 * Method follows `correction-latency.spec.ts` (#835), deliberately, so its
 * numbers and these are comparable:
 *  - **Production build**, local Supabase. `next dev` would measure the dev server.
 *  - **Panel path** (CLAUDE.md #12) — the board stays MOUNTED beneath the game,
 *    so the trailing board invalidations hit ACTIVE queries and really refetch.
 *    On a standalone route they match nothing and the cascade is understated.
 *  - **In-page marks** — a capture-phase click listener and a MutationObserver
 *    record tap and settle INSIDE the page, so no Playwright IPC lands in the span.
 *
 * TWO formats, because they differ where it matters. Non-golf (`gtt_manual`) is
 * what #835 measured, and its `games.finish` is the cheap manual arm. MATCH play
 * runs the expensive one — the match-play compute, `write_game_results`, and the
 * awaited clinch check — so a claim about "save scoring changes" made only on
 * non-golf would be a claim about the wrong procedure.
 */

const OWNER_EMAIL = "test-owner@buddytrip.app";
const PASSWORD = "BuddyTripTest2026!";
const MANUAL_GAME = "Slow Path Manual";
const MATCH_GAME = "Slow Path Match";
const ITERATIONS = Number(process.env.MEASURE_N ?? 5);
const HOLES = 18;

let admin: SupabaseClient;
let tripId: string;
let ownerId: string;
let memberId: string;
let compId: string;
let manualGameId: string;
let matchGameId: string;
const gameIds: string[] = [];

interface FetchRecord {
  url: string;
  start: number;
  end: number;
  bodyAt?: number;
  bytes?: number;
  /** Did this response body already carry the answer the UI is waiting for?
   *  The gap between the FIRST true payload and the settle mark is the part of
   *  the wait that is not a round trip — #835's finding was that the UI sat on
   *  an answer it already had. */
  correctionsOpen?: boolean;
}
interface Marks {
  tap: number;
  settled: number;
  fetches: FetchRecord[];
}

declare global {
  interface Window {
    __spFetchLog: FetchRecord[];
    __spMarks: { tap?: number; settled?: number };
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

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const fmt = (n: number) => n.toFixed(1).padStart(7);
function report(label: string, xs: number[]) {
  if (!xs.length) return console.log(`${label.padEnd(38)} (no samples)`);
  console.log(
    `${label.padEnd(38)} median ${fmt(median(xs))} ms   min ${fmt(Math.min(...xs))} ms   max ${fmt(Math.max(...xs))} ms   n=${xs.length}`
  );
}
function opsOf(url: string): string {
  const m = url.match(/\/api\/trpc\/([^?]+)/);
  return m ? decodeURIComponent(m[1]) : url.replace(/^https?:\/\/[^/]+/, "");
}

/** Duplicate-detection: the same procedure fetched more than once inside one span. */
function duplicates(fetches: FetchRecord[]): string {
  const counts = new Map<string, number>();
  for (const f of fetches) {
    for (const op of opsOf(f.url).split(",")) counts.set(op, (counts.get(op) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([op, n]) => `${op}×${n}`)
    .join("  ");
}

test.beforeAll(async () => {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("needs NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY");
  admin = createClient(url, key);

  ownerId = await ensureUser(OWNER_EMAIL, "Test Owner");
  memberId = await ensureUser("test-member@buddytrip.app", "Test Member");

  tripId = `e2e-slow-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const ins = async (table: string, rows: unknown, what: string) => {
    const { error } = await admin.from(table).insert(rows as never);
    if (error) throw new Error(`${what} failed: ${error.message}`);
  };

  await ins("trips", { id: tripId, title: "E2E Slow Paths" }, "seed trip");
  await ins("trip_members", [
    { trip_id: tripId, user_id: ownerId, role: "Owner", status: "in", nickname: "Bench Owner" },
    { trip_id: tripId, user_id: memberId, role: "Member", status: "in", nickname: "Bench Member" },
  ], "seed members");

  compId = `e2e-slow-comp-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  await ins("competitions", { id: compId, trip_id: tripId, name: "Slow Cup", scoring_model: "match_play", status: "active" }, "seed competition");

  const { data: teams, error: teamErr } = await admin
    .from("teams")
    .insert([
      { competition_id: compId, name: "Blue", short_name: "BLU", color: "#3b82f6", color_dim: "#0a1a2a" },
      { competition_id: compId, name: "Red", short_name: "RED", color: "#ef4444", color_dim: "#2a0a0a" },
    ])
    .select("id, name");
  if (teamErr || !teams) throw new Error(`seed teams failed: ${teamErr?.message}`);
  const [blue, red] = teams as { id: string; name: string }[];
  await ins("team_assignments", [
    { competition_id: compId, team_id: blue.id, user_id: ownerId },
    { competition_id: compId, team_id: red.id, user_id: memberId },
  ], "seed assignments");

  // SIX games — `faceBootstrap` and `listByTrip` both scale with the game count,
  // so a one-game competition would flatter every board refetch in the cascade.
  const par = Array.from({ length: HOLES }, () => 4);
  for (let i = 0; i < 6; i++) {
    const id = crypto.randomUUID();
    gameIds.push(id);
    await ins("games", {
      id, trip_id: tripId, competition_id: compId, game_type_id: "gtt_manual",
      name: i === 0 ? MANUAL_GAME : `Filler Game ${i + 1}`,
      points_distribution: { type: "placement", values: [5, 3] }, points_total: 8,
      status: i === 0 ? "complete" : "pending", scoring_enabled: true, corrections_open: false,
    }, `seed game ${i}`);
    if (i === 0) {
      manualGameId = id;
      await ins("game_results", [
        { id: crypto.randomUUID(), game_id: id, entity_id: blue.id, entity_type: "team", position: 1, raw_score: 1 },
        { id: crypto.randomUUID(), game_id: id, entity_id: red.id, entity_type: "team", position: 2, raw_score: 2 },
      ], "seed manual results");
    }
  }

  // The MATCH game — posted, fully scored over 18 holes, one 1v1 match.
  matchGameId = crypto.randomUUID();
  gameIds.push(matchGameId);
  await ins("games", {
    id: matchGameId, trip_id: tripId, competition_id: compId, game_type_id: "gtt_match_play",
    name: MATCH_GAME, status: "complete", corrections_open: false, scoring_enabled: true,
    scorecard_schema: { units: { count: HOLES, label: "hole", metadata: { par, handicap_index: par.map((_, i) => i + 1) } } },
    points_distribution: { type: "per_match", value: 2 }, points_total: 2,
    modifiers: {}, competition_format: "head_to_head",
    pairings_published_at: new Date(0).toISOString(),
  }, "seed match game");
  await ins("game_participants", [
    { id: crypto.randomUUID(), game_id: matchGameId, user_id: ownerId, handicap_strokes: 3 },
    { id: crypto.randomUUID(), game_id: matchGameId, user_id: memberId, handicap_strokes: 0 },
  ], "seed match participants");
  const entries: unknown[] = [];
  for (let h = 1; h <= HOLES; h++) {
    entries.push(
      { id: crypto.randomUUID(), game_id: matchGameId, participant_id: ownerId, participant_type: "user", unit_label: String(h), value: 4 },
      { id: crypto.randomUUID(), game_id: matchGameId, participant_id: memberId, participant_type: "user", unit_label: String(h), value: 5 }
    );
  }
  await ins("score_entries", entries, "seed match scores");
  await ins("game_matches", {
    id: crypto.randomUUID(), game_id: matchGameId, match_number: 1, display_order: 0,
    side_a: { type: "user", id: ownerId }, side_b: { type: "user", id: memberId },
    result: "a_win", margin: "18up", status: "complete",
  }, "seed match pairing");
  await ins("game_results", [
    { id: crypto.randomUUID(), game_id: matchGameId, entity_id: ownerId, entity_type: "user", position: 1, raw_score: 18 },
    { id: crypto.randomUUID(), game_id: matchGameId, entity_id: memberId, entity_type: "user", position: 2, raw_score: 0 },
  ], "seed match results");
});

test.afterAll(async () => {
  if (gameIds.length) {
    for (const t of ["score_entries", "game_results", "game_delegates", "game_matches", "game_participants", "match_hole_outcomes"]) {
      await admin.from(t).delete().in("game_id", gameIds);
    }
    await admin.from("games").delete().in("id", gameIds);
  }
  await admin.from("team_assignments").delete().eq("competition_id", compId);
  await admin.from("teams").delete().eq("competition_id", compId);
  await admin.from("competitions").delete().eq("id", compId);
  await admin.from("trip_members").delete().eq("trip_id", tripId);
  await admin.from("trips").delete().eq("id", tripId);
});

/** Wrap fetch before any app code runs, so every request is timed. */
async function instrument(page: Page) {
  await page.addInitScript(() => {
    window.__spFetchLog = [];
    window.__spMarks = {};
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
        const rec: FetchRecord = { url, start, end: performance.now() };
        window.__spFetchLog.push(rec);
        // Read off a CLONE so the app's own consumer is untouched. `fetch()`
        // resolves on HEADERS; the body streams after, and tRPC cannot put
        // anything in the cache until the body is read and parsed.
        if (res) {
          void res.clone().text().then((body) => {
            rec.bodyAt = performance.now();
            rec.bytes = body.length;
            if (/"corrections_open"\s*:\s*true/.test(body)) rec.correctionsOpen = true;
            else if (/"corrections_open"\s*:\s*false/.test(body)) rec.correctionsOpen = false;
          }).catch(() => {});
        }
      }
    } as typeof fetch;
  });
}

/** Arm tap + settle marks. `settleSelector` present ⇒ settled; `absent` inverts it. */
async function arm(page: Page, tapSelector: string, settleSelector: string, absent = false) {
  await page.evaluate(
    ({ tapSelector, settleSelector, absent }) => {
      window.__spMarks = {};
      window.__spFetchLog = [];
      const btn = document.querySelector(`${tapSelector}`);
      btn?.addEventListener("click", () => { window.__spMarks.tap = performance.now(); }, { capture: true, once: true });
      const done = () => (absent ? !document.querySelector(settleSelector) : !!document.querySelector(settleSelector));
      const obs = new MutationObserver(() => {
        if (window.__spMarks.tap !== undefined && window.__spMarks.settled === undefined && done()) {
          window.__spMarks.settled = performance.now();
          obs.disconnect();
        }
      });
      obs.observe(document.body, { childList: true, subtree: true, attributes: true });
    },
    { tapSelector, settleSelector, absent }
  );
}

async function readMarks(page: Page): Promise<Marks> {
  const m = (await page.evaluate(() => ({
    tap: window.__spMarks.tap,
    settled: window.__spMarks.settled,
    fetches: window.__spFetchLog,
  }))) as Marks;
  expect(m.tap, "tap mark missing").toBeTruthy();
  expect(m.settled, "settle mark missing").toBeTruthy();
  return m;
}

/** Open the board and then the named game as a PANEL (CLAUDE.md #12). */
async function openPanel(page: Page, gameName: string) {
  await page.goto(`/trips/${tripId}/leaderboard`);
  const row = page.locator('[data-testid="open-game-panel"]').filter({ hasText: gameName });
  await row.first().waitFor({ state: "visible", timeout: 30_000 });
  await row.first().click();
}

function timeline(m: Marks, label: string) {
  console.log(`\n--- ${label}: request timeline of the last run (ms from tap) ---`);
  for (const f of m.fetches.filter((x) => x.end >= m.tap - 5)) {
    const marker = f.end <= m.settled ? "(before settle)" : "(after settle) ";
    const body = f.bodyAt ? `body@${(f.bodyAt - m.tap).toFixed(0)} ${((f.bytes ?? 0) / 1024).toFixed(0)}kB` : "body:?";
    console.log(
      `${(f.start - m.tap).toFixed(1).padStart(9)} → ${(f.end - m.tap).toFixed(1).padStart(8)} ms  ` +
        `[${(f.end - f.start).toFixed(1).padStart(7)} ms]  ${body.padEnd(20)} ${marker}  ${opsOf(f.url)}`
    );
  }
  console.log(`SETTLED at ${(m.settled - m.tap).toFixed(1)} ms from tap`);
  console.log(`procedure counts in span: ${duplicates(m.fetches.filter((x) => x.start >= m.tap - 5))}`);
}

// ───────────────────────────────────────────────────────────────────────────
// PATH 1 — Home
// ───────────────────────────────────────────────────────────────────────────
test.describe("PATH 1", () => {
  // MOBILE, necessarily: `AppTabBar` is the mobile chrome — at `lg+` the Home
  // destination lives in `TopNav` instead, so `app-tab-home` renders but is not
  // visible. The report is a mobile one, so this is the faithful viewport rather
  // than a workaround. Paths 2+3 stay on the desktop profile deliberately, to
  // remain comparable with #835's numbers.
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

  test("tap Home from a trip → /dashboard painted", async ({ page }) => {
  test.setTimeout(300_000);
  await instrument(page);

  const spans: number[] = [];
  const samples: Marks[] = [];
  for (let i = 0; i < ITERATIONS; i++) {
    await page.goto(`/trips/${tripId}/leaderboard`);
    await page.locator('[data-testid="open-game-panel"]').first().waitFor({ state: "visible", timeout: 30_000 });
    await page.waitForTimeout(1500);

    // Settle = the dashboard's own content is in the DOM. `quick-game-strip`
    // renders unconditionally AFTER `tripsLoading`'s early-return spinner, so it
    // marks the paint rather than the mount.
    await arm(page, '[data-testid="app-tab-home"]', '[data-testid="quick-game-strip"]');
    await page.locator('[data-testid="app-tab-home"]').click();
    await page.locator('[data-testid="quick-game-strip"]').waitFor({ state: "visible", timeout: 60_000 });
    await page.waitForTimeout(2000);

    const m = await readMarks(page);
    samples.push(m);
    spans.push(m.settled - m.tap);
  }

  console.log(`\n=== PATH 1 · Home route change (production build, local Supabase, mobile 390×844, n=${ITERATIONS}) ===`);
  report("TAP Home → /dashboard painted", spans);
  timeline(samples[samples.length - 1], "Home");
  });
});

// ───────────────────────────────────────────────────────────────────────────
// PATHS 2 + 3 — correction, then re-lock — for BOTH formats
// ───────────────────────────────────────────────────────────────────────────
for (const [label, gameName, getId] of [
  ["non-golf (manual)", MANUAL_GAME, () => manualGameId],
  ["match play (18 holes)", MATCH_GAME, () => matchGameId],
] as const) {
  test(`PATHS 2+3 — ${label}`, async ({ page }) => {
    test.setTimeout(600_000);
    await instrument(page);

    const correctSpans: number[] = [];
    const saveSpans: number[] = [];
    const correctSamples: Marks[] = [];
    const saveSamples: Marks[] = [];

    for (let i = 0; i < ITERATIONS; i++) {
      // Back to LOCKED for the next run.
      await admin.from("games").update({ status: "complete", corrections_open: false }).eq("id", getId());

      await openPanel(page, gameName);
      await page.locator('[data-testid="game-correct"]').waitFor({ state: "visible", timeout: 30_000 });
      // Let the panel's own opening traffic settle so it isn't attributed to the tap.
      await page.waitForTimeout(1500);

      // ---- PATH 2: correct ----
      await arm(page, '[data-testid="game-correct"] button', '[data-testid="game-relock"]');
      await page.locator('[data-testid="game-correct"] button').click();
      await page.locator('[data-testid="game-relock"]').waitFor({ state: "visible", timeout: 60_000 });
      await page.waitForTimeout(2500);
      const c = await readMarks(page);
      correctSamples.push(c);
      correctSpans.push(c.settled - c.tap);

      // ---- PATH 3: save scoring changes ----
      // Settle = the game panel is GONE. `exitToBoard()` pops the `?game=` entry,
      // so the scoreboard's lifecycle CTA leaving the DOM is the close.
      await arm(page, '[data-testid="game-relock"] button', '[data-testid="game-relock"]', true);
      await page.locator('[data-testid="game-relock"] button').click();
      await page.locator('[data-testid="game-relock"]').waitFor({ state: "detached", timeout: 90_000 });
      await page.waitForTimeout(3000);
      const s = await readMarks(page);
      saveSamples.push(s);
      saveSpans.push(s.settled - s.tap);
    }

    console.log(`\n=== PATH 2 · "Correct a score" — ${label} (n=${ITERATIONS}) ===`);
    report("TAP → CTA reads 'Save scoring changes'", correctSpans);
    // #835 found the UI settling on the THIRD `getById`, ~130 ms after the first
    // payload carrying the answer had already landed. Re-measured here because
    // #836's coalescer shipped in between and changes the wave timing.
    const lag = correctSamples
      .map((s) => {
        const first = s.fetches.filter((f) => f.correctionsOpen === true && f.bodyAt).sort((a, b) => a.bodyAt! - b.bodyAt!)[0];
        return first ? s.settled - first.bodyAt! : null;
      })
      .filter((x): x is number => x !== null);
    report("  UI lag after 1st TRUE body landed", lag);
    console.log(`\n=== PATH 3 · "Save scoring changes" — ${label} (n=${ITERATIONS}) ===`);
    report("TAP → game panel closed", saveSpans);

    timeline(correctSamples[correctSamples.length - 1], `PATH 2 ${label}`);
    timeline(saveSamples[saveSamples.length - 1], `PATH 3 ${label}`);
  });

  /**
   * PATH 3b — the STALE-LOCK-STATE window after a save.
   *
   * Re-opening a just-saved game showed "Save scoring changes" (the CORRECTING
   * CTA) for a moment before settling to "Correct a score". The game is locked in
   * the database by then, so the panel is rendering a cached lock state as if it
   * were a definite answer — the #751 role-flash class.
   *
   * Two things have to be measured, not reasoned about, because the fix differs:
   *  - HOW LONG the wrong CTA is on screen, and which response ends it. That
   *    names the stale query.
   *  - WHICH CTA is first painted at all. If the panel paints nothing until the
   *    lock state is known, this is a non-issue; if it paints the wrong one, the
   *    button is live and tappable while wrong.
   */
  test(`PATH 3b — lock state on re-open after save — ${label}`, async ({ page }) => {
    test.setTimeout(600_000);
    await instrument(page);

    // Device-like latency. Localhost answers in ~100 ms, which is faster than a
    // user can tap back in; the reported window only exists when a round trip is
    // slower than the gesture. 150 ms RTT is an ordinary 4G figure and is the
    // variable under test, not a way to manufacture a failure — the run below
    // also reports what happens without it.
    const cdp = await page.context().newCDPSession(page);
    await cdp.send("Network.enable");
    await cdp.send("Network.emulateNetworkConditions", {
      offline: false, latency: 150, downloadThroughput: (1.6 * 1024 * 1024) / 8, uploadThroughput: (750 * 1024) / 8,
    });

    const wrongCtaMs: number[] = [];
    const firstPainted: string[] = [];
    let lastLog: { t: number; state: string }[] = [];
    let lastFetches: FetchRecord[] = [];

    for (let i = 0; i < ITERATIONS; i++) {
      await admin.from("games").update({ status: "complete", corrections_open: false }).eq("id", getId());

      // Correct, then save — the real sequence, not a seeded shortcut, because
      // the optimistic flip's residue in the cache is the thing under test.
      await openPanel(page, gameName);
      await page.locator('[data-testid="game-correct"] button').click();
      await page.locator('[data-testid="game-relock"]').waitFor({ state: "visible", timeout: 60_000 });
      await page.locator('[data-testid="game-relock"] button').click();
      await page.locator('[data-testid="game-relock"]').waitFor({ state: "detached", timeout: 90_000 });

      // NO settle wait here, deliberately. The trailing `games.getById` refetch
      // is what corrects the cache, and on this stack it lands in ~100 ms — so
      // pausing before re-opening measures a window that has already closed.
      // The reported behaviour is a user tapping straight back in, on a phone
      // where that refetch takes far longer than the tap. Re-open IMMEDIATELY.

      // Sample which CTA is mounted, every frame, from the moment of the tap.
      await page.evaluate(() => {
        window.__spFetchLog = [];
        (window as unknown as { __cta: { t: number; state: string }[] }).__cta = [];
        const t0 = performance.now();
        const sample = () => {
          const has = (id: string) => !!document.querySelector(`[data-testid="${id}"]`);
          const state = has("game-relock") ? "relock(WRONG)" : has("game-correct") ? "correct(right)" : has("game-finalize") ? "finalize" : "none";
          const log = (window as unknown as { __cta: { t: number; state: string }[] }).__cta;
          const prev = log[log.length - 1];
          if (!prev || prev.state !== state) log.push({ t: performance.now() - t0, state });
          requestAnimationFrame(sample);
        };
        requestAnimationFrame(sample);
      });

      // `waitFor` before clicking, not as a settle pause: under throttling the
      // board's own rows can still be painting when the panel closes, and a bare
      // `.click()` then burns the whole test timeout. This waits for the row to
      // exist, which is not the `games.getById` refetch being measured.
      const row = page.locator('[data-testid="open-game-panel"]').filter({ hasText: gameName }).first();
      await row.waitFor({ state: "visible", timeout: 60_000 });
      await row.click();
      await page.waitForTimeout(4000);

      const out = await page.evaluate(() => ({
        cta: (window as unknown as { __cta: { t: number; state: string }[] }).__cta,
        fetches: window.__spFetchLog,
      }));
      lastLog = out.cta;
      lastFetches = out.fetches as FetchRecord[];

      const firstReal = out.cta.find((s) => s.state !== "none");
      firstPainted.push(firstReal?.state ?? "none");
      const wrongStart = out.cta.find((s) => s.state === "relock(WRONG)");
      const wrongEnd = wrongStart ? out.cta.find((s) => s.t > wrongStart.t && s.state !== "relock(WRONG)") : undefined;
      if (wrongStart) wrongCtaMs.push((wrongEnd?.t ?? 4000) - wrongStart.t);
    }

    console.log(`\n=== PATH 3b · lock state on re-open after save — ${label} (n=${ITERATIONS}) ===`);
    console.log(`first CTA painted per run: ${firstPainted.join(", ")}`);
    if (wrongCtaMs.length) report("WRONG CTA on screen for", wrongCtaMs);
    else console.log("WRONG CTA never appeared — panel showed the correct state immediately");
    console.log(`\n--- CTA state timeline, last run (ms from re-open tap) ---`);
    for (const s of lastLog) console.log(`${s.t.toFixed(0).padStart(7)} ms   ${s.state}`);
    console.log(`--- requests, last run ---`);
    for (const f of lastFetches) {
      console.log(`${f.start.toFixed(0).padStart(9)} → ${f.end.toFixed(0).padStart(8)} ms  ${opsOf(f.url)}${f.correctionsOpen === undefined ? "" : `  <= corrections_open:${f.correctionsOpen}`}`);
    }
  });
}
