import Link from "next/link";

export function HeroSection() {
  return (
    <section className="bt-mkt-hero">
      <h1 className="bt-mkt-h1">
        The trip planner your<br />group chat actually needs
      </h1>
      <p className="bt-mkt-hero-sub">
        Destination voting, date polling, crew coordination, expenses, and
        live competition scoring — all in one place, built for the way
        friend groups actually plan trips.
      </p>

      <div className="bt-mkt-cta-row">
        <Link href="/login?mode=signup" className="bt-mkt-btn-primary">Plan your trip free</Link>
        <a href="#how-it-works" className="bt-mkt-btn-ghost">See how it works</a>
      </div>

      <HeroVisual />
    </section>
  );
}

function HeroVisual() {
  return (
    <div className="bt-mkt-hero-card">
      {/* Trip header */}
      <div className="bt-mkt-trip-header">
        <div className="bt-mkt-trip-title">BBMI 2026 — Pinehurst No. 2</div>
        <div className="bt-mkt-stage-badge">Planning</div>
      </div>

      {/* Crew strip */}
      <div className="bt-mkt-crew-strip">
        <div className="bt-mkt-avatar" style={{ background: "#2dd4bf", color: "#0d1f1a" }}>ZG</div>
        <div className="bt-mkt-avatar" style={{ background: "#60a5fa", color: "#1e3a5f", marginLeft: -5 }}>BB</div>
        <div className="bt-mkt-avatar" style={{ background: "#a78bfa", color: "#2e1065", marginLeft: -5 }}>MK</div>
        <div className="bt-mkt-avatar" style={{ background: "#fb923c", color: "#431407", marginLeft: -5 }}>RL</div>
        <div className="bt-mkt-avatar" style={{ background: "#34d399", color: "#064e3b", marginLeft: -5 }}>TS</div>
        <span className="bt-mkt-crew-label">5 crew · Sep 12–15</span>
      </div>

      {/* Stats row */}
      <div className="bt-mkt-stats-row">
        <div className="bt-mkt-stat">
          <div className="bt-mkt-stat-label">Destination</div>
          <div className="bt-mkt-stat-value" style={{ color: "#2dd4bf" }}>Locked ✓</div>
          <div className="bt-mkt-stat-sub">Pinehurst, NC</div>
        </div>
        <div className="bt-mkt-stat">
          <div className="bt-mkt-stat-label">Dates</div>
          <div className="bt-mkt-stat-value" style={{ color: "#2dd4bf" }}>Locked ✓</div>
          <div className="bt-mkt-stat-sub">Sep 12–15</div>
        </div>
        <div className="bt-mkt-stat">
          <div className="bt-mkt-stat-label">Crew</div>
          <div className="bt-mkt-stat-value" style={{ color: "#fbbf24" }}>3 / 5 joined</div>
          <div className="bt-mkt-stat-sub">2 pending invite</div>
        </div>
      </div>

      {/* Date poll */}
      <DatePollGrid />

      {/* Live score strip */}
      <div className="bt-mkt-inner-card">
        <div className="bt-mkt-inner-label">Live competition · Sabotage · Hole 14 of 18</div>
        <div className="bt-mkt-team-pills">
          <div className="bt-mkt-team-pill" style={{ background: "rgba(59,130,246,.1)", border: "0.5px solid rgba(59,130,246,.2)" }}>
            <div style={{ fontSize: 10, marginBottom: 3, color: "#60a5fa" }}>Team Banks</div>
            <div style={{ fontSize: 18, fontWeight: 500, color: "#60a5fa" }}>24.5</div>
          </div>
          <div className="bt-mkt-team-pill" style={{ background: "rgba(168,85,247,.1)", border: "0.5px solid rgba(168,85,247,.2)" }}>
            <div style={{ fontSize: 10, marginBottom: 3, color: "#a78bfa" }}>Team Grether</div>
            <div style={{ fontSize: 18, fontWeight: 500, color: "#a78bfa" }}>21.0</div>
          </div>
          <div className="bt-mkt-team-pill" style={{ background: "rgba(34,197,94,.1)", border: "0.5px solid rgba(34,197,94,.2)" }}>
            <div style={{ fontSize: 10, marginBottom: 3, color: "#4ade80" }}>Team Durkin</div>
            <div style={{ fontSize: 18, fontWeight: 500, color: "#4ade80" }}>19.5</div>
          </div>
          <div className="bt-mkt-team-pill" style={{ background: "rgba(251,146,60,.1)", border: "0.5px solid rgba(251,146,60,.2)" }}>
            <div style={{ fontSize: 10, marginBottom: 3, color: "#fb923c" }}>Team Lynch</div>
            <div style={{ fontSize: 18, fontWeight: 500, color: "#fb923c" }}>18.0</div>
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * Shared poll grid used by both the hero visual and the first feature
 * block. Same 5-crew × 3-window data either place.
 */
export function DatePollGrid() {
  const windows = ["Sep 12–15", "Sep 19–22", "Oct 3–6"];
  const rows: Array<{ name: string; votes: Array<"y" | "m" | "n"> }> = [
    { name: "Zach",  votes: ["y", "y", "n"] },
    { name: "Buddy", votes: ["y", "n", "y"] },
    { name: "Mike",  votes: ["y", "m", "n"] },
    { name: "Ryan",  votes: ["m", "y", "n"] },
    { name: "Tom",   votes: ["n", "y", "m"] },
  ];
  return (
    <div className="bt-mkt-inner-card" style={{ marginBottom: 10 }}>
      <div className="bt-mkt-inner-label">Date poll · crew availability</div>
      <table className="bt-mkt-poll-table">
        <thead>
          <tr>
            <th />
            {windows.map((w) => (
              <th key={w}>{w}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.name}>
              <td className="bt-mkt-poll-name">{r.name}</td>
              {r.votes.map((v, i) => (
                <td key={i}>
                  <span className={`bt-mkt-vote bt-mkt-vote-${v}`}>
                    {v === "y" ? "✓" : v === "m" ? "~" : "✗"}
                  </span>
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
