import { describe, it, expect, vi } from "vitest";
import { afterResponse } from "./afterResponse";

/**
 * `afterResponse` has exactly the failure mode CLAUDE.md #23 says needs a
 * runtime test: it depends on `after()` THROWING outside a request scope, and
 * nothing about its type signature says so. If a future Next.js made `after()`
 * a silent no-op out of scope, this module would report success while the work
 * never ran — the clinch check would simply stop happening, with no error, in
 * every context that isn't a live request (the whole vitest suite included).
 *
 * `tsc` cannot catch that. These two assertions can, and they are the reason
 * `games.finish` can defer the clinch check without the tests having to be
 * taught a different end state.
 */

describe("afterResponse", () => {
  it("runs the work (awaited) when there is no request scope", async () => {
    // This IS the no-request-scope case — vitest calls procedures through the
    // direct tRPC caller, never through a Next request.
    const work = vi.fn(async () => {});
    await afterResponse(work);
    expect(work, "work did not run — `after()` did not throw out of scope").toHaveBeenCalledTimes(1);
  });

  it("has FINISHED the work by the time it resolves, not merely started it", async () => {
    // The distinction that matters: `games.finish` returning must mean the
    // clinch check has completed, or every test asserting on its side effects
    // (push_send_log rows, the clinch claim) becomes a race.
    let done = false;
    await afterResponse(async () => {
      await new Promise((r) => setTimeout(r, 10));
      done = true;
    });
    expect(done, "afterResponse resolved before the work completed").toBe(true);
  });
});
