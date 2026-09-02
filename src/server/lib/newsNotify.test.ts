import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { TestContext } from "../../__tests__/helpers/test-setup";
import { buildNewsPayload, notifyNewsPost } from "./newsNotify";
import type { NewsBlock } from "@/lib/news";

/**
 * PUSH CONFIGURATION IS CONTROLLED HERE, NOT READ FROM THE MACHINE (#1247).
 *
 * The send-path test used to assert `notConfigured: true` on the stated premise
 * that "VAPID is absent locally". Nothing enforced that premise, and it is false
 * on any machine whose `.env.local` carries keys — so the file was green in CI
 * and red for the developer who had configured push. The assertion was about the
 * environment, not about the code.
 *
 * `vapid.ts` reads both keys into module-level consts AT IMPORT TIME, so
 * `vi.stubEnv` cannot reach them afterwards. Mocking the module is what makes
 * the state settable, and it makes BOTH branches reachable — the configured half
 * had never executed in any test, because no environment the suite runs in has
 * keys.
 *
 * NOT a conditional skip. Skipping when keys are present would make this file
 * green by not running it, which is the same defect as an assertion that cannot
 * fail: a check that reports success without checking.
 */
const { vapid } = vi.hoisted(() => ({ vapid: { configured: false } }));
vi.mock("./vapid", () => ({
  pushConfigured: () => vapid.configured,
  getWebPush: () =>
    vapid.configured ? { sendNotification: vi.fn().mockResolvedValue({ statusCode: 201 }) } : null,
}));

/**
 * BOTH functions follow the flag, and the reason is worth recording because it
 * misled the mutation check that was supposed to validate this file.
 *
 * The senders gate on `if (!wp || !pushConfigured())` — an OR of two REDUNDANT
 * conditions, since the real `getWebPush()` already returns null exactly when
 * `pushConfigured()` is false. So mutating either one alone leaves the other
 * still driven by the flag and every test stays green. Two mutations passed in a
 * row here, and the tempting read — "the mock is inert" — was wrong both times:
 * a probe confirmed the mock IS applied and that this process really does see
 * VAPID keys from `.env.local`. Only mutating BOTH sides turns the send-path
 * test red, which is what proves it load-bearing.
 *
 * Kept mirrored rather than simplified: a mock that answered `pushConfigured()`
 * honestly while always handing back a live `webpush` would pass a check the
 * real module fails, which is the shape that makes a fixture measure something
 * the app never does.
 */

// ---------------------------------------------------------------------------
// buildNewsPayload — pure, no DB.
// ---------------------------------------------------------------------------

describe("buildNewsPayload", () => {
  const heading: NewsBlock[] = [{ type: "heading", text: "Tee times posted" }];
  const photoOnly: NewsBlock[] = [{ type: "media", kind: "photo", src: null }];

  it("titles with the trip name, always suffixed with News", () => {
    const p = buildNewsPayload({
      tripId: "t1",
      tripTitle: "Cabo 2026",
      authorName: "Zach",
      postId: "p1",
      blocks: heading,
    });
    expect(p.title).toBe("Cabo 2026 · News");
  });

  it("body carries the author and a preview of the post's own content", () => {
    const p = buildNewsPayload({
      tripId: "t1",
      tripTitle: "Cabo 2026",
      authorName: "Zach",
      postId: "p1",
      blocks: heading,
    });
    expect(p.body).toBe("Zach: Tee times posted");
  });

  it("falls back to a generic body when the post has no previewable text", () => {
    const p = buildNewsPayload({
      tripId: "t1",
      tripTitle: "Cabo 2026",
      authorName: "Zach",
      postId: "p1",
      blocks: photoOnly,
    });
    expect(p.body).toBe("Zach posted an update");
  });

  it("deep-links to the News segment of chat, not the bare trip", () => {
    const p = buildNewsPayload({
      tripId: "trip-abc",
      tripTitle: "Cabo 2026",
      authorName: "Zach",
      postId: "p1",
      blocks: heading,
    });
    expect(p.url).toBe("/trips/trip-abc?chat=1&channel=news");
  });

  /**
   * PER-POST, not per-trip. Two DIFFERENT announcements must both surface —
   * unlike chat's per-ROOM tag, where a newer message in the same room
   * legitimately replacing an unread notice about an older one IS the point.
   */
  it("tags per POST — a different post gets a different tag", () => {
    const a = buildNewsPayload({
      tripId: "t1",
      tripTitle: "T",
      authorName: "Z",
      postId: "post-a",
      blocks: heading,
    });
    const b = buildNewsPayload({
      tripId: "t1",
      tripTitle: "T",
      authorName: "Z",
      postId: "post-b",
      blocks: heading,
    });
    expect(a.tag).toBe("bt-news-post-a");
    expect(b.tag).toBe("bt-news-post-b");
    expect(a.tag).not.toBe(b.tag);
  });

  /** No message content leaked beyond what the post itself already says —
   *  this is the ONE category that's allowed to preview content (unlike
   *  chat), so the check here is narrower: no fields beyond the four. */
  it("carries exactly title/body/url/tag — nothing else", () => {
    const p = buildNewsPayload({
      tripId: "t1",
      tripTitle: "T",
      authorName: "Z",
      postId: "p1",
      blocks: heading,
    });
    expect(Object.keys(p).sort()).toEqual(["body", "tag", "title", "url"]);
  });
});

// ---------------------------------------------------------------------------
// Integration — the real audience resolution against the DB.
// ---------------------------------------------------------------------------

let ctx: TestContext;
let tripId: string;
let ownerId: string;
let organizerId: string;
let memberId: string;

const HEADING: NewsBlock[] = [{ type: "heading", text: "Test post" }];

beforeAll(async () => {
  ctx = await TestContext.create();
  tripId = await ctx.createTrip("News Notify Trip");
  ownerId = ctx.user.id;
  // Sequentially, never Promise.all — these race and flake (CLAUDE.md).
  await ctx.addTripMember(tripId, "planner", "Organizer");
  await ctx.addTripMember(tripId, "member", "Member");
  organizerId = ctx.getUser("planner").id;
  memberId = ctx.getUser("member").id;
}, 60_000);

afterAll(async () => {
  // The 4 test users are SHARED and PERSISTENT across the whole suite.
  await ctx.admin
    .from("users")
    .update({ notification_prefs: {} })
    .in("id", [ownerId, organizerId, memberId]);
  await ctx.cleanup();
}, 60_000);

describe("notifyNewsPost — audience", () => {
  it("addresses every trip member except the author", async () => {
    const r = await notifyNewsPost({
      tripId,
      postId: crypto.randomUUID(),
      blocks: HEADING,
      authorId: ownerId,
      trigger: "news_posted",
      admin: ctx.admin,
    });
    // Owner excluded; Organizer + Member remain. Exactly 2 — not "at least 2",
    // since a stray third recipient (e.g. a leaked outsider) must fail this.
    expect(r.audience).toBe(2);
  });

  it("the audience shifts with the author — excludes whoever posted, not a fixed set", async () => {
    // COUNT ALONE PROVES NOTHING HERE: excluding member leaves 2 (owner +
    // organizer), same as excluding owner leaves 2 (organizer + member) in the
    // previous case — a build that always excludes the OWNER regardless of who
    // actually posted would pass an audience.toBe(2) assertion in BOTH tests.
    // Confirmed by writing exactly that mutant against news.ts's `resend` and
    // watching an equivalent count-only test pass (see news.test.ts). The
    // decisive check is `push_send_log.actor_user_id`, which `notifyNewsPost`
    // sets to the `authorId` it was actually given.
    const before = new Date().toISOString();
    const postId = crypto.randomUUID();
    const r = await notifyNewsPost({
      tripId,
      postId,
      blocks: HEADING,
      authorId: memberId,
      trigger: "news_posted",
      admin: ctx.admin,
    });
    expect(r.audience).toBe(2);

    // Scoped to AFTER this call, not just "most recent" — other tests in this
    // suite write `trigger: 'news_posted'` rows for the same trip too, and
    // ordering-only would be relying on execution order rather than proof.
    const { data } = await ctx.admin
      .from("push_send_log")
      .select("actor_user_id")
      .eq("trip_id", tripId)
      .eq("trigger", "news_posted")
      .gte("created_at", before)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    expect(data?.actor_user_id).toBe(memberId);
    expect(data?.actor_user_id).not.toBe(ownerId);
  });

  it("never throws for an unknown trip — degrades to zero audience", async () => {
    const r = await notifyNewsPost({
      tripId: "does-not-exist",
      postId: crypto.randomUUID(),
      blocks: HEADING,
      authorId: ownerId,
      trigger: "news_posted",
      admin: ctx.admin,
    });
    expect(r.audience).toBe(0);
    expect(r.send).toBeNull();
  });

  /**
   * `sent`/`skippedPreferenceOff` are 0 with push unconfigured — the trap
   * `chatNotify.test.ts` names too. `notConfigured: true` is the signal that the
   * send path was actually REACHED (not skipped upstream), which is what
   * distinguishes "ran and had nothing to send" from "never got there".
   *
   * The unconfigured state is now SET by this file rather than inherited from
   * the machine, so the signal means what it says wherever it runs.
   */
  it("reaches the send path — notConfigured, not silently skipped", async () => {
    vapid.configured = false;
    const r = await notifyNewsPost({
      tripId,
      postId: crypto.randomUUID(),
      blocks: HEADING,
      authorId: ownerId,
      trigger: "news_posted",
      admin: ctx.admin,
    });
    expect(r.send).not.toBeNull();
    expect(r.send?.notConfigured).toBe(true);
    expect(r.send?.recipients).toBe(2);
  });

  /**
   * The other half of the branch, which no environment the suite runs in could
   * reach: with push CONFIGURED, the same send must report `notConfigured:
   * false` while still finding the same recipients.
   *
   * It pins the thing the old test only appeared to: that `notConfigured`
   * tracks the RESOLVED CONFIG rather than anything about the machine. Run the
   * two cases together and the flag has to move with the config — which the
   * previous version could not show, because it only ever observed one value and
   * could not tell you why it had it.
   *
   * `sent` stays 0 deliberately: these recipients have no registered devices, so
   * nothing is dispatched and no network call is attempted. The claim here is
   * about REACHING the send with push available, not about delivery.
   */
  it("reports configured when push IS configured — the flag follows the config", async () => {
    vapid.configured = true;
    try {
      const r = await notifyNewsPost({
        tripId,
        postId: crypto.randomUUID(),
        blocks: HEADING,
        authorId: ownerId,
        trigger: "news_posted",
        admin: ctx.admin,
      });
      expect(r.send).not.toBeNull();
      expect(r.send?.notConfigured).toBe(false);
      expect(r.send?.recipients).toBe(2);
      expect(r.send?.sent).toBe(0);
    } finally {
      // Restore, so ordering between tests cannot decide the previous case.
      vapid.configured = false;
    }
  });
});
