// ── App version metadata ─────────────────────────────────────────────────
//
// Single source of truth for the version + build strings surfaced in:
//   • UserMenu's "About BuddyTrip" row (small "v0.9" tag on the right)
//   • AboutModal's version pill in the header
//   • AboutModal's mono build line at the bottom
//
// When bumping a release, edit APP_VERSION here. APP_BUILD is the date the
// release went out — change it any time you cut a build the public will
// see. Keep them in lockstep with `package.json`'s version if you wire
// that up later; for now they live here so a non-trivial CI rewire isn't
// required.

/** Public version string (e.g. "v0.9"). Shown in the avatar-menu tag and
 *  the about-modal header pill. */
export const APP_VERSION = "v0.9";

/** Build date in YYYY.MM.DD form. Shown in the about-modal's mono build
 *  line. Doesn't need to be precise to the commit — release-day date is
 *  enough for the audience. */
export const APP_BUILD = "2026.06.04";

/** When the latest user-facing changelog entry shipped. Drives the
 *  "What's new" link's subline in the about modal ("last shipped N days
 *  ago"). Update this alongside APP_BUILD when changelog entries land.
 *  ISO YYYY-MM-DD. */
export const APP_LAST_SHIPPED = "2026-06-01";
