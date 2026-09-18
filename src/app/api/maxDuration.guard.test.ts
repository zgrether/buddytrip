import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "fs";
import { join } from "path";

/**
 * EVERY API ROUTE CARRIES A DURATION BACKSTOP (#1258).
 *
 * The defect this guards is not a wrong value — it is a route that never set
 * one. There was no `maxDuration` anywhere in the app, so the platform default
 * applied and a stalled upstream could hold a function for the observed ceiling
 * of 300 seconds (19 such timeouts on `/api/trpc`, 2026-08-29). A new route
 * added tomorrow would inherit exactly that, silently, and nothing in a diff
 * would say so.
 *
 * So the check is over the FILE SET, not over one file: it reads every
 * `route.ts` under `src/app/api` and fails on any that does not export the
 * value. A route deliberately wanting a different number changes the bound here
 * as well, which is the point — the number is a decision, and an unbounded route
 * is not a decision at all.
 *
 * This is NOT the primary bound. The per-call abort is (8s on the caller's
 * client, 20s on the admin client). This one only stops a stall from costing
 * five minutes, and it is deliberately far above the slowest honest request
 * (5.7s measured) and the deferred `afterResponse` work (~1-2s, worst 5.1s).
 */

const API_DIR = join(process.cwd(), "src", "app", "api");

/** Every `route.ts` under src/app/api, at any depth. */
function routeFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...routeFiles(full));
    else if (entry === "route.ts") out.push(full);
  }
  return out;
}

const ROUTES = routeFiles(API_DIR);
/** The ceiling this app has agreed on. Raising it is a decision, not a typo. */
const MAX_ALLOWED_SECONDS = 60;

describe("every API route bounds how long it can run", () => {
  it("finds routes at all — a scan that matches nothing proves nothing", () => {
    // The guard's own premise: if the directory moved, every assertion below
    // would pass over an empty list and report coverage it does not have.
    expect(ROUTES.length, `no route.ts found under ${API_DIR}`).toBeGreaterThanOrEqual(7);
    expect(ROUTES.some((f) => f.includes("trpc"))).toBe(true);
  });

  it.each(ROUTES.map((f) => [f.slice(API_DIR.length + 1).replace(/\\/g, "/"), f]))(
    "%s exports maxDuration",
    (_label, file) => {
      const src = readFileSync(file, "utf8");
      const match = src.match(/export\s+const\s+maxDuration\s*=\s*(\d+)/);
      expect(
        match,
        "no `export const maxDuration` — this route inherits the platform default (300s observed)",
      ).not.toBeNull();
      const seconds = Number(match![1]);
      expect(seconds).toBeGreaterThan(0);
      expect(
        seconds,
        `maxDuration ${seconds}s is above the agreed ceiling of ${MAX_ALLOWED_SECONDS}s`,
      ).toBeLessThanOrEqual(MAX_ALLOWED_SECONDS);
    },
  );

  it("the tRPC route's value clears the work that runs AFTER the response", () => {
    // `games.finish` defers its push and clinch check into `afterResponse`, which
    // runs inside the function's lifetime — so this value bounds them too, and a
    // tight one would kill them with no user-visible signal. Worst observed
    // deferred cost: 5.1s. Slowest measured request: 5.7s.
    const trpc = ROUTES.find((f) => f.includes("trpc"))!;
    const seconds = Number(readFileSync(trpc, "utf8").match(/export\s+const\s+maxDuration\s*=\s*(\d+)/)![1]);
    expect(seconds).toBeGreaterThanOrEqual(30);
  });
});
