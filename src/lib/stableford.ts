/**
 * Stableford — points per hole against par, HIGHEST TOTAL WINS.
 *
 * Stroke play with an extra setting, NOT a new format. The entry schema is
 * unchanged (gross strokes per hole) and `result_strategy` stays
 * `stroke_total`; only the derivation between "what you shot" and "what you
 * scored" differs. That is precisely what config is for.
 *
 * Pure + client-safe (CLAUDE.md #8), so the live board, the scorecard and the
 * persisted final all run these same functions and cannot diverge.
 *
 * ── The rubric is a RANGE, never a map ─────────────────────────────────────
 *
 * Three things define a rubric: a `ceiling` differential, a `floor`
 * differential, and one point value per bucket between them. The ceiling is
 * "or better" and the floor is "or worse" — both catch-alls, so the domain is
 * TOTAL. A discrete `Record<-2 | -1 | 0 | 1, number>` breaks on the first
 * albatross and on the first quintuple bogey, and it breaks by returning
 * `undefined` rather than by failing, which is the worse direction.
 *
 * ── Net is the input, and gross is not a separate mode ─────────────────────
 *
 * Stableford is conventionally net. The app already derives net from gross plus
 * handicap strokes, and a game where nobody has a handicap IS gross:
 * `strokeHoles(0, …)` returns an empty set and `netStrokeEntries` subtracts
 * nothing, so a handicap-less round nets to gross unchanged (verified, not
 * assumed). There is therefore no "gross Stableford" setting to build — an old
 * round with no handicaps entered is already exactly that.
 */

/** Traditional = count strokes, lowest wins. Stableford = points, highest wins. */
export type ScoringType = "traditional" | "stableford";

export interface StablefordRubric {
  /**
   * The best differential with a bucket of its own. Anything BETTER scores the
   * first value — an albatross on a rubric whose ceiling is −2 scores the eagle
   * value, rather than falling off the end.
   */
  ceiling: number;
  /**
   * The worst differential with a bucket of its own. Anything WORSE scores the
   * last value — this is what makes a blow-up hole stop costing more, which is
   * the whole point of the format.
   */
  floor: number;
  /** One value per differential from `ceiling` to `floor` inclusive. */
  points: number[];
}

export interface StablefordConfig {
  /** Which preset the rubric came from — display + "has it been customised". */
  preset: StablefordPresetId;
  ceiling: number;
  floor: number;
  points: number[];
}

export type StablefordPresetId = "standard" | "modified" | "bbmi_2024" | "custom";

/**
 * ── The three presets ──────────────────────────────────────────────────────
 *
 * `points[i]` is the value for differential `ceiling + i`. Written as literal
 * arrays rather than assembled from a par-relative map so the table below reads
 * the same way the settings panel renders it.
 */
export const STABLEFORD_PRESETS: Record<
  Exclude<StablefordPresetId, "custom">,
  { label: string; description: string; rubric: StablefordRubric }
> = {
  /** Rule 32 — the amateur default, where 36 points equates to playing to handicap. */
  standard: {
    label: "Standard",
    description: "The classic scale. 36 points is playing to your handicap.",
    // −3 albatross 5 · −2 eagle 4 · −1 birdie 3 · 0 par 2 · +1 bogey 1 · +2 double 0
    rubric: { ceiling: -3, floor: 2, points: [5, 4, 3, 2, 1, 0] },
  },
  /**
   * The BARRACUDA scale — rewards aggression and PUNISHES a bad hole rather
   * than zeroing it. Labelled as the Barracuda scale rather than as canonical
   * on purpose: sources differ on its floor (−3 vs −2), so naming the event it
   * comes from is a claim that holds, where "Modified Stableford" alone is one
   * that does not.
   */
  modified: {
    label: "Modified (Barracuda)",
    description: "The Barracuda scale — big rewards for going low, and a bad hole costs you.",
    // −3 albatross 8 · −2 eagle 5 · −1 birdie 2 · 0 par 0 · +1 bogey −1 · +2 double −3
    rubric: { ceiling: -3, floor: 2, points: [8, 5, 2, 0, -1, -3] },
  },
  /**
   * Zach's own 2024 rubric, verified against his scorecard: the standard scale
   * roughly doubled with the floor moved one right. That shift is what makes
   * GROSS Stableford playable — with 97–103 on a par 70, a standard floor at +2
   * gives almost everyone zero all day, and a card of zeroes is not a game.
   */
  bbmi_2024: {
    label: "BBMI 2024",
    description: "The scale BBMI 2024 was scored under. Wider spread, and a triple still scores.",
    // −2 eagle 9 · −1 birdie 6 · 0 par 4 · +1 bogey 2 · +2 double 1 · +3 triple 0
    rubric: { ceiling: -2, floor: 3, points: [9, 6, 4, 2, 1, 0] },
  },
};

export const DEFAULT_PRESET: StablefordPresetId = "standard";

/** A rubric's bucket count — `floor − ceiling + 1`, and the length `points` must be. */
export function bucketCount(ceiling: number, floor: number): number {
  return floor - ceiling + 1;
}

/**
 * Is this rubric internally consistent? Checked rather than assumed because the
 * rubric arrives from `games.config` jsonb, which no type system reaches — a
 * hand-edited row or an older shape would otherwise index past the end of
 * `points` and score `undefined`, which reads as a broken app rather than a bad
 * config.
 */
export function isValidRubric(r: Partial<StablefordRubric> | null | undefined): r is StablefordRubric {
  if (!r || typeof r.ceiling !== "number" || typeof r.floor !== "number") return false;
  if (!Number.isInteger(r.ceiling) || !Number.isInteger(r.floor)) return false;
  if (r.floor < r.ceiling) return false;
  if (!Array.isArray(r.points)) return false;
  if (r.points.length !== bucketCount(r.ceiling, r.floor)) return false;
  return r.points.every((p) => typeof p === "number" && Number.isFinite(p));
}

/**
 * Points for one hole, from the differential (net strokes − par).
 *
 * Both ends CLAMP, which is the whole design: a differential better than the
 * ceiling scores the ceiling's value and one worse than the floor scores the
 * floor's. That is what "or better"/"or worse" mean, and it is why an albatross
 * and a quintuple bogey both have a defined answer on every rubric.
 */
export function stablefordPoints(differential: number, rubric: StablefordRubric): number {
  const clamped = Math.min(Math.max(differential, rubric.ceiling), rubric.floor);
  return rubric.points[clamped - rubric.ceiling];
}

/**
 * ── Rendering a bucket's name ──────────────────────────────────────────────
 *
 * Names are COMPUTED from the differential; they are never input and never
 * stored. Past the point where golf has a word, we render the NUMBER.
 *
 * **The rule, stated so it can be argued with rather than discovered:** words
 * for −3…+3 only — albatross, eagle, birdie, par, bogey, double bogey, triple
 * bogey. Outside that range, a signed differential (`+4`, `−4`).
 *
 * Those seven are the ones that get said out loud without hesitation. "Condor"
 * (−4) is real and functionally never used; "quadruple bogey" is also real, but
 * by +4 people say the number, and a rubric whose floor sits out there is
 * describing a catch-all rather than a bucket anyone names. No name is invented
 * for anything.
 */
export function bucketLabel(differential: number): string {
  switch (differential) {
    case -3: return "Albatross";
    case -2: return "Eagle";
    case -1: return "Birdie";
    case 0: return "Par";
    case 1: return "Bogey";
    case 2: return "Double bogey";
    case 3: return "Triple bogey";
    default: return differential > 0 ? `+${differential}` : `${differential}`;
  }
}

/** The label for a CATCH-ALL end, which is a range rather than a single value. */
export function edgeLabel(differential: number, end: "ceiling" | "floor"): string {
  return `${bucketLabel(differential)} ${end === "ceiling" ? "or better" : "or worse"}`;
}

/**
 * Every bucket a rubric defines, best first — the shape the settings panel and
 * the scorecard legend both render. Derived, so the panel cannot show a bucket
 * the scorer does not honour.
 */
export function rubricBuckets(
  rubric: StablefordRubric
): { differential: number; label: string; points: number; isEdge: boolean }[] {
  const out: { differential: number; label: string; points: number; isEdge: boolean }[] = [];
  for (let d = rubric.ceiling; d <= rubric.floor; d++) {
    const isEdge = d === rubric.ceiling || d === rubric.floor;
    out.push({
      differential: d,
      label: isEdge ? edgeLabel(d, d === rubric.ceiling ? "ceiling" : "floor") : bucketLabel(d),
      points: stablefordPoints(d, rubric),
      isEdge,
    });
  }
  return out;
}

/**
 * Move an edge outward or inward, GENERATING the new bucket rather than
 * rebuilding the array. Moving the floor down one is how the scale "slides
 * right", and without it Zach's own 2024 rubric is not expressible from a
 * preset.
 *
 * A newly generated bucket repeats its neighbour's value — the honest starting
 * point, since the edge it replaces was a catch-all already scoring that. The
 * owner then edits it.
 */
export function withEdge(
  rubric: StablefordRubric,
  end: "ceiling" | "floor",
  value: number
): StablefordRubric {
  if (end === "ceiling") {
    if (value === rubric.ceiling || value > rubric.floor) return rubric;
    if (value < rubric.ceiling) {
      const added = Array<number>(rubric.ceiling - value).fill(rubric.points[0]);
      return { ...rubric, ceiling: value, points: [...added, ...rubric.points] };
    }
    return { ...rubric, ceiling: value, points: rubric.points.slice(value - rubric.ceiling) };
  }
  if (value === rubric.floor || value < rubric.ceiling) return rubric;
  const last = rubric.points[rubric.points.length - 1];
  if (value > rubric.floor) {
    const added = Array<number>(value - rubric.floor).fill(last);
    return { ...rubric, floor: value, points: [...rubric.points, ...added] };
  }
  return { ...rubric, floor: value, points: rubric.points.slice(0, value - rubric.ceiling + 1) };
}

/** Set one bucket's value, returning a NEW rubric. Out-of-range is a no-op. */
export function withBucketPoints(
  rubric: StablefordRubric,
  differential: number,
  points: number
): StablefordRubric {
  if (differential < rubric.ceiling || differential > rubric.floor) return rubric;
  const next = [...rubric.points];
  next[differential - rubric.ceiling] = points;
  return { ...rubric, points: next };
}

/** Does this rubric still match the preset it claims? Drives the Custom flip. */
export function matchesPreset(rubric: StablefordRubric, preset: StablefordPresetId): boolean {
  if (preset === "custom") return false;
  const p = STABLEFORD_PRESETS[preset]?.rubric;
  if (!p) return false;
  return (
    p.ceiling === rubric.ceiling &&
    p.floor === rubric.floor &&
    p.points.length === rubric.points.length &&
    p.points.every((v, i) => v === rubric.points[i])
  );
}

// ── Reading `games.config` ───────────────────────────────────────────────────

/**
 * The scoring block, read off a game's `config` jsonb.
 *
 * **Absent, malformed and Traditional all resolve to Traditional**, and that is
 * the safe direction rather than a shrug: every game that exists today has
 * `config = '{}'`, and reading those as anything but Traditional would rescore
 * the entire history of the app. A rubric that fails validation likewise falls
 * back rather than scoring `undefined` — a wrong-looking card is worse than a
 * card that reads exactly as it always did.
 */
export function scoringOf(config: unknown): { type: ScoringType; rubric: StablefordRubric | null } {
  const c = (config ?? {}) as { scoringType?: unknown; stableford?: unknown };
  if (c.scoringType !== "stableford") return { type: "traditional", rubric: null };
  const s = c.stableford as Partial<StablefordRubric> | undefined;
  if (!isValidRubric(s)) return { type: "traditional", rubric: null };
  return { type: "stableford", rubric: { ceiling: s.ceiling, floor: s.floor, points: [...s.points] } };
}

/** The `games.config` value for a scoring choice — the write side of `scoringOf`. */
export function configFor(type: ScoringType, cfg: StablefordConfig | null): Record<string, unknown> {
  if (type === "traditional" || !cfg) return { scoringType: "traditional" };
  return {
    scoringType: "stableford",
    stableford: { preset: cfg.preset, ceiling: cfg.ceiling, floor: cfg.floor, points: [...cfg.points] },
  };
}
