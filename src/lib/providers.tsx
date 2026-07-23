"use client";

import {
  QueryClient,
  QueryClientProvider,
  MutationCache,
} from "@tanstack/react-query";
import { httpBatchLink } from "@trpc/client";
import { useState } from "react";
import superjson from "superjson";
import { ThemeProvider } from "next-themes";
import { trpc } from "@/lib/trpc-client";
import { AuthProvider } from "@/lib/auth-context";
import { Toaster } from "@/components/Toaster";
import { ServiceWorkerRegistration } from "@/components/pwa/ServiceWorkerRegistration";
import { showToast } from "@/lib/toast";

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
        httpBatchLink({
          url: `${getBaseUrl()}/api/trpc`,
          transformer: superjson,
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
          </QueryClientProvider>
        </trpc.Provider>
      </AuthProvider>
    </ThemeProvider>
  );
}
