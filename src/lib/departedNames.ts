/**
 * Names for people who have LEFT the trip (PR 8d), merged into a name map for
 * LOOKUP only.
 *
 * Every client name map is built from `tripMembers.list`, which no longer holds
 * someone who left — so their finished results, chat, expenses and bracket rows
 * read "Player" / "Unknown". The departure record keeps the name the crew saw
 * (`tripMembers.departedNames`).
 *
 * A current member always wins: an id already in the map keeps its entry. That is
 * also what keeps a rejoined person named by their membership rather than by an
 * old departure.
 *
 * Lookup only, never membership: the maps this is applied to are read with
 * `.get(id)`. `tripMembers.list` itself is NOT given departed people, because it
 * also decides who can be picked, paid for, seeded or mentioned.
 */
export function withDeparted<V>(
  byId: ReadonlyMap<string, V>,
  departed: ReadonlyMap<string, string> | undefined,
  as: (name: string, userId: string) => V,
): Map<string, V> {
  const out = new Map(byId);
  if (!departed) return out;
  for (const [id, name] of departed) if (!out.has(id)) out.set(id, as(name, id));
  return out;
}

/** The procedure's rows as a map — the shape `withDeparted` takes. */
export function departedMap(rows: readonly { userId: string; displayName: string }[] | undefined): Map<string, string> {
  return new Map((rows ?? []).map((r) => [r.userId, r.displayName]));
}
