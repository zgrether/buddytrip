import { vi, describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { TestContext, createAnonCaller } from "../../__tests__/helpers/test-setup";
import { sendFeedback } from "@/lib/email";

vi.mock("@/lib/email", () => ({
  sendFeedback: vi.fn().mockResolvedValue({ id: "mock-feedback-id" }),
}));

let ctx: TestContext;

describe("feedback router", () => {
  beforeAll(async () => {
    ctx = await TestContext.create();
  });

  afterAll(async () => {
    await ctx.cleanup();
    delete process.env.FEEDBACK_TO_EMAIL;
  });

  beforeEach(() => {
    vi.mocked(sendFeedback).mockClear();
  });

  it("returns delivered:false when FEEDBACK_TO_EMAIL is not set", async () => {
    delete process.env.FEEDBACK_TO_EMAIL;
    const result = await ctx.caller().feedback.send({
      category: "bug",
      message: "Something broke on the dashboard.",
    });
    expect(result).toEqual({ delivered: false });
    expect(sendFeedback).not.toHaveBeenCalled();
  });

  it("delivers the report and includes the captured context", async () => {
    process.env.FEEDBACK_TO_EMAIL = "founder@example.com";
    const result = await ctx.caller().feedback.send({
      category: "idea",
      message: "Add a dark mode toggle to the trip header.",
      replyTo: "owner@example.com",
      screen: "Trip · Crew",
      tripLabel: "BBMI 2026",
      platform: "web",
      build: "2026.06.04",
    });
    expect(result).toEqual({ delivered: true });
    expect(sendFeedback).toHaveBeenCalledOnce();
    const call = vi.mocked(sendFeedback).mock.calls[0][0];
    expect(call.category).toBe("idea");
    expect(call.message).toBe("Add a dark mode toggle to the trip header.");
    expect(call.replyTo).toBe("owner@example.com");
    expect(call.screen).toBe("Trip · Crew");
    expect(call.tripLabel).toBe("BBMI 2026");
    expect(call.platform).toBe("web");
    expect(call.build).toBe("2026.06.04");
    expect(call.reporterEmail).toBeTruthy();
  });

  it("rejects empty messages", async () => {
    process.env.FEEDBACK_TO_EMAIL = "founder@example.com";
    await expect(
      ctx.caller().feedback.send({ category: "bug", message: "   " }),
    ).rejects.toThrow();
  });

  it("rejects unknown categories", async () => {
    process.env.FEEDBACK_TO_EMAIL = "founder@example.com";
    await expect(
      // @ts-expect-error — testing runtime rejection
      ctx.caller().feedback.send({ category: "rant", message: "ok" }),
    ).rejects.toThrow();
  });

  it("rejects malformed replyTo addresses", async () => {
    process.env.FEEDBACK_TO_EMAIL = "founder@example.com";
    await expect(
      ctx.caller().feedback.send({
        category: "bug",
        message: "broke",
        replyTo: "not-an-email",
      }),
    ).rejects.toThrow();
  });

  it("requires authentication", async () => {
    process.env.FEEDBACK_TO_EMAIL = "founder@example.com";
    await expect(
      createAnonCaller().feedback.send({ category: "bug", message: "broke" }),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });
});
