import { describe, it, expect, vi } from "vitest";
import { writeGameResults } from "./writeGameResults";

/**
 * The FAILURE behaviour of the results writer (#776), with the RPC stubbed — no
 * DB, so it runs anywhere.
 *
 * CI's DB-backed suites prove the happy path end to end (every results-asserting
 * suite passes unchanged against real Postgres). What they do NOT exercise is a
 * write that FAILS: nothing in the suite can make `write_game_results` error on
 * demand. That leaves the entire point of #776 — finish must fail loudly rather
 * than mark a game complete with an empty results table — resting on inspection.
 *
 * So the split is pinned here instead: same call, same atomicity, two different
 * things the caller sees. The `throw`/`log` choice is the only conditional part
 * of the design, and it is the part a future edit is most likely to get wrong.
 */

/** A stub whose `rpc` fails, capturing the args it was called with. */
function failingRpc(message = "boom") {
  const rpc = vi.fn().mockResolvedValue({ error: { message } });
  return { client: { rpc } as never, rpc };
}

function okRpc() {
  const rpc = vi.fn().mockResolvedValue({ error: null });
  return { client: { rpc } as never, rpc };
}

const BASE = {
  gameId: "game-1",
  rows: [{ id: "r1", entity_id: "u1", entity_type: "user" as const, position: 1, value_kind: "rank" as const }],
  scope: { kind: "all" as const },
};

describe("writeGameResults — the finalize path fails loudly", () => {
  it('onFailure: "throw" rejects, so games.finish cannot mark a game complete', async () => {
    const { client } = failingRpc("permission denied");
    await expect(
      writeGameResults(client, { ...BASE, onFailure: "throw" })
    ).rejects.toThrow(/Failed to save results/);
  });

  it("the thrown code is INTERNAL_SERVER_ERROR — never UNAUTHORIZED", async () => {
    // authExpiry.ts treats a 401/UNAUTHORIZED as a dead session and hard-
    // navigates to /login. A results-write failure returning that code would
    // log someone out mid-round for an unrelated reason.
    const { client } = failingRpc();
    await expect(
      writeGameResults(client, { ...BASE, onFailure: "throw" })
    ).rejects.toMatchObject({ code: "INTERNAL_SERVER_ERROR" });
  });

  it("surfaces the underlying message rather than swallowing it", async () => {
    const { client } = failingRpc("relation does not exist");
    await expect(
      writeGameResults(client, { ...BASE, onFailure: "throw" })
    ).rejects.toThrow(/relation does not exist/);
  });
});

describe("writeGameResults — the setup path stays quiet", () => {
  it('onFailure: "log" resolves, so pairing a match cannot fail on a results write', async () => {
    const { client } = failingRpc();
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(writeGameResults(client, { ...BASE, onFailure: "log" })).resolves.toBeUndefined();
    expect(spy, "a swallowed failure must still be loud in the logs").toHaveBeenCalled();
    spy.mockRestore();
  });

  it("defaults to the quiet mode — 9 of the 12 call sites are setup paths", async () => {
    const { client } = failingRpc();
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(writeGameResults(client, BASE)).resolves.toBeUndefined();
    spy.mockRestore();
  });
});

describe("writeGameResults — scope is passed through faithfully", () => {
  it("'all' sends no entity filters", async () => {
    const { client, rpc } = okRpc();
    await writeGameResults(client, BASE);
    expect(rpc).toHaveBeenCalledWith(
      "write_game_results",
      expect.objectContaining({ p_scope: "all", p_entity_ids: null, p_entity_type: null })
    );
  });

  it("'entity_ids' carries the list — match play's skipComplete freeze boundary", async () => {
    // If this degraded to 'all', a COMPLETE match's frozen rows would be deleted
    // by an incremental re-derive. That is the scope's whole reason to exist.
    const { client, rpc } = okRpc();
    await writeGameResults(client, {
      ...BASE,
      scope: { kind: "entity_ids", entityIds: ["a", "b"] },
    });
    expect(rpc).toHaveBeenCalledWith(
      "write_game_results",
      expect.objectContaining({ p_scope: "entity_ids", p_entity_ids: ["a", "b"] })
    );
  });

  it("'entity_type' carries the type — match play's team rows only", async () => {
    // Degrading this to 'all' would delete the user/play_group rows written
    // moments earlier in the same finalize.
    const { client, rpc } = okRpc();
    await writeGameResults(client, {
      ...BASE,
      scope: { kind: "entity_type", entityType: "team" },
    });
    expect(rpc).toHaveBeenCalledWith(
      "write_game_results",
      expect.objectContaining({ p_scope: "entity_type", p_entity_type: "team" })
    );
  });

  it("an empty row set is still sent — it means CLEAR, not no-op", async () => {
    // strokePlay has no early return: computing an empty game legitimately
    // deletes its results and inserts nothing. Short-circuiting on `rows.length`
    // would silently leave stale standings behind.
    const { client, rpc } = okRpc();
    await writeGameResults(client, { ...BASE, rows: [] });
    expect(rpc).toHaveBeenCalledWith(
      "write_game_results",
      expect.objectContaining({ p_rows: [] })
    );
  });
});

/**
 * THE CREDITED UNIT IS FILLED ONCE, HERE — NOT AT SEVEN CALL SITES.
 *
 * `credited_team_id` on a `team` row is deliberately redundant with its
 * `entity_id`: the point of migration 191's column is that "who gets these
 * points" is ONE question with ONE answer for every format, including the
 * bracket, whose rows name an entrant rather than a team. Redundant data that
 * seven callers each restate is how six stay right and the seventh drifts, so
 * the restatement happens where it cannot.
 *
 * These assert the ARGUMENT SENT TO THE RPC, which is the only place the
 * derivation is observable without a database. The stubbed `rpc` is the same
 * one the failure cases above use.
 */
describe("writeGameResults — the credited unit", () => {
  it("fills a team row's credit from its own entity_id", async () => {
    const { client, rpc } = okRpc();
    await writeGameResults(client, {
      gameId: "game-1",
      scope: { kind: "all" },
      rows: [{ id: "r1", entity_id: "team-A", entity_type: "team", raw_score: 3, value_kind: "points" }],
    });
    // The exact value, not "is defined": a derivation that filled the GAME id,
    // or the first team it saw, would satisfy a presence check.
    expect(rpc.mock.calls[0][1].p_rows[0].credited_team_id).toBe("team-A");
  });

  it("leaves a side-level row's credit NULL — a side is not a cup credit", async () => {
    const { client, rpc } = okRpc();
    await writeGameResults(client, {
      gameId: "game-1",
      scope: { kind: "all" },
      rows: [
        { id: "r1", entity_id: "u1", entity_type: "user", position: 1, value_kind: "rank" },
        { id: "r2", entity_id: "pg1", entity_type: "play_group", position: 2, value_kind: "rank" },
      ],
    });
    const sent = rpc.mock.calls[0][1].p_rows;
    // `undefined`, not `"u1"`. A user row carrying its own id here would make
    // the column mean two different things and would put a person's id in a
    // column every reader treats as a team — migration 191's comment says so.
    expect(sent[0].credited_team_id).toBeUndefined();
    expect(sent[1].credited_team_id).toBeUndefined();
  });

  it("does not overwrite a credit the caller set on a non-team row", async () => {
    // No caller does this today. It is pinned because the derivation is a
    // `map` over every row, and the cheap way to write it — assign
    // unconditionally — would silently discard a value a future format passes.
    const { client, rpc } = okRpc();
    await writeGameResults(client, {
      gameId: "game-1",
      scope: { kind: "all" },
      rows: [
        { id: "r1", entity_id: "pg1", entity_type: "play_group", position: 1, value_kind: "rank", credited_team_id: "team-B" },
      ],
    });
    expect(rpc.mock.calls[0][1].p_rows[0].credited_team_id).toBe("team-B");
  });

  it("passes value_kind through untouched — the writer declares, this does not guess", async () => {
    // The decisive case: a row declaring "points" while carrying a position.
    // Nothing here may "helpfully" correct it — `resolveConvention` on the read
    // side is what reports that contradiction, and it can only do so if the
    // write preserved it.
    const { client, rpc } = okRpc();
    await writeGameResults(client, {
      gameId: "game-1",
      scope: { kind: "all" },
      rows: [{ id: "r1", entity_id: "team-A", entity_type: "team", position: 1, value_kind: "points" }],
    });
    expect(rpc.mock.calls[0][1].p_rows[0].value_kind).toBe("points");
  });
});
