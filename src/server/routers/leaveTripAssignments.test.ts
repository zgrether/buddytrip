import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { TestContext } from "../../__tests__/helpers/test-setup";

/**
 * Leaving a trip leaves its cups — on BOTH removal paths.
 *
 * The bug: removing someone deleted their `trip_members` row and nothing else,
 * so their `team_assignments` stayed. Two surfaces then disagreed about one
 * team — the bracket's field picker intersects assignments with the crew and
 * showed 6, while the roster read assignments directly and showed 8. Four such
 * orphans existed in production.
 *
 * Both paths are tested because a fix covering one of them is the same
 * divergence arriving through the fix. The THIRD writer of `trip_members`
 * deletions — `merge_guest_to_real_user` — is deliberately NOT covered, and the
 * last test here is what stops someone "completing" the fix by adding a trigger:
 * the merge deletes a membership row as collision resolution BEFORE it repoints
 * assignments, so a trigger would destroy what the merge is about to hand over.
 */

let ctx: TestContext;
let member: string;

/**
 * EACH CASE BUILDS ITS OWN TRIP AND CUP (#1527). The cases used to share one:
 * the first removed the member from it, and the third re-added them with
 * `addTripMemberById` — which collided ("duplicate key … trip_members") the
 * moment a shuffle put the third case first, while the member was still there
 * from setup.
 */
async function cupTrip(label: string) {
  const tripId = await ctx.createTrip(`leave-trip ${label}`);
  await ctx.addTripMember(tripId, "member", "Member");
  const competitionId = await ctx.createCompetition(tripId, `leave-trip Cup ${label}`);
  const teamId = await ctx.createTeam(competitionId, "Leavers");
  return { tripId, competitionId, teamId };
}

async function assignmentsFor(competitionId: string, userId: string) {
  const { data, error } = await ctx.admin
    .from("team_assignments")
    .select("user_id")
    .eq("competition_id", competitionId)
    .eq("user_id", userId);
  if (error) throw new Error(`read assignments: ${error.message}`);
  return data ?? [];
}

async function assign(competitionId: string, teamId: string, userId: string) {
  const { error } = await ctx.admin.from("team_assignments").insert({
    competition_id: competitionId,
    team_id: teamId,
    user_id: userId,
  });
  if (error) throw new Error(`seed assignment: ${error.message}`);
}

beforeAll(async () => {
  ctx = await TestContext.create();
  member = ctx.getUser("member").id;
}, 120000);

afterAll(async () => {
  await ctx.cleanup();
}, 60000);

describe("removing a member clears their cup team assignment", () => {
  it("tripMembers.remove — the real-account path", async () => {
    const { tripId, competitionId, teamId } = await cupTrip("real");
    await assign(competitionId, teamId, member);
    expect(await assignmentsFor(competitionId, member)).toHaveLength(1);

    await ctx.caller().tripMembers.remove({ tripId, userId: member });

    expect(await assignmentsFor(competitionId, member)).toHaveLength(0);
  });

  it("ghostCrew.remove — the guest path", async () => {
    const { tripId, competitionId, teamId } = await cupTrip("guest");
    const guest = (await ctx.caller().ghostCrew.create({ tripId, name: "Temp Guest" })) as { id: string };
    await assign(competitionId, teamId, guest.id);
    expect(await assignmentsFor(competitionId, guest.id)).toHaveLength(1);

    await ctx.caller().ghostCrew.remove({ tripId, guestUserId: guest.id });

    expect(await assignmentsFor(competitionId, guest.id)).toHaveLength(0);
  });

  it("does NOT touch assignments in another trip's competition", async () => {
    // Scoped to the trip, never to the person globally — someone removed from
    // one trip keeps their teams everywhere else they are still on.
    const { tripId, competitionId, teamId } = await cupTrip("scoped");
    const other = await cupTrip("scoped-other");
    await assign(other.competitionId, other.teamId, member);
    await assign(competitionId, teamId, member);
    // Premise: one assignment on each cup.
    expect(await assignmentsFor(competitionId, member)).toHaveLength(1);
    expect(await assignmentsFor(other.competitionId, member)).toHaveLength(1);

    await ctx.caller().tripMembers.remove({ tripId, userId: member });

    // The removal did its job here (so the survivor below is a scope, not a no-op)…
    expect(await assignmentsFor(competitionId, member)).toHaveLength(0);
    // …and left the other trip's cup alone.
    expect(await assignmentsFor(other.competitionId, member)).toHaveLength(1);
  });
});

/**
 * A SOURCE guard, the idiom CLAUDE.md #21 uses for "don't call this here".
 *
 * The two tests above cover the two writers that exist. This one is about the
 * THIRD writer nobody has written yet: any new path that deletes a
 * `trip_members` row and forgets the assignments re-opens exactly this bug, and
 * no behavioural test can fail for code that hasn't been added.
 */
describe("every trip_members deletion in the app clears assignments too", () => {
  it("no server file deletes a membership row without calling the helper", async () => {
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    const root = path.resolve(__dirname, "..");

    async function walk(dir: string): Promise<string[]> {
      const entries = await fs.readdir(dir, { withFileTypes: true });
      const out: string[] = [];
      for (const e of entries) {
        const full = path.join(dir, e.name);
        if (e.isDirectory()) out.push(...(await walk(full)));
        else if (e.name.endsWith(".ts") && !e.name.includes(".test.")) out.push(full);
      }
      return out;
    }

    const offenders: string[] = [];
    for (const file of await walk(root)) {
      const src = await fs.readFile(file, "utf8");
      // `.from("trip_members")` followed by a `.delete(` within a few lines.
      const deletesMembership = /\.from\(\s*["']trip_members["']\s*\)[\s\S]{0,200}?\.delete\(/.test(src);
      // The UMBRELLA, not either half of it. A path that called only
      // `clearTripTeamAssignments` would satisfy the old form of this check and
      // still leave the match seat behind — which is exactly what both removal
      // paths did until #1016.
      if (deletesMembership && !src.includes("clearTripParticipation")) {
        offenders.push(path.relative(root, file));
      }
    }

    // `merge_guest_to_real_user` is not in this set because it lives in SQL, and
    // it is exempt on purpose: it deletes a membership row as PK-collision
    // resolution BEFORE it repoints team_assignments, so clearing them there
    // would destroy what it is about to hand to the real account. That is also
    // why there is no DELETE trigger — see migration 120's header.
    expect(offenders).toEqual([]);
  });
});
