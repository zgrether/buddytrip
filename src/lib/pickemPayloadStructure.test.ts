import { describe, it, expect } from "vitest";
import {
  configToPickemDraft,
  pickemDraftToPayload,
  type PickemConfigDraft,
} from "./configDraft";

/**
 * `pickemDraftToPayload` must tell the RPC whether the PAIRING changed.
 *
 * `save_game_config` defaults `matchesStructureDirty` to TRUE when the key is
 * absent, and absent is what this builder sent. Every pick'em save therefore
 * took the clean-replace branch — DELETE every `game_matches` row, re-INSERT
 * with fresh `gen_random_uuid()` ids — and those ids are hashed AND are the
 * sort key in `readGameConfigHash`. So the config fingerprint moved on a save
 * that changed nothing.
 *
 * The end-to-end proof is in `pickemSaveStability.test.ts`, which asserts the
 * hash across two identical saves. This file pins the payload itself, because
 * the flag is a claim the client makes and getting it backwards is silent in
 * both directions: always-true churns, always-false persists a stale pairing.
 */

const GAME = {
  id: "g1",
  name: "Slate",
  game_type_id: "gtt_pickem",
  points_total: 24,
  points_distribution: null,
  rules_for_today: null,
  scoring_enabled: false,
  competition_format: null,
  bracket_config: null,
} as unknown as Parameters<typeof configToPickemDraft>[0];

const draftWith = (matches: PickemConfigDraft["matches"]): PickemConfigDraft => ({
  ...configToPickemDraft(GAME, [], { rollUp: "individual_matches", useConfidence: true }),
  matches,
});

const pair = (n: number, a: string[], b: string[]) => ({
  matchNumber: n,
  playersPerSide: 1 as const,
  a,
  b,
  handicap: 0,
  pointValue: null,
});

const flagOf = (draft: PickemConfigDraft, baseline?: PickemConfigDraft) =>
  (pickemDraftToPayload(draft, baseline) as { matchesStructureDirty?: boolean })
    .matchesStructureDirty;

describe("pickemDraftToPayload — the structure flag", () => {
  it("reports CLEAN when the pairing is unchanged", () => {
    const d = draftWith([pair(1, ["u1"], ["u2"]), pair(2, ["u3"], ["u4"])]);
    expect(flagOf(d, d)).toBe(false);
  });

  it("reports DIRTY when a side changes", () => {
    const base = draftWith([pair(1, ["u1"], ["u2"])]);
    const next = draftWith([pair(1, ["u1"], ["u9"])]);
    expect(flagOf(next, base)).toBe(true);
  });

  it("reports DIRTY when a match is added", () => {
    const base = draftWith([pair(1, ["u1"], ["u2"])]);
    const next = draftWith([pair(1, ["u1"], ["u2"]), pair(2, ["u3"], ["u4"])]);
    expect(flagOf(next, base)).toBe(true);
  });

  it("reports CLEAN when only a POINT VALUE moved — that is the fields tier", () => {
    // The RPC's not-dirty branch updates point_value and handicaps in place. A
    // field edit must not trigger the clean-replace, or the fix does nothing.
    const base = draftWith([pair(1, ["u1"], ["u2"])]);
    const next = draftWith([{ ...pair(1, ["u1"], ["u2"]), pointValue: 5 }]);
    expect(flagOf(next, base)).toBe(false);
  });

  it("IGNORES an unfilled slot — the spare-player case", () => {
    /**
     * THE CASE THAT MAKES THIS MORE THAN ONE LINE, and the one a naive fix
     * fails. `matchesToSaveRows` drops matches with an empty side, while the
     * draft carries a placeholder for every slot. Comparing raw drafts would
     * report dirty forever on any game with an odd person out — eight people
     * into seven matches, which is exactly the reported setup — so the churn
     * would survive behind a flag that looks correct.
     */
    const base = draftWith([pair(1, ["u1"], ["u2"])]);
    const next = draftWith([pair(1, ["u1"], ["u2"]), pair(2, ["u3"], [])]);
    expect(flagOf(next, base)).toBe(false);

    // ...and the spare player being PAIRED is a real change.
    const paired = draftWith([pair(1, ["u1"], ["u2"]), pair(2, ["u3"], ["u4"])]);
    expect(flagOf(paired, base)).toBe(true);
  });

  it("assumes DIRTY with no baseline — the RPC's own default, and the safe way", () => {
    expect(flagOf(draftWith([pair(1, ["u1"], ["u2"])]))).toBe(true);
  });

  it("sends no flag at all when there are no pairings to send", () => {
    // The key rides with `matches`; a team-totals game sends neither, and an
    // unconditional flag would arrive on a payload the RPC's guard never reads.
    const payload = pickemDraftToPayload(draftWith([]), draftWith([]));
    expect("matches" in payload).toBe(false);
    expect("matchesStructureDirty" in payload).toBe(false);
  });
});
