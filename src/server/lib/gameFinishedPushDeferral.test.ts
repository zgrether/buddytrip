import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { gameFinishedPushFailureLine } from "./gameFinishNotify";
import type { SendPushToUsersResult } from "./sendPushToUsers";

/**
 * `games.finish` sends the "game is final" push AFTER its response.
 *
 * Two things follow, and each gets its own half of this file:
 *
 *   * a failed push is no longer in the same invocation as the finalize that
 *     caused it, so the failure line is the only link between them — tested
 *     behaviourally, since it is a pure function of the send's summary
 *   * the deferral itself lives in `games.ts`, which the node suite reaches only
 *     through the direct caller where `afterResponse` runs inline — so the
 *     STRUCTURE (inside the callback, game push before clinch check) gets a
 *     source guard, and says so
 */

const where = { tripId: "trip-1", gameId: "game-1", competitionId: "comp-1" };

function send(over: Partial<SendPushToUsersResult> = {}): SendPushToUsersResult {
  return {
    sent: 3,
    skippedPreferenceOff: 0,
    recipients: 3,
    removedDead: 0,
    notConfigured: false,
    subscriptionsFound: 3,
    failed: 0,
    error: null,
    ...over,
  };
}

describe("gameFinishedPushFailureLine", () => {
  it("is silent for a clean send", () => {
    expect(gameFinishedPushFailureLine(where, send())).toBeNull();
  });

  it("is silent for the correct outcomes that deliver nothing", () => {
    // Empty audience, everyone opted out, VAPID absent: none of these is a failure,
    // and logging them would bury the line that is.
    expect(gameFinishedPushFailureLine(where, send({ sent: 0, recipients: 0, subscriptionsFound: 0 }))).toBeNull();
    expect(gameFinishedPushFailureLine(where, send({ sent: 0, skippedPreferenceOff: 3 }))).toBeNull();
    expect(gameFinishedPushFailureLine(where, send({ sent: 0, notConfigured: true }))).toBeNull();
    expect(gameFinishedPushFailureLine(where, send({ sent: 2, removedDead: 1 }))).toBeNull();
  });

  it("names the GAME when a device send failed", () => {
    const line = gameFinishedPushFailureLine(
      where,
      send({ sent: 2, failed: 1, error: "delivery failed (status 500)" })
    );
    expect(line).not.toBeNull();
    expect(JSON.parse(line!)).toEqual({
      tag: "game-finished-push-failed",
      tripId: "trip-1",
      gameId: "game-1",
      competitionId: "comp-1",
      stage: "send",
      recipients: 3,
      subscriptionsFound: 3,
      sent: 2,
      failed: 1,
      error: "delivery failed (status 500)",
    });
  });

  it("logs an unexpected error even though it left `failed` at 0", () => {
    // The case a count-only check misses: the run threw before any device send.
    const line = gameFinishedPushFailureLine(where, send({ sent: 0, failed: 0, error: "subscription read failed" }));
    expect(JSON.parse(line!)).toMatchObject({ stage: "send", failed: 0, error: "subscription read failed" });
  });

  it("logs when the notifier itself threw (no summary at all)", () => {
    const line = gameFinishedPushFailureLine({ ...where, competitionId: null }, null);
    expect(JSON.parse(line!)).toEqual({
      tag: "game-finished-push-failed",
      tripId: "trip-1",
      gameId: "game-1",
      competitionId: null,
      stage: "notifier",
    });
  });
});

describe("games.finish defers the game push (source guard)", () => {
  const raw = readFileSync(join(__dirname, "..", "routers", "games.ts"), "utf8");
  // Comments stripped: the block's own prose names every identifier below.
  const source = raw
    .split("\n")
    .filter((l) => !l.trim().startsWith("//"))
    .join("\n");

  const callbackAt = source.indexOf("await afterResponse(async () => {");
  const pushAt = source.indexOf("await notifyGameFinished(");
  const clinchAt = source.indexOf("await notifyCupClinchedIfDecided(");
  const failureAt = source.indexOf("gameFinishedPushFailureLine(");

  it("the push runs inside the afterResponse callback, not before it", () => {
    expect(callbackAt).toBeGreaterThan(-1);
    expect(pushAt).toBeGreaterThan(callbackAt);
    // Exactly one call site — a second, inline one would put the wait back.
    expect(source.split("notifyGameFinished(").length - 1).toBe(1);
  });

  it("keeps the order: game push, then its failure line, then the clinch check", () => {
    expect(failureAt).toBeGreaterThan(pushAt);
    expect(clinchAt).toBeGreaterThan(failureAt);
    // Same callback: no second afterResponse between the push and the clinch.
    expect(source.slice(pushAt, clinchAt)).not.toContain("afterResponse(");
  });

  it("the transition guard still wraps the push and not the clinch check", () => {
    const guardAt = source.indexOf("if (!wasAlreadyComplete) {", callbackAt);
    expect(guardAt).toBeGreaterThan(callbackAt);
    expect(guardAt).toBeLessThan(pushAt);
    const clinchGuardAt = source.indexOf("if (competitionId) {", callbackAt);
    expect(clinchGuardAt).toBeGreaterThan(failureAt);
    expect(clinchGuardAt).toBeLessThan(clinchAt);
  });
});
