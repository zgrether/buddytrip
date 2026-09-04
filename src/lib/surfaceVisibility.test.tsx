import { describe, it, expect, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryObserver } from "@tanstack/query-core";
import { SurfaceVisibility, useSurfaceVisible } from "./surfaceVisibility";

/**
 * Two things are pinned here, and they are different KINDS of claim.
 *
 * 1. The context composes (ANDed down the tree). Ours; ordinary React.
 *
 * 2. React Query does what the whole design rests on. NOT ours, and therefore
 *    the one that needs a runtime test rather than a reading — CLAUDE.md #23:
 *    a declared behaviour across a library boundary is not a runtime guarantee,
 *    and this one fails SILENTLY if it changes. If `invalidateQueries` ever
 *    started refetching disabled observers, the fan-out would come back with
 *    nothing failing and nothing to see; if the enabled transition stopped
 *    refetching, the cup page would freeze until someone hard-reloaded.
 *
 * Both were read out of `@tanstack/query-core` 5.90.20 first:
 *
 *     isActive() { return this.observers.some(o => resolveEnabled(o.options.enabled, this) !== false) }
 *     shouldFetchOptionally(q, prevQ, opts, prevOpts) {
 *       return (q !== prevQ || resolveEnabled(prevOpts.enabled, q) === false) && ... && isStale(q, opts)
 *     }
 *
 * The tests exist because the next `npm update` cannot be reviewed by reading.
 */

const KEY = ["surface", "probe"];

function makeClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity, staleTime: 0 } },
  });
}

describe("SurfaceVisibility — the context", () => {
  function Probe() {
    return <span>{String(useSurfaceVisible())}</span>;
  }

  it("defaults to visible with no provider, so adoption is surface-by-surface", () => {
    expect(renderToStaticMarkup(<Probe />)).toContain("true");
  });

  it("is visible inside a visible surface", () => {
    expect(
      renderToStaticMarkup(
        <SurfaceVisibility visible>
          <Probe />
        </SurfaceVisibility>
      )
    ).toContain("true");
  });

  it("is covered inside a covered surface", () => {
    expect(
      renderToStaticMarkup(
        <SurfaceVisibility visible={false}>
          <Probe />
        </SurfaceVisibility>
      )
    ).toContain("false");
  });

  /**
   * The composition rule, and the reason this is one mechanism rather than
   * three special cases: the game panel covering the board and focused entry
   * covering the game page are the same statement at two depths.
   */
  it("ANDs down the tree — a visible child inside a covered parent stays covered", () => {
    expect(
      renderToStaticMarkup(
        <SurfaceVisibility visible={false}>
          <SurfaceVisibility visible>
            <Probe />
          </SurfaceVisibility>
        </SurfaceVisibility>
      )
    ).toContain("false");
  });
});

describe("React Query semantics this design depends on", () => {
  /**
   * RULE ONE. A change marks everything stale and fetches only what is visible.
   */
  it("invalidate MARKS a disabled query stale and does NOT fetch it", async () => {
    const client = makeClient();
    const queryFn = vi.fn(async () => "v1");

    const observer = new QueryObserver(client, { queryKey: KEY, queryFn, enabled: false });
    const unsub = observer.subscribe(() => {});

    await client.fetchQuery({ queryKey: KEY, queryFn });
    queryFn.mockClear();

    await client.invalidateQueries({ queryKey: KEY });
    await new Promise((r) => setTimeout(r, 20));

    expect(client.getQueryState(KEY)?.isInvalidated).toBe(true);
    expect(queryFn).not.toHaveBeenCalled();

    unsub();
  });

  /**
   * THE CONTROL. Without this, the case above would pass just as happily
   * against a client that never refetches anything, and would be evidence of
   * nothing. This is the difference between an instrument and a decoration.
   */
  it("...but DOES fetch an ENABLED one, so the case above is about `enabled`", async () => {
    const client = makeClient();
    const queryFn = vi.fn(async () => "v1");

    const observer = new QueryObserver(client, { queryKey: KEY, queryFn, enabled: true });
    const unsub = observer.subscribe(() => {});

    /**
     * Wait for the initial fetch to SETTLE, not merely to have been called.
     * Waiting on the call alone leaves it in flight, and invalidating an
     * in-flight query is a different code path — the first version of this test
     * did that and reported "an enabled observer does not refetch", which is
     * false and would have made the disabled case above evidence of nothing.
     */
    await vi.waitFor(() => expect(client.getQueryState(KEY)?.status).toBe("success"));
    queryFn.mockClear();

    await client.invalidateQueries({ queryKey: KEY });
    await vi.waitFor(() => expect(queryFn).toHaveBeenCalled());

    unsub();
  });

  /**
   * RULE TWO. A surface becoming visible fetches what is stale.
   */
  it("enabling a STALE disabled query refetches it — reveal, not mount", async () => {
    const client = makeClient();
    const queryFn = vi.fn(async () => "v1");

    const observer = new QueryObserver(client, { queryKey: KEY, queryFn, enabled: false });
    const unsub = observer.subscribe(() => {});

    await client.fetchQuery({ queryKey: KEY, queryFn });
    await client.invalidateQueries({ queryKey: KEY });
    queryFn.mockClear();

    // The reveal.
    observer.setOptions({ queryKey: KEY, queryFn, enabled: true });
    await vi.waitFor(() => expect(queryFn).toHaveBeenCalledTimes(1));

    unsub();
  });

  /**
   * The other half of rule two, and the one that keeps a back-out cheap: if
   * nothing invalidated while the surface was covered there is nothing to
   * fetch, so revealing a FRESH query costs nothing. Without this the rule
   * would trade a fan-out for a refetch on every navigation.
   */
  it("enabling a FRESH disabled query does NOT refetch", async () => {
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: Infinity, staleTime: 60_000 } },
    });
    const queryFn = vi.fn(async () => "v1");

    const observer = new QueryObserver(client, {
      queryKey: KEY,
      queryFn,
      enabled: false,
      staleTime: 60_000,
    });
    const unsub = observer.subscribe(() => {});

    await client.fetchQuery({ queryKey: KEY, queryFn, staleTime: 60_000 });
    queryFn.mockClear();

    observer.setOptions({ queryKey: KEY, queryFn, enabled: true, staleTime: 60_000 });
    await new Promise((r) => setTimeout(r, 20));

    expect(queryFn).not.toHaveBeenCalled();
    unsub();
  });

  /**
   * A covered surface keeps RENDERING. Disabling stops fetches, not the cache —
   * which is the property the panel idiom exists to provide (CLAUDE.md #12),
   * and the reason this rule does not have to unmount the warm board.
   */
  it("a covered query still serves its cached data", async () => {
    const client = makeClient();
    const queryFn = vi.fn(async () => "cached-value");

    await client.fetchQuery({ queryKey: KEY, queryFn });

    const observer = new QueryObserver(client, { queryKey: KEY, queryFn, enabled: false });
    const unsub = observer.subscribe(() => {});
    expect(observer.getCurrentResult().data).toBe("cached-value");
    unsub();
  });
});
