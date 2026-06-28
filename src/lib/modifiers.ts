/**
 * Modifiers — the config-only "special rules" model (W-GAMEPAGE-01 §6.5).
 *
 * A modifier is a structured rule-of-the-day the app RECORDS but does not yet
 * compute — there is no scoring engine (deferred, `DEFERRED.md`). It is NOT a
 * broken promise: in the hand-entered-scoring era a toggled modifier flags
 * "last 3 holes worth double" for the group even though nothing auto-scores it.
 *
 * **Presence-model:** a key present in `games.modifiers` = enabled; absence =
 * disabled. The per-key VALUE holds config (`glorious_holes → { holes: N }`;
 * `moving_tees → {}`). This module is the single place that knows how each
 * modifier renders + serializes — but APPLICABILITY (which keys a format offers)
 * comes from `gameTypes.ts` `compatibleModifiers`, NOT here and NOT the DB
 * (`game_type_templates.compatible_modifiers` is deprecated — see the Modifiers
 * Phase-0 resolution, Flag 2).
 *
 * **Keys are snake_case** (`moving_tees`, `glorious_holes`) — the values already
 * stored in `games.modifiers`, `gameTypes.ts`, and live rows. Never camelCase.
 *
 * Client-safe (no server/DB deps) so both setup surfaces share it.
 */

/** The `games.modifiers` jsonb shape: key → per-rule config object. */
export type ModifiersMap = Record<string, Record<string, unknown>>;

export type ModifierControl = "checkbox" | "checkbox+stepper";

export interface ModifierDef {
  key: string;
  label: string;
  /** The card description — Zach's exact mock wording (W-GAMEPAGE P-E). No
   *  "config-only / not-auto-scored" disclaimer: a stale disclaimer left in when
   *  scoring logic lands is worse than none (deliberate reversal of #469). */
  description: string;
  controlType: ModifierControl;
}

export const GLORIOUS_HOLES_DEFAULT = 3;
export const GLORIOUS_HOLES_MIN = 1;
export const GLORIOUS_HOLES_MAX = 9;

export const MODIFIER_REGISTRY: Record<string, ModifierDef> = {
  moving_tees: {
    key: "moving_tees",
    label: "Moving tee boxes",
    description: "Score well and everyone else will appreciate you moving back a tee. Score not so well, and move up a tee to get your mojo back. We'll help guide you so you don't forget.",
    controlType: "checkbox",
  },
  glorious_holes: {
    key: "glorious_holes",
    label: "Glorious finishing holes",
    description: "We suggest making the last 3 holes worth double for keeping things interesting up until the end, but you can choose your own adventure.",
    controlType: "checkbox+stepper",
  },
};

/** Metadata for a key, with a soft fallback for an unknown key (fail soft). */
export function modifierDef(key: string): ModifierDef {
  return MODIFIER_REGISTRY[key] ?? { key, label: key, description: "", controlType: "checkbox" };
}

/** Clamp a trailing-hole count into the sane range (rounds, guards NaN → default). */
export function clampGloriousHoles(n: number): number {
  if (!Number.isFinite(n)) return GLORIOUS_HOLES_DEFAULT;
  return Math.max(GLORIOUS_HOLES_MIN, Math.min(GLORIOUS_HOLES_MAX, Math.round(n)));
}

/** Presence = enabled. */
export function isModifierEnabled(modifiers: ModifiersMap, key: string): boolean {
  return !!modifiers[key];
}

/**
 * Trailing-hole count for glorious_holes — **legacy-tolerant**: an enabled key
 * with no `holes` (the production `glorious_holes: {}` shape) reads as the
 * default 3, so existing rows don't break. Returns the default for a disabled
 * key too (the value the stepper opens at on first enable).
 */
export function gloriousHolesCount(modifiers: ModifiersMap): number {
  const v = modifiers["glorious_holes"];
  const h = v && typeof (v as { holes?: unknown }).holes === "number" ? (v as { holes: number }).holes : NaN;
  return Number.isFinite(h) ? clampGloriousHoles(h) : GLORIOUS_HOLES_DEFAULT;
}

/** The jsonb value to store under a key when enabling it (its default config). */
function defaultValueFor(key: string): Record<string, unknown> {
  return key === "glorious_holes" ? { holes: GLORIOUS_HOLES_DEFAULT } : {};
}

/** Enable/disable a key (presence-model), returning a NEW map. */
export function setModifierEnabled(modifiers: ModifiersMap, key: string, on: boolean): ModifiersMap {
  const next = { ...modifiers };
  if (on) next[key] = defaultValueFor(key);
  else delete next[key];
  return next;
}

/** Set glorious_holes' trailing-hole count (clamped); enables the key if absent. */
export function setGloriousHoles(modifiers: ModifiersMap, holes: number): ModifiersMap {
  return { ...modifiers, glorious_holes: { holes: clampGloriousHoles(holes) } };
}

/** Count of enabled modifiers among the applicable set. */
export function enabledCount(modifiers: ModifiersMap, available: string[]): number {
  return available.filter((k) => isModifierEnabled(modifiers, k)).length;
}

/**
 * Collapsed-row summary. None enabled → "None added" (the row is NOT resolved —
 * an optional row isn't "set" just by being applicable). ≥1 → a short list,
 * e.g. "Glorious finishing holes (last 3) · Moving tees".
 */
export function modifiersSummary(modifiers: ModifiersMap, available: string[]): string {
  const on = available.filter((k) => isModifierEnabled(modifiers, k));
  if (on.length === 0) return "None added";
  return on
    .map((k) =>
      k === "glorious_holes" ? `${modifierDef(k).label} (last ${gloriousHolesCount(modifiers)})` : modifierDef(k).label
    )
    .join(" · ");
}
