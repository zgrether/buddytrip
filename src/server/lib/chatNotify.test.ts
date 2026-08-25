import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { TestContext } from "../../__tests__/helpers/test-setup";
import {
  CHAT_ACTIVE_VIEWING_WINDOW_MS,
  CHAT_REARM_AFTER_MS,
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

// A fixed, long-past timeline. Fixtures space messages well outside the
// viewing window unless a test is specifically about it, so nothing reads as
// `active` by accident.
const T0 = Date.parse("2026-01-01T00:00:00.000Z");
const MIN = 60_000;
const at = (minutes: number) => new Date(T0 + minutes * MIN).toISOString();

/**
 * `notifiedAt` defaults to "just now" in these cases, which keeps every
 * pre-existing assertion meaning what it meant before the time-based re-arm
 * existed. That default is load-bearing: null is PERMISSIVE on the time rule,
 * so leaving it out would silently turn the `behind` cases into `notify` and
 * the suite would still be green while asserting the opposite of its own names.
 */
function verdict(args: {
  lastSeenAt: string | null;
  prevMessageAt: string | null;
  messageAt: string;
  lastNotifiedAt?: string | null;
}) {
  return chatGateVerdict({
    lastSeenAt: args.lastSeenAt,
    prevMessageAt: args.prevMessageAt,
    messageAt: args.messageAt,
    lastNotifiedAt: args.lastNotifiedAt === undefined ? args.messageAt : args.lastNotifiedAt,
  });
}

describe("chatGateVerdict — the gate, in isolation", () => {
  it("notifies someone who was caught up and is not watching", () => {
    expect(
      verdict({
        lastSeenAt: at(0), // read the predecessor
        prevMessageAt: at(0),
        messageAt: at(60), // an hour later — well outside the viewing window
      })
    ).toBe("notify");
  });

  it("stays silent for someone behind who was notified recently", () => {
    expect(
      verdict({
        lastSeenAt: at(0),
        prevMessageAt: at(30), // a message arrived after their last read
        messageAt: at(60),
        lastNotifiedAt: at(59), // told a minute ago
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
   * who never opens chat gets notified for every message in the trip.
   *
   * The real fix is `resolveLastSeen`, which means the caller should never hand
   * this a null at all. This clause is the backstop, and the two defaults are
   * not symmetric: silence costs one missed notification, "caught up" costs a
   * push per message forever to someone whose state could not be read.
   */
  it("falls silent — not open — when the read position is unknown", () => {
    expect(
      verdict({
        lastSeenAt: null,
        prevMessageAt: at(30),
        messageAt: at(60),
        lastNotifiedAt: at(59),
      })
    ).toBe("behind");
  });

  it("notifies on the channel's first message, with no predecessor to be behind on", () => {
    // Clause 2 precedes the unknown-position backstop: nobody can be behind on
    // a channel that has never had a message, whatever their read state.
    expect(
      verdict({ lastSeenAt: null, prevMessageAt: null, messageAt: at(60) })
    ).toBe("notify");
  });

  it("suppresses someone whose read mark moved inside the viewing window", () => {
    expect(
      verdict({
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
      verdict({ lastSeenAt: at(60.5), prevMessageAt: at(0), messageAt: at(60) })
    ).toBe("active");
  });

  /**
   * Clause ORDER, asserted directly. The mistake that matters is `active`
   * losing to `notify` for a caught-up viewer — that is the bug that buzzes
   * someone staring at the screen.
   */
  it("checks 'watching' BEFORE 'caught up', so a viewer is never notified", () => {
    expect(
      verdict({
        lastSeenAt: at(59), // inside the window
        prevMessageAt: at(59), // and caught up on it
        messageAt: at(60),
      })
    ).toBe("active");
  });

  /**
   * ...and 'watching' also outranks the TIME-BASED RE-ARM. Someone with the
   * panel open has by definition not been waiting 30 minutes to hear anything,
   * and the re-arm must not reach past the one clause that protects a person
   * looking at the screen.
   */
  it("checks 'watching' BEFORE the time re-arm too", () => {
    expect(
      verdict({
        lastSeenAt: at(59), // watching
        prevMessageAt: at(30), // but behind
        lastNotifiedAt: at(0), // and long overdue on the time rule
        messageAt: at(60),
      })
    ).toBe("active");
  });

  it("stops suppressing exactly at the window edge, not one tick early", () => {
    const edgeMs = CHAT_ACTIVE_VIEWING_WINDOW_MS;
    const msgMs = T0 + 60 * MIN;
    // Exactly at the boundary: `age < WINDOW` is false, so they are notifiable.
    expect(
      verdict({
        lastSeenAt: new Date(msgMs - edgeMs).toISOString(),
        prevMessageAt: at(0),
        messageAt: at(60),
      })
    ).toBe("notify");
    // A hair inside it: still watching.
    expect(
      verdict({
        lastSeenAt: new Date(msgMs - edgeMs + 1).toISOString(),
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
   * the exact hole the heartbeat was added to close.
   *
   * The window was TIGHTENED to 2.5 minutes after production showed the cost of
   * a loose one: a message 17 seconds after someone closed the chat was
   * suppressed as "watching", so reading bought five minutes of silence
   * afterwards. It can only shrink as far as the heartbeat allows, which is why
   * this pins the relationship rather than either number.
   */
  it("keeps the heartbeat comfortably inside the viewing window", () => {
    expect(CHAT_VIEW_HEARTBEAT_MS).toBeLessThan(CHAT_ACTIVE_VIEWING_WINDOW_MS);
    // Room for a dropped beat plus the gap between the last beat and the message.
    expect(CHAT_VIEW_HEARTBEAT_MS * 2).toBeLessThan(CHAT_ACTIVE_VIEWING_WINDOW_MS);
  });
});

/**
 * THE SECOND RE-ARM.
 *
 * Reading alone was too strict, and this is the measured version of that claim:
 * of 14 chat sends in one production morning, 3 delivered and 11 were suppressed
 * as `behind`. Being behind now expires.
 */
describe("chatGateVerdict — behind expires", () => {
  const REARM_MIN = CHAT_REARM_AFTER_MS / MIN;

  it("notifies someone behind who has heard nothing for the re-arm window", () => {
    expect(
      verdict({
        lastSeenAt: at(0),
        prevMessageAt: at(30), // still behind — they never caught up
        lastNotifiedAt: at(60 - REARM_MIN), // last told exactly a window ago
        messageAt: at(60),
      })
    ).toBe("notify");
  });

  it("keeps them silent one tick before the window is up", () => {
    expect(
      verdict({
        lastSeenAt: at(0),
        prevMessageAt: at(30),
        lastNotifiedAt: new Date(T0 + 60 * MIN - CHAT_REARM_AFTER_MS + 1000).toISOString(),
        messageAt: at(60),
      })
    ).toBe("behind");
  });

  /**
   * Never-notified is PERMISSIVE, and that is what lets migration 144 ship with
   * no backfill. Every existing `chat_reads` row has a null here; if null meant
   * "notified just now" instead, the deploy would silence everyone who was
   * already behind for a full window — reintroducing the exact bug this rule
   * fixes, via its own migration.
   */
  it("treats never-notified as eligible, so no backfill is needed", () => {
    expect(
      verdict({
        lastSeenAt: at(0),
        prevMessageAt: at(30),
        lastNotifiedAt: null,
        messageAt: at(60),
      })
    ).toBe("notify");
  });

  /**
   * The rate limit is what bounds the cost of this rule, so it is asserted as a
   * SEQUENCE rather than as a single verdict: a stream of messages to someone
   * who never reads must produce one push per window, not one per message. A
   * single-verdict test cannot distinguish those.
   */
  it("rate-limits a never-read stream to one push per window", () => {
    let lastNotifiedAt: string | null = null;
    let notified = 0;
    // 3 hours of messages, one per minute, to someone who never opens chat.
    for (let minute = 1; minute <= 180; minute++) {
      const v = verdict({
        lastSeenAt: at(0), // read once at the start, never again
        prevMessageAt: at(minute - 1),
        lastNotifiedAt,
        messageAt: at(minute),
      });
      if (v === "notify") {
        notified += 1;
        lastNotifiedAt = at(minute);
      }
    }
    // Enumerated rather than computed, because the formula is exactly the kind
    // of thing that can be wrong in the same direction as the code: minute 1
    // (never notified), then 31, 61, 91, 121, 151. Minute 181 is past the end.
    expect(notified).toBe(6);
    // The headline claim, stated separately: 180 messages, single-digit pushes.
    expect(notified).toBeLessThan(10);
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

/**
 * Seeds BOTH clocks on the row.
 *
 * `last_notified_at` defaults to the same instant as the read mark, which is
 * what keeps every "behind" fixture meaning what its name says. Null is
 * PERMISSIVE on the time-based re-arm, so a fixture that left it unset would
 * quietly become a notify and the assertion would be testing the opposite of
 * its own description.
 */
async function setRead(
  userId: string,
  visibility: "crew" | "planning",
  minutes: number,
  notifiedMinutes: number = minutes
) {
  const { error } = await ctx.admin.from("chat_reads").upsert(
    {
      trip_id: tripId,
      user_id: userId,
      visibility,
      last_read_at: at(minutes),
      last_notified_at: at(notifiedMinutes),
    },
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
    // Notified at minute 0 — i.e. the burst's own first message is what tells
    // them. Without this they start never-notified, the time rule fires on every
    // message, and the burst produces 10 pushes: the exact regression this test
    // exists to catch, which it DID catch when the re-arm first landed.
    await setRead(organizerId, "crew", -30, 0);
    await setRead(memberId, "crew", -30, 0);
    const notifiedCount = new Map<string, number>([
      [organizerId, 0],
      [memberId, 0],
    ]);
    let behindTotal = 0;

    for (let i = 0; i < 10; i++) {
      // A MINUTE apart: ten messages inside nine minutes, which is what a burst
      // actually looks like and comfortably inside one re-arm window. (This was
      // ten minutes apart, spanning 90 — three re-arm windows, so the correct
      // answer became 4 and the test was measuring a slow conversation while
      // claiming to measure a burst.) Still outside the viewing window, since
      // nobody's read mark moves: the suppression under test is the read-state
      // gate, not looking active.
      const m = await seedMessage({
        visibility: "crew",
        senderId: ownerId,
        minutes: i,
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
    // Both fell behind on that one, and both were notified RECENTLY (minute 55,
    // just before the minute-60 message below). That isolates the READ re-arm
    // from the TIME one: with an old notified-clock the member would be re-armed
    // by elapsed time and this test could not tell the two rules apart.
    await setRead(organizerId, "crew", -10, 55);
    await setRead(memberId, "crew", -10, 55);

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
    // longer read as actively watching, and still recently notified so the READ
    // rule is the only thing that can re-arm them.
    await setRead(organizerId, "crew", 20, 55);

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
    // Behind AND recently notified, so neither re-arm fires and the gate is the
    // only thing that can produce the empty audience this asserts.
    await setRead(organizerId, "crew", -10, 29);
    await setRead(memberId, "crew", -10, 29);

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
      // Names the CLAUSE, not just "suppressed" — `gate_behind` and
      // `gate_active` have completely different fixes, and telling them apart
      // from the log is what a production investigation needed and could not do.
      outcome: "gate_behind",
      sent: 0,
      // The AUDIENCE, not zero. It was zero, which was wrong by the column's own
      // definition and made "nobody is in this channel" indistinguishable from
      // "the gate turned away both members".
      recipients: 2,
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

describe("notifyChatMessage — the re-arm clock", () => {
  async function readRow(userId: string) {
    const { data } = await ctx.admin
      .from("chat_reads")
      .select("last_read_at, last_notified_at")
      .eq("trip_id", tripId)
      .eq("user_id", userId)
      .eq("visibility", "crew")
      .maybeSingle();
    return data as { last_read_at: string; last_notified_at: string | null } | null;
  }

  async function notifyAt(minutes: number) {
    const m = await seedMessage({ visibility: "crew", senderId: ownerId, minutes });
    return notifyChatMessage(
      {
        tripId,
        visibility: "crew",
        messageId: m.id,
        messageCreatedAt: m.createdAt,
        senderId: ownerId,
      },
      { admin: ctx.admin }
    );
  }

  /**
   * The stamp is the input to the whole time-based rule, and it is written on a
   * best-effort path that swallows its own errors — so if it silently stopped
   * happening, every recipient would look never-notified and the rule would
   * degrade into "notify on every message". That is the firehose direction, so
   * it is asserted against the ROW rather than against the return value.
   */
  it("stamps last_notified_at for everyone it notified", async () => {
    await clearMessages();
    await setRead(organizerId, "crew", 0, 0);
    await setRead(memberId, "crew", 0, 0);

    const r = await notifyAt(60);
    expect(r.eligible.sort()).toEqual([organizerId, memberId].sort());

    for (const id of [organizerId, memberId]) {
      const row = await readRow(id);
      expect(row?.last_notified_at, `no stamp for ${id}`).not.toBeNull();
      // Stamped with the MESSAGE's timestamp, not wall-clock now: the gate
      // measures elapsed time between message timestamps, so the stamp has to
      // come off the same clock or the subtraction compares two unrelated ones.
      expect(new Date(row!.last_notified_at!).toISOString()).toBe(at(60));
    }
  });

  /**
   * BEING NOTIFIED IS NOT HAVING READ.
   *
   * The stamp upserts the same row `markRead` owns, so the danger is that it
   * advances `last_read_at` on the way past — which would clear the unread badge
   * and the new-messages divider for the very message it is telling someone
   * about. An earlier draft of this code did exactly that.
   */
  it("does not advance last_read_at while stamping", async () => {
    await clearMessages();
    await setRead(organizerId, "crew", 0, 0);
    await setRead(memberId, "crew", 0, 0);
    const before = await readRow(organizerId);

    await notifyAt(60);

    const after = await readRow(organizerId);
    expect(
      after?.last_read_at,
      "the notifier marked a message read for the person it was notifying about it"
    ).toBe(before?.last_read_at);
  });

  /**
   * A recipient who has NEVER opened the channel has no `chat_reads` row, so the
   * stamp has to CREATE one — and the row it creates must not claim they have
   * read anything. Without the row the time rule could never bind them (null is
   * permissive), and they would be notified on every single message: the exact
   * per-message firehose the gate exists to prevent, reachable through the one
   * recipient who never engages.
   */
  it("creates a row for a never-read recipient without claiming they read", async () => {
    await clearMessages();
    // No chat_reads rows at all. `resolveLastSeen` falls back to joined_at,
    // which predates this 2026-01 timeline, so they are caught up and notified.
    await seedMessage({ visibility: "crew", senderId: ownerId, minutes: 0 });
    const r = await notifyAt(30);
    expect(r.eligible.length).toBeGreaterThan(0);

    const row = await readRow(r.eligible[0]);
    expect(row, "no row created — the time rule could never bind them").not.toBeNull();
    expect(row?.last_notified_at).not.toBeNull();
    // The read mark is their RESOLVED position — join time, here — and NOT the
    // message they were just told about. Asserted as "not the message" rather
    // than as an ordering: these test users joined today while the fixture
    // timeline is January, so join time is LATER than the message and an
    // ordering assertion would encode the fixture instead of the rule.
    const readMark = new Date(row!.last_read_at).toISOString();
    expect(readMark).not.toBe(at(30));
    expect(readMark).not.toBe(at(0));
  });

  /**
   * END TO END: behind, silent, then re-armed by elapsed time alone.
   *
   * The unit tests pin the predicate; this pins that the stamp and the read are
   * wired to each other. A gate that never stamped would pass every unit test in
   * this file and notify on every message in production.
   */
  it("goes silent while behind, then re-arms on elapsed time", async () => {
    await clearMessages();
    await setRead(organizerId, "crew", 0, 0);
    await setRead(memberId, "crew", 0, 0);

    // First message an hour on: both caught up -> notified, and stamped NOW.
    const first = await notifyAt(60);
    expect(first.eligible.length).toBe(2);

    // Second message right after: both behind, and freshly stamped, so silent.
    const second = await notifyAt(70);
    expect(second.eligible).toEqual([]);
    expect(second.suppressedBehind).toBe(2);

    // Wind the stamp back past the re-arm window, leaving them still behind.
    // On the fixture's own clock, since that is the clock the gate uses.
    const stale = new Date(T0 + 80 * MIN - CHAT_REARM_AFTER_MS - 60_000).toISOString();
    await ctx.admin
      .from("chat_reads")
      .update({ last_notified_at: stale })
      .eq("trip_id", tripId)
      .eq("visibility", "crew");

    const third = await notifyAt(80);
    expect(
      third.eligible.sort(),
      "still behind and never re-read, but overdue — the time rule should re-arm them"
    ).toEqual([organizerId, memberId].sort());
  });
});
