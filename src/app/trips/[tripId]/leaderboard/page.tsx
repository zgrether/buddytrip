import { createSSRHelpers } from "@/server/trpc-ssr";
import {
  LiveFaceClient,
  type FaceBootstrap,
} from "@/components/competition/LiveFaceClient";

/**
 * The Live face route (Server Component) — Stage B.
 *
 * Resolves the competition face's single boundary resolve
 * (competitions.faceBootstrap) on the server and hands it to the client face as
 * initialData, so the initial competition state ships WITH the page: the
 * board/guide render populated in the server HTML (zero client round-trip for
 * first paint), and the client reads it as fresh under the 60s staleTime — no
 * mount refetch (one resolve per load, B4). It is the SAME resolver as Stage A,
 * just called server-side via the SSR helpers (B2).
 *
 * Interactivity (toggle, controls, go-live) + realtime subscriptions live in
 * LiveFaceClient as client components over this server-rendered initial state
 * (B1) — the natural foundation for the live realtime board (B3).
 *
 * Resolve failures are swallowed (mirrors the trip layout): an unauthed/early
 * request hands down `null`, and the client falls back to its own fetch +
 * loading state rather than tripping the route error boundary.
 */
export default async function LiveFacePage({
  params,
}: {
  params: Promise<{ tripId: string }>;
}) {
  const { tripId } = await params;

  let initialBoot: FaceBootstrap | null = null;
  try {
    const helpers = await createSSRHelpers();
    initialBoot = await helpers.competitions.faceBootstrap.fetch({ tripId });
  } catch {
    // Auth/membership not ready — the client falls back to its own fetch.
  }

  return <LiveFaceClient initialBoot={initialBoot} />;
}
