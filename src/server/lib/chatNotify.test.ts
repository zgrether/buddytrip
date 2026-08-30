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
 * The chat push gate, AFTER the reversal.
 *
 * ── What changed, and why the old assertions had to go rather than be edited ─
 * This file used to prove "a burst of ten messages does not produce ten
 * notifications". That is now the BUG. The rule is: notify on every message
 * unless you sent it or your panel is open — so the headline assertion is
 * inverted, and it is written out explicitly below rather than left implied,
 * because a suite that merely stops asserting coalescing looks identical to a
 * suite whose coalescing quietly broke.
 *
 * ── The trap that survives the rewrite ─────────────────────────────────────
 * Asserting on "how many were sent" is worthless here: this module never throws,
 * VAPID is absent locally, and there are no devices — so "nothing was sent" is
 * the DEFAULT state of the world and is produced by almost any bug. Every
 * assertion is therefore on `eligible` (WHO PASSED THE GATE) and on
 * `suppressedActive` (WHY the rest didn't).
 *
 * The timeline is built from EXPLICIT past timestamps rather than wall-clock
 * `now()`, so the viewing clause can never fire by accident.
 */

// A fixed, long-past timeline. Fixtures sit well outside the viewing window
// unless a test is specifically about it, so nothing reads as `active` by
// accident.
const T0 = Date.parse("2026-01-01T00:00:00.000Z");
const MIN = 60_000;
const at = (minutes: number) => new Date(T0 + minutes * MIN).toISOString();
/** Seconds, for the cases that live inside a 40-second window. */
const atSec = (seconds: number) => new Date(T0 + seconds * 1000).toISOString();

describe("chatGateVerdict — one clause, and it is the whole rule", () => {
  /**
   * THE REVERSAL, asserted at the unit level.
   *
   * Nothing about having been notified before, having fallen behind, or how long
   * ago the last push went out may enter this decision. Those inputs no longer
   * exist as parameters — which is the strongest form of the guarantee, since a
   * regression would have to re-add them rather than merely mis-compare them.
   */
  it("notifies someone who is not viewing, regardless of anything else", () => {
    expect(chatGateVerdict({ viewingAt: null, messageAt: at(60) })).toBe("notify");
  });

  it("suppresses someone whose panel is open", () => {
    expect(
      chatGateVerdict({ viewingAt: atSec(600), messageAt: atSec(601) })
    ).toBe("active");
  });

  /**
   * Null is PERMISSIVE, and it is the case that matters most in production:
   * nobody has a `viewing_at` until they open a panel, so on the day this ships
   * every recipient's column is null. If null failed closed, the change would
   * ship as total silence — the exact failure it exists to fix.
   */
  it("treats a never-viewed channel as notifiable", () => {
    expect(chatGateVerdict({ viewingAt: null, messageAt: at(0) })).toBe("notify");
  });

  describe("the window boundary", () => {
    const W = CHAT_ACTIVE_VIEWING_WINDOW_MS;

    it("suppresses just inside it", () => {
      const messageAt = new Date(T0 + W).toISOString();
      const viewingAt = new Date(T0 + 1).toISOString(); // W-1 ms of age
      expect(chatGateVerdict({ viewingAt, messageAt })).toBe("active");
    });

    it("notifies exactly ON it — the window is exclusive", () => {
      const messageAt = new Date(T0 + W).toISOString();
      const viewingAt = new Date(T0).toISOString(); // exactly W of age
      expect(chatGateVerdict({ viewingAt, messageAt })).toBe("notify");
    });

    /**
     * `viewing_at` can land AFTER the message: the recipient's heartbeat fires
     * between the INSERT and this read. That is the strongest evidence they are
     * watching, so it must not read as a negative age and fall through to
     * notify. Guarded by `Math.abs`, and this is the test that would catch its
     * removal — a plain subtraction passes every other case in this file.
     */
    it("suppresses when the beat lands after the message", () => {
      const messageAt = atSec(600);
      const viewingAt = atSec(602);
      expect(chatGateVerdict({ viewingAt, messageAt })).toBe("active");
    });
  });

  /**
   * The pair invariant, pinned so the two constants cannot drift apart. The
   * window has to survive a dropped beat, or a viewer becomes notifiable while
   * still looking at the panel.
   */
  it("keeps the window comfortably wider than the heartbeat", () => {
    expect(CHAT_ACTIVE_VIEWING_WINDOW_MS).toBeGreaterThan(CHAT_VIEW_HEARTBEAT_MS * 2);
  });
});

describe("chatGateVerdict — ten messages are ten notifications", () => {
  /**
   * THE ASSERTION THIS REWRITE EXISTS FOR, stated as the opposite of what the
   * previous suite proved.
   *
   * The old design notified on the first message of a burst and went silent for
   * the rest — measured in production as 26 crew messages producing TWO
   * notification events in four hours. Anyone re-deriving "coalesce hard" from
   * first principles has to delete this test to do it, which is the point.
   */
  it("notifies on every message of a burst to someone who is not looking", () => {
    const verdicts = Array.from({ length: 10 }, (_, i) =>
      chatGateVerdict({ viewingAt: null, messageAt: at(60 + i) })
    );
    expect(verdicts).toEqual(Array(10).fill("notify"));
  });

  /**
   * And the same burst, to someone who IS looking, is silent throughout — the
   * clause still does its job at volume. Beats land every heartbeat interval, so
   * the fixture advances `viewing_at` the way a real open panel would.
   */
  it("stays silent through the same burst for someone whose panel is open", () => {
    const verdicts = Array.from({ length: 10 }, (_, i) =>
      chatGateVerdict({ viewingAt: atSec(600 + i * 5), messageAt: atSec(601 + i * 5) })
    );
    expect(verdicts).toEqual(Array(10).fill("active"));
  });
});

describe("buildChatPayload — what reaches the lock screen", () => {
  const base = {
    tripId: "trip-1",
    tripTitle: "BBMI Playground",
    senderName: "Brad",
    room: { kind: "crew" } as const,
  };

  it("names the trip and the sender, and says nothing about the message", () => {
    const p = buildChatPayload(base);
    expect(p.title).toBe("BBMI Playground");
    expect(p.body).toBe("Brad sent a message");
  });

  it("distinguishes the Organizers channel, which is a different room", () => {
    expect(buildChatPayload({ ...base, room: { kind: "planning" } }).title).toBe(
      "BBMI Playground · Organizers"
    );
  });

  /**
   * THE REVERSAL. This used to assert the opposite — "NOT to an invented chat
   * URL param" — on the grounds that `AppShell` keeps chat out of the URL
   * deliberately. That protected the principle at the cost of the thing a chat
   * notification exists for: tapping "Rob sent a message" and not landing on
   * the message is broken in the one interaction where the destination is
   * unambiguous. See the reversed comment on `buildChatPayload` itself.
   */
  it("deep-links to the trip WITH a one-shot instruction to open chat", () => {
    const p = buildChatPayload(base);
    expect(p.url).toBe("/trips/trip-1?chat=1&channel=crew");
  });

  it("carries the CHANNEL the message was actually in, not always crew", () => {
    expect(buildChatPayload({ ...base, room: { kind: "planning" } }).url).toBe(
      "/trips/trip-1?chat=1&channel=planning"
    );
  });

  it("tags per channel so a later push replaces rather than stacks", () => {
    expect(buildChatPayload(base).tag).toBe("bt-chat-trip-1-crew");
    expect(buildChatPayload({ ...base, room: { kind: "planning" } }).tag).toBe(
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
    // `url` now carries `chat`/`channel` as well as the trip id — still no
    // fifth field, and still nothing beyond ids and a fixed instruction.
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
 * Put this user's panel in the "open just now" state for a given message time,
 * or leave it absent to mean "not looking".
 *
 * Writes `viewing_at` and NOTHING ELSE. The predecessor of this helper seeded
 * `last_read_at` and `last_notified_at` because the gate read both; the gate now
 * reads neither, and a fixture that still wrote them would be describing a
 * mechanism the code no longer has.
 */
async function setViewing(userId: string, visibility: "crew" | "planning", iso: string) {
  const { error } = await ctx.admin.from("chat_reads").upsert(
    {
      trip_id: tripId,
      user_id: userId,
      visibility,
      viewing_at: iso,
    },
    { onConflict: "trip_id,user_id,visibility,team_key" }
  );
  if (error) throw new Error(`set viewing: ${error.message}`);
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
        room: { kind: "crew" },
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
        room: { kind: "planning" },
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
    // Nobody is viewing, so the gate lets everyone else through and the sender's
    // absence from `eligible` MEANS something. If the others were suppressed,
    // `eligible` would be empty and this would pass without exercising actor
    // exclusion at all — a vacuous pass is the failure mode to design against.
    const m = await seedMessage({ visibility: "crew", senderId: ownerId, minutes: 30 });

    const r = await notifyChatMessage(
      {
        tripId,
        room: { kind: "crew" },
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
   * A member with NO `chat_reads` row is now simply notifiable, and this is the
   * case that most needs pinning: on the day this ships, NOBODY has a
   * `viewing_at`, so if an absent row failed closed the change would deploy as
   * total silence — the exact failure it exists to fix.
   *
   * The predecessor here is deliberate. Under the old gate this same fixture
   * turned on `joined_at` and a caught-up comparison; now the presence of an
   * earlier message must make no difference at all.
   */
  it("notifies a member who has never opened the channel", async () => {
    await clearMessages();
    await seedMessage({ visibility: "crew", senderId: ownerId, minutes: 0 });
    const m = await seedMessage({ visibility: "crew", senderId: ownerId, minutes: 30 });

    const r = await notifyChatMessage(
      {
        tripId,
        room: { kind: "crew" },
        messageId: m.id,
        messageCreatedAt: m.createdAt,
        senderId: ownerId,
      },
      { admin: ctx.admin }
    );

    expect(r.audience).toBe(2);
    expect(r.eligible.sort()).toEqual([organizerId, memberId].sort());
    expect(r.suppressedActive).toBe(0);
  });
});

describe("notifyChatMessage — no coalescing, against the real DB", () => {
  /**
   * THE REVERSAL, end to end.
   *
   * The describe this replaces was called "coalescing" and asserted that a burst
   * of four messages produced ONE notification per recipient. That behaviour is
   * what shipped, and what production measured as 26 crew messages producing two
   * notification events in four hours.
   *
   * Run through the real audience resolution and the real DB, because the unit
   * test above cannot catch a gate that reads the wrong COLUMN — and reading
   * `last_read_at` instead of `viewing_at` would reintroduce exactly the old
   * behaviour while every unit assertion stayed green.
   */
  it("notifies every recipient on every message of a burst", async () => {
    await clearMessages();
    const verdicts: number[] = [];
    for (let i = 0; i < 4; i++) {
      const m = await seedMessage({ visibility: "crew", senderId: ownerId, minutes: 30 + i });
      const r = await notifyChatMessage(
        {
          tripId,
          room: { kind: "crew" },
          messageId: m.id,
          messageCreatedAt: m.createdAt,
          senderId: ownerId,
        },
        { admin: ctx.admin }
      );
      verdicts.push(r.eligible.length);
    }
    // Four messages, two recipients, every time. The old design produced
    // [2, 0, 0, 0].
    expect(verdicts).toEqual([2, 2, 2, 2]);
  });

  /**
   * READING THE CHAT MUST NOT SILENCE YOU any more.
   *
   * `last_read_at` is advanced to the instant before the message — which under
   * the old gate was the difference between "caught up" and "behind" and drove
   * the whole decision. It must now be inert. This is the assertion that fails
   * if someone repoints the gate back at the read column.
   */
  it("ignores last_read_at entirely", async () => {
    await clearMessages();
    await ctx.admin.from("chat_reads").upsert(
      [organizerId, memberId].map((user_id) => ({
        trip_id: tripId,
        user_id,
        visibility: "crew",
        last_read_at: at(29),
        viewing_at: null,
      })),
      { onConflict: "trip_id,user_id,visibility,team_key" }
    );
    const m = await seedMessage({ visibility: "crew", senderId: ownerId, minutes: 30 });

    const r = await notifyChatMessage(
      {
        tripId,
        room: { kind: "crew" },
        messageId: m.id,
        messageCreatedAt: m.createdAt,
        senderId: ownerId,
      },
      { admin: ctx.admin }
    );
    expect(r.eligible.sort()).toEqual([organizerId, memberId].sort());
    expect(r.suppressedActive).toBe(0);
  });

  /** The one clause that remains, through the real column. */
  it("suppresses only the recipient whose panel is open", async () => {
    await clearMessages();
    const m = await seedMessage({ visibility: "crew", senderId: ownerId, minutes: 30 });
    // One second before the message — unambiguously inside a 40s window.
    await setViewing(organizerId, "crew", new Date(Date.parse(m.createdAt) - 1000).toISOString());

    const r = await notifyChatMessage(
      {
        tripId,
        room: { kind: "crew" },
        messageId: m.id,
        messageCreatedAt: m.createdAt,
        senderId: ownerId,
      },
      { admin: ctx.admin }
    );

    expect(r.audience).toBe(2);
    expect(r.eligible).toEqual([memberId]);
    expect(r.suppressedActive).toBe(1);
  });

  /**
   * A viewing mark that has gone STALE stops suppressing. This is the pocket
   * case — panel closed, beats stopped — and the window is what bounds how long
   * they stay silent afterwards.
   */
  it("notifies once the viewing mark ages past the window", async () => {
    await clearMessages();
    const m = await seedMessage({ visibility: "crew", senderId: ownerId, minutes: 30 });
    await setViewing(
      organizerId,
      "crew",
      new Date(Date.parse(m.createdAt) - CHAT_ACTIVE_VIEWING_WINDOW_MS - 1000).toISOString()
    );

    const r = await notifyChatMessage(
      {
        tripId,
        room: { kind: "crew" },
        messageId: m.id,
        messageCreatedAt: m.createdAt,
        senderId: ownerId,
      },
      { admin: ctx.admin }
    );

    expect(r.eligible.sort()).toEqual([organizerId, memberId].sort());
    expect(r.suppressedActive).toBe(0);
  });

  /**
   * Channels are separate panels. Viewing Crew must not silence Organizers —
   * they are different rooms and the column is keyed per visibility.
   */
  it("does not let viewing one channel suppress the other", async () => {
    await clearMessages();
    const m = await seedMessage({ visibility: "planning", senderId: ownerId, minutes: 30 });
    await setViewing(organizerId, "crew", m.createdAt); // watching CREW, not planning

    const r = await notifyChatMessage(
      {
        tripId,
        room: { kind: "planning" },
        messageId: m.id,
        messageCreatedAt: m.createdAt,
        senderId: ownerId,
      },
      { admin: ctx.admin }
    );

    expect(r.eligible).toEqual([organizerId]);
    expect(r.suppressedActive).toBe(0);
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
        room: { kind: "crew" },
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
    const before = new Date().toISOString();
    const m = await seedMessage({ visibility: "crew", senderId: ownerId, minutes: 30 });
    // BOTH recipients viewing, which is now the only way to empty the audience —
    // so the gate is the only thing that can produce the result this asserts.
    await setViewing(organizerId, "crew", m.createdAt);
    await setViewing(memberId, "crew", m.createdAt);
    const r = await notifyChatMessage(
      {
        tripId,
        room: { kind: "crew" },
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
      // One suppression reason means one outcome. `gate_mixed` and
      // `gate_behind` are gone with the clauses that produced them — the
      // migration-106 lesson survives (a pre-send exit must be recorded), but
      // there is nothing left to disambiguate.
      outcome: "gate_active",
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
        room: { kind: "crew" },
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

describe("notifyChatMessage — writes nothing to chat_reads", () => {
  /**
   * The describe this replaces asserted that the module stamped a re-arm clock
   * and, when it had to CREATE a row, invented a defensible `last_read_at` to go
   * with it. Both writes are gone.
   *
   * That second one is why this is worth a test rather than a comment: the code
   * announcing a message also decided what read position to record for the
   * person it was announcing to, and getting it wrong cleared their unread badge
   * for a message they had not seen. The class of bug ends by the write ending.
   */
  async function rowsFor(userId: string) {
    const { data } = await ctx.admin
      .from("chat_reads")
      .select("last_read_at, viewing_at, last_notified_at")
      .eq("trip_id", tripId)
      .eq("user_id", userId)
      .eq("visibility", "crew")
      .maybeSingle();
    return data as {
      last_read_at: string;
      viewing_at: string | null;
      last_notified_at: string | null;
    } | null;
  }

  it("creates no row for a recipient it notifies", async () => {
    await clearMessages();
    const m = await seedMessage({ visibility: "crew", senderId: ownerId, minutes: 30 });

    const r = await notifyChatMessage(
      {
        tripId,
        room: { kind: "crew" },
        messageId: m.id,
        messageCreatedAt: m.createdAt,
        senderId: ownerId,
      },
      { admin: ctx.admin }
    );
    expect(r.eligible).toContain(organizerId);

    // A push must not conjure read state for someone who has read nothing.
    expect(await rowsFor(organizerId)).toBeNull();
  });

  it("leaves an existing row completely untouched", async () => {
    await clearMessages();
    const READ_AT = at(5);
    await ctx.admin.from("chat_reads").upsert(
      {
        trip_id: tripId,
        user_id: organizerId,
        visibility: "crew",
        last_read_at: READ_AT,
        viewing_at: null,
      },
      { onConflict: "trip_id,user_id,visibility,team_key" }
    );

    const m = await seedMessage({ visibility: "crew", senderId: ownerId, minutes: 30 });
    const r = await notifyChatMessage(
      {
        tripId,
        room: { kind: "crew" },
        messageId: m.id,
        messageCreatedAt: m.createdAt,
        senderId: ownerId,
      },
      { admin: ctx.admin }
    );
    expect(r.eligible).toContain(organizerId);

    const after = await rowsFor(organizerId);
    // The read position is the badge's input. If announcing a message can move
    // it, the badge clears for something nobody saw.
    expect(new Date(after!.last_read_at).toISOString()).toBe(READ_AT);
    expect(after!.viewing_at).toBeNull();
    // Dead as of migration 145's follow-up; asserted null so a resurrected
    // stamp is caught before the column is dropped rather than after.
    expect(after!.last_notified_at).toBeNull();
  });
});
