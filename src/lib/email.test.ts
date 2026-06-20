import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// vi.mock is hoisted before imports, so mockSend must be created via vi.hoisted
// to be in scope inside the factory AND accessible in the test bodies.
const { mockSend } = vi.hoisted(() => ({
  mockSend: vi.fn().mockResolvedValue({ data: { id: "ok" }, error: null }),
}));

vi.mock("resend", () => ({
  // Plain constructor function — arrow functions can't be called with `new`.
  Resend: function MockResend() {
    return { emails: { send: mockSend } };
  },
}));

import { sendInviteNewUser, sendInviteExistingUser, sendInvitationBlast } from "./email";

describe("requireFrom guard", () => {
  beforeEach(() => {
    mockSend.mockClear();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("throws in prod when RESEND_FROM is unset", async () => {
    vi.stubEnv("RESEND_FROM", "");
    vi.stubEnv("NODE_ENV", "production");

    await expect(
      sendInviteNewUser({ toEmail: "a@b.com", inviterName: "Z", tripName: "T", token: "tok" })
    ).rejects.toThrow("RESEND_FROM is not set");
    expect(mockSend).not.toHaveBeenCalled();
  });

  it("throws in preview (non-development) when RESEND_FROM is unset", async () => {
    vi.stubEnv("RESEND_FROM", "");
    vi.stubEnv("NODE_ENV", "preview");

    await expect(
      sendInviteExistingUser({
        toEmail: "a@b.com",
        toName: "A",
        inviterName: "Z",
        tripName: "T",
        tripId: "trip1",
      })
    ).rejects.toThrow("RESEND_FROM is not set");
    expect(mockSend).not.toHaveBeenCalled();
  });

  it("warns and skips in development when RESEND_FROM is unset", async () => {
    vi.stubEnv("RESEND_FROM", "");
    vi.stubEnv("NODE_ENV", "development");
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    await sendInviteNewUser({ toEmail: "a@b.com", inviterName: "Z", tripName: "T", token: "tok" });

    expect(mockSend).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("RESEND_FROM"));
    warnSpy.mockRestore();
  });

  it("sends with the configured FROM address when RESEND_FROM is set", async () => {
    vi.stubEnv("RESEND_FROM", "BuddyTrip <noreply@bbmi.app>");
    vi.stubEnv("NODE_ENV", "production");

    await sendInviteNewUser({ toEmail: "a@b.com", inviterName: "Z", tripName: "T", token: "tok" });

    expect(mockSend).toHaveBeenCalledOnce();
    expect(mockSend.mock.calls[0][0].from).toBe("BuddyTrip <noreply@bbmi.app>");
  });

  it("guard covers all four senders — sendInvitationBlast throws in prod", async () => {
    vi.stubEnv("RESEND_FROM", "");
    vi.stubEnv("NODE_ENV", "production");

    await expect(
      sendInvitationBlast({
        toEmail: "a@b.com",
        toName: "A",
        ownerName: "Z",
        tripTitle: "T",
        invitationMessage: "Hey",
        tripId: "trip1",
      })
    ).rejects.toThrow("RESEND_FROM is not set");
  });


});
