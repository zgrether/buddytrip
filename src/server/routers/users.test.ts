import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createClient } from "@supabase/supabase-js";
import {
  TestContext,
  createAnonCaller,
  getAdminClient,
} from "../../__tests__/helpers/test-setup";
import { createCallerFactory, type TRPCContext } from "../trpc";
import { appRouter } from "../router";

const factory = createCallerFactory(appRouter);

let ctx: TestContext;

describe("users router", () => {
  beforeAll(async () => {
    ctx = await TestContext.create();
  });

  afterAll(async () => {
    await ctx.cleanup();
  });

  // getMe
  it("getMe returns the current user's profile", async () => {
    const caller = ctx.caller();
    const user = await caller.users.getMe();
    expect(user.id).toBe(ctx.user.id);
    expect(user.email).toBe(ctx.user.email);
  });

  it("getMe throws UNAUTHORIZED for anonymous callers", async () => {
    const caller = createAnonCaller();
    await expect(caller.users.getMe()).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });

  // updateMe
  it("updateMe updates name", async () => {
    const caller = ctx.caller();
    const updated = await caller.users.updateMe({ name: "New Name" });
    expect(updated.name).toBe("New Name");
  });

  it("updateMe throws BAD_REQUEST when no fields provided", async () => {
    const caller = ctx.caller();
    await expect(caller.users.updateMe({})).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  // search — email-exact only (name/nickname search was removed in favour of
  // frequentTripmates chips; non-email queries always return [])
  it("search — exact email match returns that user", async () => {
    const caller = ctx.caller(); // owner
    const planner = ctx.getUser("planner");
    const results = await caller.users.search({ query: planner.email });
    expect(results.length).toBe(1);
    expect(results[0].id).toBe(planner.id);
  });

  it("search — non-email query (no @) returns empty", async () => {
    const caller = ctx.caller();
    const results = await caller.users.search({ query: "SearchTestUser" });
    expect(results).toEqual([]);
  });

  it("search — partial email prefix (no @) returns empty", async () => {
    const caller = ctx.caller();
    const results = await caller.users.search({
      query: ctx.user.email.split("@")[0],
    });
    expect(results).toEqual([]);
  });

  it("search — unknown email returns empty", async () => {
    const caller = ctx.caller();
    const results = await caller.users.search({
      query: "nonexistent-xyz-999@example.com",
    });
    expect(results).toEqual([]);
  });

  it("search — own email returns empty (self excluded)", async () => {
    const caller = ctx.caller();
    const results = await caller.users.search({ query: ctx.user.email });
    expect(results).toEqual([]);
  });

  // ── updateAvatar ──────────────────────────────────────────────────────
  // Sets / clears the per-user Tabler avatar icon. Always self-scoped.
  describe("updateAvatar", () => {
    afterAll(async () => {
      // Reset to null so we don't leave stray state for sibling test files
      // that assume the shared owner has no icon set.
      await ctx.caller().users.updateAvatar({ avatarIcon: null });
      await ctx.callerAs("member").users.updateAvatar({ avatarIcon: null });
    });

    it("sets a Tabler icon id on the current user", async () => {
      const caller = ctx.caller();
      const updated = await caller.users.updateAvatar({ avatarIcon: "trophy" });
      expect(updated.avatar_icon).toBe("trophy");

      const me = await caller.users.getMe();
      expect(me.avatar_icon).toBe("trophy");
    });

    it("overwrites an existing icon", async () => {
      const caller = ctx.caller();
      await caller.users.updateAvatar({ avatarIcon: "trophy" });
      const updated = await caller.users.updateAvatar({ avatarIcon: "flag-2" });
      expect(updated.avatar_icon).toBe("flag-2");
    });

    it("clears the icon when passed null", async () => {
      const caller = ctx.caller();
      await caller.users.updateAvatar({ avatarIcon: "trophy" });
      const cleared = await caller.users.updateAvatar({ avatarIcon: null });
      expect(cleared.avatar_icon).toBeNull();
    });

    it("rejects strings longer than 50 chars (zod max)", async () => {
      const caller = ctx.caller();
      await expect(
        caller.users.updateAvatar({ avatarIcon: "x".repeat(51) })
      ).rejects.toThrow();
    });

    it("throws UNAUTHORIZED for anonymous callers", async () => {
      const caller = createAnonCaller();
      await expect(
        caller.users.updateAvatar({ avatarIcon: "trophy" })
      ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    });

    it("each user only updates their own row", async () => {
      // Owner sets trophy, member sets star — must not collide.
      await ctx.caller().users.updateAvatar({ avatarIcon: "trophy" });
      await ctx.callerAs("member").users.updateAvatar({ avatarIcon: "star" });

      const ownerMe = await ctx.caller().users.getMe();
      const memberMe = await ctx.callerAs("member").users.getMe();
      expect(ownerMe.avatar_icon).toBe("trophy");
      expect(memberMe.avatar_icon).toBe("star");
    });
  });

  describe("deleteMe", () => {
    it("permanently removes the caller's auth + public.users rows", async () => {
      const admin = getAdminClient();
      const email = `delete-test-${Date.now()}-${Math.random()
        .toString(36)
        .slice(2, 6)}@example.com`;
      const { data: created, error: createErr } =
        await admin.auth.admin.createUser({
          email,
          email_confirm: true,
          user_metadata: { name: "Delete Me" },
        });
      expect(createErr).toBeNull();
      const tempId = created.user!.id;

      try {
        // handle_new_user mirrors the auth user into public.users on create.
        const { data: before } = await admin
          .from("users")
          .select("id")
          .eq("id", tempId)
          .maybeSingle();
        expect(before?.id).toBe(tempId);

        // deleteMe uses only ctx.user.id + the service-role admin client, so a
        // hand-built context for the temp user exercises the real path.
        const callerCtx: TRPCContext = {
          supabase: createClient(
            process.env.NEXT_PUBLIC_SUPABASE_URL!,
            process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
          ),
          user: { id: tempId, email },
          membershipCache: new Map(),
        };
        const res = await factory(callerCtx).users.deleteMe();
        expect(res).toEqual({ ok: true });

        // auth.users row gone
        const { data: after } = await admin.auth.admin.getUserById(tempId);
        expect(after?.user ?? null).toBeNull();
        // public.users row gone via the on_auth_user_deleted trigger (025)
        const { data: pub } = await admin
          .from("users")
          .select("id")
          .eq("id", tempId)
          .maybeSingle();
        expect(pub).toBeNull();
      } finally {
        // safety net if an assertion threw before deleteMe ran
        await admin.auth.admin.deleteUser(tempId).catch(() => {});
      }
    });

    it("is rejected for anonymous callers", async () => {
      await expect(createAnonCaller().users.deleteMe()).rejects.toMatchObject({
        code: "UNAUTHORIZED",
      });
    });
  });
});
