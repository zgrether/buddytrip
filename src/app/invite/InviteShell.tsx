/**
 * The card the invite landing renders its non-redirect states into. Same shell
 * as the auth page (Level 0 page background, Level 1 card) so arriving from a
 * link and arriving at sign-in look like one product — see STYLE_GUIDE.md §1.
 */
export default function InviteShell({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="flex min-h-screen items-center justify-center px-4"
      style={{ background: "var(--color-bt-base)" }}
    >
      <div
        className="w-full max-w-[400px] rounded-xl border px-6 py-8"
        style={{
          background: "var(--color-bt-card)",
          borderColor: "var(--color-bt-border)",
        }}
      >
        {children}
      </div>
    </div>
  );
}
