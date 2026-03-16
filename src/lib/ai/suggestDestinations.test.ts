import { describe, it, expect, vi, beforeEach } from "vitest";
import { suggestDestinations } from "./suggestDestinations";

// Mock global fetch
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

describe("suggestDestinations", () => {
  beforeEach(() => {
    vi.stubEnv("ANTHROPIC_API_KEY", "test-key");
    mockFetch.mockReset();
  });

  it("returns mock suggestions when ANTHROPIC_API_KEY is not set", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    const result = await suggestDestinations("6 guys, links lovers");
    expect(result).toHaveLength(3);
    expect(result[0].title).toBe("Scottsdale Golf Getaway");
    expect(result[1].location).toBe("Myrtle Beach, SC");
    expect(result[2].title).toBe("Pinehurst Village");
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("returns parsed destinations on success", async () => {
    const suggestions = [
      {
        title: "Scottsdale",
        location: "Scottsdale, AZ",
        description: "Great desert golf",
        costTier: "$$$",
      },
      {
        title: "Bandon Dunes",
        location: "Bandon, OR",
        description: "Links golf paradise",
        costTier: "$$$$",
      },
      {
        title: "Myrtle Beach",
        location: "Myrtle Beach, SC",
        description: "Budget-friendly golf mecca",
        costTier: "$$",
      },
    ];

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        content: [{ text: JSON.stringify(suggestions) }],
      }),
    });

    const result = await suggestDestinations("6 guys, links lovers, mid-range budget");
    expect(result).toHaveLength(3);
    expect(result[0].title).toBe("Scottsdale");
    expect(result[2].costTier).toBe("$$");
  });

  it("returns empty array on API error", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
      text: async () => "Internal Server Error",
    });

    const result = await suggestDestinations("test crew");
    expect(result).toEqual([]);
  });

  it("returns empty array on malformed JSON response", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        content: [{ text: "not valid json" }],
      }),
    });

    const result = await suggestDestinations("test crew");
    expect(result).toEqual([]);
  });

  it("sends correct headers and payload", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ content: [{ text: "[]" }] }),
    });

    await suggestDestinations("beach lovers");

    expect(mockFetch).toHaveBeenCalledWith(
      "https://api.anthropic.com/v1/messages",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          "Content-Type": "application/json",
          "x-api-key": "test-key",
          "anthropic-version": "2023-06-01",
        }),
      })
    );

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.model).toBe("claude-sonnet-4-20250514");
    expect(body.messages[0].content).toContain("beach lovers");
  });
});
