// Shared helpers for the scale-audit load scripts (SCALE_AUDIT.md).
//
// LOCAL ONLY. Every script calls assertLocal() first: it refuses any Supabase
// URL or app URL that is not on this machine. There is no opt-out flag. To run
// against a Supabase branch, change this file on purpose and say so in review.
import { createClient } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";

export const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.API_URL;
export const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? process.env.ANON_KEY;
export const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SERVICE_ROLE_KEY;
export const APP_URL = process.env.LOAD_APP_URL ?? "http://localhost:3210";

export const PASSWORD = "BuddyTripLoad2026!"; // test value, local stack only
export const FOCUS_TRIP = "load-focus-trip";
export const FOCUS_COMP = "load-focus-comp";
export const userEmail = (n) => `load-u${String(n).padStart(4, "0")}@load.test`;

const LOCAL_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]"]);

export function assertLocal() {
  for (const [label, value] of [["Supabase URL", SUPABASE_URL], ["app URL", APP_URL]]) {
    if (!value) throw new Error(`${label} is not set`);
    const host = new URL(value).hostname;
    if (!LOCAL_HOSTS.has(host)) {
      throw new Error(`REFUSING: ${label} host "${host}" is not local. These scripts never run against production.`);
    }
  }
  if (!ANON_KEY || !SERVICE_KEY) throw new Error("ANON_KEY / SERVICE_ROLE_KEY are not set");
}

export function admin() {
  return createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
}

/**
 * Sign in the way the browser does and return the Cookie header the app's
 * server accepts (@supabase/ssr writes it; the tRPC context reads it), plus the
 * access token for a Realtime socket.
 */
export async function signIn(email) {
  const jar = new Map();
  const client = createServerClient(SUPABASE_URL, ANON_KEY, {
    cookies: {
      getAll: () => [...jar].map(([name, value]) => ({ name, value })),
      setAll: (list) => list.forEach(({ name, value }) => (value ? jar.set(name, value) : jar.delete(name))),
    },
  });
  const { data, error } = await client.auth.signInWithPassword({ email, password: PASSWORD });
  if (error || !data.session) throw new Error(`sign-in failed for ${email}: ${error?.message}`);
  return {
    userId: data.user.id,
    accessToken: data.session.access_token,
    cookie: [...jar].map(([k, v]) => `${k}=${v}`).join("; "),
  };
}

// tRPC over HTTP, un-batched, superjson envelope ({ json }) as the client sends.
export async function trpcQuery(session, path, input, { timeoutMs = 30_000 } = {}) {
  const url = `${APP_URL}/api/trpc/${path}?input=${encodeURIComponent(JSON.stringify({ json: input }))}`;
  return call(url, { headers: { cookie: session.cookie } }, timeoutMs);
}

export async function trpcMutation(session, path, input, { timeoutMs = 30_000 } = {}) {
  return call(
    `${APP_URL}/api/trpc/${path}`,
    {
      method: "POST",
      headers: { cookie: session.cookie, "content-type": "application/json" },
      body: JSON.stringify({ json: input }),
    },
    timeoutMs
  );
}

async function call(url, init, timeoutMs) {
  const t0 = performance.now();
  let status = 0;
  let body = null;
  try {
    const res = await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
    status = res.status;
    body = await res.json().catch(() => null);
  } catch (e) {
    status = e?.name === "TimeoutError" ? -1 : -2; // -1 timeout, -2 network
  }
  const ms = performance.now() - t0;
  const ok = status === 200 && body && !body.error;
  return { ok, status, ms, data: ok ? body.result?.data?.json : null, error: ok ? null : body?.error?.json?.message ?? null };
}

export function percentile(sorted, p) {
  if (!sorted.length) return null;
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))];
}

export function summarize(samples) {
  const s = [...samples].sort((a, b) => a - b);
  const r = (v) => (v == null ? null : Math.round(v));
  return { n: s.length, p50: r(percentile(s, 50)), p95: r(percentile(s, 95)), p99: r(percentile(s, 99)), max: r(s.at(-1)) };
}
