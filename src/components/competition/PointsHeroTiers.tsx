"use client";

import { Fragment } from "react";
import { Avatar } from "@/components/Avatar";
import { TeamBadge } from "@/components/TeamBadge";
import { teamInk } from "@/lib/teamTextColor";
import type { ClinchWatch } from "@/lib/pointsClinch";
import { pointsHeroStory, type HeroCupState } from "@/lib/pointsHeroStory";
import { CLINCH_STORY_WORD as WORD, fmtPts, ordinalShort } from "@/lib/vocabulary";
import { hatch, PERSON_COLOR } from "./StandingsRows";

/**
 * The points hero's two tiers (docs/CLINCH_AND_PODIUM.md §3), in the slots the
 * match-play hero gives its scores and its "if today holds" row. The middle
 * tier is the story; the lower is the clinch watch, hidden once it is final.
 *
 * Banked points decide everything here. The hatched extension and the dashed
 * post are the only things a projection touches, and neither can lock a place.
 */

export interface PointsHeroUnit {
  id: string;
  name: string;
  shortName: string | null;
  /** A team's color. A person has none, and takes `PERSON_COLOR`. */
  color: string | null;
  hasResult?: boolean;
}

const GOLD = "var(--color-bt-warning)";

function Contender({ unit, out }: { unit: PointsHeroUnit; out: boolean }) {
  return (
    <span style={{ opacity: out ? 0.28 : 1, display: "inline-flex" }} data-testid={`clinch-contender-${unit.id}`} data-out={out ? "true" : undefined}>
      {unit.color ? (
        <TeamBadge teamId={unit.id} name={unit.name} shortName={unit.shortName} color={unit.color} size={20} />
      ) : (
        <Avatar name={unit.name} sizePx={20} />
      )}
    </span>
  );
}

function ClinchWatchTier({ watch, units }: { watch: ClinchWatch; units: readonly PointsHeroUnit[] }) {
  const unitOf = (id: string | null) => units.find((u) => u.id === id);
  const soleLeader = watch.leaderIds.length === 1 ? unitOf(watch.leaderIds[0]) : undefined;
  const chaser = unitOf(watch.chaserId);
  const color = soleLeader?.color ?? (soleLeader ? PERSON_COLOR : "var(--color-bt-text-dim)");
  const pct = (n: number) => (watch.swing > 0 ? Math.max(0, Math.min(100, (n / watch.swing) * 100)) : 0);

  const fill = soleLeader ? pct(watch.lead) : 0;
  const projected = soleLeader && watch.projectedLead != null ? pct(watch.projectedLead) : fill;
  const landing = watch.liveSwing > 0 ? pct(watch.swing - watch.liveSwing) : null;
  const leadMark = WORD.leadMark(fmtPts(watch.lead));
  const caption = soleLeader && chaser ? `${leadMark} ${WORD.onChaser(chaser.name)}` : null;

  return (
    <div className="mt-[18px] flex flex-col gap-[9px] pt-3.5" style={{ borderTop: "1px solid var(--color-bt-subtle-border)" }} data-testid="clinch-watch">
      <p className="text-center" style={{ fontSize: 11, color: "var(--color-bt-text-dim)" }}>
        <span style={{ fontWeight: 700, letterSpacing: "0.14em", textTransform: "uppercase" }}>
          {watch.place === 1 ? WORD.clinchWatch : WORD.clinchWatchFor(ordinalShort(watch.place ?? 1))}
        </span>
        {WORD.separator}
        {WORD.gamesLeft(watch.gamesLeft)}
      </p>

      <div role="img" aria-label={caption ?? WORD.gamesLeft(watch.gamesLeft)} style={{ position: "relative", height: 12 }} data-testid="clinch-track">
        <div className="absolute inset-0 flex" style={{ gap: 3 }}>
          {watch.segments.map((s) => (
            <span key={s.gameId} style={{ flex: s.swing, height: "100%", borderRadius: 3, background: "var(--color-bt-card-raised)" }} data-testid="clinch-segment" />
          ))}
        </div>
        {fill > 0 && (
          <span
            className="absolute left-0 top-0 bottom-0"
            style={{ width: `${fill}%`, borderRadius: 3, background: color, boxShadow: `0 0 12px color-mix(in srgb, ${color} 60%, transparent)` }}
            data-testid="clinch-fill"
          />
        )}
        {projected > fill && (
          <span
            className="absolute top-0 bottom-0"
            style={{ left: `${fill}%`, width: `${projected - fill}%`, borderRadius: 3, background: hatch(color) }}
            data-testid="clinch-projected"
          />
        )}
        {landing != null && (
          <span
            aria-hidden="true"
            className="absolute"
            style={{ left: `${landing}%`, top: -6, height: 24, width: 0, borderLeft: `2px dashed ${GOLD}` }}
            data-testid="clinch-landing"
          />
        )}
        <span aria-hidden="true" className="absolute" style={{ right: -3, top: -6, width: 4, height: 24, borderRadius: 2, background: GOLD }} data-testid="clinch-post" />
      </div>

      <div className="flex items-center justify-between gap-2">
        <span className="min-w-0" style={{ fontSize: 13, color: "var(--color-bt-text)" }} data-testid="clinch-caption">
          {soleLeader && chaser && (
            <>
              <b style={{ color: soleLeader.color ? teamInk(soleLeader.color) : PERSON_COLOR }}>{leadMark}</b> {WORD.onChaser(chaser.name)}
            </>
          )}
        </span>
        <span className="flex shrink-0 gap-1">
          {watch.field.map((f) => {
            const unit = unitOf(f.id);
            return unit ? <Contender key={f.id} unit={unit} out={f.out} /> : null;
          })}
        </span>
      </div>
    </div>
  );
}

export function PointsHeroTiers({
  watch,
  units,
  totals,
  final,
  cup,
}: {
  watch: ClinchWatch;
  units: readonly PointsHeroUnit[];
  totals: Readonly<Record<string, number>>;
  final: boolean;
  cup?: HeroCupState;
}) {
  const story = pointsHeroStory(watch, units, totals, final, cup);
  const subjects = units.filter((u) => story.unitIds.includes(u.id));
  // One unit reads in its own ink. A shared 1st has no one color to read in.
  const sole = subjects.length === 1 ? subjects[0] : null;
  const inkOf = (u: PointsHeroUnit) => (u.color ? teamInk(u.color) : PERSON_COLOR);
  const subjectColor = sole ? inkOf(sole) : "var(--color-bt-text)";

  return (
    <>
      <div className="mt-5 flex flex-col items-center text-center" data-testid="points-hero-story">
        {/* A shared 1st names each unit in its own ink, joined in plain text (v2.8). */}
        {subjects.length > 0 && (
          <span style={{ fontSize: 17, fontWeight: 600, color: "var(--color-bt-text)" }} data-testid="points-hero-unit">
            {subjects.map((u, i) => (
              <Fragment key={u.id}>
                {i > 0 && WORD.levelJoiner}
                <span style={{ color: inkOf(u) }} data-testid={`points-hero-unit-name-${u.id}`}>
                  {u.name}
                </span>
              </Fragment>
            ))}
          </span>
        )}
        <span
          className={story.isScore ? "tabular-nums" : undefined}
          style={{
            fontSize: story.isScore ? 74 : 30,
            fontWeight: 700,
            lineHeight: story.isScore ? 1 : 1.1,
            color: story.isScore ? subjectColor : "var(--color-bt-text)",
          }}
          data-testid="points-hero-headline"
        >
          {story.headline}
        </span>
        <span
          className="mt-2"
          style={
            story.isTie
              ? { fontSize: 20, fontWeight: 800, color: "var(--color-bt-text)" }
              : { fontSize: 13, color: "var(--color-bt-text-dim)" }
          }
          data-testid="points-hero-sub"
          data-tie={story.isTie ? "true" : undefined}
        >
          {story.sub}
        </span>
      </div>
      {!final && watch.place != null && watch.gamesLeft > 0 && <ClinchWatchTier watch={watch} units={units} />}
    </>
  );
}
