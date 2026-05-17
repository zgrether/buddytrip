import { Home, Wifi, MapPin } from "lucide-react";
import { DatePollGrid } from "./HeroSection";

/**
 * Four-feature alternating-layout block. Odd-numbered features (1, 3)
 * have text on the left and the visual on the right; even-numbered (2,
 * 4) flip via `direction: rtl` on the grid wrapper.
 */
export function FeaturesSection() {
  return (
    <section id="how-it-works" className="bt-mkt-features">
      <FeatureBlock
        flip={false}
        tag="Plan together"
        h2="From &lsquo;where should we go?&rsquo; to locked in"
        body="Toss in destination ideas, let everyone vote, and compare options side by side. Once the crew has weighed in, the owner locks it and you move on — no more waiting on stragglers in the group text. Same goes for dates: a clean poll where every yes, maybe, and no is visible at once."
        visual={<FeatureVisualPlanTogether />}
      />
      <FeatureBlock
        flip={true}
        tag="Split it fairly"
        h2="No more Excel settlement math after the trip"
        body="Every VRBO, every tee time, every group dinner — log who paid, split it however makes sense, and BuddyTrip tells everyone what they owe at the end. No spreadsheet. No awkward follow-up texts three weeks later."
        visual={<FeatureVisualSplitFairly />}
      />
      <FeatureBlock
        flip={false}
        tag="Compete"
        h2="Live scoring when it matters most"
        body="Set up teams, run events across the whole trip — golf rounds, side games, whatever fits — and watch points accumulate. Weight the final events heavier so nothing is decided until the last moment. When someone is lining up a 3-footer for par and has no idea it decides the trophy, a live leaderboard on everyone&rsquo;s phone makes the moment."
        visual={<FeatureVisualCompete />}
      />
      <FeatureBlock
        flip={true}
        tag="Stay on track"
        h2="Everything the crew needs, one tap away"
        body="Door codes, WiFi passwords, tee time confirmation numbers — the stuff everyone asks for twelve times in the group text, pinned right at the top. Below that, a day-by-day itinerary with tee times, dinners, and side events. No more &lsquo;wait, what time are we teeing off?&rsquo; at 6am the morning of."
        visual={<FeatureVisualStayOnTrack />}
        isLast
      />
    </section>
  );
}

function FeatureBlock({
  flip,
  tag,
  h2,
  body,
  visual,
  isLast,
}: {
  flip: boolean;
  tag: string;
  h2: string;
  body: string;
  visual: React.ReactNode;
  isLast?: boolean;
}) {
  return (
    <div
      className="bt-mkt-feature-block"
      style={{
        direction: flip ? "rtl" : "ltr",
        marginBottom: isLast ? 0 : 56,
      }}
    >
      <div className="bt-mkt-feature-text" style={{ direction: "ltr" }}>
        <div className="bt-mkt-feature-tag">{tag}</div>
        {/* h2 contains HTML entities (&lsquo; &rsquo;) so render via dangerouslySetInnerHTML */}
        <h2
          className="bt-mkt-feature-h2"
          dangerouslySetInnerHTML={{ __html: h2 }}
        />
        <p
          className="bt-mkt-feature-body"
          dangerouslySetInnerHTML={{ __html: body }}
        />
      </div>
      <div className="bt-mkt-feature-visual" style={{ direction: "ltr" }}>
        {visual}
      </div>
    </div>
  );
}

// ── Feature 1 — Plan together ─────────────────────────────────────────────

function FeatureVisualPlanTogether() {
  return (
    <div className="bt-mkt-card">
      <div className="bt-mkt-inner-label" style={{ marginBottom: 8 }}>
        Destination ideas · voting open
      </div>

      <IdeaRow
        title="Pinehurst No. 2"
        sub="Pinehurst, NC · 4 courses nearby"
        votes={["y", "y", "y", "m", "n"]}
        winner
      />
      <IdeaRow
        title="Kiawah Island"
        sub="Kiawah Island, SC · 5 courses"
        votes={["y", "m", "n", "n", "y"]}
      />
      <IdeaRow
        title="Pebble Beach"
        sub="Pebble Beach, CA · 3 courses"
        votes={["y", "n", "n", "n", "m"]}
        lastIdea
      />

      <DatePollGrid />
    </div>
  );
}

function IdeaRow({
  title,
  sub,
  votes,
  winner,
  lastIdea,
}: {
  title: string;
  sub: string;
  votes: Array<"y" | "m" | "n">;
  winner?: boolean;
  lastIdea?: boolean;
}) {
  return (
    <div
      className="bt-mkt-idea-row"
      style={{
        ...(winner
          ? {
              borderColor: "rgba(45,212,191,.35)",
              background: "rgba(45,212,191,.04)",
            }
          : {}),
        marginBottom: lastIdea ? 12 : 6,
      }}
    >
      <div>
        <div style={{ fontSize: 12, color: "#f1f5f9", marginBottom: 2 }}>{title}</div>
        <div style={{ fontSize: 10, color: "#64748b" }}>{sub}</div>
      </div>
      <div className="bt-mkt-vote-dots-wrap">
        <div className="bt-mkt-vote-dots">
          {votes.map((v, i) => (
            <span
              key={i}
              className="bt-mkt-vote-dot"
              style={{
                background:
                  v === "y" ? "#2dd4bf" : v === "m" ? "#f59e0b" : "#ef4444",
              }}
            />
          ))}
        </div>
        {winner && <span className="bt-mkt-leading-badge">Leading</span>}
      </div>
    </div>
  );
}

// ── Feature 2 — Split it fairly ───────────────────────────────────────────

function FeatureVisualSplitFairly() {
  const expenses: Array<{ title: string; paidBy: string; amount: string; split: string }> = [
    { title: "VRBO — 3 nights",            paidBy: "Paid by Buddy", amount: "$980", split: "÷ 5 = $196" },
    { title: "Pinehurst No. 2 — Round 1",  paidBy: "Paid by Zach",  amount: "$725", split: "÷ 5 = $145" },
    { title: "Steak dinner + open bar",    paidBy: "Paid by Ryan",  amount: "$480", split: "÷ 5 = $96"  },
    { title: "Hammerschlagen entry fees",  paidBy: "Paid by Mike",  amount: "$155", split: "÷ 5 = $31"  },
  ];
  return (
    <div className="bt-mkt-card">
      <div style={{ textAlign: "center", marginBottom: 14 }}>
        <div style={{ fontSize: 28, fontWeight: 500, color: "#f1f5f9" }}>$2,340</div>
        <div style={{ fontSize: 11, color: "#64748b", marginTop: 2 }}>
          total trip expenses · 5 crew
        </div>
      </div>

      {expenses.map((e) => (
        <div key={e.title} className="bt-mkt-expense-row">
          <div>
            <div style={{ fontSize: 12, color: "#f1f5f9" }}>{e.title}</div>
            <div style={{ fontSize: 10, color: "#64748b", marginTop: 1 }}>{e.paidBy}</div>
          </div>
          <div style={{ textAlign: "right" }}>
            <div style={{ fontSize: 13, fontWeight: 500, color: "#f1f5f9" }}>{e.amount}</div>
            <div style={{ fontSize: 10, color: "#64748b", marginTop: 1 }}>{e.split}</div>
          </div>
        </div>
      ))}

      <div className="bt-mkt-balance-row">
        <div className="bt-mkt-balance-chip">
          <div className="bt-mkt-balance-label">You are owed</div>
          <div className="bt-mkt-balance-amount" style={{ color: "#2dd4bf" }}>+$312</div>
        </div>
        <div className="bt-mkt-balance-chip">
          <div className="bt-mkt-balance-label">Tom owes</div>
          <div className="bt-mkt-balance-amount" style={{ color: "#f87171" }}>-$468</div>
        </div>
        <div className="bt-mkt-balance-chip">
          <div className="bt-mkt-balance-label">Mike owes</div>
          <div className="bt-mkt-balance-amount" style={{ color: "#f87171" }}>-$156</div>
        </div>
      </div>
    </div>
  );
}

// ── Feature 3 — Compete ───────────────────────────────────────────────────

function FeatureVisualCompete() {
  const events: Array<{ label: string; state: "done" | "active" | "upcoming" | "final" }> = [
    { label: "Scramble ✓",       state: "done" },
    { label: "Hammerschlagen ✓", state: "done" },
    { label: "Stroke Play ✓",    state: "done" },
    { label: "Poker ✓",          state: "done" },
    { label: "Sabotage →",       state: "active" },
    { label: "Corn hole",        state: "upcoming" },
    { label: "Skins · 2× pts",   state: "final" },
  ];

  const teams: Array<{
    rank: number;
    dot: string;
    name: string;
    pts: string;
    ptsColor: string;
    sub?: string;
    leader?: boolean;
  }> = [
    { rank: 1, dot: "#3b82f6", name: "Team Banks",   pts: "24.5", ptsColor: "#fbbf24", sub: "+3.5 lead", leader: true },
    { rank: 2, dot: "#a855f7", name: "Team Grether", pts: "21.0", ptsColor: "#f1f5f9" },
    { rank: 3, dot: "#22c55e", name: "Team Durkin",  pts: "19.5", ptsColor: "#f1f5f9" },
    { rank: 4, dot: "#f97316", name: "Team Lynch",   pts: "18.0", ptsColor: "#f1f5f9" },
  ];

  return (
    <div className="bt-mkt-card">
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
        <div style={{ fontSize: 12, fontWeight: 500, color: "#f1f5f9" }}>
          BBMI 2026 · Day 2 of 3
        </div>
        <div className="bt-mkt-live-badge">
          <span className="bt-mkt-live-dot" />
          Live
        </div>
      </div>

      {/* Event chips */}
      <div className="bt-mkt-event-strip">
        {events.map((e, i) => (
          <span
            key={i}
            className="bt-mkt-event-chip"
            style={
              e.state === "done"
                ? { opacity: 0.45 }
                : e.state === "active"
                ? { border: "0.5px solid rgba(45,212,191,.3)", color: "#2dd4bf", background: "rgba(45,212,191,.06)" }
                : e.state === "final"
                ? { border: "0.5px solid rgba(251,191,36,.25)", color: "#fbbf24", background: "rgba(251,191,36,.04)" }
                : {}
            }
          >
            {e.label}
          </span>
        ))}
      </div>

      {/* Team rows */}
      <div style={{ display: "flex", flexDirection: "column", gap: 5, marginBottom: 10 }}>
        {teams.map((t) => (
          <div
            key={t.rank}
            className="bt-mkt-team-row"
            style={
              t.leader
                ? { borderColor: "rgba(251,191,36,.3)", background: "rgba(251,191,36,.04)" }
                : {}
            }
          >
            <span style={{ fontSize: 12, color: "#64748b", width: 14, flexShrink: 0 }}>{t.rank}</span>
            <span className="bt-mkt-team-dot" style={{ background: t.dot }} />
            <span style={{ fontSize: 12, color: "#f1f5f9", flex: 1 }}>{t.name}</span>
            <div style={{ textAlign: "right" }}>
              <div style={{ fontSize: 14, fontWeight: 500, color: t.ptsColor }}>{t.pts}</div>
              {t.sub && (
                <div style={{ fontSize: 10, color: "#64748b", marginTop: 1 }}>{t.sub}</div>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Current hole */}
      <div className="bt-mkt-inner-card">
        <div className="bt-mkt-inner-label">Sabotage · Hole 14 · Par 4</div>
        <div style={{ display: "flex", gap: 4 }}>
          {[
            { team: "Banks",   score: 4, color: "#2dd4bf" },
            { team: "Grether", score: 5, color: "#fbbf24" },
            { team: "Durkin",  score: 5, color: "#94a3b8" },
            { team: "Lynch",   score: 6, color: "#f87171" },
          ].map((s) => (
            <div key={s.team} className="bt-mkt-hole-cell">
              <div style={{ fontSize: 9, color: "#475569", marginBottom: 2 }}>{s.team}</div>
              <div style={{ fontSize: 13, fontWeight: 500, color: s.color }}>{s.score}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── Feature 4 — Stay on track ─────────────────────────────────────────────

const mapHref = (q: string) =>
  `https://maps.google.com/?q=${encodeURIComponent(q)}`;

function FeatureVisualStayOnTrack() {
  const days: Array<{
    label: string;
    items: Array<{
      time: string;
      dot: string;
      name: string;
      map?: string; // query string for map link
    }>;
  }> = [
    {
      label: "Thursday · Sep 12",
      items: [
        { time: "2:00p", dot: "#64748b", name: "Arrive / check in · VRBO" },
        { time: "7:00p", dot: "#64748b", name: "Dinner — The Pit BBQ", map: "The Pit BBQ Pinehurst NC" },
        { time: "9:00p", dot: "#f97316", name: "Hammerschlagen + poker" },
      ],
    },
    {
      label: "Friday · Sep 13",
      items: [
        { time: "7:30a", dot: "#2dd4bf", name: "Round 1 — Scramble", map: "Pinehurst No. 2 Golf Course" },
        { time: "7:00p", dot: "#64748b", name: "Steak dinner + open bar", map: "Pinehurst Resort Steakhouse" },
      ],
    },
    {
      label: "Saturday · Sep 14",
      items: [
        { time: "8:00a", dot: "#2dd4bf", name: "Round 2 — Stroke Play", map: "Pinehurst No. 2 Golf Course" },
        { time: "2:00p", dot: "#60a5fa", name: "Corn hole + pop-a-shot" },
      ],
    },
  ];

  return (
    <div className="bt-mkt-card">
      {/* Quick Info tiles */}
      <div className="bt-mkt-quickinfo-grid">
        <div className="bt-mkt-quickinfo-tile">
          <div className="bt-mkt-quickinfo-label">
            <Home size={11} strokeWidth={1.75} />
            VRBO door code
          </div>
          <div className="bt-mkt-quickinfo-value" style={{ letterSpacing: "0.03em" }}>4821#</div>
          <div className="bt-mkt-quickinfo-sub">Front door · resets daily</div>
        </div>
        <div className="bt-mkt-quickinfo-tile">
          <div className="bt-mkt-quickinfo-label">
            <Wifi size={11} strokeWidth={1.75} />
            WiFi password
          </div>
          <div className="bt-mkt-quickinfo-value" style={{ fontSize: 13 }}>PinehurstGolf26</div>
          <div className="bt-mkt-quickinfo-sub">Network: VRBO_Guest</div>
        </div>
      </div>

      <div className="bt-mkt-divider" />

      {/* Schedule */}
      {days.map((d) => (
        <div key={d.label} style={{ marginBottom: 10 }}>
          <div className="bt-mkt-day-label">{d.label}</div>
          {d.items.map((item) => (
            <div key={item.time + item.name} className="bt-mkt-schedule-item">
              <span style={{ fontSize: 10, color: "#64748b", width: 38, flexShrink: 0 }}>{item.time}</span>
              <span className="bt-mkt-schedule-dot" style={{ background: item.dot }} />
              <span style={{ fontSize: 12, color: "#f1f5f9", flex: 1 }}>{item.name}</span>
              {item.map && (
                <a
                  href={mapHref(item.map)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="bt-mkt-map-link"
                >
                  <MapPin size={11} strokeWidth={1.75} />
                  Map
                </a>
              )}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
