import type { SupabaseClient } from "@supabase/supabase-js";
import { TRPCError } from "@trpc/server";
import { computeConfigHash } from "@/lib/configHash";
import { maybeRowOrThrow, rowsOrThrow } from "./rowOrThrow";

/**
 * The ROSTER fingerprint — PR 8's prerequisite 3 (ruled 2026-09-28).
 *
 * PR 8 shows a before-and-after preview for any roster change once points exist
 * (ruling 20), and a preview is only true of the roster it was built on. Rosters
 * had no concurrency check at all: assignments were in no version or hash, and
 * assign/remove take no base. So a preview could be confirmed against a roster
 * another organizer had since changed, and nothing would refuse it — which is
 * worse than no preview, because it looks checked.
 *
 * ── The config hash's pattern, one mechanism ────────────────────────────────
 * The same `computeConfigHash` (FNV-1a over canonical JSON), read on the server,
 * compared at confirm, refused with CONFLICT on a mismatch.
 *
 * ── …but SEPARATE from the config hash, deliberately ────────────────────────
 * Folding the roster into `games.configHash` would make every roster change
 * conflict with every open settings draft in the competition. The two answer
 * different questions and move independently.
 *
 * ── What is in it, and what is not ──────────────────────────────────────────
 * IN: the competition's team ids, and each assignment's (user, team). That is
 * everything a preview's before-and-after depends on: who is on which team, and
 * which teams exist.
 *
 * NOT: `sort_order`, `is_captain`, team names and colours. None of them changes
 * who is credited with what, so including them would refuse a preview because
 * someone reordered a team or renamed it — a conflict that protects nothing.
 * `id`/`created_at` of an assignment row are provenance (#16: hash semantic
 * content only). If a preview ever starts depending on one of these, it joins
 * the input here, in the same change.
 *
 * Total order (#16): teams by id; assignments by user_id, which is unique within
 * a competition (PK (competition_id, user_id)), so no two rows can swap unseen.
 */

export type RosterFingerprintInput = {
  teams: string[];
  assignments: { user_id: string; team_id: string | null }[];
};

/**
 * Read the roster and hash it. Throws NOT_FOUND unless the competition belongs
 * to `tripId` — a competition the caller cannot see reads as NO ROWS, which
 * hashes to a valid-looking value, and two such would compare equal. Every read
 * goes through the rowOrThrow family: a failed read is never an empty roster.
 */
export async function readRosterFingerprint(
  supabase: SupabaseClient,
  tripId: string,
  competitionId: string
): Promise<string> {
  const comp = maybeRowOrThrow(
    await supabase.from("competitions").select("id").eq("id", competitionId).eq("trip_id", tripId).maybeSingle(),
    "competition"
  );
  if (!comp) throw new TRPCError({ code: "NOT_FOUND", message: "Competition not found" });

  const [teamsRes, assignRes] = await Promise.all([
    supabase.from("teams").select("id").eq("competition_id", competitionId).order("id", { ascending: true }),
    supabase
      .from("team_assignments")
      .select("user_id, team_id")
      .eq("competition_id", competitionId)
      .order("user_id", { ascending: true }),
  ]);
  const input: RosterFingerprintInput = {
    teams: rowsOrThrow(teamsRes, "competition's teams").map((t) => (t as { id: string }).id),
    assignments: rowsOrThrow(assignRes, "competition's rosters").map((a) => ({
      user_id: (a as { user_id: string }).user_id,
      team_id: (a as { team_id: string | null }).team_id,
    })),
  };
  return computeConfigHash(input);
}

/** The refusal a confirm sends when the roster moved under its preview. */
export const ROSTER_CHANGED_MESSAGE = "The roster changed — review again.";

/**
 * Refuse unless the roster still matches the fingerprint a preview was built on.
 * PR 8's confirm calls this BEFORE it writes anything.
 */
export async function assertRosterUnchanged(
  supabase: SupabaseClient,
  tripId: string,
  competitionId: string,
  baseFingerprint: string
): Promise<void> {
  const current = await readRosterFingerprint(supabase, tripId, competitionId);
  if (current !== baseFingerprint) {
    throw new TRPCError({ code: "CONFLICT", message: ROSTER_CHANGED_MESSAGE });
  }
}
