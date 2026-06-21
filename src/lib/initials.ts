/**
 * The ONE initials algorithm. Pure + framework-free so BOTH client (`Avatar`,
 * the scorecard) and server (`news.ts`) import the same logic — the split that
 * previously spawned 4 hand-rolled copies. If you need initials, import this;
 * never re-derive them inline.
 *
 * "Zach Grether" → "ZG"; "Llama" → "L"; "" → "?"
 */
export function initialsFor(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  return parts
    .map((w) => w[0] ?? "")
    .join("")
    .toUpperCase()
    .slice(0, 2);
}
