// BuddyTrip UI kit — screens.jsx
// Four screens that compose into the click-through prototype in index.html.

// ── Mock data ──────────────────────────────────────────────────────────
const MOCK_USER = { name: 'Zach Grether', avatar: 'ZG' };

const MOCK_TRIPS = [
  {
    id: 'bbmi-26', title: 'BBMI 2026 — Pinehurst No. 2', location: 'Pinehurst, NC',
    dateRange: 'Sep 12 – Sep 15', stage: 'going', role: 'Owner',
    countdown: 'Starts in 32 days', hasComp: true, unread: 3,
  },
  {
    id: 'banff', title: 'Banff ski week', location: 'Banff, AB',
    dateRange: 'Feb 8 – Feb 14', stage: 'planning', role: 'Planner',
    hasComp: false, unread: 0,
  },
  {
    id: 'vegas', title: 'Vegas bachelor', location: '',
    dateRange: 'Dates TBD', stage: 'idea', role: 'Owner', hasComp: false, unread: 1,
  },
];

const MOCK_CREW = [
  { name: 'Zach Grether', role: 'Owner', status: 'in', team: '#a855f7', icon: 'flag' },
  { name: 'Buddy Banks',  role: 'Planner', status: 'in', team: '#3b82f6' },
  { name: 'Mike Kosko',   role: 'Member', status: 'in', team: '#22c55e' },
  { name: 'Ryan Lynch',   role: 'Member', status: 'maybe', team: '#f97316' },
  { name: 'Tom Stilson',  role: 'Member', status: 'pending', team: '#06b6d4' },
];

const MOCK_POLL_WINDOWS = ['Sep 12–15', 'Sep 19–22', 'Oct 3–6'];
const MOCK_POLL_VOTES = {
  'Zach Grether': ['y','y','n'],
  'Buddy Banks':  ['y','n','y'],
  'Mike Kosko':   ['y','m', null],
  'Ryan Lynch':   ['m','y','n'],
  'Tom Stilson':  [null,'y','m'],
};

const MOCK_TEAMS = [
  { rank: 1, color: '#3b82f6', name: 'Team Banks',   pts: 24.5, sub: '+3.5 lead', leading: true },
  { rank: 2, color: '#a855f7', name: 'Team Grether', pts: 21.0 },
  { rank: 3, color: '#22c55e', name: 'Team Durkin',  pts: 19.5 },
  { rank: 4, color: '#f97316', name: 'Team Lynch',   pts: 18.0 },
];

// ─────────────────────────────────────────────────────────────────────────
// Dashboard screen (My Trips)
// ─────────────────────────────────────────────────────────────────────────
function DashboardScreen({ trips = MOCK_TRIPS, onOpenTrip }) {
  const now = trips.filter(t => t.stage === 'now');
  const active = trips.filter(t => t.stage === 'planning' || t.stage === 'going');
  const ideas = trips.filter(t => t.stage === 'idea');

  return (
    <div style={{ background: 'var(--color-bt-base)', color: 'var(--color-bt-text)', minHeight: '100%' }}>
      <BTTopNav title="BuddyTrip" unread={4} avatar={MOCK_USER.avatar} />

      <main style={{ padding: '16px 16px 96px', maxWidth: 896, margin: '0 auto' }}>
        <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', marginBottom: 18 }}>
          <div>
            <div style={{ fontSize: 13, color: 'var(--color-bt-text-dim)' }}>Welcome back, Zach</div>
            <h1 style={{ fontSize: 22, fontWeight: 700, margin: '2px 0 0', color: 'var(--color-bt-text)' }}>My Trips</h1>
          </div>
          <BTButton variant="primary" size="md">New trip</BTButton>
        </div>

        {now.length > 0 && <Section label="NOW" labelColor="var(--color-bt-warning)" trips={now} onOpen={onOpenTrip} />}
        <Section label="ACTIVE" trips={active} onOpen={onOpenTrip} />
        {ideas.length > 0 && <Section label="IDEAS" trips={ideas} onOpen={onOpenTrip} />}
      </main>
    </div>
  );
}

function Section({ label, labelColor = 'var(--color-bt-text-dim)', trips, onOpen }) {
  if (!trips.length) return null;
  return (
    <section style={{ marginBottom: 24 }}>
      <h2 style={{
        margin: '0 0 12px', fontSize: 12, fontWeight: 700,
        letterSpacing: '0.12em', textTransform: 'uppercase', color: labelColor,
      }}>{label}</h2>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {trips.map(t => <TripCard key={t.id} trip={t} onClick={() => onOpen?.(t.id)} />)}
      </div>
    </section>
  );
}

function TripCard({ trip, onClick }) {
  const isIdea = trip.stage === 'idea';
  return (
    <button onClick={onClick} style={{
      all: 'unset', cursor: 'pointer', width: '100%', position: 'relative',
      overflow: 'hidden', borderRadius: 12,
      background: isIdea
        ? 'var(--color-bt-card)'
        : 'linear-gradient(135deg, #0a1f2e 0%, #1a3247 60%, #0d2533 100%)',
      boxShadow: 'var(--shadow-card)',
      border: isIdea ? '1px solid var(--color-bt-border)' : 'none',
      boxSizing: 'border-box',
    }}>
      <div style={{ padding: 16, position: 'relative' }}>
        {/* badges top-right */}
        <div style={{ position: 'absolute', right: 12, top: 12, display: 'flex', gap: 6, alignItems: 'center' }}>
          {trip.hasComp && (
            <span style={{
              width: 20, height: 20, borderRadius: '50%', display: 'inline-flex',
              alignItems: 'center', justifyContent: 'center',
              background: 'var(--color-bt-accent-faint)', color: 'var(--color-bt-accent)',
              border: '1px solid var(--color-bt-accent-border)',
            }}><BTIcon name="trophy" size={10} strokeWidth={2.5} /></span>
          )}
          {!isIdea && <BTStatusBadge status={trip.stage} label={trip.stage === 'going' ? 'UPCOMING' : undefined} />}
          {trip.unread > 0 && (
            <span style={{
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              height: 20, minWidth: 20, padding: '0 6px', borderRadius: 9999,
              background: 'var(--color-bt-accent)', color: '#0d1f1a',
              fontSize: 10, fontWeight: 700,
            }}>{trip.unread}</span>
          )}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8, paddingRight: 100, minWidth: 0 }}>
          <BTRoleBadge role={trip.role} />
          <h3 style={{
            margin: 0, fontSize: 15, fontWeight: 600, lineHeight: 1.2,
            color: isIdea ? 'var(--color-bt-text)' : '#fff',
            whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
          }}>{trip.title}</h3>
        </div>

        {trip.location && (
          <div style={{
            marginTop: 6, display: 'flex', alignItems: 'center', gap: 4,
            fontSize: 13, color: isIdea ? 'var(--color-bt-text-dim)' : 'rgba(255,255,255,.7)',
          }}>
            <BTIcon name="map-pin" size={12} /><span>{trip.location}</span>
          </div>
        )}
        <div style={{
          marginTop: 4, display: 'flex', alignItems: 'center', gap: 4,
          fontSize: 12, color: isIdea ? 'var(--color-bt-text-dim)' : 'rgba(255,255,255,.5)',
        }}>
          <BTIcon name="calendar" size={11} /><span>{trip.dateRange}</span>
        </div>
      </div>
      {trip.countdown && (
        <div style={{
          borderTop: '1px solid rgba(148,163,184,.15)',
          background: 'var(--color-bt-accent-faint)',
          padding: '8px 16px', fontSize: 12, fontWeight: 600,
          letterSpacing: '0.04em', color: 'var(--color-bt-accent)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
        }}>
          <span style={{
            width: 6, height: 6, borderRadius: '50%', background: 'var(--color-bt-accent)',
            animation: 'btPulse 1.4s ease-in-out infinite',
          }}/>
          {trip.countdown}
        </div>
      )}
    </button>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Trip Home screen — header + planning rows + nudge banner
// ─────────────────────────────────────────────────────────────────────────
function TripHomeScreen({ onBack, onOpenDates, onOpenComp }) {
  const [open, setOpen] = React.useState('crew');

  return (
    <div style={{ background: 'var(--color-bt-base)', color: 'var(--color-bt-text)', minHeight: '100%' }}>
      <BTTopNav title="BBMI 2026" onBack={onBack} unread={2} avatar="ZG" />
      <BTTripTabBar active="home" onChange={() => {}} badges={{ crew: 'info', expenses: 'warning' }} />

      <main style={{ padding: 16, paddingBottom: 96 }}>
        {/* Hero — locked destination */}
        <div style={{
          position: 'relative', overflow: 'hidden', borderRadius: 16,
          background: 'linear-gradient(135deg, #0d2c3a 0%, #1a3a4f 50%, #0d2533 100%)',
          boxShadow: 'var(--shadow-raised)',
          marginBottom: 16,
        }}>
          <div style={{ padding: '14px 18px 10px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, paddingRight: 40 }}>
              <BTRoleBadge role="Owner" />
              <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700, color: '#fff', lineHeight: 1.15 }}>BBMI 2026</h1>
            </div>
            <div style={{ marginTop: 6, fontSize: 13, color: 'rgba(255,255,255,.7)', display: 'flex', alignItems: 'center', gap: 4 }}>
              <BTIcon name="map-pin" size={13} /> Pinehurst No. 2 · NC
            </div>
            <div style={{ marginTop: 4, fontSize: 12, color: 'rgba(255,255,255,.5)', display: 'flex', alignItems: 'center', gap: 4 }}>
              <BTIcon name="calendar" size={11} /> Sep 12 – Sep 15
            </div>
            <button onClick={onOpenComp}
              aria-label="Settings"
              style={{
                position: 'absolute', right: 12, top: 12,
                all: 'unset', cursor: 'pointer',
                width: 32, height: 32, borderRadius: 8,
                background: 'rgba(255,255,255,0.08)', color: 'rgba(241,245,249,0.6)',
                display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              }}><BTIcon name="settings" size={16} /></button>
          </div>
          <div style={{
            borderTop: '1px solid rgba(148,163,184,.15)',
            background: 'var(--color-bt-accent-faint)',
            padding: '8px 16px', fontSize: 12, fontWeight: 600,
            letterSpacing: '0.04em', color: 'var(--color-bt-accent)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
          }}>
            <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--color-bt-accent)', animation: 'btPulse 1.4s ease-in-out infinite' }}/>
            Starts in 32 days
          </div>
        </div>

        {/* Nudges */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 16 }}>
          <BTNudge tone="accent" icon="check" title="3 items still need confirmation"
                   sub="Tap to review and finalize before the trip starts." />
          <BTNudge tone="warning" icon="user-plus" title="2 crew haven't RSVP'd"
                   sub="Tom and Ryan — last reminder sent 3 days ago." />
        </div>

        {/* Planning rows */}
        <h2 style={{ margin: '4px 0 10px', fontSize: 12, fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--color-bt-text-dim)' }}>
          Planning
        </h2>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <BTPlanningRow icon="map-pin" title="Destination" sub="Pinehurst No. 2 — locked ✓"
                         state="done" open={open === 'dest'} onToggle={() => setOpen(open === 'dest' ? null : 'dest')} />
          <BTPlanningRow icon="users" title="Crew" sub="3 of 5 confirmed · 2 pending"
                         open={open === 'crew'} onToggle={() => setOpen(open === 'crew' ? null : 'crew')}>
            <CrewList />
          </BTPlanningRow>
          <BTPlanningRow icon="calendar" title="Dates" sub="Sep 12 – Sep 15 — locked ✓"
                         state="done" open={open === 'dates'} onToggle={onOpenDates} />
          <BTPlanningRow icon="hotel" title="Logistics"
                         sub="VRBO booked · tee times pending"
                         open={open === 'log'} onToggle={() => setOpen(open === 'log' ? null : 'log')} />
        </div>

        <div style={{ marginTop: 18 }}>
          <BTButton variant="dashed" icon="plus" fullWidth>Add a Competition</BTButton>
        </div>
      </main>

      <div style={{ position: 'sticky', bottom: 0 }}>
        <BTBottomNav kind="trip" active="trip-home" />
      </div>
    </div>
  );
}

function CrewList() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      {MOCK_CREW.map(m => {
        const statusMap = {
          in:      { bg: 'var(--color-bt-accent-faint)',  fg: 'var(--color-bt-accent)',  label: 'In' },
          maybe:   { bg: 'var(--color-bt-warning-faint)', fg: 'var(--color-bt-warning)', label: 'Maybe' },
          pending: { bg: 'transparent',                   fg: 'var(--color-bt-text-dim)', label: 'Pending' },
        };
        const s = statusMap[m.status];
        return (
          <div key={m.name} style={{
            display: 'flex', alignItems: 'center', gap: 10,
            background: 'var(--color-bt-card-raised)', borderRadius: 10, padding: '8px 12px',
          }}>
            <BTAvatar name={m.name} size={30} teamColor={m.team} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--color-bt-text)' }}>{m.name}</div>
              {m.role !== 'Member' && (
                <div style={{ fontSize: 10, color: 'var(--color-bt-text-dim)', marginTop: 1 }}>{m.role}</div>
              )}
            </div>
            <span style={{
              padding: '2px 8px', borderRadius: 9999, fontSize: 10, fontWeight: 600,
              letterSpacing: '0.06em', textTransform: 'uppercase',
              background: s.bg, color: s.fg,
              border: m.status === 'pending' ? '0.5px dashed var(--color-bt-border)' : 'none',
            }}>{s.label}</span>
          </div>
        );
      })}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Date poll screen (sheet-style)
// ─────────────────────────────────────────────────────────────────────────
function DatePollScreen({ onBack }) {
  const [votes, setVotes] = React.useState(MOCK_POLL_VOTES);
  const myName = 'Zach Grether';

  const cycleVote = (winIdx) => {
    const seq = [null, 'y', 'm', 'n'];
    const cur = votes[myName][winIdx];
    const next = seq[(seq.indexOf(cur) + 1) % seq.length];
    const updated = { ...votes[myName] };
    updated[winIdx] = next;
    const arr = [...votes[myName]];
    arr[winIdx] = next;
    setVotes({ ...votes, [myName]: arr });
  };

  return (
    <div style={{ background: 'var(--color-bt-base)', color: 'var(--color-bt-text)', minHeight: '100%' }}>
      <BTTopNav title="Date poll" onBack={onBack} avatar="ZG" />

      <main style={{ padding: 16, paddingBottom: 96 }}>
        <p style={{ margin: '4px 0 14px', fontSize: 13, color: 'var(--color-bt-text-dim)', lineHeight: 1.5 }}>
          Tap your row to cycle <strong style={{ color: 'var(--color-bt-text)' }}>✓ Works</strong>,
          {' '}<strong style={{ color: '#fbbf24' }}>~ Maybe</strong>, or
          {' '}<strong style={{ color: 'var(--color-bt-danger)' }}>✗ Can't</strong> for each window.
          The owner locks the winner once it's clear.
        </p>

        <div style={{
          background: 'var(--color-bt-card)', border: '1px solid var(--color-bt-border)',
          borderRadius: 12, padding: 14,
        }}>
          <div style={{ fontSize: 9, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--color-bt-text-dim)', marginBottom: 10 }}>
            Date poll · crew availability
          </div>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead>
              <tr>
                <th></th>
                {MOCK_POLL_WINDOWS.map(w => (
                  <th key={w} style={{
                    padding: '6px 4px', fontWeight: 500, color: 'var(--color-bt-text-dim)',
                    fontSize: 10, textAlign: 'center',
                  }}>{w}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {Object.entries(votes).map(([name, arr], rowIdx) => {
                const isMe = name === myName;
                return (
                  <tr key={name} style={{
                    borderBottom: rowIdx < Object.keys(votes).length - 1 ? '1px solid var(--color-bt-border)' : 'none',
                  }}>
                    <td style={{
                      padding: '8px 0', borderRight: '1px solid var(--color-bt-border)',
                      color: isMe ? 'var(--color-bt-accent)' : 'var(--color-bt-text)',
                      fontWeight: isMe ? 600 : 500, width: 80, fontSize: 12,
                    }}>{name.split(' ')[0]}{isMe && ' (you)'}</td>
                    {arr.map((v, i) => (
                      <td key={i} style={{
                        padding: '6px 4px', textAlign: 'center',
                        background: rowIdx % 2 === 1 ? 'rgba(255,255,255,.025)' : 'transparent',
                      }}>
                        <BTVoteCell vote={v} onClick={isMe ? (() => cycleVote(i)) : undefined} />
                      </td>
                    ))}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
          <BTButton variant="dashed" icon="plus" fullWidth>Add date option</BTButton>
          <BTButton variant="primary" icon="lock">Lock window</BTButton>
        </div>
      </main>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Scoreboard screen
// ─────────────────────────────────────────────────────────────────────────
function ScoreboardScreen({ onBack }) {
  return (
    <div style={{ background: 'var(--color-bt-base)', color: 'var(--color-bt-text)', minHeight: '100%' }}>
      <BTTopNav title="Scoreboard" onBack={onBack} avatar="ZG" />

      <main style={{ padding: 16, paddingBottom: 96 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
          <div>
            <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--color-bt-text)' }}>BBMI 2026 · Day 2 of 3</div>
            <div style={{ fontSize: 11, color: 'var(--color-bt-text-dim)', marginTop: 2 }}>Sabotage · Hole 14 · Par 4</div>
          </div>
          <BTLiveBadge />
        </div>

        {/* Event chips */}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 14 }}>
          {[
            { l: 'Scramble ✓', s: 'done' },
            { l: 'Hammerschlagen ✓', s: 'done' },
            { l: 'Stroke Play ✓', s: 'done' },
            { l: 'Poker ✓', s: 'done' },
            { l: 'Sabotage →', s: 'active' },
            { l: 'Corn hole', s: 'upcoming' },
            { l: 'Skins · 2× pts', s: 'final' },
          ].map((e, i) => {
            const stateStyle = e.s === 'done'
              ? { opacity: 0.45, background: 'var(--color-bt-card-raised)', color: 'var(--color-bt-text-dim)' }
              : e.s === 'active'
              ? { border: '0.5px solid var(--color-bt-accent-border)', color: 'var(--color-bt-accent)', background: 'var(--color-bt-accent-faint)' }
              : e.s === 'final'
              ? { border: '0.5px solid var(--color-bt-warning-border)', color: 'var(--color-bt-warning)', background: 'rgba(251,191,36,.04)' }
              : { background: 'var(--color-bt-card-raised)', color: 'var(--color-bt-text-dim)' };
            return (
              <span key={i} style={{
                fontSize: 10, padding: '3px 8px', borderRadius: 9999,
                ...stateStyle,
              }}>{e.l}</span>
            );
          })}
        </div>

        {/* Team rows */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 14 }}>
          {MOCK_TEAMS.map(t => (
            <div key={t.name} style={{
              display: 'flex', alignItems: 'center', gap: 10,
              padding: '12px 14px', borderRadius: 10,
              background: t.leading ? 'rgba(251,191,36,.05)' : 'var(--color-bt-card)',
              border: t.leading ? '1px solid rgba(251,191,36,.3)' : '1px solid var(--color-bt-border)',
            }}>
              <span style={{ width: 16, fontSize: 12, color: 'var(--color-bt-text-dim)' }}>{t.rank}</span>
              <span style={{ width: 8, height: 8, borderRadius: '50%', background: t.color }}/>
              <span style={{ flex: 1, fontSize: 13, color: 'var(--color-bt-text)' }}>{t.name}</span>
              <div style={{ textAlign: 'right' }}>
                <div style={{ fontSize: 16, fontWeight: 600, color: t.leading ? 'var(--color-bt-warning)' : 'var(--color-bt-text)' }}>{t.pts}</div>
                {t.sub && <div style={{ fontSize: 10, color: 'var(--color-bt-text-dim)', marginTop: 1 }}>{t.sub}</div>}
              </div>
            </div>
          ))}
        </div>

        {/* Current hole */}
        <div style={{
          background: 'var(--color-bt-card)', border: '1px solid var(--color-bt-border)',
          borderRadius: 12, padding: 14,
        }}>
          <div style={{ fontSize: 9, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--color-bt-text-dim)', marginBottom: 8 }}>
            Current hole · enter scores
          </div>
          <div style={{ display: 'flex', gap: 6 }}>
            {[
              { team: 'Banks',   score: 4, color: 'var(--color-bt-accent)' },
              { team: 'Grether', score: 5, color: '#fbbf24' },
              { team: 'Durkin',  score: 5, color: 'var(--color-bt-text-dim)' },
              { team: 'Lynch',   score: 6, color: 'var(--color-bt-danger)' },
            ].map(s => (
              <div key={s.team} style={{
                flex: 1, padding: '10px 6px', borderRadius: 8,
                background: 'var(--color-bt-card-raised)', textAlign: 'center',
              }}>
                <div style={{ fontSize: 10, color: 'var(--color-bt-text-dim)', marginBottom: 4 }}>{s.team}</div>
                <div style={{ fontSize: 18, fontWeight: 600, color: s.color }}>{s.score}</div>
              </div>
            ))}
          </div>
        </div>
      </main>
    </div>
  );
}

Object.assign(window, { DashboardScreen, TripHomeScreen, DatePollScreen, ScoreboardScreen });
