import { describe, it, expect, beforeEach, vi } from "vitest";

/**
 * #1471 — a push's reads fail closed: "couldn't read" never becomes "send".
 *
 * Both senders read the recipients' notification preferences and then their
 * devices. Read as `data ?? []` / `data?.x ?? null`, a failed PREFERENCES read
 * resolved everyone through the registry default, so people who had turned a
 * category off got the push and the record said `skippedPreferenceOff: 0`; a
 * failed DEVICES read looked like "nobody has a device". Each now throws into
 * the sender's own handler: nothing is sent and the error is recorded.
 *
 * The stub client fails exactly one table's read. The CONTROL in each block is
 * the same stub with that read succeeding, proving it can express a send, so a
 * silent result in the failing case is the failure and not the stub.
 */

const { sendMock } = vi.hoisted(() => ({ sendMock: vi.fn() }));
vi.mock("./vapid", () => ({
  pushConfigured: () => true,
  getWebPush: () => ({ sendNotification: sendMock }),
}));

import { sendPushToUsers } from "./sendPushToUsers";
import { sendPush } from "./sendPush";

const FAIL = { data: null, error: { code: "PGRST003", message: "simulated read failure" } };
const PAYLOAD = { title: "t", body: "b" };
const SUB = (userId: string) => ({ id: `sub-${userId}`, user_id: userId, endpoint: `https://push.test/${userId}`, p256dh: "k", auth: "a" });

/** One client for both senders: `failing` names the table whose read fails. */
function stub(failing: "users" | "push_subscriptions" | null, prefs: Record<string, Record<string, boolean>> = {}) {
  const users = ["u1", "u2"].map((id) => ({ id, notification_prefs: prefs[id] ?? {} }));
  const read = (table: string, filter: (row: { id?: string; user_id?: string }) => boolean) => {
    if (table === failing) return Promise.resolve(FAIL);
    const rows = table === "users" ? users : users.map((u) => SUB(u.id));
    return Promise.resolve({ data: rows.filter(filter), error: null });
  };
  return {
    from(table: string) {
      return {
        select() {
          return {
            in: (_c: string, vals: string[]) => read(table, (r) => vals.includes((r.user_id ?? r.id) as string)),
            eq: (_c: string, val: string) => {
              const p = read(table, (r) => (r.user_id ?? r.id) === val);
              return Object.assign(p, {
                maybeSingle: () => p.then((res) => ({ ...res, data: Array.isArray(res.data) ? res.data[0] ?? null : res.data })),
              });
            },
          };
        },
        delete: () => ({ in: () => Promise.resolve({ data: null, error: null }) }),
      };
    },
  } as never;
}

beforeEach(() => {
  sendMock.mockReset();
});

describe("sendPushToUsers (#1471)", () => {
  it("CONTROL: both reads succeed, so both people are sent to", async () => {
    const r = await sendPushToUsers(["u1", "u2"], "game_results", PAYLOAD, { admin: stub(null) });
    expect(sendMock).toHaveBeenCalledTimes(2);
    expect(r.sent).toBe(2);
    expect(r.error).toBeNull();
  });

  it("CONTROL: a person who turned the category off is skipped", async () => {
    const r = await sendPushToUsers(["u1", "u2"], "game_results", PAYLOAD, { admin: stub(null, { u1: { game_results: false } }) });
    expect(r.skippedPreferenceOff).toBe(1);
    expect(sendMock).toHaveBeenCalledTimes(1);
  });

  it("a failed PREFERENCES read sends nothing, and records why", async () => {
    const r = await sendPushToUsers(["u1", "u2"], "game_results", PAYLOAD, { admin: stub("users", { u1: { game_results: false } }) });
    expect(sendMock).not.toHaveBeenCalled();
    expect(r.sent).toBe(0);
    expect(r.error).toContain("could not read notification preferences");
  });

  it("a failed DEVICES read sends nothing, and records why", async () => {
    const r = await sendPushToUsers(["u1", "u2"], "game_results", PAYLOAD, { admin: stub("push_subscriptions") });
    expect(sendMock).not.toHaveBeenCalled();
    expect(r.subscriptionsFound).toBe(0);
    expect(r.error).toContain("could not read push subscriptions");
  });
});

describe("sendPush, one recipient (#1471)", () => {
  // `sendPush` returns no error field; a failure is logged and recorded. The log
  // line is the signal: the old code read a failed DEVICES read as "no devices",
  // which also sends nothing, so asserting only that nothing was sent could not
  // fail against it.
  const logged = (spy: ReturnType<typeof vi.spyOn>) => spy.mock.calls.map((c: unknown[]) => String((c[1] as { err?: unknown })?.err ?? "")).join(" ");

  it("CONTROL: both reads succeed, so the person is sent to", async () => {
    const r = await sendPush("u1", "game_results", PAYLOAD, { admin: stub(null) });
    expect(sendMock).toHaveBeenCalledTimes(1);
    expect(r.sent).toBe(1);
  });

  it("a failed PREFERENCES read sends nothing, and records why", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const r = await sendPush("u1", "game_results", PAYLOAD, { admin: stub("users", { u1: { game_results: false } }) });
    expect(sendMock).not.toHaveBeenCalled();
    expect(r.sent).toBe(0);
    expect(logged(spy)).toContain("could not read notification preferences");
    spy.mockRestore();
  });

  it("a failed DEVICES read sends nothing, and records why", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    await sendPush("u1", "game_results", PAYLOAD, { admin: stub("push_subscriptions") });
    expect(sendMock).not.toHaveBeenCalled();
    expect(logged(spy)).toContain("could not read push subscriptions");
    spy.mockRestore();
  });
});
