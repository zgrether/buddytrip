import { MATCH_LEVEL_WORD } from "./matchPlay";
import { fmtToPar } from "./rackNStack";
import { fmtSkins } from "./quickGame";

/**
 * THE VIEWER'S OWN STANDING in a live game they are playing in (#1599), and the
 * ONE place it becomes words on the Games tab's live card.
 *
 * The server computes it under the viewer's own session and sends only this
 * value: no other player's scores or ids (`server/lib/ownStanding.ts`). Someone
 * who runs a game without playing in it gets no standing; their card is filled
 * (it's theirs) and says nothing about a result that isn't theirs.
 *
 * Wording ruled by Zach, 2026-10-12:
 *  - match play from the viewer's side: "2 UP thru 7", "AS thru 7", "2 DN thru 7"
 *    (DN pairs with UP and is how golf scoring apps show it); at the end
 *    "Won 3&2" / "Lost 3&2" / "Halved";
 *  - stroke play by its own measure: to par, or POINTS under Stableford, since
 *    that's how a Stableford round is scored;
 *  - non-golf matches say Tied, not Halved (a golf word), and "Not decided"
 *    partway through, since they have no running score.
 */
export type OwnStanding =
  /** Golf match play. `lead` is from the VIEWER's side: + up, − down. */
  | { kind: "match"; lead: number; thru: number; over: boolean; margin: string | null }
  /** Stroke play, scramble (the viewer's group) and rack (net). `thru` is a
   *  `thruLabel`: a count, or "F" once the round is complete. */
  | { kind: "to_par"; toPar: number; thru: string }
  /** Stroke play under Stableford. */
  | { kind: "points"; points: number; thru: string }
  | { kind: "skins"; skins: number; thru: string }
  /** `points` is null when the viewer has no sheet: nothing, not zero. */
  | { kind: "pickem"; points: number | null; resolved: number; total: number }
  /** A non-golf match: declared or not, with no running score in between. */
  | { kind: "result"; result: "won" | "lost" | "tied" | "pending" }
  | { kind: "not_started" };

/** The trailing side's word for a lead (Zach: DN, beside UP). */
const DOWN = "DN";

/** "+3 thru 9", or "+3 F" once the round is complete. */
const withThru = (head: string, thru: string) => (thru === "F" ? `${head} F` : `${head} thru ${thru}`);

const pts = (n: number) => `${n} ${n === 1 ? "pt" : "pts"}`;

export function formatOwnStanding(s: OwnStanding): string {
  switch (s.kind) {
    case "not_started":
      return MATCH_LEVEL_WORD.not_started;
    case "match": {
      if (s.over) {
        if (s.lead === 0) return MATCH_LEVEL_WORD.halved;
        // matchState's margin is the leader's: "3&2" reads the same for both
        // sides, "2 UP" (won on the last hole) is "2 DN" for the side that lost.
        const margin = s.margin ?? `${Math.abs(s.lead)} UP`;
        return s.lead > 0 ? `Won ${margin}` : `Lost ${margin.replace(/ UP$/, ` ${DOWN}`)}`;
      }
      if (s.lead > 0) return `${s.lead} UP thru ${s.thru}`;
      if (s.lead < 0) return `${-s.lead} ${DOWN} thru ${s.thru}`;
      return `${MATCH_LEVEL_WORD.level} thru ${s.thru}`;
    }
    case "to_par":
      return withThru(fmtToPar(s.toPar), s.thru);
    case "points":
      return withThru(pts(s.points), s.thru);
    case "skins":
      return withThru(fmtSkins(s.skins), s.thru);
    case "pickem":
      return s.points == null ? "Nothing submitted" : `${pts(s.points)} · ${s.resolved} of ${s.total} in`;
    case "result":
      return { won: "Won", lost: "Lost", tied: "Tied", pending: "Not decided" }[s.result];
  }
}
