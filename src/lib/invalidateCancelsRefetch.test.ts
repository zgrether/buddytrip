import { describe, it, expect } from "vitest";
import { QueryClient, QueryObserver } from "@tanstack/react-query";

/**
 * The mechanism behind the correction transition's wasted round trips —
 * VERIFIED against the real library, not inferred from behaviour.
 *
 * #835 measured `games.getById` being fetched THREE times for one boolean flip,
 * with the UI settling on the last one ~130 ms after the first response carrying
 * the answer had already arrived. It named `invalidateQueries`' default
 * `cancelRefetch: true` as the consistent explanation and was explicit that it
 * was **not a verified mechanism**: "Anyone acting on it should confirm it
 * first." This is that confirmation.
 *
 * CLAUDE.md #23 is the reason it is a test rather than a paragraph: a library's
 * behaviour that our code merely *tolerates* fails invisibly, and a type
 * signature is not a guard. `invalidateQueries` returns `Promise<void>` whether
 * it delivered data or threw the result away — the return type cannot tell the
 * two apart, which is exactly why this needed measuring in the first place.
 *
 * Two facts are pinned, because the fix depends on both:
 *   1. A second `invalidateQueries` while a refetch is in flight CANCELS it and
 *      starts another. The first response's data never reaches the cache.
 *   2. `cancelRefetch: false` does NOT — the in-flight fetch is left to finish
 *      and its data lands. This is the escape hatch, so it is pinned too: a fix
 *      that passes the flag is only correct if the flag actually does this.
 */

/** A query fn that resolves on demand, so a second invalidate can land mid-flight. */
function deferredQuery() {
  const resolvers: Array<(v: string) => void> = [];
  let calls = 0;
  const fn = () => {
    calls++;
    const n = calls;
    return new Promise<string>((resolve) => resolvers.push((v) => resolve(`${v}#${n}`)));
  };
  return {
    fn,
    get calls() {
      return calls;
    },
    /** Resolve the Nth in-flight fetch (1-indexed). */
    resolve(n: number, value: string) {
      resolvers[n - 1]?.(value);
    },
  };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

/**
 * Mount the query the way a component does.
 *
 * `invalidateQueries` only REFETCHES queries that have an active observer —
 * without one it just marks the entry stale, which is why this needs a real
 * `QueryObserver` rather than a bare `fetchQuery`. That is also the property
 * CLAUDE.md #10 turns on: the board's queries refetch because the board is still
 * mounted beneath the panel.
 */
async function mount(client: QueryClient, key: unknown[], queryFn: () => Promise<string>) {
  const observer = new QueryObserver(client, { queryKey: key, queryFn, staleTime: 0, retry: false });
  const unsub = observer.subscribe(() => {});
  await flush();
  return unsub;
}

describe("invalidateQueries + an in-flight refetch (React Query 5)", () => {
  it("DEFAULT (cancelRefetch: true): the second invalidate discards the first response", async () => {
    const q = deferredQuery();
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
    const key = ["game", "getById"];

    // Mount + prime, as the panel does when it opens.
    const unsub = await mount(client, key, q.fn);
    q.resolve(1, "primed");
    await flush();
    expect(client.getQueryData(key)).toContain("primed");

    // Wave 1 — the handler's own awaited invalidate.
    const wave1 = client.invalidateQueries({ queryKey: key });
    await flush();
    expect(q.calls, "wave 1 started a refetch").toBe(2);

    // Wave 2 — realtime / configHash arriving while wave 1 is still in flight.
    const wave2 = client.invalidateQueries({ queryKey: key });
    await flush();
    expect(q.calls, "wave 2 started ANOTHER refetch rather than joining wave 1").toBe(3);

    // Wave 1's response now lands. This is the response the UI is waiting on.
    q.resolve(2, "ANSWER");
    await flush();

    // THE FINDING: it was thrown away. The cache still holds the pre-wave value,
    // so the UI cannot reflect the answer that has already arrived over the wire.
    expect(client.getQueryData(key), "wave 1's data was discarded").not.toContain("ANSWER");

    // Only wave 3's response reaches the cache — one extra round trip of waiting.
    q.resolve(3, "ANSWER");
    await flush();
    expect(client.getQueryData(key)).toContain("ANSWER");

    await Promise.all([wave1, wave2]);
    unsub();
    client.clear();
  });

  it("cancelRefetch: false lets the in-flight refetch finish and its data land", async () => {
    const q = deferredQuery();
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
    const key = ["game", "getById"];

    const unsub = await mount(client, key, q.fn);
    q.resolve(1, "primed");
    await flush();

    const wave1 = client.invalidateQueries({ queryKey: key });
    await flush();
    expect(q.calls).toBe(2);

    // The same second wave — but told not to cancel.
    const wave2 = client.invalidateQueries({ queryKey: key }, { cancelRefetch: false });
    await flush();
    expect(q.calls, "no second refetch was started — wave 2 joined the one in flight").toBe(2);

    q.resolve(2, "ANSWER");
    await flush();
    expect(client.getQueryData(key), "the in-flight response reached the cache").toContain("ANSWER");

    await Promise.all([wave1, wave2]);
    unsub();
    client.clear();
  });
});
