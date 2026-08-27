"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Search } from "lucide-react";
import {
  MATCHUP_LEAGUES,
  MIN_QUERY,
  formatKickoff,
  searchTeams,
  upcomingFirst,
  type Matchup,
  type MatchupTeam,
} from "@/lib/matchupApi";
import { TYPE_SCALE } from "@/lib/typeScale";

/**
 * Search a team, pick one of their games.
 *
 * ── The contract, and the whole of it ───────────────────────────────────────
 * In: a place to type. Out: `onPick({ espnEventId, away, home, startsAt,
 * neutralSite })`. That is the entire surface area.
 *
 * **It knows nothing about pick'em** — not the slate, not the draft, not the
 * storage, not that a "game" is a row in a table somewhere. It cannot read or
 * write pick'em state because it has no way to name it.
 * `matchupBoundary.test.ts` fails the build if an import ever crosses that
 * line.
 *
 * That is not reuse-by-anticipation. The plausible second consumer (ad-hoc
 * betting) mostly does NOT want this — "twenty bucks says you miss this putt"
 * is free text with two sides and no ESPN — so the boundary is here to keep a
 * future extraction cheap, not because an extraction is coming.
 *
 * ── Typing is free; only SELECTING costs a request ──────────────────────────
 * The team index is fetched ONCE per league and searched in memory. 32 NFL
 * teams and 759 college teams, four fields each, changing about once a year.
 * A keystroke never hits the network; picking a team fetches that team's
 * schedule.
 *
 * ── It degrades to nothing, on purpose ──────────────────────────────────────
 * Every failure path — ESPN down, DNS blocked, a shape change, an empty league
 * — ends in "no results" plus an honest line, never an error state. The manual
 * form underneath is the base case and must keep working; this only fills
 * fields a person could have typed.
 */

type Status = "idle" | "loading-index" | "ready" | "unavailable";

export function MatchupSearch({
  onPick,
  /** Event ids already used by the caller. Shown as "added" and not selectable,
   *  so searching two teams in the same game cannot add it twice. The component
   *  does not know WHY they are taken. */
  takenEventIds,
  autoFocus = false,
}: {
  onPick: (m: Matchup) => void;
  takenEventIds?: Iterable<string>;
  autoFocus?: boolean;
}) {
  const [leagueId, setLeagueId] = useState(MATCHUP_LEAGUES[0].id);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<Status>("idle");
  const [team, setTeam] = useState<MatchupTeam | null>(null);
  const [games, setGames] = useState<Matchup[] | null>(null);
  const [loadingGames, setLoadingGames] = useState(false);

  /** league id → team index. Kept for the component's lifetime so switching
   *  leagues back and forth does not refetch. */
  const indexes = useRef<Map<string, MatchupTeam[]>>(new Map());
  const [indexVersion, setIndexVersion] = useState(0);

  const taken = useMemo(() => new Set(takenEventIds ?? []), [takenEventIds]);

  // Fetch the index for the selected league, once.
  useEffect(() => {
    let cancelled = false;
    if (indexes.current.has(leagueId)) {
      setStatus(indexes.current.get(leagueId)!.length > 0 ? "ready" : "unavailable");
      return;
    }
    setStatus("loading-index");
    fetch(`/api/matchups/teams?league=${encodeURIComponent(leagueId)}`)
      .then((r) => (r.ok ? r.json() : []))
      .catch(() => [])
      .then((teams: MatchupTeam[]) => {
        if (cancelled) return;
        indexes.current.set(leagueId, Array.isArray(teams) ? teams : []);
        setIndexVersion((v) => v + 1);
        setStatus((Array.isArray(teams) ? teams : []).length > 0 ? "ready" : "unavailable");
      });
    return () => {
      cancelled = true;
    };
  }, [leagueId]);

  const index = indexes.current.get(leagueId) ?? [];
  // `indexVersion` is read so the memo recomputes when the ref fills in — the
  // ref itself is not reactive.
  const results = useMemo(
    () => (team ? [] : searchTeams(index, query)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [query, leagueId, team, indexVersion]
  );

  function pickTeam(t: MatchupTeam) {
    setTeam(t);
    setGames(null);
    setLoadingGames(true);
    fetch(`/api/matchups/schedule?league=${encodeURIComponent(leagueId)}&teamId=${encodeURIComponent(t.id)}`)
      .then((r) => (r.ok ? r.json() : []))
      .catch(() => [])
      .then((m: Matchup[]) => {
        setGames(upcomingFirst(Array.isArray(m) ? m : []));
        setLoadingGames(false);
      });
  }

  function reset() {
    setTeam(null);
    setGames(null);
    setQuery("");
  }

  return (
    <div className="flex flex-col gap-2" data-testid="matchup-search">
      {/* League — config-driven, so adding basketball is a list entry. */}
      <div className="flex gap-1.5">
        {MATCHUP_LEAGUES.map((l) => {
          const on = l.id === leagueId;
          return (
            <button
              key={l.id}
              type="button"
              aria-pressed={on}
              onClick={() => {
                setLeagueId(l.id);
                // KEEP the query. Typing a team into the wrong league and
                // having to retype it on the switch is the most likely way to
                // use this wrong — the correction should cost one tap, not the
                // words again. The selected TEAM does clear, because it belongs
                // to the league you just left.
                setTeam(null);
                setGames(null);
              }}
              className="rounded-lg px-2.5 py-1"
              style={{
                fontSize: TYPE_SCALE.caption,
                fontWeight: 600,
                background: on ? "var(--color-bt-accent-faint)" : "transparent",
                border: `1px solid ${on ? "var(--color-bt-accent-border)" : "var(--color-bt-border)"}`,
                color: on ? "var(--color-bt-accent)" : "var(--color-bt-text-dim)",
              }}
            >
              {l.label}
            </button>
          );
        })}
      </div>

      {team ? (
        <div className="flex items-center gap-2">
          <span className="min-w-0 flex-1 truncate" style={{ fontSize: TYPE_SCALE.bodyDense, fontWeight: 600 }}>
            {team.displayName}
          </span>
          <button
            type="button"
            onClick={reset}
            data-testid="matchup-change-team"
            style={{ fontSize: TYPE_SCALE.caption, fontWeight: 600, color: "var(--color-bt-accent)" }}
          >
            Change
          </button>
        </div>
      ) : (
        <div className="relative">
          <Search
            size={14}
            style={{ position: "absolute", left: 9, top: 11, color: "var(--color-bt-text-dim)" }}
          />
          <input
            aria-label="Search for a team"
            data-testid="matchup-query"
            value={query}
            autoFocus={autoFocus}
            placeholder={status === "loading-index" ? "Loading teams…" : "Search a team"}
            onChange={(e) => setQuery(e.target.value)}
            style={{
              background: "var(--color-bt-card-raised)",
              border: "1px solid var(--color-bt-border)",
              borderRadius: 8,
              color: "var(--color-bt-text)",
              fontSize: 16, // iOS zooms on focus below 16 (#1062)
              padding: "8px 10px 8px 28px",
              width: "100%",
            }}
          />
        </div>
      )}

      {/* Team results — local, instant. */}
      {!team && query.trim().length >= MIN_QUERY && (
        <div className="flex flex-col gap-1">
          {results.length === 0 ? (
            <Muted>
              {status === "unavailable"
                ? "Team search isn't available right now — type the game in below."
                : status === "loading-index"
                  ? "Loading teams…"
                  : "No teams match that."}
            </Muted>
          ) : (
            results.map((t) => (
              <button
                key={t.id}
                type="button"
                data-testid="matchup-team-result"
                onClick={() => pickTeam(t)}
                className="rounded-lg px-2.5 py-2 text-left"
                style={{
                  background: "var(--color-bt-card)",
                  border: "1px solid var(--color-bt-border)",
                  fontSize: TYPE_SCALE.bodyDense,
                  fontWeight: 600,
                }}
              >
                {t.displayName}
                {t.abbreviation && (
                  <span style={{ color: "var(--color-bt-text-dim)", fontWeight: 500 }}>
                    {" "}
                    · {t.abbreviation}
                  </span>
                )}
              </button>
            ))
          )}
        </div>
      )}

      {/* That team's games. */}
      {team && (
        <div className="flex flex-col gap-1">
          {loadingGames ? (
            <Muted>Loading games…</Muted>
          ) : !games || games.length === 0 ? (
            <Muted>No games found — type the game in below.</Muted>
          ) : (
            games.map((g) => {
              const isTaken = taken.has(g.espnEventId);
              return (
                <button
                  key={g.espnEventId}
                  type="button"
                  data-testid="matchup-game-result"
                  disabled={isTaken}
                  onClick={() => {
                    onPick(g);
                    reset();
                  }}
                  className="rounded-lg px-2.5 py-2 text-left disabled:opacity-40"
                  style={{
                    background: "var(--color-bt-card)",
                    border: "1px solid var(--color-bt-border)",
                  }}
                >
                  <div style={{ fontSize: TYPE_SCALE.bodyDense, fontWeight: 600 }}>
                    {g.away} <span style={{ color: "var(--color-bt-text-dim)", fontWeight: 500 }}>
                      {g.neutralSite ? "vs" : "at"}
                    </span>{" "}
                    {g.home}
                  </div>
                  <div style={{ fontSize: TYPE_SCALE.caption, color: "var(--color-bt-text-dim)", marginTop: 1 }}>
                    {formatKickoff(g.startsAt)}
                    {isTaken && " · already added"}
                  </div>
                </button>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}

function Muted({ children }: { children: React.ReactNode }) {
  return (
    <span
      className="px-1 py-1"
      style={{ fontSize: TYPE_SCALE.caption, color: "var(--color-bt-text-dim)" }}
    >
      {children}
    </span>
  );
}
