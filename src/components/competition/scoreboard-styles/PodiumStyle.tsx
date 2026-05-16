import { fmtPts } from "./mock-score";
import type { ScoreboardTeam, StyleProps } from "./types";

/** Visual podium: 1st in the middle (tallest), 2nd left, 3rd right.
 *  Teams in positions 4+ render as a list underneath. */
export function PodiumStyle({ data }: StyleProps) {
  const sorted = [...data.teams].sort(
    (a, b) => (data.totals[b.id] ?? 0) - (data.totals[a.id] ?? 0)
  );

  const first = sorted[0];
  const second = sorted[1];
  const third = sorted[2];
  const rest = sorted.slice(3);

  return (
    <div className="p-4">
      {/* Podium row — left:2nd  middle:1st  right:3rd */}
      <div className="flex items-end justify-center gap-2">
        {second && (
          <PodiumBlock
            team={second}
            place={2}
            points={data.totals[second.id] ?? 0}
            heightClass="h-20"
          />
        )}
        {first && (
          <PodiumBlock
            team={first}
            place={1}
            points={data.totals[first.id] ?? 0}
            heightClass="h-28"
          />
        )}
        {third && (
          <PodiumBlock
            team={third}
            place={3}
            points={data.totals[third.id] ?? 0}
            heightClass="h-14"
          />
        )}
      </div>

      {rest.length > 0 && (
        <div
          className="mt-4 space-y-1.5 pt-3"
          style={{ borderTop: "1px solid var(--color-bt-border)" }}
        >
          {rest.map((t, i) => (
            <div
              key={t.id}
              className="flex items-center gap-3 px-2"
            >
              <span
                className="w-5 text-center text-[11px] font-bold"
                style={{ color: "var(--color-bt-text-dim)" }}
              >
                {i + 4}
              </span>
              <span
                className="h-2.5 w-2.5 flex-shrink-0 rounded-full"
                style={{ background: t.color }}
                aria-hidden
              />
              <span
                className="flex-1 truncate text-sm"
                style={{ color: "var(--color-bt-text)" }}
              >
                {t.name}
              </span>
              <span
                className="text-sm font-semibold tabular-nums"
                style={{ color: "var(--color-bt-text)" }}
              >
                {fmtPts(data.totals[t.id] ?? 0)}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function PodiumBlock({
  team,
  place,
  points,
  heightClass,
}: {
  team: ScoreboardTeam;
  place: number;
  points: number;
  heightClass: string;
}) {
  const medals = ["", "🥇", "🥈", "🥉"];
  return (
    <div className="flex flex-1 flex-col items-center" style={{ maxWidth: 130 }}>
      <span className="mb-1 text-2xl">{medals[place]}</span>
      <p
        className="truncate text-center text-xs font-semibold"
        style={{ color: "var(--color-bt-text)", maxWidth: "100%" }}
      >
        {team.short_name}
      </p>
      <p
        className="mb-1 text-lg font-bold tabular-nums"
        style={{ color: "var(--color-bt-text)" }}
      >
        {fmtPts(points)}
      </p>
      <div
        className={`w-full rounded-t-md ${heightClass}`}
        style={{
          background: `linear-gradient(180deg, ${team.color} 0%, color-mix(in srgb, ${team.color} 55%, transparent) 100%)`,
          border: "1px solid var(--color-bt-border)",
          borderBottom: "none",
        }}
        aria-hidden
      />
    </div>
  );
}
