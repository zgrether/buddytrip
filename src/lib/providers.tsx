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
import { DEFAULT_THEME, THEMES, THEME_STORAGE_KEY } from "@/lib/theme";
import { trpc } from "@/lib/trpc-client";
import { AuthProvider } from "@/lib/auth-context";
import { Toaster } from "@/components/Toaster";
import { ServiceWorkerRegistration } from "@/components/pwa/ServiceWorkerRegistration";
import { PwaEngagementTracker } from "@/components/pwa/PwaEngagementTracker";
import { showToast } from "@/lib/toast";
import { handleAuthExpiry, isUnauthorizedError } from "@/lib/authExpiry";
import { isConnectivityError, mutationErrorMessage } from "@/lib/mutationErrors";

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
        // EVERY failed mutation is surfaced, unless it opts out via
        // meta.suppressErrorToast (score/outcome writes do — they own per-cell
        // save UI).
        //
        // This used to toast ONLY connectivity failures, on the stated grounds
        // that "server-rejected mutations are handled at their call sites". For
        // the game lifecycle that was false: finalize / correct / re-lock all
        // sat behind empty `catch {}` blocks whose comments pointed back HERE.
        // Each comment delegated to the other and a server rejection reached
        // nobody — no toast, no message, no navigation. #784 made that
        // load-bearing by making `games.finish` throw on a failed results write,
        // converting a silent wrong success into a silent nothing.
        //
        // The default is now "say something", because the two failure modes are
        // not symmetric: a redundant toast beside a site's own inline error is
        // noise, and silence is a bug that looks exactly like success.
        mutationCache: new MutationCache({
          onError: (error, _vars, _ctx, mutation) => {
            const suppressed = (
              mutation.meta as { suppressErrorToast?: boolean } | undefined
            )?.suppressErrorToast;
            if (suppressed) return;
            showToast(
              isConnectivityError(error)
                ? "Couldn't save — check your connection. We'll keep your data."
                : mutationErrorMessage(error)
            );
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
    /* The theme switch. `forcedTheme="dark"` is GONE — that prop overrode
     * storage, system preference and every setTheme call, so while it was set
     * the account-menu row would have been inert.
     *
     * `enableSystem={false}` on purpose: the value is a deliberate choice, not
     * an OS mirror. `prefers-color-scheme` on a phone tracks a schedule or a
     * battery saver, and this switch exists so a scorecard can be read in the
     * sun — a different question with a different answer.
     *
     * This provider knows nothing about the account-menu row, and must not: if
     * the row is hidden (`src/lib/themeMenu.ts`) a theme already stored still
     * has to apply, which is the whole point of that fallback. Guarded in
     * `src/lib/theme.test.ts`.
     */
    /* ── LIGHT MODE IS OFF ──────────────────────────────────────────────────
     *
     * `forcedTheme` overrides storage, system preference and every `setTheme`
     * call, at the pre-hydration boot script AND the React effect — so a crew
     * member who had already chosen light gets dark on their next load, with
     * no flash. It is the ONLY lever that reverts an existing preference;
     * hiding the menu row does not.
     *
     * Paired with `THEME_MENU_VISIBLE = false` in `src/lib/themeMenu.ts`, and
     * the pairing is enforced by `theme.test.ts`'s T0 — forcing a theme while
     * still offering the row is a menu that silently does nothing, and CI
     * refuses it.
     *
     * TO PUT LIGHT MODE BACK: revert the commit that added this. Nobody's
     * stored preference was cleared, only overridden, so anyone who had chosen
     * light returns to it.
     */
    <ThemeProvider
      attribute="class"
      forcedTheme="dark"
      defaultTheme={DEFAULT_THEME}
      storageKey={THEME_STORAGE_KEY}
      themes={[...THEMES]}
      enableSystem={false}
    >
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
