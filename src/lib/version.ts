// ── App build metadata ────────────────────────────────────────────────────
//
// Stamped at build time by next.config.ts via execSync — no manual updates
// needed. Format: YYYY.MM.DD.<short-sha>  e.g. 2026.06.05.a1b2c3d
//
//   Date  = last git commit date (not wall-clock build time)
//   SHA   = first 7 chars of the commit hash — paste into `git show <sha>`
//
// Falls back to static strings when the env vars aren't present (local dev
// without a Next.js build, unit tests, etc.).

const date = process.env.NEXT_PUBLIC_BUILD_DATE ?? "0000.00.00";
const sha = process.env.NEXT_PUBLIC_BUILD_SHA ?? "dev";

/** Full build string shown in the AboutModal mono build line.
 *  e.g. "2026.06.05.a1b2c3d" */
export const APP_BUILD = `${date}.${sha}`;
