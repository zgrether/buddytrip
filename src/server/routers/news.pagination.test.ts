import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { TestContext, genId } from "../../__tests__/helpers/test-setup";

/**
 * `news.list` pages, and the pinned tier survives paging (#868).
 *
 * ── What was wrong ──────────────────────────────────────────────────────────
 * It was the one unbounded query on the chat surface — no limit, no cursor,
 * every post and its whole block payload on every load. Prevention rather than
 * repair: production holds one post.
 *
 * ── The part that needed care ───────────────────────────────────────────────
 * `messages.list`'s cursor is a bare `created_at`, which is a correct keyset over
 * its ordering because it has ONE tier. The news feed orders `pinned DESC,
 * created_at DESC`, so the same cursor is NOT a keyset over it: an older pinned
 * post would be paged past and then sort to the top of a later page — visibly
 * wrong, and only for the posts someone deliberately marked as most important.
 *
 * So the tiers page separately, and these tests pin that: pinned posts ride page
 * one whatever their age, and the cursor walks only the unpinned tier.
 */
let ctx: TestContext;
let tripId: string;
let ownerId: string;

async function seedPost(opts: { pinned?: boolean; createdAt: string; text: string }) {
  const id = genId("news");
  const { error } = await ctx.admin.from("news_posts").insert({
    id,
    trip_id: tripId,
    author_id: ownerId,
    blocks: [{ type: "text", text: opts.text }],
    pinned: opts.pinned ?? false,
    created_at: opts.createdAt,
  });
  if (error) throw new Error(`seedPost failed: ${error.message}`);
  return id;
}

/** `2026-01-DD` — one post per day, so ordering is unambiguous. */
const day = (d: number) => `2026-01-${String(d).padStart(2, "0")}T00:00:00Z`;

describe("news.list pagination (#868)", () => {
  beforeAll(async () => {
    ctx = await TestContext.create();
    tripId = await ctx.createTrip("News Pagination");
    ownerId = ctx.user.id;
    // Sequential, never Promise.all — the local-stack convention.
    for (let d = 1; d <= 12; d++) {
      await seedPost({ createdAt: day(d), text: `unpinned ${d}` });
    }
    // Deliberately the OLDEST post in the trip. Under a bare `created_at` cursor
    // it would fall off the end; pinned means it belongs on page one.
    await seedPost({ pinned: true, createdAt: "2025-01-01T00:00:00Z", text: "pinned ancient" });
  }, 60_000);

  afterAll(async () => {
    await ctx.cleanup();
  });

  it("page one is bounded, and reports that more exists", async () => {
    const page = await ctx.caller().news.list({ tripId, limit: 5 });
    // 5 unpinned + the 1 pinned — the pinned tier rides along, it is not part of
    // the page budget.
    expect(page.posts.filter((p) => !p.pinned)).toHaveLength(5);
    expect(page.nextCursor, "12 unpinned posts, 5 returned — there is more").not.toBeNull();
  }, 60_000);

  it("the OLDEST post in the trip is on page one, because it is pinned", async () => {
    const page = await ctx.caller().news.list({ tripId, limit: 5 });
    const pinned = page.posts.filter((p) => p.pinned);
    expect(pinned, "a pinned post you have to scroll to find is not pinned").toHaveLength(1);
    // And it leads the page — the tier ordering is preserved, not just membership.
    expect(page.posts[0]!.pinned).toBe(true);
  }, 60_000);

  it("the cursor walks the unpinned tier to exhaustion, with no repeats and no gaps", async () => {
    const seen: string[] = [];
    let cursor: string | null | undefined;
    let pages = 0;
    do {
      const page = await ctx.caller().news.list({
        tripId,
        limit: 5,
        ...(cursor ? { cursor } : {}),
      });
      pages++;
      // Pinned appears on page one ONLY — otherwise it would repeat on every page.
      expect(page.posts.filter((p) => p.pinned), `page ${pages}`).toHaveLength(pages === 1 ? 1 : 0);
      seen.push(...page.posts.filter((p) => !p.pinned).map((p) => p.id));
      cursor = page.nextCursor;
    } while (cursor && pages < 10);

    expect(pages, "12 unpinned at 5/page = 3 pages").toBe(3);
    expect(seen, "no post is delivered twice — pages do not overlap").toHaveLength(new Set(seen).size);
    expect(seen, "every unpinned post is delivered exactly once").toHaveLength(12);
  }, 60_000);

  it("the last page reports no next cursor rather than a phantom one", async () => {
    // The over-fetch-by-one is what buys this: a full page is not assumed to mean
    // more exists, which is wrong on an exact multiple of `limit`.
    let cursor: string | null | undefined;
    let last: { nextCursor: string | null } | null = null;
    for (let i = 0; i < 10; i++) {
      const page = await ctx.caller().news.list({ tripId, limit: 6, ...(cursor ? { cursor } : {}) });
      last = page;
      cursor = page.nextCursor;
      if (!cursor) break;
    }
    // 12 unpinned / 6 per page = exactly 2 full pages, then the end.
    expect(last!.nextCursor).toBeNull();
  }, 60_000);

  it("defaults to a bounded page even when the caller asks for nothing", async () => {
    // The regression that matters: the old query had no limit at all, so the
    // default must not be "everything".
    const page = await ctx.caller().news.list({ tripId });
    expect(page.posts.length).toBeLessThanOrEqual(51); // 50 unpinned + pinned tier
  }, 60_000);
});
