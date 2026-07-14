"use client";

import { useCallback, useEffect, useState } from "react";

// ── useTeeVisibility ─────────────────────────────────────────────────────
//
// Persists the scorecard's tee filter (which yardage rows are shown) per GAME
// in localStorage. Each game has its own course + set of tees, so the key is
// the game id — and because a game's scorecard is reachable from several
// places (game view, leaderboard preview, scorecard page), keying on the game
// id makes the choice consistent regardless of how you got there.
//
// We store only the user's OVERRIDES — a `{ [teeName]: visible }` map of tees
// the user explicitly toggled away from their default visibility. Tees the
// user never touched fall back to `row.defaultVisible`, so a later change to a
// tee's default still applies. The chosen (in-play) tee is always shown by the
// caller regardless of this map.
//
// `gameId` is optional: when absent (Quick Game, tests, a course-less game)
// the hook is a plain in-memory useState — the scorecard components stay
// persistence-agnostic (pattern #7), gaining persistence only when a real
// game id is threaded in.

export type TeeOverrides = Record<string, boolean>;

const KEY = (gameId: string) => `bt-game-${gameId}-tee-visibility`;

/** Parse a stored payload into a validated overrides map. Pure + exported so
 *  it can be unit-tested without a DOM. Tolerates absent / garbage payloads. */
export function parseTeeOverrides(raw: string | null): TeeOverrides {
  if (!raw) return {};
  try {
    const obj = JSON.parse(raw);
    if (!obj || typeof obj !== "object" || Array.isArray(obj)) return {};
    const out: TeeOverrides = {};
    for (const [k, v] of Object.entries(obj)) {
      if (typeof v === "boolean") out[k] = v;
    }
    return out;
  } catch {
    return {};
  }
}

function readOverrides(gameId: string | null | undefined): TeeOverrides {
  if (!gameId || typeof window === "undefined") return {};
  try {
    return parseTeeOverrides(window.localStorage.getItem(KEY(gameId)));
  } catch {
    return {};
  }
}

function sameOverrides(a: TeeOverrides, b: TeeOverrides): boolean {
  const ak = Object.keys(a);
  const bk = Object.keys(b);
  if (ak.length !== bk.length) return false;
  return ak.every((k) => a[k] === b[k]);
}

export function useTeeVisibility(
  gameId: string | null | undefined,
): [TeeOverrides, (next: TeeOverrides) => void] {
  // Lazy initializer reads localStorage on first render (SSR → {}).
  const [overrides, setOverridesState] = useState<TeeOverrides>(() =>
    readOverrides(gameId),
  );

  // Re-sync when the game changes (the panel can swap games without a full
  // remount). localStorage is the external system this effect subscribes to —
  // the whitelisted case for the set-state-in-effect lint rule.
  useEffect(() => {
    const next = readOverrides(gameId);
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setOverridesState((cur) => (sameOverrides(cur, next) ? cur : next));
  }, [gameId]);

  const setOverrides = useCallback(
    (next: TeeOverrides) => {
      setOverridesState(next);
      if (!gameId || typeof window === "undefined") return;
      try {
        if (Object.keys(next).length === 0) window.localStorage.removeItem(KEY(gameId));
        else window.localStorage.setItem(KEY(gameId), JSON.stringify(next));
      } catch {
        // Storage disabled / private mode — state still flips in memory.
      }
    },
    [gameId],
  );

  return [overrides, setOverrides];
}
