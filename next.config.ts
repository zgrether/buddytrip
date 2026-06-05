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
};

export default nextConfig;
