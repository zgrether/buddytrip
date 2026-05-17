/**
 * About section — origin story on the left, BBMI trip card on the right.
 * The story explains why BuddyTrip exists; the card shows the actual six
 * years of trip history that motivated it.
 */
export function AboutSection() {
  const years = ["2021", "2022", "2023", "2024", "2025", "2026"];
  const standings: Array<{ rank: number; team: string; wins: number; medal: string }> = [
    { rank: 1, team: "Team Banks",   wins: 2, medal: "🥇" },
    { rank: 2, team: "Team Grether", wins: 2, medal: "🥈" },
    { rank: 3, team: "Team Durkin",  wins: 1, medal: "🥉" },
    { rank: 4, team: "Team Lynch",   wins: 0, medal: "—" },
  ];

  return (
    <section id="about" className="bt-mkt-about">
      <div className="bt-mkt-about-grid">
        {/* Origin story */}
        <div className="bt-mkt-about-text">
          <div className="bt-mkt-feature-tag">The origin</div>
          <h2 className="bt-mkt-feature-h2">Built for one specific trip. Now built for yours.</h2>
          <div className="bt-mkt-pullquote">
            Six years of group texts, spreadsheets, and lost scorecards.
            BuddyTrip is the tool we wished we&rsquo;d had from year one.
          </div>
          <p className="bt-mkt-feature-body">
            Every year since 2021, the same crew of guys takes a golf trip
            we call <strong style={{ color: "#f1f5f9" }}>BBMI</strong> —
            Buddy, Bo, Mike, &amp; the Irishman. Four teams, three days,
            a rotating cast of side games, and a trophy that&rsquo;s lived
            on four different mantles.
          </p>
          <p className="bt-mkt-feature-body">
            For five years we did it with group texts, a battered Excel
            sheet, and a paper scorecard that someone always left in the
            cart. BuddyTrip is what year six looks like — every piece of
            that trip, in one place, on everyone&rsquo;s phone.
          </p>
          <div className="bt-mkt-signature">— Zach Grether, founder</div>
        </div>

        {/* BBMI card */}
        <div className="bt-mkt-about-card">
          <div className="bt-mkt-about-card-header">
            <div>
              <div style={{ fontSize: 11, color: "#64748b", marginBottom: 2 }}>
                The trip that started it all
              </div>
              <div style={{ fontSize: 16, fontWeight: 500, color: "#f1f5f9" }}>
                BBMI · 6 years running
              </div>
            </div>
            <span className="bt-mkt-stage-badge">Annual</span>
          </div>

          <div className="bt-mkt-year-pills">
            {years.map((y) => (
              <span
                key={y}
                className="bt-mkt-year-pill"
                style={
                  y === "2026"
                    ? { borderColor: "rgba(45,212,191,.4)", color: "#2dd4bf", background: "rgba(45,212,191,.06)" }
                    : {}
                }
              >
                {y}
              </span>
            ))}
          </div>

          <div className="bt-mkt-about-destination">
            <div>
              <div style={{ fontSize: 10, color: "#64748b", marginBottom: 2 }}>2026 destination</div>
              <div style={{ fontSize: 13, color: "#f1f5f9" }}>Pinehurst No. 2 · NC</div>
            </div>
            <div style={{ textAlign: "right" }}>
              <div style={{ fontSize: 10, color: "#64748b", marginBottom: 2 }}>Crew</div>
              <div style={{ fontSize: 13, color: "#f1f5f9" }}>16 across 4 teams</div>
            </div>
          </div>

          <div className="bt-mkt-inner-card">
            <div className="bt-mkt-inner-label">All-time standings · trophies won</div>
            <table className="bt-mkt-trophy-table">
              <tbody>
                {standings.map((s) => (
                  <tr key={s.team}>
                    <td style={{ width: 22, color: "#64748b" }}>{s.rank}</td>
                    <td style={{ color: "#f1f5f9" }}>{s.team}</td>
                    <td style={{ textAlign: "right", color: "#fbbf24", width: 60 }}>
                      {s.wins} {s.medal}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </section>
  );
}
