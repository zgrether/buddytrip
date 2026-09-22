import { describe, it, expect } from "vitest";
import { QueryClient, QueryObserver } from "@tanstack/react-query";
import { cancelRosterWriters, type RosterCacheUtils } from "./rosterCacheSync";

/**
 * THE ROSTER ADD RACE — adding crew to a team put one of them back in
 * "available crew" a second later.
 *
 * ── WHICH DOOR THIS WATCHES ────────────────────────────────────────────────
 *
 * There are TWO, and they are not the same bug:
 *
 *   Door 1 (2026-07-11, `aeb40e8a`) — four mutations racing their own
 *     `onSettled -> invalidate` calls. Closed by the trailing-edge `pendingRef`
 *     guard in `useTeamAssignmentMutations`. Covers taps CLOSER TOGETHER than
 *     one write round trip.
 *   Door 2 — THIS FILE — `onMutate` cancelled `teamAssignments.list` and not
 *     `competitions.faceBootstrap`, which writes the same cache key through
 *     LiveFaceClient's seed. Opened 2026-07-26 (`e07e2ebe`) when that
 *     invalidate was added, two weeks after door 1 was closed.
 *
 * Door 2 needs taps SPACED WIDER than a write round trip — far enough apart
 * that door 1's guard lets a settle through. That is a human going down a list
 * at ~1s intervals, and it is why tapping FASTER was safer and why deliberate
 * testing never found it.
 *
 * ── WHY THIS TEST IS GATED AND NOT TIMED ───────────────────────────────────
 *
 * The investigation harness reproduced this in 5 of 10 latency combinations.
 * A test that samples latencies fails about half the time, gets called flaky,
 * and stops being read. So the reproducing interleaving is PINNED as an explicit
 * event order through deferred promises — there is no wall-clock latency in this
 * file, and the ordering cannot drift on a loaded CI runner.
 *
 * ── WHY IT DRIVES THE REAL FUNCTION ────────────────────────────────────────
 *
 * It calls `cancelRosterWriters`, the same function `TeamsPanel`'s four
 * `onMutate`s call. A test that transcribed the cancel list would stay GREEN
 * against a build with the faceBootstrap line deleted — measuring a path the app
 * does not take. (Lived twice: `pickemCardAgreement.test.ts` called the engine
 * directly and passed while every live card was wrong.) Deleting the
 * faceBootstrap line from `rosterCacheSync.ts` fails `cancels BOTH writers`
 * and `the newly-added member survives` below; the characterization test is the
 * standing proof those two can go red.
 */

const A = ["teamAssignments.list"] as const;
const B = ["competitions.faceBootstrap"] as const;
const KEY = { tripId: "trip_1", competitionId: "comp_1" };

type Row = { user_id: string };

function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => { resolve = r; });
  return { promise, resolve };
}

/** Let TanStack's notify batching and any settled promises drain. No latency. */
const flush = async () => { for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0)); };

const ids = (qc: QueryClient) => ((qc.getQueryData(A) as Row[] | undefined) ?? []).map((r) => r.user_id);

/**
 * The board + roster as they sit on screen: `teamAssignments.list` observed
 * directly, and `competitions.faceBootstrap` re-seeding it on every resolve —
 * LiveFaceClient.tsx's `useMemo`, which runs during render whenever `boot`'s
 * identity changes.
 */
function mount() {
  const server: Row[] = [];
  let gate = deferred<void>();

  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  qc.setQueryDefaults(A, { staleTime: 60_000, queryFn: async () => [...server] });
  qc.setQueryDefaults(B, {
    staleTime: Infinity,
    // The snapshot is taken when the request reaches the DB; the response
    // arrives when the gate opens. A snapshot older than a later write is the
    // whole mechanism.
    queryFn: async () => { const snapshot = [...server]; await gate.promise; return { assignments: snapshot }; },
  });

  const utils: RosterCacheUtils = {
    teamAssignments: { list: { cancel: () => qc.cancelQueries({ queryKey: A }) } },
    competitions: { faceBootstrap: { cancel: () => qc.cancelQueries({ queryKey: B }) } },
  };

  const obsA = new QueryObserver(qc, { queryKey: A });
  const unsubA = obsA.subscribe(() => {});
  const obsB = new QueryObserver<{ assignments: Row[] }>(qc, { queryKey: B, staleTime: Infinity });
  let lastBoot: unknown;
  const unsubB = obsB.subscribe((r) => {
    if (!r.data || r.data === lastBoot) return;
    lastBoot = r.data;
    qc.setQueryData(A, r.data.assignments);
  });

  return {
    qc, utils, server,
    openGate: () => { gate.resolve(); },
    /** A settle's `invalidateQueries(faceBootstrap)` — starts a fetch that parks. */
    startBootstrapRefetch: () => { gate = deferred<void>(); void qc.invalidateQueries({ queryKey: B }); },
    stop: () => { unsubA(); unsubB(); lastBoot = undefined; },
  };
}

/**
 * The pinned interleaving, which is the one that reproduces. It is the real
 * sequence from the mobile crew roster, with the clock removed:
 *
 *   0. Nobody is on the team. The bootstrap has resolved once, carrying [].
 *   1. P1 is tapped and lands. Their settle invalidates faceBootstrap, and that
 *      refetch snapshots the roster as [P1] — then parks in flight.
 *   2. P2 is tapped: `onMutate` cancels, then writes P2 optimistically.
 *   3. P2's write lands on the server.
 *   4. The bootstrap from step 1 finally returns, carrying [P1].
 *
 * Step 0 matters and is not ceremony. TanStack's structural sharing hands back
 * the PREVIOUS object when new data is deeply equal, and LiveFaceClient's seed
 * is a `useMemo` keyed on `boot` — so a bootstrap that resolves to the same
 * roster twice re-seeds nothing and clobbers nothing. The defect needs the
 * bootstrap to MOVE (here [] -> [P1]) while being behind the optimistic cache,
 * which is exactly what a burst of adds produces: measured over five taps, the
 * bootstrap is always one person behind.
 *
 * `cancelWriters` is the ONLY variable: the real function, or the pre-fix
 * behaviour of cancelling the list alone.
 */
async function runRace(cancelWriters: (m: ReturnType<typeof mount>) => Promise<void>) {
  const m = mount();
  await m.qc.prefetchQuery({ queryKey: A });
  const boot0 = m.qc.prefetchQuery({ queryKey: B });
  m.openGate();
  await boot0;
  await flush();                                   // 0. seeded from a roster of []

  await cancelRosterWriters(m.utils, KEY);         // 1. tap P1 — always the fixed path;
  m.qc.setQueryData(A, (old: Row[] | undefined) => [...(old ?? []), { user_id: "P1" }]);
  m.server.push({ user_id: "P1" });                //    this tap is not what is under test
  m.startBootstrapRefetch();                       //    their settle -> bootstrap snapshots [P1]
  await flush();

  await cancelWriters(m);                          // 2. tap P2 — THE VARIABLE
  m.qc.setQueryData(A, (old: Row[] | undefined) => [...(old ?? []), { user_id: "P2" }]);
  m.server.push({ user_id: "P2" });                // 3. the write lands

  m.openGate();                                    // 4. the stale bootstrap returns [P1]
  await flush();

  const roster = ids(m.qc);
  m.stop();
  return roster;
}

describe("cancelRosterWriters — the faceBootstrap door", () => {
  it("cancels BOTH writers of teamAssignments.list, not just the list", async () => {
    const cancelled: string[] = [];
    const utils: RosterCacheUtils = {
      teamAssignments: { list: { cancel: (i) => { cancelled.push(`teamAssignments.list:${i.competitionId}`); } } },
      competitions: { faceBootstrap: { cancel: (i) => { cancelled.push(`competitions.faceBootstrap:${i.tripId}`); } } },
    };
    await cancelRosterWriters(utils, KEY);
    // Exact set and exact inputs: a cancel aimed at the wrong trip cancels nothing.
    expect(cancelled.sort()).toEqual([
      "competitions.faceBootstrap:trip_1",
      "teamAssignments.list:comp_1",
    ]);
  });

  it("the newly-added member survives a bootstrap that resolves after their add", async () => {
    const roster = await runRace((m) => cancelRosterWriters(m.utils, KEY));
    expect(roster).toEqual(["P1", "P2"]);
  });

  /**
   * THE RED PROOF, standing in the file rather than run once by hand.
   *
   * Identical interleaving, with the ONE difference that the faceBootstrap
   * cancel is missing — i.e. `rosterCacheSync.ts` with its second line deleted,
   * which is what `TeamsPanel` did before this fix. P2 is put back into
   * "available crew" by a bootstrap snapshot that predates them.
   *
   * If this ever goes GREEN, the test above has stopped being able to fail and
   * is no longer evidence of anything — fix this file, do not delete it.
   */
  it("CHARACTERIZATION — cancelling only the list loses the member (the bug)", async () => {
    const roster = await runRace((m) => m.qc.cancelQueries({ queryKey: A }).then(() => {}));
    expect(roster).toEqual(["P1"]);
    expect(roster).not.toContain("P2");
  });
});
