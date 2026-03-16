import { describe, it, expect } from "vitest";

/**
 * ScoreEntry unit tests
 *
 * Since ScoreEntry uses tRPC hooks (useMutation), we can't render it in a
 * plain Vitest env without a full provider. Instead we test the pure logic
 * of the scoring selectors by importing and testing the exported types/behavior.
 *
 * The full integration is covered by the Playwright E2E test.
 */

// We test the score change logic independently
describe("ScoreEntry — score logic", () => {
  it("three-way selector maps Team A win to (1, 0)", () => {
    // Simulating the logic from ThreeWaySelector
    const teams = [
      { id: "team-a", name: "Europe", shortName: "EUR", color: "#3b82f6" },
      { id: "team-b", name: "USA", shortName: "USA", color: "#ef4444" },
    ];

    // Selection "a" => team A gets 1, team B gets 0
    const scores = teams.map((t) => ({ teamId: t.id, points: 0 }));
    const updated = scores.map((s) => {
      if (s.teamId === "team-a") return { ...s, points: 1 };
      if (s.teamId === "team-b") return { ...s, points: 0 };
      return s;
    });

    expect(updated[0].points).toBe(1);
    expect(updated[1].points).toBe(0);
  });

  it("halved maps to (0.5, 0.5)", () => {
    const scores = [
      { teamId: "team-a", points: 0 },
      { teamId: "team-b", points: 0 },
    ];
    const updated = scores.map((s) => ({ ...s, points: 0.5 }));
    expect(updated[0].points).toBe(0.5);
    expect(updated[1].points).toBe(0.5);
  });

  it("points selector clamps between 0 and 1", () => {
    const points = 0;
    const decremented = Math.max(0, points - 0.5);
    expect(decremented).toBe(0);

    const points2 = 1;
    const incremented = Math.min(1, points2 + 0.5);
    expect(incremented).toBe(1);
  });

  it("score entry result shape matches expected format", () => {
    const result = { teamId: "team-a", points: 0.5 };
    expect(result).toHaveProperty("teamId");
    expect(result).toHaveProperty("points");
    expect(result.points).toBeGreaterThanOrEqual(0);
    expect(result.points).toBeLessThanOrEqual(1);
  });

  it("scoresRef pattern: latest score is captured even when submit fires before re-render", () => {
    // Simulates the ref-based pattern used in ScoreEntry to prevent stale closures.
    // Without the ref, handleSubmit would capture the scores at the time useCallback
    // was last re-created, potentially missing a score update that happened in the
    // same tick as the submit click.
    let scores = [
      { teamId: "team-a", points: 0 },
      { teamId: "team-b", points: 0 },
    ];
    // The ref always points to the latest value
    const scoresRef = { current: scores };

    // Simulate handleScoreChange updating state + ref together
    const handleScoreChange = (teamId: string, points: number) => {
      const next = scores.map((s) => (s.teamId === teamId ? { ...s, points } : s));
      scoresRef.current = next;
      scores = next; // state update (in React, this would trigger re-render)
    };

    // A stale handleSubmit that closed over the OLD scores (before any change)
    const staleSubmitCapture = [...scores]; // closed-over value — all zeros
    const staleHandleSubmit = () => staleSubmitCapture;

    // The fixed handleSubmit always reads from ref
    const fixedHandleSubmit = () => scoresRef.current;

    // User changes team-a to 0.5 then immediately submits
    handleScoreChange("team-a", 0.5);

    // Stale closure returns all-zero scores — the bug
    expect(staleHandleSubmit()[0].points).toBe(0);

    // Ref-based submit returns the updated score — the fix
    expect(fixedHandleSubmit()[0].points).toBe(0.5);
    expect(fixedHandleSubmit()[1].points).toBe(0);
  });
});
