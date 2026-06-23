import type { NextConfig } from "next";
import { execSync } from "child_process";

// ── Build metadata ────────────────────────────────────────────────────────
//
// Stamped at build time so AboutModal always shows the exact commit the
// running app was built from — no manual updates needed.
//
// Format: YYYY.MM.DD.<short-sha>   e.g. 2026.06.05.a1b2c3d
//
// - Date  → from the last git commit (not the wall-clock build time),
//            so a deploy on a different day still shows the commit date.
// - SHA   → first 7 chars of the commit hash. Uniquely identifies the
//            build; paste it into `git show <sha>` to see exactly what
//            shipped. This is the industry-standard 4th segment (Vercel,
//            Linear, etc. all show the commit SHA in their build lines).
//
// Both are exposed as NEXT_PUBLIC_ so client components can read them.
// execSync falls back to placeholders when git isn't available (e.g. in
// a bare Docker layer without .git).

function gitDate(): string {
  try {
    return execSync("git log -1 --format=%cd --date=format:%Y.%m.%d", {
      stdio: ["pipe", "pipe", "pipe"],
    })
      .toString()
      .trim();
  } catch {
    return new Date().toISOString().slice(0, 10).replace(/-/g, ".");
  }
}

function gitSha(): string {
  try {
    return execSync("git rev-parse --short=7 HEAD", {
      stdio: ["pipe", "pipe", "pipe"],
    })
      .toString()
      .trim();
  } catch {
    return "unknown";
  }
}

const buildDate = gitDate();
const buildSha = gitSha();

const nextConfig: NextConfig = {
  env: {
    NEXT_PUBLIC_BUILD_DATE: buildDate,
    NEXT_PUBLIC_BUILD_SHA: buildSha,
  },
  experimental: {
    // ── Structure/State separation — kill the per-navigation SERVER re-resolve ──
    //
    // The Live face route (/trips/[id]/leaderboard) is a Server Component that
    // resolves competitions.faceBootstrap — the whole competition STRUCTURE +
    // standings — on the server for first paint. By default Next's Router Cache
    // treats dynamic routes as stale immediately (dynamic: 0), so EVERY warm
    // navigation back to the Live face (trip→live, game→back→live) re-runs the
    // server component and re-pays that resolve. That blocking server RSC fetch is
    // the "loading a foreign webpage every time" reload — and a long client-side
    // (React Query) cache canNOT fix it, because the navigation waits on the RSC,
    // not on the client query.
    //
    // Retaining the dynamic RSC for a window lets warm navigations REUSE the
    // already-rendered payload — the server component does not re-run, faceBootstrap
    // is not re-resolved — while the kept client cache (STRUCTURE_QUERY) serves the
    // data. The SSR seed is still paid ONCE on a cold document load. Structural
    // mutations already invalidate the client faceBootstrap cache (pattern #10) and
    // the kept client query — not the cached RSC's stale initialData — wins on
    // remount (initialData is ignored when the query already has data), so a real
    // structural change still propagates. 5 min comfortably covers the rapid
    // trip↔live↔game ping-ponging that happens in seconds; gcTime (30 min) outlives
    // it, so the client query can't be GC'd while a cached RSC is still in play.
    staleTimes: {
      dynamic: 300,
    },
  },
};

export default nextConfig;
