import { describe, it, expect } from "vitest";

/**
 * Unit tests for round lifecycle state logic used in CompTab and GroupsTab.
 *
 * These test the pure state derivation logic:
 *   - StatusPill mapping: upcoming / active / submitted / closed
 *   - canEnterScore derivation per round status + canEdit
 *   - statusColor derivation for round card left borders
 */

// ── StatusPill config logic (mirrors CompTab's StatusPill) ─────────────────

function getStatusConfig(status: string) {
  return status === "active"
    ? { label: "Active", color: "#00d4aa" }
    : status === "submitted"
      ? { label: "Submitted", color: "#f59e0b" }
      : status === "closed" || status === "completed"
        ? { label: "Closed", color: "#8b949e" }
        : { label: "Upcoming", color: "#a78bfa" };
}

// ── canEnterScore logic (mirrors GroupsTab) ────────────────────────────────

function canEnterScore(roundStatus: string, canEdit: boolean) {
  return roundStatus === "active" || (roundStatus === "submitted" && canEdit);
}

// ── statusColor logic (mirrors CompTab round cards) ────────────────────────

function statusColor(status: string) {
  return status === "active" ? "#00d4aa"
    : status === "submitted" ? "#f59e0b"
      : status === "closed" ? "#8b949e"
        : "#6e7681";
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe("Round lifecycle: StatusPill config", () => {
  it("maps 'upcoming' to purple Upcoming pill", () => {
    const cfg = getStatusConfig("upcoming");
    expect(cfg.label).toBe("Upcoming");
    expect(cfg.color).toBe("#a78bfa");
  });

  it("maps 'active' to green Active pill", () => {
    const cfg = getStatusConfig("active");
    expect(cfg.label).toBe("Active");
    expect(cfg.color).toBe("#00d4aa");
  });

  it("maps 'submitted' to amber Submitted pill", () => {
    const cfg = getStatusConfig("submitted");
    expect(cfg.label).toBe("Submitted");
    expect(cfg.color).toBe("#f59e0b");
  });

  it("maps 'closed' to gray Closed pill", () => {
    const cfg = getStatusConfig("closed");
    expect(cfg.label).toBe("Closed");
    expect(cfg.color).toBe("#8b949e");
  });

  it("maps 'completed' to gray Closed pill (legacy compat)", () => {
    const cfg = getStatusConfig("completed");
    expect(cfg.label).toBe("Closed");
    expect(cfg.color).toBe("#8b949e");
  });
});

describe("Round lifecycle: canEnterScore", () => {
  it("active round: anyone can score", () => {
    expect(canEnterScore("active", false)).toBe(true);
    expect(canEnterScore("active", true)).toBe(true);
  });

  it("submitted round: only canEdit users can score", () => {
    expect(canEnterScore("submitted", false)).toBe(false);
    expect(canEnterScore("submitted", true)).toBe(true);
  });

  it("closed round: nobody can score", () => {
    expect(canEnterScore("closed", false)).toBe(false);
    expect(canEnterScore("closed", true)).toBe(false);
  });

  it("upcoming round: nobody can score", () => {
    expect(canEnterScore("upcoming", false)).toBe(false);
    expect(canEnterScore("upcoming", true)).toBe(false);
  });
});

describe("Round lifecycle: statusColor", () => {
  it("returns correct colors for each state", () => {
    expect(statusColor("active")).toBe("#00d4aa");
    expect(statusColor("submitted")).toBe("#f59e0b");
    expect(statusColor("closed")).toBe("#8b949e");
    expect(statusColor("upcoming")).toBe("#6e7681");
  });
});
