import { Home, Wifi, Plane, Car, Flag, Clock, Navigation } from "lucide-react";
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

// ── Feature 2 — Split it fairly (receipts + balances) ─────────────────────

function FeatureVisualSplitFairly() {
  const receipts: Array<{ title: string; paidBy: string; ways: number; share: string; amount: string }> = [
    { title: "VRBO — 3 nights",           paidBy: "Buddy", ways: 5, share: "$196", amount: "$980" },
    { title: "Pinehurst No. 2 — Round 1", paidBy: "Zach",  ways: 5, share: "$145", amount: "$725" },
    { title: "Steak dinner + open bar",   paidBy: "Ryan",  ways: 5, share: "$96",  amount: "$480" },
  ];
  // Signed balances net to zero (+434 +72 −96 −196 −214).
  const balances: Array<{ name: string; amt: string; pos: boolean }> = [
    { name: "Zach",  amt: "+$434", pos: true },
    { name: "Ryan",  amt: "+$72",  pos: true },
    { name: "Buddy", amt: "-$96",  pos: false },
    { name: "Brad",  amt: "-$196", pos: false },
    { name: "Mike",  amt: "-$214", pos: false },
  ];
  return (
    <div className="bt-mkt-card">
      <div className="bt-mkt-inner-label" style={{ marginBottom: 8 }}>
        Receipts · who paid for what
      </div>

      {receipts.map((r) => (
        <div key={r.title} style={{ display: "flex", alignItems: "center", gap: 11, padding: "7px 0" }}>
          <span
            style={{
              width: 34, height: 34, borderRadius: 9, flexShrink: 0,
              display: "flex", alignItems: "center", justifyContent: "center",
              background: "rgba(45,212,191,0.14)", color: "#2dd4bf",
              fontFamily: "var(--font-mono)", fontSize: 15, fontWeight: 700,
            }}
          >
            $
          </span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 12, color: "#f1f5f9", fontWeight: 600 }}>{r.title}</div>
            <div style={{ fontSize: 10, color: "#64748b", marginTop: 1 }}>
              Paid by <strong style={{ color: "#cbd5e1", fontWeight: 600 }}>{r.paidBy}</strong>
              {" · "}split {r.ways} ways
            </div>
            <div style={{ fontSize: 10, color: "#2dd4bf", marginTop: 1 }}>
              Your share: <strong style={{ fontWeight: 600 }}>{r.share}</strong>
            </div>
          </div>
          <span
            style={{
              fontFamily: "var(--font-mono)", fontSize: 14, fontWeight: 600,
              color: "#f1f5f9", flexShrink: 0,
            }}
          >
            {r.amount}
          </span>
        </div>
      ))}

      <div className="bt-mkt-divider" />

      <div className="bt-mkt-inner-label" style={{ marginBottom: 8 }}>
        Where everyone lands
      </div>
      {balances.map((b) => (
        <div
          key={b.name}
          style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "4px 0" }}
        >
          <span style={{ display: "flex", alignItems: "center", gap: 9 }}>
            <span
              style={{
                width: 22, height: 22, borderRadius: "50%", flexShrink: 0,
                display: "flex", alignItems: "center", justifyContent: "center",
                background: "#243049", color: "#cbd5e1", fontSize: 10, fontWeight: 600,
              }}
            >
              {b.name[0]}
            </span>
            <span style={{ fontSize: 12, color: "#f1f5f9" }}>{b.name}</span>
          </span>
          <span
            style={{
              fontFamily: "var(--font-mono)", fontSize: 13, fontWeight: 600,
              color: b.pos ? "#2dd4bf" : "#f87171",
            }}
          >
            {b.amt}
          </span>
        </div>
      ))}
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

// Category palette for the itinerary cards (dark marketing surface).
const ITIN_CATS = {
  travel:  { color: "#2dd4bf", fill: "rgba(45,212,191,0.10)", badge: "rgba(45,212,191,0.18)" },
  lodging: { color: "#60a5fa", fill: "rgba(96,165,250,0.10)", badge: "rgba(96,165,250,0.18)" },
  events:  { color: "#f59e0b", fill: "rgba(245,158,11,0.10)", badge: "rgba(245,158,11,0.18)" },
  golf:    { color: "#22c55e", fill: "rgba(34,197,94,0.10)",  badge: "rgba(34,197,94,0.18)" },
} as const;

function AvatarStack({ initials }: { initials: string[] }) {
  return (
    <span style={{ display: "inline-flex" }}>
      {initials.map((n, i) => (
        <span
          key={i}
          style={{
            width: 20, height: 20, borderRadius: "50%",
            display: "flex", alignItems: "center", justifyContent: "center",
            background: "#243049", border: "1.5px solid #161e2f", color: "#cbd5e1",
            fontSize: 9, fontWeight: 600, marginLeft: i ? -7 : 0,
          }}
        >
          {n}
        </span>
      ))}
    </span>
  );
}

function ItinCard({
  cat,
  Icon,
  title,
  sub,
  map,
  children,
}: {
  cat: keyof typeof ITIN_CATS;
  Icon: typeof Home;
  title: string;
  sub?: string;
  map?: string;
  children?: React.ReactNode;
}) {
  const c = ITIN_CATS[cat];
  return (
    <div
      style={{
        display: "flex", gap: 10, alignItems: children ? "flex-start" : "center",
        background: c.fill, borderRadius: 10, padding: "9px 11px", marginBottom: 6,
      }}
    >
      <span
        style={{
          width: 30, height: 30, borderRadius: 8, flexShrink: 0,
          display: "flex", alignItems: "center", justifyContent: "center",
          background: c.badge, color: c.color,
        }}
      >
        <Icon size={15} strokeWidth={1.9} />
      </span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 12, color: "#f1f5f9", fontWeight: 600 }}>{title}</div>
        {sub && <div style={{ fontSize: 10, color: "#94a3b8", marginTop: 1 }}>{sub}</div>}
        {children}
      </div>
      {map && (
        <a
          href={mapHref(map)}
          target="_blank"
          rel="noopener noreferrer"
          style={{
            display: "inline-flex", alignItems: "center", gap: 4, flexShrink: 0,
            background: c.badge, color: c.color, borderRadius: 9999,
            padding: "4px 9px", fontSize: 10, fontWeight: 600,
            textDecoration: "none", whiteSpace: "nowrap",
          }}
        >
          <Navigation size={10} strokeWidth={2} />
          Directions
        </a>
      )}
    </div>
  );
}

function FeatureVisualStayOnTrack() {
  return (
    <div className="bt-mkt-card">
      {/* Quick Info tiles */}
      <div className="bt-mkt-quickinfo-grid">
        <div className="bt-mkt-quickinfo-tile">
          <div className="bt-mkt-quickinfo-label">
            <Home size={11} strokeWidth={1.75} />
            VRBO door code
          </div>
          <div className="bt-mkt-quickinfo-value" style={{ letterSpacing: "0.03em", color: "#f1f5f9" }}>4821#</div>
        </div>
        <div className="bt-mkt-quickinfo-tile">
          <div className="bt-mkt-quickinfo-label">
            <Wifi size={11} strokeWidth={1.75} />
            WiFi password
          </div>
          <div className="bt-mkt-quickinfo-value" style={{ fontSize: 13, color: "#f1f5f9" }}>PinehurstGolf26</div>
        </div>
      </div>

      <div className="bt-mkt-divider" />

      <div className="bt-mkt-day-label">Friday · Sep 13</div>

      {/* Arrivals — grouped card: flying / driving with avatar stacks + windows */}
      <ItinCard cat="travel" Icon={Plane} title="Arrivals">
        <div style={{ marginTop: 7, display: "flex", flexDirection: "column", gap: 7 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <Plane size={11} strokeWidth={1.9} style={{ color: "#2dd4bf", flexShrink: 0 }} />
            <span style={{ fontSize: 11, color: "#cbd5e1", width: 46, flexShrink: 0 }}>Flying</span>
            <AvatarStack initials={["Z", "B", "R"]} />
            <span style={{ fontSize: 10, color: "#94a3b8", marginLeft: "auto", fontFamily: "var(--font-mono)" }}>
              2:10p – 4:30p
            </span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <Car size={11} strokeWidth={1.9} style={{ color: "#2dd4bf", flexShrink: 0 }} />
            <span style={{ fontSize: 11, color: "#cbd5e1", width: 46, flexShrink: 0 }}>Driving</span>
            <AvatarStack initials={["M", "J"]} />
            <span style={{ fontSize: 10, color: "#94a3b8", marginLeft: "auto", fontFamily: "var(--font-mono)" }}>
              by 3:00p
            </span>
          </div>
        </div>
      </ItinCard>

      <ItinCard
        cat="lodging"
        Icon={Home}
        title="Check in — Pinehurst Resort"
        sub="57744 Round Lake Dr"
        map="Pinehurst Resort"
      />

      <ItinCard
        cat="golf"
        Icon={Flag}
        title="Round 1 — Scramble"
        sub="Pinehurst No. 2"
        map="Pinehurst No. 2 Golf Course"
      >
        <div style={{ marginTop: 6, display: "flex", gap: 5, flexWrap: "wrap" }}>
          {["8:00a", "8:10a", "8:20a"].map((t) => (
            <span
              key={t}
              style={{
                fontFamily: "var(--font-mono)", fontSize: 10, color: "#4ade80",
                background: "rgba(34,197,94,0.14)", borderRadius: 6, padding: "2px 6px",
              }}
            >
              {t}
            </span>
          ))}
        </div>
      </ItinCard>

      <ItinCard
        cat="events"
        Icon={Clock}
        title="Steak dinner + open bar"
        sub="Pinehurst Steakhouse"
        map="Pinehurst Resort Steakhouse"
      />
    </div>
  );
}
