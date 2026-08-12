import { TopNav } from "@/components/TopNav";
import { CreateTripFlow } from "@/components/trips/CreateTripFlow";
import type { DestinationMode } from "@/components/DestinationPicker";

/**
 * `/trips/new` — the create flow as a ROUTE.
 *
 * In-app, creating a trip is a modal now (`CreateTripModal`), so nothing in the
 * UI navigates here. **The route still has to exist**, and not as a courtesy:
 * `auth/callback` redirects every organic signup with no trip memberships
 * straight to `/trips/new` with a server-side 302 (`auth/callback/route.ts`).
 * Deleting it would break signup silently for exactly the users who have never
 * seen the app before — the failure mode #878 warned about, arriving from the
 * one referrer that isn't a component you can grep for a `router.push`.
 *
 * So the route stays and renders the SAME `CreateTripFlow` the modal does.
 * There is one flow with two presentations, not a flow and a fallback that
 * drift.
 *
 * A server component, deliberately: `?mode=` is read from the `searchParams`
 * prop rather than `useSearchParams`, which would need a Suspense boundary and
 * would opt the route into client-side dynamic rendering for a value that is
 * known at request time.
 */
function parseMode(raw: string | string[] | undefined): DestinationMode {
  const v = Array.isArray(raw) ? raw[0] : raw;
  return v === "known" || v === "exploring" ? v : null;
}

export default async function TripNewPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { mode } = await searchParams;

  return (
    <div
      className="min-h-screen"
      style={{ background: "var(--color-bt-base)", color: "var(--color-bt-text)" }}
    >
      {/* App-wide top nav — matches dashboard, profile, and trip pages so
          the new-trip flow doesn't feel like a separate surface. */}
      <TopNav />

      <main className="mx-auto max-w-4xl px-6 py-8">
        <CreateTripFlow initialMode={parseMode(mode)} />
      </main>
    </div>
  );
}
