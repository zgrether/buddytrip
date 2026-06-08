import { createHash } from "crypto";

/**
 * Human-friendly trip URL slugs — `slugify(title)-<code>`, e.g. `bbmi-2027-a3f9c1`.
 *
 * The title alone can't be globally unique (two crews can both plan a "Cancun"
 * trip), so every slug carries a short code derived from the trip id. The code
 * makes the slug **unique by construction** — no global collision check, no
 * race at creation — while the title prefix keeps it readable. The trip's UUID
 * stays the canonical id and a permanent URL fallback; the slug is a display
 * layer.
 *
 * The algorithm is mirrored in SQL in the backfill migration
 * (`..._031_trip_slugs.sql`) so existing trips get identical-shape slugs.
 * Slugs are generated once at creation and are **stable** — renaming a trip
 * does NOT change its slug, so shared links never break.
 */

const SLUG_MAX = 40;
const CODE_LEN = 6;

/** Title → lowercase, non-alphanumerics collapsed to `-`, trimmed, capped. */
export function slugifyTitle(title: string): string {
  const base = (title ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .slice(0, SLUG_MAX)
    .replace(/^-+|-+$/g, "");
  return base || "trip";
}

/** Stable short code from the trip id (first 6 hex of its md5). */
export function tripSlugCode(id: string): string {
  return createHash("md5").update(id).digest("hex").slice(0, CODE_LEN);
}

/** Full slug for a trip: `slugify(title)-<code>`. */
export function buildTripSlug(title: string, id: string): string {
  return `${slugifyTitle(title)}-${tripSlugCode(id)}`;
}
