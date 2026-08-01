import { describe, it, expect, beforeEach, vi } from "vitest";

/**
 * Unit tests for the batched fan-out (Push Phase 3), with BOTH the push service
 * and Supabase stubbed — no DB, no network, so these run in any environment.
 *
 * The properties pinned here are the ones a device test cannot cheaply prove and
 * a reviewer cannot eyeball: that the actor is excluded, that a switched-off
 * category is respected server-side, that a two-device user gets two sends and a
 * duplicated audience entry does NOT, that a dead endpoint is pruned, and that
 * one endpoint failing never takes down the rest.
 */

const { sendMock } = vi.hoisted(() => ({ sendMock: vi.fn() }));
vi.mock("./vapid", () => ({
  pushConfigured: () => true,
  getWebPush: () => ({ sendNotification: sendMock }),
}));

import { sendPushToUsers } from "./sendPushToUsers";

type UserRow = { id: string; notification_prefs: Record<string, boolean> };
type SubRow = {
  id: string;
  user_id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
};

/** Minimal Supabase stub covering exactly the calls the helper makes:
 *  `.from(t).select(c).in(col, vals)` and `.from(t).delete().in(col, vals)`. */
function makeAdmin(users: UserRow[], subs: SubRow[]) {
  const deleted: string[][] = [];
  const admin = {
    from(table: string) {
      return {
        select(_cols: string) {
          return {
            in(_col: string, vals: string[]) {
              const data =
                table === "users"
                  ? users.filter((u) => vals.includes(u.id))
                  : subs.filter((s) => vals.includes(s.user_id));
              return Promise.resolve({ data, error: null });
            },
          };
        },
        delete() {
          return {
            in(_col: string, vals: string[]) {
              deleted.push(vals);
              return Promise.resolve({ data: null, error: null });
            },
          };
        },
      };
    },
  };
  return { admin: admin as never, deleted };
}

const sub = (userId: string, n: number): SubRow => ({
  id: `sub-${userId}-${n}`,
  user_id: userId,
  endpoint: `https://push.test/${userId}/${n}`,
  p256dh: "k",
  auth: "a",
});

const PAYLOAD = { title: "t", body: "b" };

// Braces matter: `() => sendMock.mockReset()` RETURNS the mock (mockReset is
// chainable), and vitest treats a function returned from beforeEach as a
// teardown hook — so it would invoke sendMock with no arguments after every
// test. That surfaced here as a phantom third call with `undefined`.
beforeEach(() => {
  sendMock.mockReset();
});

describe("sendPushToUsers — audience", () => {
  it("excludes the actor — nobody is notified about their own action", async () => {
    const { admin } = makeAdmin(
      [
        { id: "u1", notification_prefs: {} },
        { id: "u2", notification_prefs: {} },
      ],
      [sub("u1", 1), sub("u2", 1)]
    );
    sendMock.mockResolvedValue(undefined);

    const res = await sendPushToUsers(["u1", "u2"], "scores", PAYLOAD, {
      admin,
      excludeUserId: "u1",
    });

    expect(res.recipients).toBe(1);
    expect(res.sent).toBe(1);
    const endpoints = sendMock.mock.calls.map((c) => c[0].endpoint);
    expect(endpoints).toEqual(["https://push.test/u2/1"]);
  });

  it("de-duplicates a repeated recipient — one event, one notification", async () => {
    // A user can legitimately appear twice in a resolved audience; sending twice
    // is indistinguishable from a bug to the person holding the phone.
    const { admin } = makeAdmin([{ id: "u1", notification_prefs: {} }], [sub("u1", 1)]);
    sendMock.mockResolvedValue(undefined);

    const res = await sendPushToUsers(["u1", "u1", "u1"], "scores", PAYLOAD, { admin });

    expect(res.recipients).toBe(1);
    expect(res.sent).toBe(1);
  });

  it("an empty audience sends nothing and touches no client", async () => {
    const { admin } = makeAdmin([], []);
    const res = await sendPushToUsers([], "scores", PAYLOAD, { admin });
    expect(res).toMatchObject({ recipients: 0, sent: 0 });
    expect(sendMock).not.toHaveBeenCalled();
  });
});

describe("sendPushToUsers — preference gate", () => {
  it("a recipient with scores OFF gets nothing; the rest still do", async () => {
    const { admin } = makeAdmin(
      [
        { id: "off", notification_prefs: { scores: false } },
        { id: "on", notification_prefs: { scores: true } },
      ],
      [sub("off", 1), sub("on", 1)]
    );
    sendMock.mockResolvedValue(undefined);

    const res = await sendPushToUsers(["off", "on"], "scores", PAYLOAD, { admin });

    expect(res.skippedPreferenceOff).toBe(1);
    expect(res.sent).toBe(1);
    expect(sendMock.mock.calls.map((c) => c[0].endpoint)).toEqual([
      "https://push.test/on/1",
    ]);
  });

  it("an UNSET preference falls back to the registry default (scores is ON)", async () => {
    const { admin } = makeAdmin([{ id: "u1", notification_prefs: {} }], [sub("u1", 1)]);
    sendMock.mockResolvedValue(undefined);
    const res = await sendPushToUsers(["u1"], "scores", PAYLOAD, { admin });
    expect(res.sent).toBe(1);
  });

  it("chat defaults OFF — the same audience gets nothing for a chat-category send", async () => {
    // Pins that the gate reads the REGISTRY per key rather than assuming "on".
    const { admin } = makeAdmin([{ id: "u1", notification_prefs: {} }], [sub("u1", 1)]);
    const res = await sendPushToUsers(["u1"], "chat", PAYLOAD, { admin });
    expect(res.sent).toBe(0);
    expect(res.skippedPreferenceOff).toBe(1);
  });
});

describe("sendPushToUsers — devices", () => {
  it("one push PER DEVICE for a two-device recipient", async () => {
    const { admin } = makeAdmin(
      [{ id: "u1", notification_prefs: {} }],
      [sub("u1", 1), sub("u1", 2)]
    );
    sendMock.mockResolvedValue(undefined);

    const res = await sendPushToUsers(["u1"], "scores", PAYLOAD, { admin });

    expect(res.recipients).toBe(1);
    expect(res.sent).toBe(2); // phone + tablet, not a double of one device
  });

  it("a recipient with no subscribed device is not an error", async () => {
    const { admin } = makeAdmin([{ id: "u1", notification_prefs: {} }], []);
    const res = await sendPushToUsers(["u1"], "scores", PAYLOAD, { admin });
    expect(res).toMatchObject({ recipients: 1, sent: 0, removedDead: 0 });
  });
});

describe("sendPushToUsers — dead endpoints", () => {
  it.each([410, 404])("prunes the row on %i and keeps delivering to the rest", async (status) => {
    const { admin, deleted } = makeAdmin(
      [
        { id: "gone", notification_prefs: {} },
        { id: "live", notification_prefs: {} },
      ],
      [sub("gone", 1), sub("live", 1)]
    );
    sendMock.mockImplementation((s: { endpoint: string }) => {
      if (s.endpoint.includes("gone")) return Promise.reject({ statusCode: status });
      return Promise.resolve(undefined);
    });

    const res = await sendPushToUsers(["gone", "live"], "scores", PAYLOAD, { admin });

    expect(res.removedDead).toBe(1);
    expect(res.sent).toBe(1);
    expect(deleted).toEqual([["sub-gone-1"]]);
  });

  it("does NOT prune on a transient failure (500) — a blip is not an uninstall", async () => {
    const { admin, deleted } = makeAdmin(
      [{ id: "u1", notification_prefs: {} }],
      [sub("u1", 1)]
    );
    sendMock.mockRejectedValue({ statusCode: 500 });

    const res = await sendPushToUsers(["u1"], "scores", PAYLOAD, { admin });

    expect(res.removedDead).toBe(0);
    expect(res.sent).toBe(0);
    expect(deleted).toEqual([]);
  });
});

describe("sendPushToUsers — failure isolation", () => {
  it("never throws when the push service rejects", async () => {
    const { admin } = makeAdmin([{ id: "u1", notification_prefs: {} }], [sub("u1", 1)]);
    sendMock.mockRejectedValue(new Error("network down"));
    await expect(sendPushToUsers(["u1"], "scores", PAYLOAD, { admin })).resolves.toMatchObject(
      { sent: 0 }
    );
  });

  it("never throws when the DB read itself blows up", async () => {
    // The domain write has already committed by the time this runs; a thrown
    // error here would surface as a failed finalize for a game that DID finish.
    const exploding = {
      from() {
        throw new Error("db gone");
      },
    } as never;
    await expect(
      sendPushToUsers(["u1"], "scores", PAYLOAD, { admin: exploding })
    ).resolves.toMatchObject({ sent: 0 });
  });
});
