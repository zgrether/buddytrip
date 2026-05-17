import Link from "next/link";

/**
 * Bottom-of-page conversion section. Single big headline, one-line sub,
 * and the two same CTAs from the hero — primary "Plan your trip free"
 * and a ghost "See how it works" anchor.
 */
export function CtaSection() {
  return (
    <section className="bt-mkt-cta-section">
      <h2 className="bt-mkt-cta-h2">
        Your crew deserves better<br />than a group text
      </h2>
      <p className="bt-mkt-cta-sub">
        Free to start. No credit card. Invite your crew in seconds and have
        your next trip planned by the end of the day.
      </p>
      <div className="bt-mkt-cta-row">
        <Link href="/login" className="bt-mkt-btn-primary">Plan your trip free</Link>
        <a href="#how-it-works" className="bt-mkt-btn-ghost">See how it works</a>
      </div>
    </section>
  );
}
