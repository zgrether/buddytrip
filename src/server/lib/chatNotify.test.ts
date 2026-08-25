import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { TestContext } from "../../__tests__/helpers/test-setup";
import {
  CHAT_ACTIVE_VIEWING_WINDOW_MS,
  buildChatPayload,
  chatGateVerdict,
  notifyChatMessage,
} from "./chatNotify";
import { CHAT_VIEW_HEARTBEAT_MS } from "@/lib/chatViewHeartbeat";

/**
 * The chat push gate.
 *
 * ── What is actually being asserted, and why not the obvious thing ──────────
 * The claim this feature makes is "a burst of ten messages does not produce ten
 * notifications". The tempting test is to run a burst and assert the count is
 * small — which passes if the gate is broken and something ELSE happens to be
 * suppressing (no devices, no VAPID, an empty audience, a thrown error swallowed
 * by design). Every one of those is reachable here: this module never throws,
 * and VAPID is absent locally, so "nothing was sent" is the DEFAULT state of the
 * world and proves nothing at all.
 *
 * So every assertion below is on `eligible` — WHO PASSED THE GATE — and on the
 * per-clause counters (`suppressedActive` / `suppressedBehind`) that say WHY the
 * others didn't. "Sixteen in the channel, four watching, eleven behind, one
 * notified" is a claim several different bugs cannot produce; "zero sent" is a
 * claim almost any bug produces.
 *
 * The timeline is built from EXPLICIT past timestamps rather than wall-clock
 * `now()`, so the active-viewing clause can never fire by accident and silently
 * turn a "behind" assertion into a "watching" one that happens to have the same
 * total.
 */

// A fixed, long-past timeline. Ten minutes apart — comfortably outside the
// 5-minute viewing window, so nothing here is `active` unless a test says so.
const T0 = Date.parse("2026-01-01T00:00:00.000Z");
const MIN = 60_000;
const at = (minutes: number) => new Date(T0 + minutes * MIN).toISOString();

describe("chatGateVerdict — the gate, in isolation", () => {
  it("notifies someone who was caught up and is not watching", () => {
    expect(
      chatGateVerdict({
        lastSeenAt: at(0), // read the predecessor
        prevMessageAt: at(0),
        messageAt: at(60), // an hour later — well outside the viewing window
      })
    ).toBe("notify");
  });

  it("stays silent for someone already behind — they were told when they fell behind", () => {
    expect(
      chatGateVerdict({
        lastSeenAt: at(0),
        prevMessageAt: at(30), // a message arrived after their last read
        messageAt: at(60),
      })
    ).toBe("behind");
  });

  /**
   * FAIL CLOSED when the read position is unknown.
   *
   * This clause returned `notify` in the first version of this module, on the
   * reasoning that an absent read row means "nothing to be behind on, so give
   * them one and let the normal rule take over from there". There is no normal
   * rule to take over: with no position, nothing ever moves them into `behind`,
   * so they are caught up on message 1 and on message 400 alike, and a member
   * who never opens chat gets notified for every message in the trip. The burst
   * test below is what caught it — it read 10 of 10 notified.
   *
   * The real fix is `resolveLastSeen`, which means the caller should never hand
   * this a null at all. This clause is the backstop, and the two defaults are
   * not symmetric: silence costs one missed notification, "caught up" costs a
   * push per message forever to someone whose state could not be read.
   */
  it("falls silent — not open — when the read position is unknown", () => {
    expect(
      chatGateVerdict({ lastSeenAt: null, prevMessageAt: at(30), messageAt: at(60) })
    ).toBe("behind");
  });

  it("notifies on the channel's first message, with no predecessor to be behind on", () => {
    // Clause 2 precedes the unknown-position backstop: nobody can be behind on
    // a channel that has never had a message, whatever their read state.
    expect(
      chatGateVerdict({ lastSeenAt: null, prevMessageAt: null, messageAt: at(60) })
    ).toBe("notify");
  });

  it("suppresses someone whose read mark moved inside the viewing window", () => {
    expect(
      chatGateVerdict({
        lastSeenAt: at(60 - 1), // one minute ago
        prevMessageAt: at(0),
        messageAt: at(60),
      })
    ).toBe("active");
  });

  /**
   * The race the window exists for: the recipient's client received the realtime
   * INSERT and marked read before this server-side read ran, so their read mark
   * is NEWER than the message. That is the strongest possible evidence they are
   * looking at it — it must not come out as a negative age and fall through to
   * `notify`.
   */
  it("suppresses a read mark stamped AFTER the message (client won the race)", () => {
    expect(
      chatGateVerdict({
        lastSeenAt: at(60.5),
        prevMessageAt: at(0),
        messageAt: at(60),
      })
    ).toBe("active");
  });

  /**
   * Clause ORDER, asserted directly. This recipient is BEHIND (their read mark
   * predates the previous message) and also actively reading right now. If the
   * caught-up test ran first they would come out `behind`, which is harmless —
   * but the reverse mistake, `active` losing to `notify` for a caught-up viewer,
   * is the bug that buzzes someone staring at the screen. Pinning the order here
   * is what stops the clauses being reshuffled as equivalent.
   */
  it("checks 'watching' BEFORE 'caught up', so a viewer is never notified", () => {
    // Caught up AND watching -> active, not notify. This is the ordering that matters.
    expect(
      chatGateVerdict({
        lastSeenAt: at(59), // inside the window
        prevMessageAt: at(59), // and caught up on it
        messageAt: at(60),
      })
    ).toBe("active");
  });

  it("stops suppressing exactly at the window edge, not one tick early", () => {
    const edgeMinutes = CHAT_ACTIVE_VIEWING_WINDOW_MS / MIN;
    // Exactly at the boundary: `age < WINDOW` is false, so they are notifiable.
    expect(
      chatGateVerdict({
        lastSeenAt: at(60 - edgeMinutes),
        prevMessageAt: at(0),
        messageAt: at(60),
      })
    ).toBe("notify");
    // A hair inside it: still watching.
    expect(
      chatGateVerdict({
        lastSeenAt: new Date(T0 + 60 * MIN - CHAT_ACTIVE_VIEWING_WINDOW_MS + 1).toISOString(),
        prevMessageAt: at(0),
        messageAt: at(60),
      })
    ).toBe("active");
  });

  /**
   * The heartbeat and the window are a pair (see chatViewHeartbeat.ts): an open
   * panel re-stamps on the heartbeat, and the gate forgives a mark younger than
   * the window. If the heartbeat ever grew past the window, an open-but-silent
   * panel would fall outside it between beats and buzz at a message on screen —
   * the exact hole the heartbeat was added to close. A comment cannot hold that;
   * this can.
   */
  it("keeps the heartbeat comfortably inside the viewing window", () => {
    expect(CHAT_VIEW_HEARTBEAT_MS).toBeLessThan(CHAT_ACTIVE_VIEWING_WINDOW_MS);
    // "Comfortably" = room for at least one missed beat plus the gap between the
    // last beat and the message.
    expect(CHAT_VIEW_HEARTBEAT_MS * 2).toBeLessThan(CHAT_ACTIVE_VIEWING_WINDOW_MS);
  });
});

describe("buildChatPayload — what reaches the lock screen", () => {
  const base = {
    tripId: "trip-1",
    tripTitle: "BBMI Playground",
    senderName: "Brad",
    visibility: "crew" as const,
  };

  it("names the trip and the sender, and says nothing about the message", () => {
    const p = buildChatPayload(base);
    expect(p.title).toBe("BBMI Playground");
    expect(p.body).toBe("Brad sent a message");
  });

  it("distinguishes the Organizers channel, which is a different room", () => {
    expect(buildChatPayload({ ...base, visibility: "planning" }).title).toBe(
      "BBMI Playground · Organizers"
    );
  });

  it("deep-links to the trip, NOT to an invented chat URL param", () => {
    // AppShell keeps chat open/closed out of the URL deliberately. A notification
    // is not a reason to override that, so the link lands on the trip.
    const p = buildChatPayload(base);
    expect(p.url).toBe("/trips/trip-1");
    expect(p.url).not.toContain("chat=");
  });

  it("tags per channel so a later push replaces rather than stacks", () => {
    expect(buildChatPayload(base).tag).toBe("bt-chat-trip-1-crew");
    expect(buildChatPayload({ ...base, visibility: "planning" }).tag).toBe(
      "bt-chat-trip-1-planning"
    );
  });

  /**
   * The no-content rule, from the direction a test CAN check.
   *
   * This is the weaker half deliberately: it proves the payload is clean for the
   * inputs the builder accepts. The STRONG half is structural and lives in
   * `pushCallSites.guard.test.ts` — the builder has no text parameter and the
   * notifier never selects the column, so there is no message text to leak
   * regardless of what any test happens to try. Both halves are needed: this one
   * would still pass if a text field were added and simply left out of the copy.
   */
  it("puts nothing in the payload but the trip, the channel and the sender", () => {
    const p = buildChatPayload(base);
    expect(Object.keys(p).sort()).toEqual(["body", "tag", "title", "url"]);
    const serialized = JSON.stringify(p);
    for (const fragment of ["password", "Meet at the 9th", "secret"]) {
      expect(serialized).not.toContain(fragment);
    }
  });
});

// ---------------------------------------------------------------------------
// Integration — the real audience resolution and the real gate, against the DB.
// ---------------------------------------------------------------------------

let ctx: TestContext;
let tripId: string;
let ownerId: string;
let organizerId: string;
let memberId: string;

/** Insert a message with an EXPLICIT timestamp, so the timeline is controlled. */
async function seedMessage(args: {
  visibility: "crew" | "planning";
  senderId: string | null;
  minutes: number;
  system?: boolean;
}) {
  const id = crypto.randomUUID();
  const { error } = await ctx.admin.from("messages").insert({
    id,
    trip_id: tripId,
    user_id: args.senderId,
    channel: "trip",
    team_id: null,
    text: "SENTINEL-MESSAGE-BODY-must-never-reach-a-payload",
    visibility: args.visibility,
    message_type: args.system ? "system" : "user",
    created_at: at(args.minutes),
  });
  if (error) throw new Error(`seed message: ${error.message}`);
  return { id, createdAt: at(args.minutes) };
}

async function setRead(userId: string, visibility: "crew" | "planning", minutes: number) {
  const { error } = await ctx.admin.from("chat_reads").upsert(
    { trip_id: tripId, user_id: userId, visibility, last_read_at: at(minutes) },
    { onConflict: "trip_id,user_id,visibility" }
  );
  if (error) throw new Error(`set read: ${error.message}`);
}

async function clearMessages() {
  await ctx.admin.from("messages").delete().eq("trip_id", tripId);
  await ctx.admin.from("chat_reads").delete().eq("trip_id", tripId);
}

beforeAll(async () => {
  ctx = await TestContext.create();
  tripId = await ctx.createTrip("Chat Notify Trip");
  ownerId = ctx.user.id;
  // Sequentially, never Promise.all — these race and flake (CLAUDE.md).
  await ctx.addTripMember(tripId, "planner", "Organizer");
  await ctx.addTripMember(tripId, "member", "Member");
  organizerId = ctx.getUser("planner").id;
  memberId = ctx.getUser("member").id;
}, 60_000);

afterAll(async () => {
  // The 4 test users are SHARED and PERSISTENT across the whole suite, so any
  // preference this file writes must be put back or it leaks into every other
  // file's push assertions.
  await ctx.admin
    .from("users")
    .update({ notification_prefs: {} })
    .in("id", [ownerId, organizerId, memberId]);
  await ctx.cleanup();
}, 60_000);

describe("notifyChatMessage — audience", () => {
  it("addresses every crew member except the sender", async () => {
    await clearMessages();
    const m = await seedMessage({ visibility: "crew", senderId: ownerId, minutes: 0 });

    const r = await notifyChatMessage(
      {
        tripId,
        visibility: "crew",
        messageId: m.id,
        messageCreatedAt: m.createdAt,
        senderId: ownerId,
      },
      { admin: ctx.admin }
    );

    expect(r.audience).toBe(2);
    expect(r.eligible.sort()).toEqual([organizerId, memberId].sort());
    expect(r.eligible).not.toContain(ownerId);
  });

  /**
   * The Organizers channel notifies Organizers only — the CHANNEL's membership,
   * not the trip's. Asserted by naming the excluded person rather than by
   * counting: a count of 1 would also be produced by an audience that happened
   * to contain the wrong single person.
   */
  it("addresses only Owner + Organizer for the Organizers channel", async () => {
    await clearMessages();
    const m = await seedMessage({ visibility: "planning", senderId: ownerId, minutes: 0 });

    const r = await notifyChatMessage(
      {
        tripId,
        visibility: "planning",
        messageId: m.id,
        messageCreatedAt: m.createdAt,
        senderId: ownerId,
      },
      { admin: ctx.admin }
    );

    expect(r.eligible).toEqual([organizerId]);
    expect(r.eligible).not.toContain(memberId);
  });

  it("never notifies the sender, even on a message everyone else is notified for", async () => {
    await clearMessages();
    // Everyone else is CAUGHT UP, so the gate lets them through and the sender's
    // absence from `eligible` means something. With them all behind, `eligible`
    // would be empty and this test would pass without exercising actor exclusion
    // at all — a vacuous pass is the failure mode to design against here.
    await seedMessage({ visibility: "crew", senderId: memberId, minutes: 0 });
    await setRead(organizerId, "crew", 0);
    await setRead(memberId, "crew", 0);
    const m = await seedMessage({ visibility: "crew", senderId: ownerId, minutes: 30 });

    const r = await notifyChatMessage(
      {
        tripId,
        visibility: "crew",
        messageId: m.id,
        messageCreatedAt: m.createdAt,
        senderId: ownerId,
      },
      { admin: ctx.admin }
    );

    expect(r.eligible.sort()).toEqual([organizerId, memberId].sort());
    expect(r.eligible).not.toContain(ownerId);
    expect(r.audience).toBe(2);
  });

  /**
   * The fallback chain, exercised end to end rather than only as a unit.
   *
   * A member with NO `chat_reads` row is the case that broke the first version
   * of this module: absent-as-caught-up made them permanently notifiable. Here
   * they have never opened the channel, and a predecessor exists that postdates
   * their join — so `resolveLastSeen` lands on `joined_at`, they read as behind,
   * and they are silent. Asserted through the real DB because the whole point is
   * which COLUMN gets read when the obvious one is missing.
   */
  it("falls back to the member's join time when they have never opened the channel", async () => {
    await clearMessages();
    // No chat_reads rows at all, and a PREDECESSOR that predates their join
    // (the timeline is Jan 2026; these members joined just now, in beforeAll).
    // They could never have read those messages — they arrived after them — so
    // they are up to date, and this one notifies.
    //
    // This fixture is chosen because it is the case where the fallback and the
    // unknown-position backstop DISAGREE: `joined_at` says notify, `null` says
    // behind. A fixture where both said "behind" would pass with the fallback
    // deleted, which would make this test decorative — it would be asserting
    // clause 3 while claiming to assert `resolveLastSeen`.
    await seedMessage({ visibility: "crew", senderId: ownerId, minutes: 0 });
    const m = await seedMessage({ visibility: "crew", senderId: ownerId, minutes: 30 });

    const r = await notifyChatMessage(
      {
        tripId,
        visibility: "crew",
        messageId: m.id,
        messageCreatedAt: m.createdAt,
        senderId: ownerId,
      },
      { admin: ctx.admin }
    );

    expect(r.audience).toBe(2);
    expect(r.eligible.sort()).toEqual([organizerId, memberId].sort());
    expect(r.suppressedBehind).toBe(0);
  });
});

describe("notifyChatMessage — coalescing", () => {
  /**
   * THE CLAIM: a burst produces one notification per recipient, not one per
   * message.
   *
   * Counted by how many times each recipient PASSES THE GATE across the ten
   * sends, and cross-checked against the per-clause counters so a zero caused by
   * an empty audience or a swallowed error cannot masquerade as coalescing.
   */
  it("turns a 10-message burst into ONE notification per recipient", async () => {
    await clearMessages();
    // Both recipients start CAUGHT UP, pinned explicitly rather than left to a
    // fallback: 30 minutes before the first message, so they are outside the
    // viewing window and the only thing that can suppress them is the gate.
    await setRead(organizerId, "crew", -30);
    await setRead(memberId, "crew", -30);
    const notifiedCount = new Map<string, number>([
      [organizerId, 0],
      [memberId, 0],
    ]);
    let behindTotal = 0;

    for (let i = 0; i < 10; i++) {
      // Ten minutes apart, so nothing is ever inside the viewing window: this
      // burst is suppressed by the read-state gate alone, not by looking active.
      const m = await seedMessage({
        visibility: "crew",
        senderId: ownerId,
        minutes: i * 10,
      });
      const r = await notifyChatMessage(
        {
          tripId,
          visibility: "crew",
          messageId: m.id,
          messageCreatedAt: m.createdAt,
          senderId: ownerId,
        },
        { admin: ctx.admin }
      );
      for (const id of r.eligible) notifiedCount.set(id, (notifiedCount.get(id) ?? 0) + 1);
      behindTotal += r.suppressedBehind;
      // Nothing here should ever read as "watching" — if it does, this test is
      // measuring the wrong suppression and its headline number is a coincidence.
      expect(r.suppressedActive).toBe(0);
      expect(r.audience).toBe(2);
    }

    expect(notifiedCount.get(organizerId)).toBe(1);
    expect(notifiedCount.get(memberId)).toBe(1);
    // 2 recipients x 9 subsequent messages, all suppressed by the gate itself.
    expect(behindTotal).toBe(18);
  });

  it("re-arms after the recipient reads, and only for the one who read", async () => {
    await clearMessages();
    await seedMessage({ visibility: "crew", senderId: ownerId, minutes: 0 });
    // Both fell behind on that one.
    await setRead(organizerId, "crew", -10);
    await setRead(memberId, "crew", -10);

    const behind = await seedMessage({ visibility: "crew", senderId: ownerId, minutes: 10 });
    const r1 = await notifyChatMessage(
      {
        tripId,
        visibility: "crew",
        messageId: behind.id,
        messageCreatedAt: behind.createdAt,
        senderId: ownerId,
      },
      { admin: ctx.admin }
    );
    expect(r1.eligible).toEqual([]);
    expect(r1.suppressedBehind).toBe(2);

    // The organizer opens chat and catches up — long enough ago that they no
    // longer read as actively watching.
    await setRead(organizerId, "crew", 20);

    const next = await seedMessage({ visibility: "crew", senderId: ownerId, minutes: 60 });
    const r2 = await notifyChatMessage(
      {
        tripId,
        visibility: "crew",
        messageId: next.id,
        messageCreatedAt: next.createdAt,
        senderId: ownerId,
      },
      { admin: ctx.admin }
    );

    expect(r2.eligible).toEqual([organizerId]);
    expect(r2.suppressedBehind).toBe(1); // the member, still behind
  });

  it("suppresses whoever is watching, without suppressing whoever is not", async () => {
    await clearMessages();
    await seedMessage({ visibility: "crew", senderId: ownerId, minutes: 0 });
    // Organizer's panel is open: read mark one minute before the message.
    await setRead(organizerId, "crew", 59);
    // Member is caught up but away — last read at the predecessor, an hour ago.
    await setRead(memberId, "crew", 0);

    const m = await seedMessage({ visibility: "crew", senderId: ownerId, minutes: 60 });
    const r = await notifyChatMessage(
      {
        tripId,
        visibility: "crew",
        messageId: m.id,
        messageCreatedAt: m.createdAt,
        senderId: ownerId,
      },
      { admin: ctx.admin }
    );

    expect(r.eligible).toEqual([memberId]);
    expect(r.suppressedActive).toBe(1);
    expect(r.suppressedBehind).toBe(0);
  });

  /**
   * A system line ("X joined the trip") must not make anyone "behind".
   *
   * Unread counts already exclude system rows (`messages.countUnreadByChannel`),
   * so if one could serve as a predecessor here, a member joining would silence
   * the next real message for the whole channel — a divergence between two
   * places that answer the same question about the same table.
   */
  it("does not let a system message count as the predecessor", async () => {
    await clearMessages();
    await seedMessage({ visibility: "crew", senderId: ownerId, minutes: 0 });
    await setRead(organizerId, "crew", 0); // caught up on the real message
    await setRead(memberId, "crew", 0);
    // A join notice lands after their last read.
    await seedMessage({ visibility: "crew", senderId: null, minutes: 10, system: true });

    const m = await seedMessage({ visibility: "crew", senderId: ownerId, minutes: 60 });
    const r = await notifyChatMessage(
      {
        tripId,
        visibility: "crew",
        messageId: m.id,
        messageCreatedAt: m.createdAt,
        senderId: ownerId,
      },
      { admin: ctx.admin }
    );

    expect(r.eligible.sort()).toEqual([organizerId, memberId].sort());
    expect(r.suppressedBehind).toBe(0);
  });
});

describe("notifyChatMessage — preference", () => {
  /**
   * `chat` OFF means no push AT ANY VOLUME.
   *
   * Asserted on `skippedPreferenceOff` rather than on `sent`, because `sent` is
   * 0 here regardless — VAPID is absent locally. A test reading `sent` would
   * pass with the preference gate deleted entirely. The gate deliberately runs
   * BEFORE the not-configured check inside `sendPushToUsers` for exactly this
   * reason, so the counter is truthful in CI.
   */
  it("sends nothing to a recipient who has switched chat off", async () => {
    await clearMessages();
    await ctx.admin
      .from("users")
      .update({ notification_prefs: { chat: false } })
      .eq("id", memberId);
    await ctx.admin.from("users").update({ notification_prefs: {} }).eq("id", organizerId);

    const m = await seedMessage({ visibility: "crew", senderId: ownerId, minutes: 0 });
    const r = await notifyChatMessage(
      {
        tripId,
        visibility: "crew",
        messageId: m.id,
        messageCreatedAt: m.createdAt,
        senderId: ownerId,
      },
      { admin: ctx.admin }
    );

    // The GATE passed both — the preference is a separate, later clause, and
    // conflating them would hide a gate regression behind a muted user.
    expect(r.eligible.sort()).toEqual([organizerId, memberId].sort());
    expect(r.send?.skippedPreferenceOff).toBe(1);
    expect(r.send?.recipients).toBe(2);

    await ctx.admin.from("users").update({ notification_prefs: {} }).eq("id", memberId);
  });
});

describe("notifyChatMessage — the record", () => {
  /**
   * Migration 106's lesson: a pre-send exit that writes NO ROW is invisible, and
   * indistinguishable from a failure. "The gate suppressed everyone" is the
   * COMMON outcome for this trigger, so it must be recorded as its own outcome
   * rather than by returning quietly.
   */
  it("records a gate-suppressed send with its own outcome", async () => {
    await clearMessages();
    await seedMessage({ visibility: "crew", senderId: ownerId, minutes: 0 });
    await setRead(organizerId, "crew", -10);
    await setRead(memberId, "crew", -10);

    const before = new Date().toISOString();
    const m = await seedMessage({ visibility: "crew", senderId: ownerId, minutes: 30 });
    const r = await notifyChatMessage(
      {
        tripId,
        visibility: "crew",
        messageId: m.id,
        messageCreatedAt: m.createdAt,
        senderId: ownerId,
      },
      { admin: ctx.admin }
    );
    expect(r.eligible).toEqual([]);
    expect(r.send).toBeNull();

    const { data } = await ctx.admin
      .from("push_send_log")
      .select("trigger, type_key, outcome, sent, recipients")
      .eq("trip_id", tripId)
      .gte("created_at", before)
      .order("created_at", { ascending: false })
      .limit(1);

    expect(data?.[0]).toMatchObject({
      trigger: "chat_message",
      type_key: "chat",
      outcome: "gate_suppressed",
      sent: 0,
      recipients: 0,
    });
  });

  /**
   * The audit trail must not become the leak the payload isn't. `push_send_log`
   * is ids and counts by design (migration 105), and the message text is seeded
   * as a distinctive sentinel precisely so this can be checked rather than
   * assumed.
   */
  it("never writes message content to the audit trail", async () => {
    await clearMessages();
    const before = new Date().toISOString();
    const m = await seedMessage({ visibility: "crew", senderId: ownerId, minutes: 0 });
    await notifyChatMessage(
      {
        tripId,
        visibility: "crew",
        messageId: m.id,
        messageCreatedAt: m.createdAt,
        senderId: ownerId,
      },
      { admin: ctx.admin }
    );

    const { data } = await ctx.admin
      .from("push_send_log")
      .select("*")
      .eq("trip_id", tripId)
      .gte("created_at", before);

    expect((data ?? []).length).toBeGreaterThan(0);
    expect(JSON.stringify(data)).not.toContain("SENTINEL-MESSAGE-BODY");
  });
});
