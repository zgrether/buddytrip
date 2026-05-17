import { describe, it, expect } from "vitest";
import { getEffectiveStatus, countdownLabel } from "./tripStatus";

describe("getEffectiveStatus", () => {
  // The 'saved' status override has been retired (see tripStatus.ts).
  // Pre-existing rows with trip_status_override='saved' now fall through
  // to their natural stage/date-derived status — verify that here.
  it("ignores legacy trip_status_override='saved' and uses stage instead", () => {
    expect(
      getEffectiveStatus({ trip_status_override: "saved", stage: "going" })
    ).toBe("going");
  });

  it("returns 'past' when end_date + 3 days is in the past", () => {
    const pastDate = new Date();
    pastDate.setDate(pastDate.getDate() - 10);
    expect(
      getEffectiveStatus({
        stage: "going",
        end_date: pastDate.toISOString().split("T")[0],
      })
    ).toBe("past");
  });

  it("returns 'now' for going trip within 3 days of start", () => {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const endDate = new Date();
    endDate.setDate(endDate.getDate() + 5);
    expect(
      getEffectiveStatus({
        stage: "going",
        start_date: tomorrow.toISOString().split("T")[0],
        end_date: endDate.toISOString().split("T")[0],
      })
    ).toBe("now");
  });

  it("returns 'going' for going trip with distant start date", () => {
    const futureStart = new Date();
    futureStart.setDate(futureStart.getDate() + 30);
    expect(
      getEffectiveStatus({
        stage: "going",
        start_date: futureStart.toISOString().split("T")[0],
      })
    ).toBe("going");
  });

  it("returns 'planning' for planning stage", () => {
    expect(getEffectiveStatus({ stage: "planning" })).toBe("planning");
  });

  it("returns 'idea' for idea stage or no stage", () => {
    expect(getEffectiveStatus({ stage: "idea" })).toBe("idea");
    expect(getEffectiveStatus({})).toBe("idea");
  });
});

describe("countdownLabel", () => {
  it("returns null for non-now trips", () => {
    expect(countdownLabel({ stage: "planning" })).toBeNull();
  });

  it("returns null when trip has started", () => {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const endDate = new Date();
    endDate.setDate(endDate.getDate() + 3);
    expect(
      countdownLabel({
        stage: "going",
        start_date: yesterday.toISOString().split("T")[0],
        end_date: endDate.toISOString().split("T")[0],
      })
    ).toBeNull();
  });

  it("returns 'Tomorrow' for 1 day away", () => {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const endDate = new Date();
    endDate.setDate(endDate.getDate() + 5);
    expect(
      countdownLabel({
        stage: "going",
        start_date: tomorrow.toISOString().split("T")[0],
        end_date: endDate.toISOString().split("T")[0],
      })
    ).toBe("Tomorrow");
  });

  it("returns 'X days to go' for 2+ days", () => {
    // Use 2 days from now (safely inside the 3-day NOW window)
    const twoDays = new Date();
    twoDays.setDate(twoDays.getDate() + 2);
    const endDate = new Date();
    endDate.setDate(endDate.getDate() + 7);
    const result = countdownLabel({
      stage: "going",
      start_date: twoDays.toISOString().split("T")[0],
      end_date: endDate.toISOString().split("T")[0],
    });
    expect(result).toBe("2 days to go");
  });
});
