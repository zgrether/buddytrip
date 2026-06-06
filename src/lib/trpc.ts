import { createTRPCClient, httpBatchLink } from "@trpc/client";
import type { AppRouter } from "@/server/router";
import superjson from "superjson";

function getBaseUrl() {
  if (typeof window !== "undefined") return "";
  // Canonical production origin wins; VERCEL_URL stays as the fallback so
  // preview deployments still resolve to their own host.
  if (process.env.NEXT_PUBLIC_SITE_URL) return process.env.NEXT_PUBLIC_SITE_URL;
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  return "http://localhost:3000";
}

export const trpc = createTRPCClient<AppRouter>({
  links: [
    httpBatchLink({
      url: `${getBaseUrl()}/api/trpc`,
      transformer: superjson,
    }),
  ],
});
