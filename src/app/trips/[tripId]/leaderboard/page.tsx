"use client";

import { useEffect } from "react";
import { useParams, useRouter } from "next/navigation";

/**
 * `/trips/[tripId]/leaderboard` — now a DEEP-LINK ALIAS for the Cup tab.
 *
 * Phase 3 moved the competition face into the four-tab shell hosted by
 * `/trips/[tripId]`, so this path no longer owns a surface. It is KEPT rather
 * than deleted because it is still referenced from **8 places in the app**
 * (`CompetitionEnableCard`, `TripSettingsModal`, the trip page's `?tab=comp`
 * redirect and its enable card, `BottomNav`, and the three game views'
 * `onDeleted`) and **7 places in the E2E specs**, including both merge-blocking
 * ones. Removing it would have broken all of them at once.
 *
 * On push notifications specifically (NAV_AUDIT_2.md §8.5): the only production
 * `sendPush` caller today is `notifications.testSend`, whose url is `/dashboard`
 * — so there are ZERO live deep links to this path on anyone's phone right now.
 * Keeping the alias is what makes that safe to stay true when notifications
 * Phase 3 wires real events, whichever path it happens to pick.
 *
 * It normalises with `replace`, not `push`, so it never becomes a history entry
 * the user can be bounced back onto.
 *
 * KNOWN, SEQUENCED REGRESSION: this used to be a Server Component that resolved
 * `competitions.faceBootstrap` and handed it down as `initialData`, so a cold
 * deep link painted the board from server HTML with no client round-trip. That
 * seed does not survive the hop. **Phase 4 owns re-homing it to the trip route**,
 * where it will cover all four tabs instead of one; until then a cold Cup deep
 * link pays one extra client fetch.
 */
export default function LiveFaceAliasPage() {
  const { tripId } = useParams<{ tripId: string }>();
  const router = useRouter();

  useEffect(() => {
    if (tripId) router.replace(`/trips/${tripId}?view=cup`);
  }, [tripId, router]);

  return (
    <div className="flex min-h-screen items-center justify-center">
      <div
        className="h-8 w-8 animate-spin rounded-full border-2"
        style={{ borderColor: "var(--color-bt-accent)", borderTopColor: "transparent" }}
      />
    </div>
  );
}
