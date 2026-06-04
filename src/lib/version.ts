// ── App build metadata ───────────────────────────────────────────────────
//
// Single source of truth for the build date + last-shipped date surfaced
// in the AboutModal. A user-facing version string (e.g. "v1.0") is
// intentionally NOT defined here yet — the app hasn't formally versioned
// a release, so the modal omits the version pill until that lands. When
// it does, add `APP_VERSION` here and wire it back in.

/** Build date in YYYY.MM.DD form. Shown in the about-modal's mono build
 *  line. Doesn't need to be precise to the commit — release-day date is
 *  enough for the audience. */
export const APP_BUILD = "2026.06.04";

/** When the latest user-facing changelog entry shipped. Drives the
 *  "What's new" link's subline in the about modal ("last shipped N days
 *  ago"). Update this alongside APP_BUILD when changelog entries land.
 *  ISO YYYY-MM-DD. */
export const APP_LAST_SHIPPED = "2026-06-01";
