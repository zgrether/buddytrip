"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { httpBatchLink } from "@trpc/client";
import { useState } from "react";
import superjson from "superjson";
import { ThemeProvider } from "next-themes";
import { trpc } from "@/lib/trpc-client";
import { AuthProvider } from "@/lib/auth-context";

function getBaseUrl() {
  if (typeof window !== "undefined") return "";
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  return "http://localhost:3000";
}

export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
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
          <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
        </trpc.Provider>
      </AuthProvider>
    </ThemeProvider>
  );
}
