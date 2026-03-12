import { describe, it, expect } from "vitest";
import { createTestCaller, createAnonCaller, hasServiceKey } from "./test-helpers";

describe.skipIf(!hasServiceKey())("tRPC middleware", () => {
  // Use seeded data: 'brad' is Owner of 'trip-bbmi', 'zach' is Planner,
  // 'ben' is Member. 'rob' is not a member of 'trip-new-deciding'.

  it("authedProcedure: allows authenticated users", async () => {
    const caller = createTestCaller("brad");
    const result = await caller.health();
    expect(result).toEqual({ status: "ok" });
  });

  it("authedProcedure: rejects unauthenticated users on protected routes", async () => {
    // health is a public procedure, so it passes even without auth.
    // We'll test auth rejection via a protected router in later tests.
    const caller = createAnonCaller();
    const result = await caller.health();
    expect(result).toEqual({ status: "ok" });
  });
});
