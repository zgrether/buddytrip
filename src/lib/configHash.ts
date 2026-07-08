/**
 * computeConfigHash — a cheap, deterministic fingerprint of a game's CONFIG so a
 * remote device can detect "did the config change?" without refetching the whole
 * config every tick (game-state sync, Spec).
 *
 * The problem it solves: a game's config (modifiers, rules, settings, course,
 * status, groupings, matchups, handicaps) is cached client-side as STRUCTURE
 * (staleTime: Infinity) and only refetched on an explicit invalidation — which is
 * LOCAL to the device that made the change. A second device never hears about it
 * and plays under stale rules/groupings. The fix is a cheap change-signal: the
 * server hashes the config, the client polls just the hash alongside the score
 * poll, and refetches the full config ONLY when the hash it holds differs.
 *
 * Why a hash (not a version bump): it's derived from the ACTUAL config, so it
 * changes automatically whenever any config field changes — it can't be forgotten
 * the way a manual `version++` on some-but-not-all mutations can (and this app's
 * config mutations invalidate inconsistently — exactly the kind of gap a hash is
 * immune to).
 *
 * This is client-safe and dependency-free (no node `crypto`): the fingerprint
 * only needs to change iff the input changes — it is NOT a security primitive, so
 * a fast non-cryptographic hash (FNV-1a over canonical JSON) is the right tool.
 * Keeping it pure + client-safe makes it unit-testable and reusable either side.
 */

/**
 * Canonical JSON — stable across object key ordering so `{a:1,b:2}` and
 * `{b:2,a:1}` hash identically (Postgres jsonb / JS object key order must not
 * flip the fingerprint). Arrays keep their order — callers pass config arrays
 * pre-sorted by a stable key (e.g. row id) so a reorder that doesn't change
 * meaning doesn't churn the hash, and a reorder that DOES (e.g. slot order) does.
 */
export function canonicalize(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalize(obj[k])}`).join(",")}}`;
}

/**
 * FNV-1a 32-bit over the canonical string → an 8-char hex fingerprint. Fast,
 * deterministic, and collision-resistant enough for change-detection (we only
 * ever compare equality of two hashes of the same small config object).
 */
export function computeConfigHash(config: unknown): string {
  const s = canonicalize(config);
  let h = 0x811c9dc5; // FNV offset basis
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193); // FNV prime, 32-bit via imul
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}
