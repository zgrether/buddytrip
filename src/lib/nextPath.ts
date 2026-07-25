/**
 * `?next=` return-path validation.
 *
 * An involuntary session expiry (authExpiry.ts) bounces the user to /login and
 * carries where they were as `?next=`, so re-auth returns them to their
 * scorecard instead of dumping them on the dashboard to renavigate while their
 * group waits.
 *
 * A `next` param taken at face value is an OPEN REDIRECT — an attacker mails
 * `/login?next=https://evil.example/harvest`, the victim signs in for real, and
 * the app hands them to the attacker's page wearing a fresh session. So a value
 * is honored ONLY if it is unambiguously a same-origin relative path:
 *
 *   - must start with a single "/"        → relative to this origin
 *   - must NOT start with "//" or "/\"    → protocol-relative, resolves OFF-origin
 *                                           ("//evil.example" is a valid URL)
 *   - must NOT contain a scheme           → "/\/\evil" and friends
 *   - must NOT contain control chars      → "/\n//evil" defeats naive prefix checks
 *
 * Anything else returns null and the caller falls back to its normal
 * destination. Deny-by-default: an unparseable value is refused, never
 * best-effort repaired.
 */

/** Rejects anything that isn't plainly a same-origin relative path. */
export function safeNextPath(raw: string | null | undefined): string | null {
  if (typeof raw !== "string" || raw.length === 0) return null;

  // Control characters (CR/LF/NUL/tab) — smuggled in to break the checks below
  // or to split a header. Reject outright rather than stripping.
  if (/[\u0000-\u001F\u007F]/.test(raw)) return null;

  // Must be rooted, and must not be protocol-relative. Browsers treat a
  // backslash as a slash in the authority position, so "/\evil.example" is
  // off-origin too.
  if (!raw.startsWith("/")) return null;
  if (raw.startsWith("//") || raw.startsWith("/\\")) return null;

  // A scheme can't appear in a rooted relative path; if one does, it's an
  // attempt to escape the origin.
  if (/^\/[a-z][a-z0-9+.-]*:/i.test(raw)) return null;

  // Final proof: resolve against a throwaway origin and confirm it stayed put.
  // Catches anything the string checks missed (backslash normalization, etc.).
  try {
    const probe = "https://nextpath.invalid";
    const url = new URL(raw, probe);
    if (url.origin !== probe) return null;
    return url.pathname + url.search + url.hash;
  } catch {
    return null;
  }
}

/**
 * The current location as a `next` value, for the redirect-to-login path.
 * Returns null on the server or when the current path isn't worth returning to.
 */
export function currentPathAsNext(): string | null {
  if (typeof window === "undefined") return null;
  return safeNextPath(window.location.pathname + window.location.search);
}
