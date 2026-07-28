"use client";

import {
  QueryClient,
  QueryClientProvider,
  MutationCache,
  QueryCache,
} from "@tanstack/react-query";
import { httpBatchLink, httpLink, splitLink } from "@trpc/client";
import { useState } from "react";
import superjson from "superjson";
import { ThemeProvider } from "next-themes";
import { trpc } from "@/lib/trpc-client";
import { AuthProvider } from "@/lib/auth-context";
import { Toaster } from "@/components/Toaster";
import { ServiceWorkerRegistration } from "@/components/pwa/ServiceWorkerRegistration";
import { PwaEngagementTracker } from "@/components/pwa/PwaEngagementTracker";
import { showToast } from "@/lib/toast";
import { handleAuthExpiry, isUnauthorizedError } from "@/lib/authExpiry";

/**
 * A mutation failed because the request never reached a server (dead zone / bad
 * signal), NOT because the server rejected it. A transport failure has no HTTP
 * status; a real server response (validation/conflict/500) does and is handled
 * where it's raised, so we don't hijack it with a connectivity toast.
 */
function isConnectivityError(error: unknown): boolean {
  const httpStatus = (error as { data?: { httpStatus?: number } } | null)?.data
    ?.httpStatus;
  if (typeof httpStatus === "number" && httpStatus > 0) return false;
  const msg = (
    error instanceof Error ? error.message : String(error)
  ).toLowerCase();
  return (
    msg.includes("fetch") ||
    msg.includes("network") ||
    msg.includes("load failed") ||
    msg.includes("failed to fetch") ||
    httpStatus === undefined
  );
}

function getBaseUrl() {
  if (typeof window !== "undefined") return "";
  // Canonical production origin wins; VERCEL_URL stays as the fallback so
  // preview deployments still resolve to their own host.
  if (process.env.NEXT_PUBLIC_SITE_URL) return process.env.NEXT_PUBLIC_SITE_URL;
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  return "http://localhost:3000";
}

export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        // Surface connectivity failures (Layer 1): any mutation whose request
        // never reached the server gets a "couldn't save" toast — UNLESS it
        // opts out via meta.suppressErrorToast (score writes do, since they
        // own per-cell save UI). Server-rejected mutations are handled at their
        // call sites, so they're left alone.
        mutationCache: new MutationCache({
          onError: (error, _vars, _ctx, mutation) => {
            const suppressed = (
              mutation.meta as { suppressErrorToast?: boolean } | undefined
            )?.suppressErrorToast;
            if (suppressed) return;
            if (isConnectivityError(error)) {
              showToast("Couldn't save — check your connection. We'll keep your data.");
            }
          },
        }),
        // A query that comes back UNAUTHORIZED (401) means the session died
        // out from under an in-flight poll. handleAuthExpiry self-heals a
        // recoverable session (one refresh) or, if it's truly gone, redirects
        // to /login so the poll loop tears down instead of firing forever
        // against a dead session (the mid-round silent-freeze bug).
        queryCache: new QueryCache({
          onError: (error) => {
            if (isUnauthorizedError(error)) {
              void handleAuthExpiry();
            }
          },
        }),
        defaultOptions: {
          queries: {
            staleTime: 60_000,
            // Supabase Realtime is the freshness source for live data —
            // window-focus refetch re-fired every stale shared query on each
            // tab return, duplicating coverage Realtime already provides.
            refetchOnWindowFocus: false,
            retry: 1,
          },
        },
      })
  );

  const [trpcClient] = useState(() =>
    trpc.createClient({
      links: [
        /**
         * `games.configHash` gets its OWN un-batched link. Everything else keeps
         * batching.
         *
         * WHY. `httpBatchLink` groups every query that fires in the same tick into
         * one request, and **a batch resolves at the speed of its slowest member**.
         * `configHash` is a background sync probe (CLAUDE.md #16) — a fingerprint
         * polled every ~20s to notice another device's config change. Nothing
         * renders from it. But when it lands in the same tick as the queries a
         * surface actually needs, its latency becomes that surface's latency.
         *
         * Measured, opening a game's settings with `configHash` held for 20s:
         *   batched together → stepper paints at +21s
         *   split out        → stepper paints at +0.5s
         *
         * The coupling was always latent; it surfaced when the four-tab shell
         * started mounting a game panel's queries in one render pass instead of
         * two, which merged them into a single batch. Splitting the probe out
         * fixes the class rather than restoring the accidental tick ordering that
         * used to hide it — a slow `configHash` should never be able to hold up a
         * read someone is waiting on.
         *
         * Cost: one extra HTTP request per poll, on a request that was already
         * going out. Cheap for removing a whole category of head-of-line blocking.
         */
        splitLink({
          condition: (op) => op.path === "games.configHash",
          true: httpLink({
            url: `${getBaseUrl()}/api/trpc`,
            transformer: superjson,
          }),
          false: httpBatchLink({
            url: `${getBaseUrl()}/api/trpc`,
            transformer: superjson,
          }),
        }),
      ],
    })
  );

  return (
    // App is locked to dark mode for now. The next-themes provider stays
    // in place (and forcedTheme overrides every other source — storage,
    // system preference, any stray setTheme call) so we can add the
    // competition outdoor-mode toggle later without rewiring providers.
    <ThemeProvider attribute="class" defaultTheme="dark" forcedTheme="dark">
      <AuthProvider queryClient={queryClient}>
        <trpc.Provider client={trpcClient} queryClient={queryClient}>
          <QueryClientProvider client={queryClient}>
            {children}
            <Toaster />
            <ServiceWorkerRegistration />
            <PwaEngagementTracker />
          </QueryClientProvider>
        </trpc.Provider>
      </AuthProvider>
    </ThemeProvider>
  );
}
