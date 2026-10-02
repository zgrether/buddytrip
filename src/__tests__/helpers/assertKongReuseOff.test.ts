import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";
import {
  assertKongReuseOff,
  kongContainerName,
  kongReuseState,
  KONG_REUSE_OPT_IN,
} from "./assertKongReuseOff";

/**
 * The local read-back for Kong's upstream connection reuse (#1527).
 *
 * The assertions are that it REFUSES reuse-on, an unreadable config and a config
 * without the line, not merely that it admits reuse-off: a function returning
 * void unconditionally would pass the happy path alone.
 */

const LOCAL_URL = "http://127.0.0.1:54321";
const ROOT = resolve(__dirname, "../../..");

// The resolved-config lines Kong 2.8 writes, as read from the local container.
const kongEnv = (pool: number, maxRequests = 100) =>
  [
    "upstream_keepalive_idle_timeout = 60",
    `upstream_keepalive_max_requests = ${maxRequests}`,
    `upstream_keepalive_pool_size = ${pool}`,
  ].join("\n");

describe("kongReuseState", () => {
  it("reads the pool size, and only the pool size", () => {
    expect(kongReuseState(kongEnv(0))).toBe("off");
    expect(kongReuseState(kongEnv(60))).toBe("on");
    // A ZERO on a neighbouring keep-alive line must not read as reuse off.
    expect(kongReuseState(kongEnv(60, 0))).toBe("on");
    // `= 600` must not satisfy a check for `= 0` read as a prefix.
    expect(kongReuseState(kongEnv(600))).toBe("on");
    expect(kongReuseState("upstream_keepalive_idle_timeout = 0")).toBe("unknown");
  });
});

describe("kongContainerName", () => {
  it("names the container after config.toml's project_id", () => {
    expect(kongContainerName('[api]\nproject_id = "buddytrip"\n')).toBe("supabase_kong_buddytrip");
  });

  it("agrees with the container CI reloads — the two must name the same Kong", () => {
    const name = kongContainerName(readFileSync(resolve(ROOT, "supabase/config.toml"), "utf8"));
    const ci = readFileSync(resolve(ROOT, ".github/workflows/ci.yml"), "utf8");
    expect(ci).toContain(`KONG_UPSTREAM_KEEPALIVE_POOL_SIZE=0 ${name} kong reload`);
  });
});

describe("assertKongReuseOff", () => {
  it("admits a Kong whose resolved config says reuse is off", () => {
    const read = vi.fn(() => kongEnv(0));
    expect(() => assertKongReuseOff(LOCAL_URL, { env: {}, readKongEnv: read })).not.toThrow(Error);
    expect(read).toHaveBeenCalledWith("supabase_kong_buddytrip");
  });

  it("REFUSES a Kong reusing connections, and names the command that fixes it", () => {
    expect(() => assertKongReuseOff(LOCAL_URL, { env: {}, readKongEnv: () => kongEnv(60) })).toThrow(
      "docker exec -e KONG_UPSTREAM_KEEPALIVE_POOL_SIZE=0 supabase_kong_buddytrip kong reload"
    );
  });

  it("REFUSES a config with no pool-size line — unknown is not off", () => {
    expect(() =>
      assertKongReuseOff(LOCAL_URL, { env: {}, readKongEnv: () => "upstream_keepalive_idle_timeout = 60" })
    ).toThrow(/no upstream_keepalive_pool_size line/);
  });

  it("fails CLOSED when Kong's config cannot be read", () => {
    const read = () => {
      throw new Error("Error response from daemon: No such container: supabase_kong_buddytrip");
    };
    expect(() => assertKongReuseOff(LOCAL_URL, { env: {}, readKongEnv: read })).toThrow(
      /Could not read the local Kong's config[\s\S]*No such container/
    );
  });

  it("does not look at Kong for a remote database — there is no container of ours to read", () => {
    const read = vi.fn(() => kongEnv(60));
    expect(() =>
      assertKongReuseOff("https://example.supabase.co", { env: {}, readKongEnv: read })
    ).not.toThrow(Error);
    expect(read).not.toHaveBeenCalled();
  });

  it("the per-command opt-in skips the check", () => {
    const read = vi.fn(() => kongEnv(60));
    expect(() =>
      assertKongReuseOff(LOCAL_URL, { env: { [KONG_REUSE_OPT_IN]: "1" }, readKongEnv: read })
    ).not.toThrow(Error);
    expect(read).not.toHaveBeenCalled();
  });
});
