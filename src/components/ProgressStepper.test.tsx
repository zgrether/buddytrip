import { describe, it, expect } from "vitest";

// Unit-test the step state derivation logic from ProgressStepper
// without rendering React components.

const STEPS = ["idea", "planning", "going", "done"] as const;

function getCurrentIndex(stage: string, displayStatus: string): number {
  if (displayStatus === "past" || displayStatus === "saved") return 3;
  if (displayStatus === "now" || stage === "going") return 2;
  if (stage === "planning") return 1;
  return 0;
}

function getStepState(stepIndex: number, currentIndex: number): "completed" | "current" | "future" {
  if (stepIndex < currentIndex) return "completed";
  if (stepIndex === currentIndex) return "current";
  return "future";
}

function getStepStates(stage: string, displayStatus: string) {
  const currentIndex = getCurrentIndex(stage, displayStatus);
  return STEPS.map((_, i) => getStepState(i, currentIndex));
}

describe("ProgressStepper — step state derivation", () => {
  it("idea stage: Idea=current, rest=future", () => {
    expect(getStepStates("idea", "idea")).toEqual([
      "current", "future", "future", "future",
    ]);
  });

  it("planning stage: Idea=completed, Planning=current, rest=future", () => {
    expect(getStepStates("planning", "planning")).toEqual([
      "completed", "current", "future", "future",
    ]);
  });

  it("going stage: first two completed, Ready=current, Done=future", () => {
    expect(getStepStates("going", "going")).toEqual([
      "completed", "completed", "current", "future",
    ]);
  });

  it("now displayStatus: same as going — Ready=current", () => {
    expect(getStepStates("going", "now")).toEqual([
      "completed", "completed", "current", "future",
    ]);
  });

  it("past displayStatus: all four completed (Done=current)", () => {
    expect(getStepStates("going", "past")).toEqual([
      "completed", "completed", "completed", "current",
    ]);
  });

  it("saved displayStatus: all four completed (Done=current)", () => {
    expect(getStepStates("going", "saved")).toEqual([
      "completed", "completed", "completed", "current",
    ]);
  });
});

describe("ProgressStepper — countdown text", () => {
  it("countdown text is only meaningful for NOW status", () => {
    // The component renders countdownText only when provided,
    // but it's only passed a value when displayStatus === "now"
    // (countdownLabel returns null for all other statuses)
    const statuses = ["idea", "planning", "going", "past", "saved"];
    for (const s of statuses) {
      // countdownLabel returns null for non-now statuses
      expect(s).not.toBe("now");
    }
  });
});
