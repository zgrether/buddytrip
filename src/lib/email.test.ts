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


// ── The blast's link is chosen PER RECIPIENT ────────────────────────────────
//
// The bug this pins: every blast recipient used to get the raw `/trips/{uuid}`
// URL, so a person with no account met a "Welcome back" sign-in wall instead of
// #988's invite router. The token is also the SECURITY boundary — it is what
// lets a signed-out reader be told the trip's name at all, which is why the fix
// is a capability link and not a talkative `/trips/{uuid}`.
describe("sendInvitationBlast — link selection", () => {
  beforeEach(() => {
    mockSend.mockClear();
    vi.stubEnv("RESEND_FROM", "BuddyTrip <noreply@bbmi.app>");
    vi.stubEnv("NODE_ENV", "production");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  const base = {
    toEmail: "a@b.com",
    toName: "A",
    ownerName: "Z",
    tripTitle: "BBMI Playground",
    invitationMessage: "Hey come along",
    tripId: "trip-uuid-1",
  };

  // Assert on PATHS, never the origin: `BASE_URL` is resolved at module load
  // from NEXT_PUBLIC_SITE_URL, so stubbing that env inside a test does nothing
  // (the module is already imported). Pinning an origin here would test the
  // harness, not the code.
  function htmlOf() {
    return mockSend.mock.calls[0][0].html as string;
  }

  it("no token (real account) → the raw trip URL, unchanged", async () => {
    await sendInvitationBlast(base);
    const html = htmlOf();
    expect(html).toContain("/trips/trip-uuid-1");
    expect(html).not.toContain("/invite?token=");
    expect(html).toContain("View Trip");
  });

  it("token (no account) → the /invite capability link, never the raw trip URL", async () => {
    await sendInvitationBlast({ ...base, token: "abc123" });
    const html = htmlOf();
    expect(html).toContain("/invite?token=abc123");
    // The raw trip URL must NOT also appear — a second, tokenless link in the
    // same email would hand the recipient the sign-in wall this fixes.
    expect(html).not.toContain("/trips/trip-uuid-1");
  });

  it("the token variant's copy tells a NEW person what to expect", async () => {
    await sendInvitationBlast({ ...base, token: "abc123" });
    const html = htmlOf();
    expect(html).toContain("Join the Trip");
    expect(html).toContain("create your free account");
    // "see what's planned so far" invites a browse; it reads as a lie to
    // someone who must first make an account.
    expect(html).not.toContain("see what");
  });

  it("carries the owner's message in BOTH variants", async () => {
    // The reason the token link goes through this builder rather than
    // sendInviteNewUser: that one has a canned body and would silently drop
    // the message the owner actually wrote, for exactly the people being
    // invited for the first time.
    await sendInvitationBlast({ ...base, token: "abc123" });
    expect(htmlOf()).toContain("Hey come along");

    mockSend.mockClear();
    await sendInvitationBlast(base);
    expect(htmlOf()).toContain("Hey come along");
  });

  it("treats an empty-string / null token as no token", async () => {
    // ensureInviteToken returns null when the read fails or RLS refuses the
    // insert; that must degrade to the old link, not emit `?token=`.
    await sendInvitationBlast({ ...base, token: null });
    expect(htmlOf()).toContain("/trips/trip-uuid-1");

    mockSend.mockClear();
    await sendInvitationBlast({ ...base, token: "" });
    expect(htmlOf()).toContain("/trips/trip-uuid-1");
    expect(htmlOf()).not.toContain("?token=");
  });

  it("URL-encodes the token rather than interpolating it raw", async () => {
    await sendInvitationBlast({ ...base, token: "a b&c" });
    expect(htmlOf()).toContain("/invite?token=a%20b%26c");
  });
});
