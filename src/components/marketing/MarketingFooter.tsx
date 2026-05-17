import Link from "next/link";

/**
 * Footer for the marketing page. Logo mark on top, three utility links,
 * copyright underneath.
 */
export function MarketingFooter() {
  return (
    <footer className="bt-mkt-footer">
      <div className="bt-mkt-footer-logo">
        <svg
          width="16"
          height="16"
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
      </div>
      <div className="bt-mkt-footer-links">
        <a href="#how-it-works" className="bt-mkt-nav-link">How it works</a>
        <a href="#about" className="bt-mkt-nav-link">About</a>
        <Link href="/login" className="bt-mkt-nav-link">Sign in</Link>
      </div>
      <div className="bt-mkt-footer-copy">
        © 2026 BuddyTrip · Built for the crew
      </div>
    </footer>
  );
}
