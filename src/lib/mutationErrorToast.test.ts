import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import path from "path";
import { MutationCache, QueryClient } from "@tanstack/react-query";

/**
 * Why a background write needs `meta.suppressErrorToast` and not an empty
 * `onError`.
 *
 * ── The mistake this pins, which shipped ───────────────────────────────────
 * The viewing heartbeat was written with `onError: () => {}` on the assumption
 * that handling the error locally stops it surfacing. It does not: React Query
 * calls the MutationCache's `onError` AND the mutation's own, and the
 * cache-level one in `providers.tsx` is what shows the toast. Against a
 * production database missing `viewing_at`, that put a toast on screen every 15
 * seconds for anyone who opened chat.
 *
 * That is CLAUDE.md #23 in miniature: a library behaviour the code depends on,
 * where being wrong is invisible to `tsc` and to every test that does not
 * actually run the library. So it gets a runtime test against the real
 * `MutationCache`, not a comment asserting how React Query works.
 */

function harness() {
  const seen: string[] = [];
  const client = new QueryClient({
    mutationCache: new MutationCache({
      onError: (_e, _v, _c, mutation) => {
        const suppressed = (mutation.meta as { suppressErrorToast?: boolean } | undefined)
          ?.suppressErrorToast;
        if (suppressed) return;
        seen.push("toast");
      },
    }),
    defaultOptions: { mutations: { retry: false } },
  });
  const run = async (options: Record<string, unknown>) => {
    const observer = client.getMutationCache().build(client, {
      mutationFn: async () => {
        throw new Error("could not find the 'viewing_at' column of 'chat_reads'");
      },
      ...options,
    });
    await observer.execute(undefined).catch(() => {});
  };
  return { seen, run };
}

describe("MutationCache.onError — what actually suppresses a toast", () => {
  /**
   * THE ASSERTION THE BUG NEEDED. If this ever passes with an empty `onError`,
   * React Query changed its dispatch and the codebase's suppression convention
   * needs revisiting.
   */
  it("still fires the cache handler when the mutation has its own onError", async () => {
    const { seen, run } = harness();
    await run({ onError: () => {} });
    expect(seen).toEqual(["toast"]);
  });

  it("does NOT fire when the mutation sets meta.suppressErrorToast", async () => {
    const { seen, run } = harness();
    await run({ meta: { suppressErrorToast: true } });
    expect(seen).toEqual([]);
  });

  /** The control: an ordinary mutation must still surface its failure. */
  it("fires for a mutation that opts out of nothing", async () => {
    const { seen, run } = harness();
    await run({});
    expect(seen).toEqual(["toast"]);
  });
});

describe("the viewing heartbeat opts out", () => {
  /**
   * Asserted against the SOURCE because the alternative — rendering
   * `FloatingChatPanel` — needs tRPC, a session and a DOM, none of which this
   * `node` suite has. Narrow and direct: the heartbeat is a timer-driven write
   * with no user-facing surface, so it must carry the opt-out.
   */
  it("declares meta.suppressErrorToast on markViewing", () => {
    const src = readFileSync(
      path.resolve(__dirname, "../components/FloatingChatPanel.tsx"),
      "utf8"
    );
    const call = src.slice(src.indexOf("trpc.messages.markViewing.useMutation("));
    const body = call.slice(0, call.indexOf("});") + 3);
    expect(body).toContain("suppressErrorToast: true");
    // The shape that shipped and silently did nothing.
    expect(body).not.toMatch(/onError:\s*\(\)\s*=>\s*\{\s*\}/);
  });
});
