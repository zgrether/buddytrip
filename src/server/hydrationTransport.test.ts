import { describe, it, expect } from "vitest";
import { QueryClient, hydrate } from "@tanstack/react-query";
import { initTRPC } from "@trpc/server";
import { createServerSideHelpers } from "@trpc/react-query/server";
import { createTRPCReact, getQueryKey } from "@trpc/react-query";
import superjson from "superjson";
import { z } from "zod";

/**
 * #730 — the server→client hydration transport, pinned end to end.
 *
 * The trip layout prefetches on the server and expects the client to find that
 * data already in its cache. For the layout's entire existence it did not: the
 * payload was discarded on arrival, silently, and every prefetch was decorative.
 * Three separate pieces of work (`competitions.getByTrip`, `faceBootstrap`,
 * `tripMembers.list`) each hit the symptom and two of them built manual
 * `setData` seed components around it.
 *
 * This file exists because **the failure was invisible in every other way**:
 * no error, no warning, and `tsc` clean — `createServerSideHelpers().dehydrate()`
 * is TYPED as returning `DehydratedState` while actually returning a superjson
 * envelope. A type annotation cannot catch a library lying about its own return
 * type, so the contract needs a runtime test or it will regress unnoticed.
 *
 * No DB, no browser: this is a claim about two libraries' data contract, and it
 * is testable directly with a probe router.
 */

const t = initTRPC.create({ transformer: superjson });
const probeRouter = t.router({
  demo: t.router({
    get: t.procedure
      .input(z.object({ tripId: z.string() }))
      .query(() => ({ ok: true, n: 42 })),
  }),
});
const reactClient = createTRPCReact<typeof probeRouter>();

function serverHelpers() {
  return createServerSideHelpers({ router: probeRouter, ctx: {}, transformer: superjson });
}
/** Mirrors the app's client QueryClient in the one respect that matters here. */
function clientQueryClient(extra?: ConstructorParameters<typeof QueryClient>[0]) {
  return new QueryClient({
    defaultOptions: { queries: { staleTime: 60_000 } },
    ...extra,
  });
}

describe("#730 — createServerSideHelpers().dehydrate() transport", () => {
  it("returns a superjson ENVELOPE, not a DehydratedState — the whole bug", async () => {
    const helpers = serverHelpers();
    await helpers.demo.get.prefetch({ tripId: "t1" });
    const state = helpers.dehydrate() as unknown as Record<string, unknown>;

    // If this ever starts failing, tRPC changed the contract and
    // `HydrateQueryState`'s deserialize should be revisited — that would be
    // GOOD news, but it must not pass silently either way.
    expect(Object.keys(state)).toContain("json");
    expect((state as { queries?: unknown }).queries).toBeUndefined();
  });

  it("hydrating the envelope as-is lands NOTHING, with no error", async () => {
    const helpers = serverHelpers();
    await helpers.demo.get.prefetch({ tripId: "t1" });

    const qc = clientQueryClient();
    // Exactly what the layout used to do. Note it does not throw — that silence
    // is why this went unnoticed for the layout's entire existence.
    hydrate(qc, helpers.dehydrate() as never);

    expect(qc.getQueryCache().getAll()).toHaveLength(0);
    expect(
      qc.getQueryData(getQueryKey(reactClient.demo.get, { tripId: "t1" }, "query"))
    ).toBeUndefined();
  });

  it("deserializing first lands the data, FRESH, under the client's exact key", async () => {
    const helpers = serverHelpers();
    await helpers.demo.get.prefetch({ tripId: "t1" });

    const qc = clientQueryClient();
    // What HydrateQueryState does.
    hydrate(qc, superjson.deserialize(helpers.dehydrate() as never) as never);

    const key = getQueryKey(reactClient.demo.get, { tripId: "t1" }, "query");
    const entry = qc.getQueryCache().getAll()[0];

    // Three separate claims, because a partial pass is a different bug:
    // the data arrives…
    expect(qc.getQueryData(key)).toEqual({ ok: true, n: 42 });
    // …under the key the client observer will actually look up…
    expect(entry?.queryHash).toBe(JSON.stringify(key));
    // …and FRESH, so `refetchOnMount` (default true, stale-only) leaves it
    // alone. A hydrated-but-stale entry would refetch and look identical to
    // the original bug from the network tab.
    expect(entry?.isStale()).toBe(false);
  });

  it("setting hydrate.deserializeData as WELL breaks it — the two configs are alternatives", async () => {
    // tRPC's RSC helper (`@trpc/react-query/rsc`) documents
    // `dehydrate.serializeData` / `hydrate.deserializeData` as required, and
    // both are absent from this app's QueryClient. That looks like a missing
    // half of a config. It isn't — it is a DIFFERENT transport.
    //
    // `createServerSideHelpers`'s internal client is a bare
    // `new QueryClient(config.queryClientConfig)` with no `serializeData`, so
    // per-query data stays PLAIN and the whole state is serialized once at the
    // end. Adding `deserializeData` runs superjson over data that was never
    // superjson'd.
    //
    // This test is the guard against someone "finishing the job" later.
    const helpers = serverHelpers();
    await helpers.demo.get.prefetch({ tripId: "t1" });

    const qc = clientQueryClient({
      defaultOptions: {
        queries: { staleTime: 60_000 },
        hydrate: { deserializeData: superjson.deserialize },
      },
    });
    hydrate(qc, superjson.deserialize(helpers.dehydrate() as never) as never);

    const key = getQueryKey(reactClient.demo.get, { tripId: "t1" }, "query");
    // The double-deserialize does NOT reproduce the original payload.
    expect(qc.getQueryData(key)).not.toEqual({ ok: true, n: 42 });
  });

  it("a value superjson preserves and plain JSON would not survives the round trip", async () => {
    // The reason the deserialize happens in a CLIENT component rather than in
    // the Server Component: keep the envelope opaque across the RSC boundary so
    // superjson, not React's Flight serializer, decides what survives. This
    // pins that superjson's own round trip is lossless for a type plain JSON
    // flattens — the class of value that would otherwise arrive silently wrong.
    const t2 = initTRPC.create({ transformer: superjson });
    const dateRouter = t2.router({
      when: t2.procedure.query(() => ({ at: new Date("2026-08-01T12:00:00.000Z") })),
    });
    const helpers = createServerSideHelpers({
      router: dateRouter,
      ctx: {},
      transformer: superjson,
    });
    await helpers.when.prefetch();

    const qc = clientQueryClient();
    hydrate(qc, superjson.deserialize(helpers.dehydrate() as never) as never);

    const data = qc.getQueryCache().getAll()[0]?.state.data as { at: Date } | undefined;
    expect(data?.at).toBeInstanceOf(Date);
    expect(data?.at.toISOString()).toBe("2026-08-01T12:00:00.000Z");
  });
});
