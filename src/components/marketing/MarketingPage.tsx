import { MarketingNav } from "./MarketingNav";
import { HeroSection } from "./HeroSection";
import { FeaturesSection } from "./FeaturesSection";
import { AboutSection } from "./AboutSection";
import { CtaSection } from "./CtaSection";
import { MarketingFooter } from "./MarketingFooter";

/**
 * Server Component orchestrator for the public marketing page at `/`.
 *
 * Visual treatment is intentionally separate from the in-app design
 * system: raw CSS in a `<style>` block, hardcoded hex values, no Tailwind
 * utilities, no `--color-bt-*` tokens. The marketing surface is a
 * marketing surface — keeping its CSS isolated means we can tune copy
 * and visual polish here without risk of bleeding into product screens.
 */
export function MarketingPage() {
  return (
    <>
      <style>{MARKETING_CSS}</style>
      <div className="bt-mkt-root">
        <MarketingNav />
        <main className="bt-mkt-main">
          <HeroSection />
          <FeaturesSection />
          <AboutSection />
          <CtaSection />
        </main>
        <MarketingFooter />
      </div>
    </>
  );
}

const MARKETING_CSS = `
/* ───────────── Root + page shell ───────────── */
.bt-mkt-root {
  background: #0a1628;
  color: #f1f5f9;
  min-height: 100vh;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  -webkit-font-smoothing: antialiased;
  scroll-behavior: smooth;
}
.bt-mkt-root *,
.bt-mkt-root *::before,
.bt-mkt-root *::after {
  box-sizing: border-box;
}
.bt-mkt-main {
  max-width: 1100px;
  margin: 0 auto;
  padding: 0 24px;
}

/* ───────────── Nav ───────────── */
.bt-mkt-nav {
  position: sticky;
  top: 0;
  z-index: 50;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 24px;
  background: rgba(10, 14, 26, 0.85);
  backdrop-filter: blur(14px);
  -webkit-backdrop-filter: blur(14px);
  border-bottom: 1px solid rgba(148, 163, 184, 0.08);
}
.bt-mkt-nav-logo {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  font-size: 18px;
  font-weight: 600;
  letter-spacing: 0.06em;
  color: #f1f5f9;
  text-decoration: none;
}
.bt-mkt-flag { color: #2dd4bf; flex-shrink: 0; }
.bt-mkt-nav-right { display: flex; align-items: center; gap: 18px; }
.bt-mkt-nav-link {
  font-size: 13px;
  color: #94a3b8;
  text-decoration: none;
  transition: color 0.15s;
}
.bt-mkt-nav-link:hover { color: #f1f5f9; }
.bt-mkt-nav-cta {
  display: inline-flex;
  align-items: center;
  font-size: 13px;
  font-weight: 500;
  padding: 8px 14px;
  border-radius: 10px;
  background: #2dd4bf;
  color: #0d1f1a;
  text-decoration: none;
  transition: opacity 0.15s;
}
.bt-mkt-nav-cta:hover { opacity: 0.9; }
@media (max-width: 640px) {
  .bt-mkt-nav-right .bt-mkt-nav-link:not(:last-child):nth-child(-n+2) { display: none; }
}

/* ───────────── Hero ───────────── */
.bt-mkt-hero {
  padding: 72px 0 56px;
  text-align: center;
}
.bt-mkt-h1 {
  font-size: clamp(32px, 5.5vw, 56px);
  font-weight: 600;
  line-height: 1.08;
  letter-spacing: -0.02em;
  margin: 0 auto 20px;
  max-width: 820px;
  color: #f1f5f9;
}
.bt-mkt-hero-sub {
  font-size: clamp(15px, 1.8vw, 17px);
  line-height: 1.55;
  color: #94a3b8;
  max-width: 620px;
  margin: 0 auto 32px;
}
.bt-mkt-cta-row {
  display: flex;
  gap: 12px;
  justify-content: center;
  flex-wrap: wrap;
  margin-bottom: 56px;
}
.bt-mkt-btn-primary {
  display: inline-flex; align-items: center; justify-content: center;
  padding: 14px 22px;
  border-radius: 12px;
  font-size: 15px;
  font-weight: 500;
  background: #2dd4bf;
  color: #0d1f1a;
  text-decoration: none;
  transition: opacity 0.15s;
}
.bt-mkt-btn-primary:hover { opacity: 0.9; }
.bt-mkt-btn-ghost {
  display: inline-flex; align-items: center; justify-content: center;
  padding: 14px 22px;
  border-radius: 12px;
  font-size: 15px;
  font-weight: 500;
  background: transparent;
  color: #f1f5f9;
  border: 1px solid rgba(148, 163, 184, 0.18);
  text-decoration: none;
  transition: background 0.15s, border-color 0.15s;
}
.bt-mkt-btn-ghost:hover {
  background: rgba(148, 163, 184, 0.06);
  border-color: rgba(148, 163, 184, 0.28);
}

/* ───────────── Hero visual card ───────────── */
.bt-mkt-hero-card {
  max-width: 720px;
  margin: 0 auto;
  background: #111827;
  border: 1px solid rgba(148, 163, 184, 0.1);
  border-radius: 20px;
  padding: 22px;
  text-align: left;
  box-shadow: 0 30px 60px -20px rgba(0, 0, 0, 0.5);
}
.bt-mkt-trip-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 12px;
}
.bt-mkt-trip-title {
  font-size: 15px;
  font-weight: 500;
  color: #f1f5f9;
}
.bt-mkt-stage-badge {
  display: inline-flex; align-items: center;
  padding: 3px 9px;
  border-radius: 999px;
  font-size: 10px;
  font-weight: 500;
  letter-spacing: 0.05em;
  text-transform: uppercase;
  background: rgba(251, 191, 36, 0.1);
  color: #fbbf24;
  border: 0.5px solid rgba(251, 191, 36, 0.25);
}

.bt-mkt-crew-strip {
  display: flex; align-items: center;
  margin-bottom: 14px;
}
.bt-mkt-avatar {
  width: 26px; height: 26px;
  border-radius: 50%;
  display: inline-flex; align-items: center; justify-content: center;
  font-size: 10px; font-weight: 600;
  border: 2px solid #111827;
}
.bt-mkt-crew-label {
  margin-left: 10px;
  font-size: 11px;
  color: #64748b;
}

.bt-mkt-stats-row {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 8px;
  margin-bottom: 12px;
}
.bt-mkt-stat {
  background: rgba(148, 163, 184, 0.04);
  border: 1px solid rgba(148, 163, 184, 0.08);
  border-radius: 10px;
  padding: 10px;
}
.bt-mkt-stat-label {
  font-size: 9px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: #64748b;
  margin-bottom: 4px;
}
.bt-mkt-stat-value {
  font-size: 13px;
  font-weight: 500;
}
.bt-mkt-stat-sub {
  font-size: 10px;
  color: #64748b;
  margin-top: 2px;
}

/* ───────────── Inner card (shared) ───────────── */
.bt-mkt-inner-card {
  background: rgba(148, 163, 184, 0.04);
  border: 1px solid rgba(148, 163, 184, 0.08);
  border-radius: 10px;
  padding: 12px;
}
.bt-mkt-inner-label {
  font-size: 9px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: #64748b;
  margin-bottom: 8px;
}

/* ───────────── Poll table ───────────── */
.bt-mkt-poll-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 11px;
}
.bt-mkt-poll-table th {
  text-align: center;
  font-weight: 500;
  color: #64748b;
  padding: 4px 2px;
  font-size: 10px;
}
.bt-mkt-poll-table td {
  text-align: center;
  padding: 4px 2px;
}
.bt-mkt-poll-name {
  text-align: left !important;
  color: #f1f5f9;
  font-size: 11px;
  padding-left: 0;
  width: 56px;
}
.bt-mkt-vote {
  display: inline-flex; align-items: center; justify-content: center;
  width: 18px; height: 18px;
  border-radius: 4px;
  font-size: 10px;
}
.bt-mkt-vote-y { background: rgba(45, 212, 191, 0.18); color: #2dd4bf; }
.bt-mkt-vote-m { background: rgba(245, 158, 11, 0.18); color: #f59e0b; }
.bt-mkt-vote-n { background: rgba(239, 68, 68, 0.15); color: #ef4444; }

/* ───────────── Team pills (hero live strip) ───────────── */
.bt-mkt-team-pills {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 6px;
}
.bt-mkt-team-pill {
  text-align: center;
  padding: 8px 6px;
  border-radius: 8px;
}

/* ───────────── Features section ───────────── */
.bt-mkt-features {
  padding: 80px 0;
}
.bt-mkt-feature-block {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 56px;
  align-items: center;
}
@media (max-width: 820px) {
  .bt-mkt-feature-block {
    grid-template-columns: 1fr !important;
    direction: ltr !important;
    gap: 28px;
  }
}
.bt-mkt-feature-text { min-width: 0; }
.bt-mkt-feature-visual { min-width: 0; }
.bt-mkt-feature-tag {
  display: inline-block;
  font-size: 11px;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: #2dd4bf;
  margin-bottom: 14px;
}
.bt-mkt-feature-h2 {
  font-size: clamp(24px, 3.6vw, 36px);
  font-weight: 600;
  line-height: 1.15;
  letter-spacing: -0.015em;
  margin: 0 0 18px;
  color: #f1f5f9;
}
.bt-mkt-feature-body {
  font-size: 15px;
  line-height: 1.65;
  color: #94a3b8;
  margin: 0 0 14px;
}

/* ───────────── Generic card (feature visuals) ───────────── */
.bt-mkt-card {
  background: #111827;
  border: 1px solid rgba(148, 163, 184, 0.1);
  border-radius: 16px;
  padding: 18px;
  box-shadow: 0 24px 48px -20px rgba(0, 0, 0, 0.45);
}

/* ───────────── Plan-together — idea rows ───────────── */
.bt-mkt-idea-row {
  display: flex; align-items: center; justify-content: space-between;
  gap: 10px;
  padding: 8px 10px;
  border-radius: 8px;
  border: 1px solid rgba(148, 163, 184, 0.08);
  background: rgba(148, 163, 184, 0.02);
}
.bt-mkt-vote-dots-wrap {
  display: flex; align-items: center; gap: 8px; flex-shrink: 0;
}
.bt-mkt-vote-dots { display: flex; gap: 3px; }
.bt-mkt-vote-dot {
  width: 8px; height: 8px; border-radius: 50%;
}
.bt-mkt-leading-badge {
  font-size: 9px;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: #2dd4bf;
  padding: 2px 6px;
  border-radius: 999px;
  background: rgba(45, 212, 191, 0.1);
  border: 0.5px solid rgba(45, 212, 191, 0.25);
}

/* ───────────── Split-fairly — expenses ───────────── */
.bt-mkt-expense-row {
  display: flex; align-items: center; justify-content: space-between;
  padding: 8px 0;
  border-bottom: 1px solid rgba(148, 163, 184, 0.06);
}
.bt-mkt-expense-row:last-of-type { border-bottom: 0; }
.bt-mkt-balance-row {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 6px;
  margin-top: 12px;
}
.bt-mkt-balance-chip {
  background: rgba(148, 163, 184, 0.04);
  border: 1px solid rgba(148, 163, 184, 0.08);
  border-radius: 8px;
  padding: 8px 6px;
  text-align: center;
}
.bt-mkt-balance-label {
  font-size: 9px;
  letter-spacing: 0.05em;
  text-transform: uppercase;
  color: #64748b;
  margin-bottom: 3px;
}
.bt-mkt-balance-amount {
  font-size: 13px;
  font-weight: 500;
}

/* ───────────── Compete — live badge, chips, rows ───────────── */
.bt-mkt-live-badge {
  display: inline-flex; align-items: center; gap: 5px;
  font-size: 10px;
  font-weight: 500;
  letter-spacing: 0.05em;
  text-transform: uppercase;
  color: #f87171;
  padding: 3px 8px;
  border-radius: 999px;
  background: rgba(239, 68, 68, 0.08);
  border: 0.5px solid rgba(239, 68, 68, 0.25);
}
.bt-mkt-live-dot {
  width: 6px; height: 6px;
  border-radius: 50%;
  background: #f87171;
  animation: bt-mkt-pulse 1.4s ease-in-out infinite;
}
@keyframes bt-mkt-pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.4; }
}
.bt-mkt-event-strip {
  display: flex; flex-wrap: wrap; gap: 4px;
  margin-bottom: 12px;
}
.bt-mkt-event-chip {
  font-size: 10px;
  padding: 3px 8px;
  border-radius: 999px;
  background: rgba(148, 163, 184, 0.06);
  color: #94a3b8;
  border: 0.5px solid rgba(148, 163, 184, 0.1);
}
.bt-mkt-team-row {
  display: flex; align-items: center; gap: 8px;
  padding: 8px 10px;
  border-radius: 8px;
  border: 1px solid rgba(148, 163, 184, 0.08);
  background: rgba(148, 163, 184, 0.02);
}
.bt-mkt-team-dot {
  width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0;
}
.bt-mkt-hole-cell {
  flex: 1;
  text-align: center;
  padding: 6px 4px;
  border-radius: 6px;
  background: rgba(148, 163, 184, 0.04);
}

/* ───────────── Stay-on-track — quick info + schedule ───────────── */
.bt-mkt-quickinfo-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
}
.bt-mkt-quickinfo-tile {
  background: rgba(148, 163, 184, 0.04);
  border: 1px solid rgba(148, 163, 184, 0.08);
  border-radius: 10px;
  padding: 10px;
}
.bt-mkt-quickinfo-label {
  display: inline-flex; align-items: center; gap: 5px;
  font-size: 9px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: #64748b;
  margin-bottom: 6px;
}
.bt-mkt-quickinfo-value {
  font-size: 15px;
  font-weight: 500;
  color: #2dd4bf;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
}
.bt-mkt-quickinfo-sub {
  font-size: 9px;
  color: #64748b;
  margin-top: 3px;
}
.bt-mkt-divider {
  height: 1px;
  background: rgba(148, 163, 184, 0.08);
  margin: 14px 0;
}
.bt-mkt-day-label {
  font-size: 10px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: #64748b;
  margin-bottom: 6px;
}
.bt-mkt-schedule-item {
  display: flex; align-items: center; gap: 8px;
  padding: 6px 0;
  border-bottom: 1px solid rgba(148, 163, 184, 0.05);
}
.bt-mkt-schedule-item:last-child { border-bottom: 0; }
.bt-mkt-schedule-dot {
  width: 6px; height: 6px; border-radius: 50%; flex-shrink: 0;
}
.bt-mkt-map-link {
  display: inline-flex; align-items: center; gap: 3px;
  font-size: 10px;
  color: #2dd4bf;
  text-decoration: none;
  padding: 3px 6px;
  border-radius: 6px;
  background: rgba(45, 212, 191, 0.08);
  transition: background 0.15s;
}
.bt-mkt-map-link:hover { background: rgba(45, 212, 191, 0.16); }

/* ───────────── About section ───────────── */
.bt-mkt-about {
  padding: 80px 0;
}
.bt-mkt-about-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 56px;
  align-items: start;
}
@media (max-width: 820px) {
  .bt-mkt-about-grid { grid-template-columns: 1fr; gap: 28px; }
}
.bt-mkt-about-text { min-width: 0; }
.bt-mkt-pullquote {
  border-left: 2px solid #2dd4bf;
  padding: 4px 0 4px 16px;
  margin: 18px 0 22px;
  font-size: 18px;
  line-height: 1.5;
  color: #f1f5f9;
  font-style: italic;
}
.bt-mkt-signature {
  margin-top: 18px;
  font-size: 13px;
  color: #64748b;
}
.bt-mkt-about-card {
  background: #111827;
  border: 1px solid rgba(148, 163, 184, 0.1);
  border-radius: 16px;
  padding: 22px;
  box-shadow: 0 24px 48px -20px rgba(0, 0, 0, 0.45);
}
.bt-mkt-about-card-header {
  display: flex; align-items: flex-start; justify-content: space-between;
  margin-bottom: 16px;
}
.bt-mkt-year-pills {
  display: flex; flex-wrap: wrap; gap: 6px;
  margin-bottom: 16px;
}
.bt-mkt-year-pill {
  font-size: 11px;
  padding: 4px 10px;
  border-radius: 999px;
  border: 1px solid rgba(148, 163, 184, 0.15);
  color: #94a3b8;
  background: rgba(148, 163, 184, 0.03);
}
.bt-mkt-about-destination {
  display: flex; justify-content: space-between; align-items: center;
  padding: 12px 0;
  border-top: 1px solid rgba(148, 163, 184, 0.08);
  border-bottom: 1px solid rgba(148, 163, 184, 0.08);
  margin-bottom: 14px;
}
.bt-mkt-trophy-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 12px;
}
.bt-mkt-trophy-table td {
  padding: 6px 0;
  border-bottom: 1px solid rgba(148, 163, 184, 0.05);
}
.bt-mkt-trophy-table tr:last-child td { border-bottom: 0; }

/* ───────────── CTA section ───────────── */
.bt-mkt-cta-section {
  padding: 80px 0 96px;
  text-align: center;
}
.bt-mkt-cta-h2 {
  font-size: clamp(28px, 4.4vw, 44px);
  font-weight: 600;
  line-height: 1.1;
  letter-spacing: -0.02em;
  margin: 0 auto 18px;
  max-width: 720px;
  color: #f1f5f9;
}
.bt-mkt-cta-sub {
  font-size: 15px;
  line-height: 1.55;
  color: #94a3b8;
  max-width: 540px;
  margin: 0 auto 32px;
}
.bt-mkt-cta-section .bt-mkt-cta-row { margin-bottom: 0; }

/* ───────────── Footer ───────────── */
.bt-mkt-footer {
  border-top: 1px solid rgba(148, 163, 184, 0.08);
  padding: 32px 24px 40px;
  text-align: center;
}
.bt-mkt-footer-logo {
  display: inline-flex; align-items: center; gap: 6px;
  font-size: 14px;
  font-weight: 600;
  letter-spacing: 0.06em;
  color: #f1f5f9;
  margin-bottom: 14px;
}
.bt-mkt-footer-links {
  display: flex; justify-content: center; gap: 22px;
  margin-bottom: 14px;
}
.bt-mkt-footer-copy {
  font-size: 11px;
  color: #475569;
}
`;
