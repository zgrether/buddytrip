/**
 * Route-level loading UI.
 *
 * Next.js renders this synchronously during navigation, so the spinner
 * appears the instant the user clicks a trip on the dashboard — before
 * the page bundle + tRPC queries resolve. The page component renders
 * the same spinner during its own loading phase, so there's no visual
 * jump when the route mounts and takes over.
 */
export default function TripLoading() {
  return (
    <div
      className="flex min-h-screen items-center justify-center"
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
