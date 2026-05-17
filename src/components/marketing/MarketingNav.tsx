import Link from "next/link";

/**
 * Sticky top nav for the marketing page. Logo mark mirrors the live
 * app's TopNav exactly (same inline SVG, same gap, same font treatment)
 * so the brand reads identically across signed-out and signed-in surfaces.
 */
export function MarketingNav() {
  return (
    <nav className="bt-mkt-nav">
      <Link href="/" className="bt-mkt-nav-logo">
        <svg
          width="18"
          height="18"
          viewBox="0 0 100 100"
          xmlns="http://www.w3.org/2000/svg"
          aria-hidden="true"
          className="bt-mkt-flag"
        >
          <path
            d="M 28 8 L 38 8 L 76 26 L 38 44 L 38 75 L 33 92 L 28 75 Z"
            fill="currentColor"
          />
        </svg>
        BuddyTrip
      </Link>

      <div className="bt-mkt-nav-right">
        <a href="#how-it-works" className="bt-mkt-nav-link">How it works</a>
        <a href="#about" className="bt-mkt-nav-link">About</a>
        <Link href="/login" className="bt-mkt-nav-link">Sign in</Link>
        <Link href="/login?mode=signup" className="bt-mkt-nav-cta">Get started free</Link>
      </div>
    </nav>
  );
}
