import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock the browser Supabase client so we can drive refreshSession outcomes.
const refreshSession = vi.fn();
vi.mock("@/lib/supabase", () => ({
  createClient: () => ({ auth: { refreshSession } }),
}));

// handleAuthExpiry is imported dynamically per-test (after vi.resetModules) so
// each case gets a fresh module-level in-flight guard; only the stateless
// isUnauthorizedError is safe to bind statically.
import { isUnauthorizedError } from "./authExpiry";

// The suite runs in the node environment (no DOM — component tests here use
// renderToStaticMarkup), so stub a minimal window with just the surface
// handleAuthExpiry touches.
function setPath(pathname: string) {
  const assign = vi.fn();
  vi.stubGlobal("window", { location: { pathname, search: "", assign } });
  return assign;
}

describe("isUnauthorizedError", () => {
  it("detects the tRPC UNAUTHORIZED shape by code and by httpStatus", () => {
    expect(isUnauthorizedError({ data: { code: "UNAUTHORIZED" } })).toBe(true);
    expect(isUnauthorizedError({ data: { httpStatus: 401 } })).toBe(true);
  });

  it("ignores other errors", () => {
    expect(isUnauthorizedError({ data: { httpStatus: 500 } })).toBe(false);
    expect(isUnauthorizedError({ data: { code: "NOT_FOUND" } })).toBe(false);
    expect(isUnauthorizedError(new Error("network"))).toBe(false);
    expect(isUnauthorizedError(null)).toBe(false);
  });
});

describe("handleAuthExpiry", () => {
  beforeEach(() => {
    refreshSession.mockReset();
    vi.resetModules();
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("self-heals without redirecting when refresh returns a session", async () => {
    const assign = setPath("/trips/t1/leaderboard");
    refreshSession.mockResolvedValue({ data: { session: { access_token: "x" } } });

    // Re-import to reset the module-level in-flight guard.
    const { handleAuthExpiry: fn } = await import("./authExpiry");
    await fn();

    expect(refreshSession).toHaveBeenCalledTimes(1);
    expect(assign).not.toHaveBeenCalled();
  });

  it("redirects to /login when refresh yields no session", async () => {
    const assign = setPath("/trips/t1/leaderboard");
    refreshSession.mockResolvedValue({ data: { session: null } });

    const { handleAuthExpiry: fn } = await import("./authExpiry");
    await fn();

    expect(assign).toHaveBeenCalledWith("/login");
  });

  it("redirects to /login when refresh throws", async () => {
    const assign = setPath("/trips/t1/leaderboard");
    refreshSession.mockRejectedValue(new Error("no refresh token"));

    const { handleAuthExpiry: fn } = await import("./authExpiry");
    await fn();

    expect(assign).toHaveBeenCalledWith("/login");
  });

  it("does nothing on a public route (no refresh, no redirect)", async () => {
    const assign = setPath("/login");
    const { handleAuthExpiry: fn } = await import("./authExpiry");
    await fn();

    expect(refreshSession).not.toHaveBeenCalled();
    expect(assign).not.toHaveBeenCalled();
  });

  it("collapses a burst of 401s into a single refresh/redirect", async () => {
    const assign = setPath("/trips/t1/leaderboard");
    refreshSession.mockResolvedValue({ data: { session: null } });

    const { handleAuthExpiry: fn } = await import("./authExpiry");
    // Three simultaneous 401s from one batched poll.
    await Promise.all([fn(), fn(), fn()]);

    expect(assign).toHaveBeenCalledTimes(1);
  });
});
