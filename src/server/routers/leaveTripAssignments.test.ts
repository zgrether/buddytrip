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
let tripId: string;
let competitionId: string;
let teamId: string;
let member: string;

const assignmentsFor = async (userId: string) =>
  (await ctx.admin.from("team_assignments").select("user_id").eq("competition_id", competitionId).eq("user_id", userId))
    .data ?? [];

async function assign(userId: string) {
  await ctx.admin.from("team_assignments").insert({
    competition_id: competitionId,
    team_id: teamId,
    user_id: userId,
  });
}

beforeAll(async () => {
  ctx = await TestContext.create();
  tripId = await ctx.createTrip("leave-trip Trip");
  await ctx.addTripMember(tripId, "member", "Member");
  member = ctx.getUser("member").id;
  competitionId = await ctx.createCompetition(tripId, "leave-trip Cup");
  teamId = await ctx.createTeam(competitionId, "Leavers");
}, 120000);

afterAll(async () => {
  await ctx.cleanup();
}, 60000);

describe("removing a member clears their cup team assignment", () => {
  it("tripMembers.remove — the real-account path", async () => {
    await assign(member);
    expect(await assignmentsFor(member)).toHaveLength(1);

    await ctx.caller().tripMembers.remove({ tripId, userId: member });

    expect(await assignmentsFor(member)).toHaveLength(0);
  });

  it("ghostCrew.remove — the guest path", async () => {
    const guest = (await ctx.caller().ghostCrew.create({ tripId, name: "Temp Guest" })) as { id: string };
    await assign(guest.id);
    expect(await assignmentsFor(guest.id)).toHaveLength(1);

    await ctx.caller().ghostCrew.remove({ tripId, guestUserId: guest.id });

    expect(await assignmentsFor(guest.id)).toHaveLength(0);
  });

  it("does NOT touch assignments in another trip's competition", async () => {
    // Scoped to the trip, never to the person globally — someone removed from
    // one trip keeps their teams everywhere else they are still on.
    const otherTrip = await ctx.createTrip("other Trip");
    await ctx.addTripMemberById(otherTrip, member, "Member");
    const otherComp = await ctx.createCompetition(otherTrip, "other Cup");
    const otherTeam = await ctx.createTeam(otherComp, "Stayers");
    await ctx.admin.from("team_assignments").insert({
      competition_id: otherComp, team_id: otherTeam, user_id: member,
    });

    await ctx.addTripMemberById(tripId, member, "Member");
    await assign(member);
    await ctx.caller().tripMembers.remove({ tripId, userId: member });

    expect(await assignmentsFor(member)).toHaveLength(0);
    const kept = (await ctx.admin.from("team_assignments").select("user_id").eq("competition_id", otherComp)).data ?? [];
    expect(kept).toHaveLength(1);
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
      // paths did until #1013.
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
