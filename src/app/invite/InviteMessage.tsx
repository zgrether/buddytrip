import Link from "next/link";
import InviteShell from "./InviteShell";

/**
 * A dead end that says why. Both callers are states where routing genuinely
 * cannot continue (the link names nothing; the roster no longer includes you),
 * so the one action offered goes somewhere that always works.
 */
export default function InviteMessage({ title, body }: { title: string; body: string }) {
  return (
    <InviteShell>
      <div className="space-y-4 text-center">
        <h1 className="text-lg font-semibold" style={{ color: "var(--color-bt-text)" }}>
          {title}
        </h1>
        <p className="text-sm" style={{ color: "var(--color-bt-text-dim)" }}>
          {body}
        </p>
        <Link
          href="/"
          className="inline-block rounded-xl px-6 py-2.5 text-sm font-semibold transition-opacity hover:opacity-90"
          style={{ background: "var(--color-bt-accent)", color: "var(--color-bt-base)" }}
        >
          Go to BuddyTrip
        </Link>
      </div>
    </InviteShell>
  );
}
