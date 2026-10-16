/**
 * A Google place id: letters, digits, `_` and `-`, and nothing that could leave
 * its path segment (#693). Google publishes no maximum length, so the cap is
 * generous and only there to refuse junk.
 */
export function isPlaceId(value: string): boolean {
  return /^[A-Za-z0-9_-]{1,1024}$/.test(value);
}
