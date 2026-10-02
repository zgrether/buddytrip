/**
 * Refuse to run the suite while the local Kong is reusing its connections to
 * PostgREST.
 *
 * ── Why this exists ───────────────────────────────────────────────────────
 *
 * With upstream connection reuse on, PostgREST sometimes closes a pooled
 * connection while Kong is waiting on the reply. Kong retries a READ on a fresh
 * connection and never retries a WRITE, so writes reach the tests as 502s —
 * 45-46 Kong errors in a full local run, 0 with reuse off (#1527). CI turns it
 * off right after `supabase start` and fails the step unless Kong reads back 0.
 *
 * Locally there was no such read-back. The setting lives only in the running
 * container: a stack restart (or a Docker crash, which happens) puts Kong back
 * on its defaults without saying so, and local runs drift back to producing
 * 502s. This gives local runs the same guarantee CI has.
 *
 * ── Deliberately not a warning ────────────────────────────────────────────
 *
 * Same reasoning as `assertLocalTestDatabase`: a warning scrolls past in a
 * terminal running thousands of tests, and the failure it guards against —
 * transient 502s that look like flaky tests — is already a thing people learn
 * to ignore. The refusal names the one command that clears it.
 *
 * ── What it does NOT check ────────────────────────────────────────────────
 *
 * Only runs against a LOCAL url. A remote project (`ALLOW_REMOTE_TEST_DB=1`)
 * has no Kong container of ours to read; production's gateway is Envoy and
 * showed zero 502s over four weeks (#1527).
 */

import { execFileSync } from "child_process";
import { readFileSync } from "fs";
import { resolve } from "path";
import { isLocalDatabaseUrl } from "./assertLocalTestDatabase";

export const KONG_REUSE_OPT_IN = "ALLOW_KONG_REUSE";

const KONG_ENV_PATH = "/usr/local/kong/.kong_env";

/** `supabase start` names the container after `project_id` in config.toml. */
export function kongContainerName(configToml: string): string {
  const m = configToml.match(/^project_id\s*=\s*"([^"]+)"/m);
  if (!m) throw new Error("supabase/config.toml has no project_id; cannot name the Kong container");
  return `supabase_kong_${m[1]}`;
}

/**
 * What Kong's RESOLVED config says about upstream reuse. Reads the file Kong
 * itself writes on start and reload, not an env var we set — a reload has
 * silently kept an old value before, so only the resolved config is evidence.
 */
export function kongReuseState(kongEnv: string): "off" | "on" | "unknown" {
  const m = kongEnv.match(/^upstream_keepalive_pool_size\s*=\s*(\d+)\s*$/m);
  if (!m) return "unknown";
  return Number(m[1]) === 0 ? "off" : "on";
}

function reloadCommand(container: string): string {
  return `docker exec -e KONG_UPSTREAM_KEEPALIVE_POOL_SIZE=0 ${container} kong reload`;
}

export function assertKongReuseOff(
  url: string | undefined | null,
  opts: {
    env?: Record<string, string | undefined>;
    /** Reads Kong's resolved config. Injected for testing. */
    readKongEnv?: (container: string) => string;
    repoRoot?: string;
  } = {}
): void {
  const env = opts.env ?? process.env;
  if (!isLocalDatabaseUrl(url)) return;
  if (env[KONG_REUSE_OPT_IN]) return;

  const root = opts.repoRoot ?? resolve(__dirname, "../../..");
  const container = kongContainerName(readFileSync(resolve(root, "supabase/config.toml"), "utf8"));
  const read =
    opts.readKongEnv ??
    ((name: string) =>
      execFileSync("docker", ["exec", name, "cat", KONG_ENV_PATH], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      }));

  let kongEnv: string;
  try {
    kongEnv = read(container);
  } catch (err) {
    // Fail CLOSED: a check that cannot read its subject has not passed.
    throw new Error(
      [
        "",
        `  ✗ Could not read the local Kong's config (${container}), so the suite will not run.`,
        "",
        `      ${(err as Error).message.split("\n")[0]}`,
        "",
        "  This check exists because Kong reusing its connections to PostgREST turns",
        "  writes into transient 502s (#1527). Is the local stack up?",
        "",
        "      npx supabase start",
        "",
        `  To run without the check, say so per-command: ${KONG_REUSE_OPT_IN}=1 npx vitest run ...`,
        "",
      ].join("\n")
    );
  }

  const state = kongReuseState(kongEnv);
  if (state === "off") return;

  throw new Error(
    [
      "",
      state === "on"
        ? "  ✗ The local Kong is REUSING its connections to PostgREST, so the suite will not run."
        : "  ✗ The local Kong's config has no upstream_keepalive_pool_size line, so the suite will not run.",
      "",
      "  With reuse on, writes fail as transient 502s (\"An invalid response was",
      "  received from the upstream server\") — about 45 per full run (#1527).",
      "  A stack restart or a Docker crash puts Kong back on its defaults, which is",
      "  usually why you are seeing this. Turn reuse off, then re-run:",
      "",
      `      ${reloadCommand(container)}`,
      "",
      `  To run with reuse on anyway, say so per-command: ${KONG_REUSE_OPT_IN}=1 npx vitest run ...`,
      "",
    ].join("\n")
  );
}
