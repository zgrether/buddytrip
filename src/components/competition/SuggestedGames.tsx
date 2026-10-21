"use client";

import { useState } from "react";
import { X } from "lucide-react";
import { trpc } from "@/lib/trpc-client";
import { STARTING_POINTS, createInTurn, type StartingPointId, type SuggestedGame } from "@/lib/startingPoints";
import { formatLine } from "@/lib/formatLines";
import { EYEBROW, TYPE_SCALE } from "@/lib/typeScale";

/**
 * The starting point's suggested games, in the board's games list (Zach's
 * rulings, 2026-10-21): dashed rows, each with its one-line description and its
 * points. Add creates that game directly; Add all creates every remaining one,
 * and a failed create simply leaves that game as a suggestion; ✕ skips one. No
 * section-wide Hide.
 *
 * Nothing about "added" is stored: a suggestion counts as added once a game of
 * its format exists, so a created game takes its row away by appearing in the
 * list above. A skip is stored on the competition (migration 220), so it holds
 * for every organizer and survives a reload.
 *
 * Organizers only: the caller renders this for `canEdit`.
 */
export function SuggestedGames({
  tripId,
  competitionId,
  startingPoint,
  suggestions,
}: {
  tripId: string;
  competitionId: string;
  startingPoint: StartingPointId;
  /** What is still to suggest: `remainingSuggestions(...)`, computed by the caller. */
  suggestions: SuggestedGame[];
}) {
  const utils = trpc.useUtils();
  const create = trpc.games.create.useMutation();
  const skip = trpc.competitions.skipSuggestion.useMutation();
  const [busy, setBusy] = useState<Set<string>>(new Set());
  const [failed, setFailed] = useState<Set<string>>(new Set());
  // A skip takes the row away at once; the server's list confirms it.
  const [skipped, setSkipped] = useState<Set<string>>(new Set());

  /** The same refresh the add-game sheet makes after a create (#10: never the child alone). */
  function refresh() {
    void utils.games.listByTrip.invalidate({ tripId });
    void utils.competitions.leaderboard.invalidate({ tripId, competitionId });
    void utils.games.sideBoard.invalidate({ tripId });
    void utils.competitions.getByTrip.invalidate({ tripId });
    void utils.competitions.faceBootstrap.invalidate({ tripId });
  }

  const createOne = (s: SuggestedGame) =>
    create.mutateAsync({
      tripId,
      competitionId,
      gameTypeId: s.gameTypeId,
      name: s.name,
      pointsTotal: s.pointsTotal,
      pointsDistribution: s.pointsDistribution,
      competitionFormat: s.competitionFormat,
    });

  async function add(list: SuggestedGame[]) {
    const keys = list.map((s) => s.key);
    setBusy((b) => new Set([...b, ...keys]));
    setFailed((f) => new Set([...f].filter((k) => !keys.includes(k))));
    const { failed: failedKeys } = await createInTurn(list, createOne);
    setFailed((f) => new Set([...f, ...failedKeys]));
    setBusy((b) => new Set([...b].filter((k) => !keys.includes(k))));
    refresh();
  }

  async function skipOne(s: SuggestedGame) {
    setSkipped((x) => new Set([...x, s.key]));
    try {
      await skip.mutateAsync({ tripId, competitionId, key: s.key });
    } catch {
      // Put it back: the skip was not stored.
      setSkipped((x) => new Set([...x].filter((k) => k !== s.key)));
    }
    refresh();
  }

  const shown = suggestions.filter((s) => !skipped.has(s.key));
  if (shown.length === 0) return null;
  const sp = STARTING_POINTS[startingPoint];
  const anyBusy = shown.some((s) => busy.has(s.key));

  return (
    <section className="flex flex-col gap-2" aria-labelledby="suggested-games-title" data-testid="suggested-games">
      <div className="flex items-center justify-between">
        <h2 id="suggested-games-title" className="m-0" style={{ ...EYEBROW, fontSize: TYPE_SCALE.bodyDense, color: "var(--color-bt-text-dim)" }}>
          Suggested for a {sp.name}
        </h2>
        {shown.length > 1 && (
          <button
            type="button"
            onClick={() => void add(shown)}
            disabled={anyBusy}
            className="px-1 disabled:opacity-50"
            style={{ minHeight: 44, color: "var(--color-bt-accent)", fontSize: TYPE_SCALE.emphasis, fontWeight: 600 }}
            data-testid="suggested-games-add-all"
          >
            Add all
          </button>
        )}
      </div>

      {shown.map((s) => {
        const pending = busy.has(s.key);
        return (
          <div
            key={s.key}
            className="flex items-start gap-2.5 rounded-xl py-3 pl-3.5 pr-1.5"
            style={{ border: "1.5px dashed var(--color-bt-border)" }}
            data-testid={`suggested-game-${s.key}`}
          >
            <div className="flex min-w-0 flex-1 flex-col gap-1 pt-0.5">
              <span style={{ fontSize: TYPE_SCALE.name, fontWeight: 600, color: "var(--color-bt-text)" }}>{s.name}</span>
              <span style={{ fontSize: TYPE_SCALE.body, lineHeight: 1.4, color: "var(--color-bt-text-dim)" }} data-testid={`suggested-game-line-${s.key}`}>
                {formatLine(s.gameTypeId, s.competitionFormat)}
              </span>
              <span style={{ fontSize: TYPE_SCALE.captionPlus, color: "var(--color-bt-text)" }}>{s.pointsTotal} pts</span>
              {failed.has(s.key) && (
                <span style={{ fontSize: TYPE_SCALE.captionPlus, color: "var(--color-bt-danger)" }} data-testid={`suggested-game-failed-${s.key}`}>
                  Couldn’t add it. Try again.
                </span>
              )}
            </div>
            <button
              type="button"
              onClick={() => void add([s])}
              disabled={pending}
              className="rounded-lg px-3.5 disabled:opacity-50"
              style={{
                minHeight: 44,
                border: "1px solid var(--color-bt-accent)",
                color: "var(--color-bt-accent)",
                background: "transparent",
                fontSize: TYPE_SCALE.emphasis,
                fontWeight: 600,
              }}
              data-testid={`suggested-game-add-${s.key}`}
            >
              {pending ? "Adding…" : "Add"}
            </button>
            <button
              type="button"
              onClick={() => void skipOne(s)}
              disabled={pending}
              aria-label={`Skip ${s.name}`}
              className="flex items-center justify-center disabled:opacity-50"
              style={{ width: 40, minHeight: 44, color: "var(--color-bt-text-dim)" }}
              data-testid={`suggested-game-skip-${s.key}`}
            >
              <X size={16} />
            </button>
          </div>
        );
      })}
    </section>
  );
}
