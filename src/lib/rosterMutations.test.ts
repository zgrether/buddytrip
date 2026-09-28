import { describe, it, expect } from "vitest";
import { MutationObserver, QueryClient, QueryObserver } from "@tanstack/react-query";
import { createRosterMutations, type AssignVars, type RosterMutationCache, type RosterRow } from "./rosterMutations";

/**
 * #1405 — a FAILED roster tap must not wipe a sibling tap that SUCCEEDED.
 *
 * The four roster mutations used to snapshot the cache in `onMutate` and restore
 * it in `onError`. Taps down a crew list run concurrently, so tap 1's snapshot
 * predates tap 2; when tap 1 failed, the restore removed tap 2's player from the
 * screen although the server had already committed them. It healed at the next
 * refetch, which is why the END STATE was right in every run and an end-state
 * assertion never saw it (MEMORY: "intermittent means race", end-state
 * assertions are blind to a wrong state that heals itself).
 *
 * So this asserts the PATH: the invariant is checked at the one moment the
 * restore would fire, with the healing refetch deliberately held back.
 *
 * It drives `createRosterMutations`, the module `TeamsPanel` wires, through a
 * real `MutationObserver` on one shared observer (as one `useMutation` serves
 * every tap), with a real `QueryClient`. No wall clock: every response is a
 * deferred promise released in a pinned order.
 */

const KEY = ["teamAssignments.list"] as const;

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

const flush = async () => { for (let i = 0; i < 6; i++) await new Promise((r) => setTimeout(r, 0)); };

type Policy = ReturnType<typeof createRosterMutations>;

/** The roster surface as mounted: the roster query observed, server truth behind it. */
function mount() {
  const server: RosterRow[] = [];
  let gate: ReturnType<typeof deferred<void>> | null = null;

  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity }, mutations: { retry: false } } });
  qc.setQueryDefaults(KEY, {
    staleTime: 60_000,
    queryFn: async () => {
      const snapshot = [...server];
      if (gate) await gate.promise; // a refetch can be held in flight
      return snapshot;
    },
  });
  const obs = new QueryObserver(qc, { queryKey: KEY });
  const unsub = obs.subscribe(() => {});

  const refetches: { leaderboard: boolean }[] = [];
  const cache: RosterMutationCache = {
    cancelWriters: () => qc.cancelQueries({ queryKey: KEY }),
    patch: (fn) => qc.setQueryData<RosterRow[]>(KEY, (old) => fn(old ?? [])),
    refetch: (opts) => { refetches.push(opts); void qc.invalidateQueries({ queryKey: KEY }); },
  };

  return {
    qc, server, cache, refetches,
    ids: () => ((qc.getQueryData(KEY) as RosterRow[] | undefined) ?? []).map((r) => r.user_id).sort(),
    holdRefetches: () => { gate = deferred<void>(); },
    releaseRefetches: () => { gate?.resolve(); gate = null; },
    stop: () => unsub(),
  };
}

/**
 * The pinned interleaving:
 *   0. The team is empty.
 *   1. P1 is tapped (optimistic), then P2 is tapped (optimistic). Both in flight.
 *   2. P2's write COMMITS on the server.
 *   3. P1's write FAILS. <- the restore fired here, and removed P2
 *   4. The burst's refetch lands with server truth.
 */
async function runBurst(policy: (m: ReturnType<typeof mount>) => Policy) {
  const m = mount();
  await m.qc.prefetchQuery({ queryKey: KEY });
  const p = policy(m);

  const writes = new Map<string, ReturnType<typeof deferred<void>>>();
  const observer = new MutationObserver<void, Error, AssignVars, unknown>(m.qc, {
    mutationFn: (v) => {
      const d = deferred<void>();
      writes.set(v.userId, d);
      return d.promise;
    },
    ...(p.assign as object),
  });

  const t1 = observer.mutate({ competitionId: "c", userId: "P1", teamId: "blue" }).catch(() => {});
  const t2 = observer.mutate({ competitionId: "c", userId: "P2", teamId: "blue" }).catch(() => {});
  await flush();
  const afterTaps = m.ids();

  m.holdRefetches(); // keep the healing refetch in flight so the path is visible

  m.server.push({ user_id: "P2", team_id: "blue" });
  writes.get("P2")!.resolve(); // 2. P2 commits
  await flush();

  writes.get("P1")!.reject(new Error("write failed")); // 3. P1 fails
  await flush();
  const afterFailure = m.ids(); // THE MOMENT the restore used to fire

  m.releaseRefetches(); // 4. server truth lands
  await Promise.all([t1, t2]);
  await flush();
  const settled = m.ids();

  m.stop();
  return { afterTaps, afterFailure, settled, refetches: m.refetches };
}

describe("roster mutations — a failed tap never discards a committed sibling (#1405)", () => {
  it("P2, committed on the server, stays on screen when P1 fails", async () => {
    const r = await runBurst((m) => createRosterMutations(m.cache));
    expect(r.afterTaps).toEqual(["P1", "P2"]); // both optimistic
    expect(r.afterFailure, "at the moment P1 fails, the committed P2 is still shown").toContain("P2");
  });

  it("the failure is healed by re-pulling server truth, once, at the end of the burst", async () => {
    const r = await runBurst((m) => createRosterMutations(m.cache));
    // The failed P1 is gone and the committed P2 remains: server truth, not a snapshot.
    expect(r.settled).toEqual(["P2"]);
    // Exactly one refetch for the burst (the trailing edge), carrying the
    // leaderboard because an assign changes a team's size.
    expect(r.refetches).toEqual([{ leaderboard: true }]);
  });

  /**
   * THE RED PROOF, standing in the file.
   *
   * The real policy with the pre-#1405 error path put back: snapshot the cache
   * in onMutate, restore it in onError. P2 vanishes at the moment P1 fails. If
   * this ever goes GREEN the harness can no longer see the bug, and the first
   * test above is evidence of nothing; fix the harness, do not delete this.
   */
  it("CHARACTERIZATION — restoring a snapshot on error drops the committed sibling (the bug)", async () => {
    const r = await runBurst((m) => {
      const real = createRosterMutations(m.cache);
      const withRestore = {
        ...real.assign,
        onMutate: async (v: AssignVars) => {
          const previous = m.qc.getQueryData<RosterRow[]>(KEY);
          await real.assign.onMutate(v);
          return { previous };
        },
        onError: (_e: unknown, _v: unknown, ctx: { previous?: RosterRow[] } | undefined) => {
          if (ctx?.previous) m.qc.setQueryData(KEY, ctx.previous);
        },
      };
      return { ...real, assign: withRestore } as unknown as Policy;
    });
    expect(r.afterFailure).not.toContain("P2");
  });
});
