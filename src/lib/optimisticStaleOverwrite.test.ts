import { describe, it, expect } from "vitest";
import { QueryClient, QueryObserver } from "@tanstack/react-query";

/**
 * THE PICK FLASH — a refetch already on the wire lands AFTER a newer optimistic
 * write and reinstates the state the user just replaced.
 *
 * Reported from a device: "when you change the winner of a match and it has to
 * clear out the old results, sometimes they clear and switch to the new
 * winner/loser, but sometimes they flash the old ones briefly."
 *
 * The "sometimes" is the whole diagnosis. A render bug is not intermittent; a
 * race is. This pins the race against the REAL library rather than inferring it,
 * for the same reason `invalidateCancelsRefetch.test.ts` exists (CLAUDE.md #23: a
 * library behaviour our code merely tolerates fails invisibly).
 *
 * ── The sequence ────────────────────────────────────────────────────────────
 *   1. pick A       → optimistic setData → mutate → onSettled → reconcile()
 *                     → refetch R1 starts (a pick measured ~806ms in production)
 *   2. CHANGE the winner, before R1 lands → optimistic setData applies the
 *      CASCADE, clearing every downstream pick the change orphans
 *   3. R1 lands, carrying server state from before step 2 → the cleared winners
 *      REAPPEAR
 *   4. B's own reconcile → R2 → the correct state finally arrives
 *
 * Between 3 and 4 the board shows the old winners. That is the flash, and it is
 * only visible when the change happens while R1 is in flight — hence "sometimes".
 *
 * It is specifically a CHANGE rather than a first pick because a change is the
 * case where the optimistic write REMOVES things. A stale response reinstating a
 * check-mark that was never there is invisible; reinstating a whole cleared
 * subtree in both brackets is not.
 *
 * ── Why the existing guard does not cover it ────────────────────────────────
 * `pendingPicks` in BracketScoringSurface says it is "not about saving requests;
 * it is about never letting a stale response overwrite a newer local truth."
 * It cannot do that. It gates whether a NEW reconcile is ISSUED; it has no effect
 * on a refetch already in flight — and `cancelRefetch: false`, which the same
 * component passes deliberately, guarantees that refetch is left alone and its
 * data lands. The comment states an invariant the mechanism does not implement.
 */

/** A query fn that resolves on demand, so a response can be made to land late. */
function deferredQuery() {
  const resolvers: Array<(v: unknown) => void> = [];
  let calls = 0;
  const fn = () => {
    calls++;
    return new Promise<unknown>((resolve) => resolvers.push(resolve));
  };
  return {
    fn,
    get calls() {
      return calls;
    },
    /** Resolve the Nth in-flight fetch (1-indexed). */
    resolve(n: number, value: unknown) {
      resolvers[n - 1]?.(value);
    },
  };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

async function mount(client: QueryClient, key: unknown[], queryFn: () => Promise<unknown>) {
  const observer = new QueryObserver(client, { queryKey: key, queryFn, staleTime: 0, retry: false });
  const unsub = observer.subscribe(() => {});
  await flush();
  return unsub;
}

/** The draw as the cache holds it, reduced to the one column that moves. */
type Draw = { key: string; winnerSeed: number | null }[];

const SERVER_BEFORE: Draw = [
  { key: "main:1:1", winnerSeed: 1 },
  { key: "main:2:1", winnerSeed: 1 }, // downstream of the pick — orphaned by a change
  { key: "lower:1:1", winnerSeed: 4 }, // the loser's side, also downstream
];

/** What the optimistic cascade produces when the user CHANGES main:1:1 to seed 2:
 *  the new winner, and every downstream result cleared. */
const OPTIMISTIC_AFTER_CHANGE: Draw = [
  { key: "main:1:1", winnerSeed: 2 },
  { key: "main:2:1", winnerSeed: null },
  { key: "lower:1:1", winnerSeed: null },
];

const KEY = ["games.bracketDraw", { gameId: "g-1" }];

describe("a refetch in flight when the winner changes", () => {
  it("REPRODUCES THE FLASH: the stale response reinstates the cleared results", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const q = deferredQuery();
    const unsub = await mount(client, KEY, q.fn);

    // Initial load — the board as it stood after the first pick.
    q.resolve(1, SERVER_BEFORE);
    await flush();
    expect(client.getQueryData(KEY)).toEqual(SERVER_BEFORE);

    // 1 · the previous pick's reconcile puts a refetch on the wire.
    void client.invalidateQueries({ queryKey: KEY }, { cancelRefetch: false });
    await flush();
    expect(q.calls, "R1 is in flight").toBe(2);

    // 2 · the user CHANGES the winner. The optimistic cascade clears downstream.
    client.setQueryData(KEY, OPTIMISTIC_AFTER_CHANGE);
    expect(client.getQueryData(KEY)).toEqual(OPTIMISTIC_AFTER_CHANGE);

    // 3 · R1 lands, carrying state from BEFORE the change.
    q.resolve(2, SERVER_BEFORE);
    await flush();

    // THE FLASH, pinned: the cleared results are back on screen.
    expect(
      client.getQueryData(KEY),
      "an in-flight response that predates the optimistic write overwrote it",
    ).toEqual(SERVER_BEFORE);

    unsub();
  });

  it("THE FIX: cancelling in-flight fetches before the optimistic write holds the new state", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const q = deferredQuery();
    const unsub = await mount(client, KEY, q.fn);

    q.resolve(1, SERVER_BEFORE);
    await flush();

    void client.invalidateQueries({ queryKey: KEY }, { cancelRefetch: false });
    await flush();
    expect(q.calls).toBe(2);

    // THE ONE ADDED STEP. A response already on the wire predates this action by
    // definition, so it cannot be newer truth — cancel it, THEN write.
    //
    // This is the canonical React Query optimistic sequence (cancel → setData),
    // and it is NOT the `onMutate` + snapshot-restore idiom CLAUDE.md #1 forbids:
    // #1 is about how to ROLL BACK (invalidate and re-pull, never restore a
    // snapshot), which is unchanged. Cancelling is about which response is
    // allowed to win, and it is orthogonal.
    await client.cancelQueries({ queryKey: KEY });
    client.setQueryData(KEY, OPTIMISTIC_AFTER_CHANGE);

    // R1 resolves anyway — a cancelled fetch's promise still settles.
    q.resolve(2, SERVER_BEFORE);
    await flush();

    expect(
      client.getQueryData(KEY),
      "the cancelled response must not reach the cache",
    ).toEqual(OPTIMISTIC_AFTER_CHANGE);

    unsub();
  });

  it("cancel does NOT need awaiting — the paint stays synchronous", async () => {
    /**
     * The form the component actually uses, pinned separately because it is the
     * one that ships.
     *
     * `handlePick` must write the check-mark in the same tick as the tap — the
     * whole reason the optimistic patch exists is that a pick costs ~806ms in
     * production. Awaiting `cancelQueries` before `setData` would put a microtask
     * between the tap and the mark, and worse, invites someone to later make the
     * handler `async` and await the network too.
     *
     * `cancelQueries` dispatches the cancellation synchronously; only the settling
     * of the promise is async. So `void cancel(); setData(...)` is enough, and
     * this proves it rather than assuming it.
     */
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const q = deferredQuery();
    const unsub = await mount(client, KEY, q.fn);

    q.resolve(1, SERVER_BEFORE);
    await flush();
    void client.invalidateQueries({ queryKey: KEY }, { cancelRefetch: false });
    await flush();
    expect(q.calls).toBe(2);

    // NOT awaited — exactly what the tap handler does.
    void client.cancelQueries({ queryKey: KEY });
    client.setQueryData(KEY, OPTIMISTIC_AFTER_CHANGE);
    // The mark is on screen NOW, in this tick.
    expect(client.getQueryData(KEY)).toEqual(OPTIMISTIC_AFTER_CHANGE);

    q.resolve(2, SERVER_BEFORE);
    await flush();
    expect(
      client.getQueryData(KEY),
      "the un-awaited cancel still keeps the stale response out",
    ).toEqual(OPTIMISTIC_AFTER_CHANGE);

    unsub();
  });

  it("the fix does not strand the query: a later reconcile still refetches", async () => {
    // The obvious way to get this wrong is to cancel and leave the cache with no
    // path back to server truth. The pick's own onSettled reconcile must still
    // land — otherwise the flash is traded for a permanently optimistic board.
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const q = deferredQuery();
    const unsub = await mount(client, KEY, q.fn);

    q.resolve(1, SERVER_BEFORE);
    await flush();
    void client.invalidateQueries({ queryKey: KEY }, { cancelRefetch: false });
    await flush();

    await client.cancelQueries({ queryKey: KEY });
    client.setQueryData(KEY, OPTIMISTIC_AFTER_CHANGE);
    q.resolve(2, SERVER_BEFORE);
    await flush();

    // The change's own reconcile — the server has now recorded it.
    const SERVER_AFTER: Draw = OPTIMISTIC_AFTER_CHANGE;
    void client.invalidateQueries({ queryKey: KEY }, { cancelRefetch: false });
    await flush();
    q.resolve(3, SERVER_AFTER);
    await flush();

    expect(client.getQueryData(KEY), "server truth still arrives").toEqual(SERVER_AFTER);
    unsub();
  });

  /**
   * THE GUARD THAT ACTUALLY PROTECTS THE FIX.
   *
   * Everything above tests the LIBRARY: it proves the race is real and that
   * cancelling stops it. None of it would go red if someone deleted the cancel
   * from `BracketScoringSurface` — the mechanism would still behave exactly as
   * pinned, and the flash would come back with a green suite.
   *
   * The suite runs in `environment: "node"` with no renderer, so a source guard is
   * the honest instrument here — the same approach `TripIdProvider.test.ts` uses
   * to keep a rule from being quietly reverted.
   *
   * ORDER is the assertion, not presence. A `cancel` placed AFTER the `setData`
   * would read as compliance and do nothing: the stale response is only excluded
   * if cancellation is dispatched before the write it is protecting.
   */
  it("BracketScoringSurface cancels in-flight fetches BEFORE the optimistic write", async () => {
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const src = readFileSync(
      join(process.cwd(), "src/components/games/bracket/BracketScoringSurface.tsx"),
      "utf8",
    );

    // Narrow to the tap handler; the file has other cancel/setData users.
    const start = src.indexOf("const handlePick");
    expect(start, "handlePick not found — this guard needs re-pointing").toBeGreaterThan(-1);
    const body = src.slice(start, src.indexOf("const allComplete", start));

    const cancelAt = body.indexOf("bracketDraw.cancel(");
    const setDataAt = body.indexOf("bracketDraw.setData(");

    expect(
      cancelAt,
      "handlePick must cancel in-flight bracketDraw fetches — without it a reconcile " +
        "already on the wire lands after the optimistic write and reinstates the " +
        "cleared cascade (the change-a-winner flash)",
    ).toBeGreaterThan(-1);
    expect(setDataAt, "handlePick must still write optimistically").toBeGreaterThan(-1);
    expect(
      cancelAt < setDataAt,
      "the cancel must come BEFORE the setData — after it, it protects nothing",
    ).toBe(true);
  });

  it("a FIRST pick is unaffected — which is why the report says 'when you change'", () => {
    // Not a race test; a statement of scope. A first pick only ADDS a winner, so
    // a stale response reinstating "no winner" is a check-mark that blinks off and
    // back. A CHANGE clears a cascade, so the same stale response reinstates a
    // whole subtree across both brackets. Same mechanism, very different visibility
    // — which is the reason this was reported as a change-only symptom.
    const orphaned = SERVER_BEFORE.filter((m) => m.winnerSeed !== null).length;
    const afterChange = OPTIMISTIC_AFTER_CHANGE.filter((m) => m.winnerSeed !== null).length;
    expect(orphaned - afterChange, "a change clears more than it sets").toBeGreaterThan(0);
  });
});
