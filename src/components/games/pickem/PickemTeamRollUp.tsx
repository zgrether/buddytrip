"use client";

import { TYPE_SCALE, EYEBROW } from "@/lib/typeScale";
import { placementPointsByTeam } from "@/lib/placementGroups";
import {
  sideStanding,
  leaderId,
  leaderClinched,
  orderByTotal,
  tiedWithPrevious,
  type SideStanding,
  type TeamStanding,
} from "@/lib/pickemBoard";
import { PickemUnassignedNote } from "./PickemUnassignedNote";
import type { ScoredPick, ScoredSlateGame } from "@/lib/pickemScoring";

/**
 * Screen G — the team roll-up.
 *
 * Takes the same slot the matches list occupies when `roll_up = team_totals`,
 * under the same two buttons. Not a route and not a page: the game has one
 * board and this is one of its two shapes.
 *
 * ── N sides, not two ───────────────────────────────────────────────────────
 *
 * The design draws two cards; that is an illustration, not a constraint. Phase
 * 7 made a points cup an ordering of N teams paid by placement, and every
 * derivation here is already entity-agnostic. The failure this replaced was a
 * `const [a, b] = standings` destructure — correct at two and silently dropping
 * every team after the second.
 *
 * ── The order IS the result ────────────────────────────────────────────────
 *
 * `orderByTotal`, always. In a points cup finishing position is what pays, so
 * presenting them in roster order would be presenting the wrong thing; and at
 * two teams a standings card that does not sort by the standing is simply a
 * scoreboard with the rows in an arbitrary order.
 *
 * ── Ties are resolved by the PAYOUT, never by the sort ─────────────────────
 *
 * Two teams level for first share the first and second awards between them.
 * `placementPointsByTeam` owns that averaging, which is why the sort here is
 * deliberately not asked to break the tie — a sort that picked a winner would
 * make the payout's careful halving describe something that is not on screen.
 */

export interface RollUpTeam {
  id: string;
  name: string;
}

export function PickemTeamRollUp({
  slate,
  sheets,
  teams,
  teamOf,
  nameOf,
  meId,
  useConfidence,
  resolved,
  total,
  distribution,
  pointsMode,
}: {
  slate: ScoredSlateGame[];
  sheets: Record<string, ScoredPick[]>;
  teams: RollUpTeam[];
  teamOf: (userId: string) => string | null;
  nameOf: (userId: string) => string;
  meId: string | null;
  useConfidence: boolean;
  resolved: number;
  total: number;
  /** The authored placement schedule. Undefined or empty means nothing to pay. */
  distribution?: number[];
  pointsMode: boolean;
}) {
  const remaining = total - resolved;

  const bySide = teams.map((t) => ({
    team: t,
    sheets: Object.entries(sheets)
      .filter(([uid]) => teamOf(uid) === t.id)
      .map(([uid, picks]) => ({ uid, picks })),
  }));

  const ranked = orderByTotal(
    bySide.map((s) => ({
      ...s,
      standing: sideStanding(
        slate,
        s.sheets.map((x) => x.picks),
        useConfidence
      ),
    }))
  );

  const asTeamStandings: TeamStanding[] = ranked.map((r) => ({
    id: r.team.id,
    standing: r.standing,
  }));
  const tied = tiedWithPrevious(asTeamStandings);
  const leadId = leaderId(asTeamStandings);
  const clinched = leaderClinched(asTeamStandings, remaining);
  const best = ranked[0]?.standing.total ?? 0;

  /**
   * What each place pays. `length` checked rather than presence: a game with no
   * authored split returns an EMPTY array, and an empty array is truthy — the
   * bare check once paid everyone "0 pts", which reads as a decided prize of
   * nothing rather than as a game nobody has configured.
   */
  const payout =
    pointsMode && distribution && distribution.length > 0
      ? placementPointsByTeam(
          asTeamStandings.map((t) => t.id),
          tied,
          distribution
        )
      : null;

  /**
   * People with a sheet and no side.
   *
   * Carried across from the board's own version rather than dropped with it:
   * their sheet scores nowhere, and rendering nothing is the empty-versus-
   * unknown pattern — fifteen rows where there are seventeen people reads as
   * "there are fifteen people", with no way to tell a short field from a
   * dropped one.
   */
  const unplaced = Object.keys(sheets)
    .filter((uid) => teamOf(uid) == null)
    .map(nameOf)
    .sort();

  const places = placeLabels(ranked, tied, resolved);
  const note = rollUpNote(ranked, resolved, remaining, clinched, leadId);

  return (
    <div className="flex flex-col gap-2" data-testid="pickem-rollup">
      <div className="flex items-baseline justify-between px-1" style={EYEBROW}>
        <span>Team totals</span>
        <span style={{ textTransform: "none", letterSpacing: 0, fontWeight: 600 }}>
          {remaining} of {total} still to play
        </span>
      </div>

      {note && (
        <div
          data-testid="pickem-rollup-note"
          className="px-1"
          style={{
            fontSize: TYPE_SCALE.caption,
            lineHeight: 1.45,
            color: clinched ? "var(--color-bt-accent)" : "var(--color-bt-text-dim)",
            fontWeight: clinched ? 600 : 400,
          }}
        >
          {note}
        </div>
      )}

      {ranked.map((s, i) => (
        <SideCard
          key={s.team.id}
          name={s.team.name}
          standing={s.standing}
          place={places[i]}
          /* `leaderId` returns null on a tie for the top, so this is already
             "sole" without a second condition — and the accent must not go on
             two cards at once, which is what would say one of them is ahead. */
          soleLeader={leadId != null && s.team.id === leadId}
          best={best}
          award={payout ? (payout.get(s.team.id) ?? 0) : null}
          scored={resolved > 0}
          showAwards={payout != null}
        />
      ))}

      <PickemUnassignedNote names={unplaced} teamCount={teams.length} />

      {ranked.map((s) => (
        <Contributions
          key={s.team.id}
          teamName={s.team.name}
          standing={s.standing}
          people={s.sheets.map(({ uid, picks }) => ({
            uid,
            name: nameOf(uid),
            standing: sideStanding(slate, [picks], useConfidence),
          }))}
          meId={meId}
        />
      ))}
    </div>
  );
}

/**
 * Every side's place label, in finishing order.
 *
 * ── Competition ranking, and the T is not decoration ───────────────────────
 *
 * Two teams level for first are BOTH first, and the next one is third. The
 * `T` prefix goes on every side sharing a place — including the top one, which
 * a naive "tied with the previous" read would leave as a plain `1st` while
 * marking only its partner. The reader would then see `1st` and `T1st` and
 * reasonably conclude one of them is ahead.
 *
 * So the count decides it: a place held by more than one side is a tie, and
 * every holder is marked.
 *
 * ── A dash before anything is scored ───────────────────────────────────────
 *
 * Everybody is level at zero, so calling the first row first would report a
 * standing that does not exist yet — the empty-versus-unknown split, in a
 * two-character pill. It is the same reason the awards read "Nothing awarded
 * yet" rather than paying out a first place nobody has taken.
 */
export function placeLabels(
  ranked: readonly { team: { id: string } }[],
  tiedWithPrev: ReadonlySet<string>,
  resolved: number
): string[] {
  if (resolved === 0) return ranked.map(() => "—");

  const places: number[] = [];
  for (let i = 0; i < ranked.length; i++) {
    places.push(i > 0 && tiedWithPrev.has(ranked[i].team.id) ? places[i - 1] : i + 1);
  }

  const held = new Map<number, number>();
  for (const p of places) held.set(p, (held.get(p) ?? 0) + 1);

  return places.map((p) => ((held.get(p) ?? 0) > 1 ? `T${ordinalFor(p)}` : ordinalFor(p)));
}

function ordinalFor(n: number): string {
  const rem100 = n % 100;
  if (rem100 >= 11 && rem100 <= 13) return `${n}th`;
  const rem10 = n % 10;
  if (rem10 === 1) return `${n}st`;
  if (rem10 === 2) return `${n}nd`;
  if (rem10 === 3) return `${n}rd`;
  return `${n}th`;
}

/** One side. */
function SideCard({
  name,
  standing,
  place,
  soleLeader,
  best,
  award,
  scored,
  showAwards,
}: {
  name: string;
  standing: SideStanding;
  place: string;
  soleLeader: boolean;
  best: number;
  award: number | null;
  scored: boolean;
  showAwards: boolean;
}) {
  const pct = best > 0 ? Math.min(100, (standing.total / best) * 100) : 0;
  return (
    <div
      data-testid="pickem-board-side"
      className="mx-1 flex flex-col gap-1.5 px-3 py-2.5"
      style={{
        borderRadius: 13,
        background: "var(--color-bt-card)",
        border: soleLeader
          ? "1px solid var(--color-bt-accent-border)"
          : "1px solid var(--color-bt-border)",
      }}
    >
      <div className="flex items-center gap-2">
        <span
          data-testid="pickem-rollup-place"
          className="shrink-0 rounded"
          style={{
            fontSize: 10,
            fontWeight: 700,
            padding: "2px 6px",
            minWidth: 26,
            textAlign: "center",
            color: "var(--color-bt-text-dim)",
            background: "var(--color-bt-card-raised)",
          }}
        >
          {place}
        </span>
        <span className="min-w-0 flex-1 truncate" style={{ fontSize: TYPE_SCALE.emphasis, fontWeight: 600 }}>
          {name}
        </span>
        <span
          style={{
            fontSize: 26,
            fontWeight: 800,
            lineHeight: 1.05,
            fontVariantNumeric: "tabular-nums",
            color: soleLeader ? "var(--color-bt-accent)" : "var(--color-bt-text)",
          }}
        >
          {standing.total}
        </span>
      </div>

      <span
        className="block overflow-hidden"
        style={{ height: 5, borderRadius: 3, background: "var(--color-bt-card-raised)" }}
      >
        <span
          className="block"
          style={{
            width: `${pct}%`,
            height: 5,
            borderRadius: 3,
            background: soleLeader ? "var(--color-bt-accent)" : "var(--color-bt-text-dim)",
            transition: "width 250ms ease-out",
          }}
        />
      </span>

      <div className="flex items-baseline justify-between gap-2">
        {showAwards ? (
          <span
            data-testid="pickem-board-payout"
            style={{ fontSize: 11.5, fontWeight: 600, color: "var(--color-bt-owner)" }}
          >
            {scored ? formatPayout(award ?? 0) : "Nothing awarded yet"}
          </span>
        ) : (
          <span />
        )}
        <span style={{ fontSize: TYPE_SCALE.caption, color: "var(--color-bt-text-dim)" }}>
          {standing.upside} still in play
        </span>
      </div>
    </div>
  );
}

/** Who put the total there. */
function Contributions({
  teamName,
  standing,
  people,
  meId,
}: {
  teamName: string;
  standing: SideStanding;
  people: { uid: string; name: string; standing: SideStanding }[];
  meId: string | null;
}) {
  const best = people.reduce((m, p) => Math.max(m, p.standing.total), 0);
  return (
    <div className="flex flex-col gap-1">
      <div className="mt-1 flex items-baseline justify-between px-1" style={EYEBROW}>
        <span className="min-w-0 truncate">{teamName}</span>
        <span style={{ textTransform: "none", letterSpacing: 0 }}>
          {standing.total} points from {people.length} sheet{people.length === 1 ? "" : "s"}
        </span>
      </div>
      {people.map((p) => (
        <div
          key={p.uid}
          data-testid="pickem-board-participant"
          className="mx-1 flex items-center gap-2 px-3"
          style={{
            minHeight: 38,
            borderRadius: 11,
            background: "var(--color-bt-card)",
            border: "1px solid var(--color-bt-border)",
          }}
        >
          <span
            className="min-w-0 flex-1 truncate"
            style={{ fontSize: TYPE_SCALE.bodyDense, fontWeight: 600 }}
          >
            {p.name}
            {p.uid === meId && <YouTag />}
          </span>
          <span
            className="shrink-0 text-right"
            style={{
              width: 30,
              fontSize: TYPE_SCALE.body,
              fontWeight: 700,
              fontVariantNumeric: "tabular-nums",
            }}
          >
            {p.standing.total}
          </span>
          <span
            className="block shrink-0 overflow-hidden"
            style={{ width: 56, height: 4, borderRadius: 2, background: "var(--color-bt-card-raised)" }}
          >
            <span
              className="block"
              style={{
                width: best > 0 ? `${(p.standing.total / best) * 100}%` : "0%",
                height: 4,
                borderRadius: 2,
                background: "var(--color-bt-accent)",
              }}
            />
          </span>
          <span
            className="shrink-0 text-right"
            style={{ width: 34, fontSize: TYPE_SCALE.caption, color: "var(--color-bt-text-dim)" }}
          >
            +{p.standing.upside}
          </span>
        </div>
      ))}
    </div>
  );
}

/**
 * The one-line state of the roll-up.
 *
 * Silent before anything is scored: at nil-all every side is level and any
 * sentence would be describing the ordering rather than the game.
 */
export function rollUpNote(
  ranked: readonly { team: { name: string }; standing: SideStanding }[],
  resolved: number,
  remaining: number,
  clinched: boolean,
  leadId: string | null
): string | null {
  if (resolved === 0 || ranked.length < 2) return null;
  const [first, second] = ranked;
  if (clinched && leadId != null) {
    return `${first.team.name} has clinched — ${remaining} still to play.`;
  }
  const margin = first.standing.total - second.standing.total;
  if (margin === 0) return `Level at the top with ${remaining} to play.`;
  return `${first.team.name} by ${margin} · ${second.standing.upside} still in play.`;
}

/**
 * A payout as it reads on a card: "2 pts", "1.5 pts", "0 pts".
 *
 * Trailing zeros trimmed, because the historical BBMI schedule is 2 / 1.5 / 0.5
 * / 0 and rendering "2.0" beside "1.5" makes the whole column look like a
 * measurement rather than a prize.
 */
export function formatPayout(v: number): string {
  const n = Math.round(v * 100) / 100;
  return `${n} pt${n === 1 ? "" : "s"}`;
}

function YouTag() {
  return (
    <span
      className="ml-1 rounded px-1"
      style={{
        fontSize: 9,
        fontWeight: 700,
        letterSpacing: "0.06em",
        textTransform: "uppercase",
        color: "var(--color-bt-accent)",
        background: "var(--color-bt-accent-faint)",
      }}
    >
      You
    </span>
  );
}
