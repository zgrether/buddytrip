/**
 * Route-level loading UI for the game pages (stroke / match / rack).
 *
 * The game pages are client-rendered and cold-fetch their data on mount, so
 * tapping a game from the leaderboard used to leave the PREVIOUS screen frozen
 * during the JS + data load — which reads as "nothing happened," prompting
 * repeated taps. This Suspense fallback paints an instant full-screen spinner
 * the moment navigation starts, so the tap always registers visibly.
 *
 * This is the perceived-responsiveness half of the fix; server-rendering the
 * game page's initial data (so it arrives populated, not after a 2–3s cold
 * fetch) is the deeper follow-on (DEFERRED.md).
 */
export default function GamesLoading() {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ background: "var(--color-bt-base)" }}
    >
      <div
        className="h-8 w-8 animate-spin rounded-full border-2"
        style={{
          borderColor: "var(--color-bt-accent)",
          borderTopColor: "transparent",
        }}
      />
    </div>
  );
}
