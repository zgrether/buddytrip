// explorations-empty.jsx
// Redesigns of the sad empty states. Three ideas combine:
//   1. Ghost preview cards — show what the filled state looks like
//   2. Crew waiting context — overlapping avatars + a "waiting on you" line
//   3. Quick-add suggestions — typed-content shortcuts (tee time, dinner)
// Both screens reuse the WindowShell + ExTopNav from explorations-atoms.

// ── Sample/example treatment (replaces ghost-faded look) ──────────────
// "What this'll look like" sections used to be a row of dimmed ghost
// items. They read as broken half-data. The Sample treatment makes the
// illustrative nature explicit: a clear "EXAMPLE" eyebrow + a real card
// at full opacity wrapped in a tinted callout band.
function SampleHeader({ label }) {
  return (
    <div style={{
      display: 'inline-flex', alignItems: 'center', gap: 8,
      padding: '5px 10px', borderRadius: 9999, alignSelf: 'flex-start',
      background: 'rgba(96, 165, 250, 0.08)',
      border: '1px solid rgba(96, 165, 250, 0.25)',
      color: 'var(--color-bt-planning)',
      fontSize: 10, fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase',
    }}>
      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/>
      </svg>
      {label}
    </div>
  );
}

function SampleCard({ children }) {
  return (
    <div style={{
      position: 'relative',
      background: 'var(--color-bt-card)',
      border: '1px dashed rgba(96,165,250,0.30)',
      borderRadius: 14, padding: 6,
    }}>
      <span style={{
        position: 'absolute', top: -8, left: 12,
        background: 'var(--color-bt-base)',
        color: 'var(--color-bt-planning)',
        fontSize: 9, fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase',
        padding: '2px 7px',
      }}>Example</span>
      {children}
    </div>
  );
}

// ── Right-rail composers (always-visible add panel, desktop only) ──────
function RailComposer({ title, children, primary, hint, boosted }) {
  return (
    <div style={{
      background: 'var(--color-bt-card)',
      border: boosted ? '1px solid var(--color-bt-accent-border)' : '1px solid var(--color-bt-border)',
      boxShadow: boosted ? 'var(--shadow-raised)' : 'none',
      borderRadius: 12, padding: 16,
      display: 'flex', flexDirection: 'column', gap: 10,
    }}>
      <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', color: boosted ? 'var(--color-bt-accent)' : 'var(--color-bt-text-dim)' }}>{title}</div>
      {children}
      <button style={{
        all: 'unset', cursor: 'pointer', textAlign: 'center',
        padding: '10px 0', borderRadius: 10,
        background: 'var(--color-bt-accent)', color: '#0a0e1a',
        fontSize: 13, fontWeight: 600,
      }}>{primary}</button>
      {hint && (
        <div style={{ fontSize: 11, color: 'var(--color-bt-text-dim)', lineHeight: 1.45 }}>{hint}</div>
      )}
    </div>
  );
}

function railInput(extra) {
  return {
    background: 'var(--color-bt-card-raised)', border: '1px solid var(--color-bt-border)',
    borderRadius: 8, padding: '9px 12px', fontSize: 13, color: 'var(--color-bt-text)',
    outline: 'none', fontFamily: 'var(--font-sans)', width: '100%', boxSizing: 'border-box',
    ...extra,
  };
}

function AddPropertyComposer({ boosted } = {}) {
  return (
    <RailComposer
      title={boosted ? 'Add your first property' : 'Add a property'}
      primary="Add property"
      boosted={boosted}
      hint={<>Paste a link from VRBO, Airbnb, or hotels.com — we pull the photo, price, and sleep count. Or <a style={{ color: 'var(--color-bt-accent)' }}>enter manually</a>.</>}
    >
      <div style={{ position: 'relative' }}>
        <span style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--color-bt-text-dim)' }}>
          <ExIcon name="more-horizontal" size={14} color="currentColor"/>
        </span>
        <input placeholder="https://airbnb.com/rooms/…" style={railInput({ paddingLeft: 30, fontFamily: 'var(--font-mono)', color: 'var(--color-bt-text-dim)' })}/>
      </div>
    </RailComposer>
  );
}

function AddAgendaComposer({ boosted } = {}) {
  const chips = [
    { label: 'Tee time',  color: '#2dd4bf' },
    { label: 'Dinner',    color: '#fb923c' },
    { label: 'Travel',    color: '#60a5fa' },
    { label: 'Side game', color: '#fbbf24' },
    { label: 'Free time', color: '#a78bfa' },
  ];
  return (
    <RailComposer title={boosted ? 'Add your first agenda item' : 'Add to agenda'} primary="Add" boosted={boosted} hint="Type and day are required. Time is optional — leave blank for an all-day item.">
      <div style={{ fontSize: 11, color: 'var(--color-bt-text-dim)', marginBottom: -4 }}>Type</div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
        {chips.map((c, i) => (
          <span key={c.label} style={{
            padding: '5px 10px', borderRadius: 9999, fontSize: 11, fontWeight: 600, cursor: 'pointer',
            color: i === 0 ? '#0a0e1a' : c.color,
            background: i === 0 ? c.color : `${c.color}1a`,
            border: i === 0 ? 'none' : `0.5px solid ${c.color}40`,
          }}>{c.label}</span>
        ))}
      </div>
      <input placeholder="Title (e.g. Scramble round)" style={railInput()}/>
      <div style={{ display: 'flex', gap: 6 }}>
        <select style={railInput({ flex: 2 })}><option>Date · Thu Sep 12</option><option>Fri Sep 13</option><option>Sat Sep 14</option><option>Sun Sep 15</option></select>
        <input placeholder="Time" style={railInput({ flex: 1, fontFamily: 'var(--font-mono)' })}/>
      </div>
    </RailComposer>
  );
}

function AddReceiptComposer({ boosted } = {}) {
  const crew = [
    { initials: 'ZG', name: 'Zach',  color: '#a855f7' },
    { initials: 'LL', name: 'Llama', color: '#3b82f6' },
    { initials: 'BB', name: 'Buddy', color: '#22c55e' },
    { initials: 'MK', name: 'Mike',  color: '#06b6d4' },
    { initials: 'RL', name: 'Ryan',  color: '#f97316' },
  ];
  return (
    <RailComposer title={boosted ? 'Add your first receipt' : 'Add a receipt'} primary="Add receipt" boosted={boosted} hint="Tap a crew member to toggle them out of the split.">
      <input placeholder="Title (e.g. Steak dinner)" style={railInput()}/>
      <div style={{ display: 'flex', gap: 6 }}>
        <input placeholder="$0.00" style={railInput({ flex: 1, fontFamily: 'var(--font-mono)', textAlign: 'right' })}/>
        <select style={railInput({ flex: 1 })}><option>Paid by · Zach</option><option>Llama</option><option>Buddy</option><option>Mike</option><option>Ryan</option></select>
      </div>
      <div style={{ fontSize: 11, color: 'var(--color-bt-text-dim)' }}>Split with</div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
        {crew.map(p => (
          <span key={p.name} style={{
            display: 'inline-flex', alignItems: 'center', gap: 5,
            padding: '4px 8px 4px 4px', borderRadius: 9999,
            background: 'var(--color-bt-card-raised)', border: `0.5px solid ${p.color}`,
            fontSize: 11, fontWeight: 600, color: 'var(--color-bt-text)',
          }}>
            <span style={{ width: 18, height: 18, borderRadius: '50%', background: p.color, color: '#fff', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 8 }}>{p.initials}</span>
            {p.name}
          </span>
        ))}
      </div>
    </RailComposer>
  );
}
function TripHeaderStrip({ children }) {
  return (
    <div style={{
      position: 'relative', overflow: 'hidden', borderRadius: 14,
      background: 'linear-gradient(125deg, #1f3340 0%, #1a2a3a 55%, #2a2419 100%)',
      boxShadow: 'var(--shadow-card)',
      padding: '14px 18px', margin: '16px 24px 0',
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    }}>
      <div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{
            padding: '2px 7px', borderRadius: 4, fontSize: 10, fontWeight: 600,
            border: '1px solid #fbbf24', color: '#fbbf24',
            background: 'rgba(251,191,36,0.10)',
          }}>Owner</span>
          <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700, color: '#fff', lineHeight: 1 }}>BBMI 2026</h1>
        </div>
        <div style={{ marginTop: 6, fontSize: 13, color: 'rgba(255,255,255,0.7)', display: 'flex', alignItems: 'center', gap: 4 }}>
          <ExIcon name="map-pin" size={13} color="currentColor"/> Pinehurst, NC
        </div>
        <div style={{ marginTop: 4, fontSize: 12, color: 'rgba(255,255,255,0.5)', display: 'flex', alignItems: 'center', gap: 4 }}>
          <ExIcon name="calendar" size={11} color="currentColor"/> May 20, 2026 – May 25, 2026
        </div>
      </div>
      {children}
    </div>
  );
}

function TabStrip({ active }) {
  const tabs = [
    { id: 'home',     label: 'Home',        icon: 'home' },
    { id: 'crew',     label: 'Crew',        icon: 'users' },
    { id: 'lodging',  label: 'Lodging',     icon: 'hotel' },
    { id: 'schedule', label: 'Agenda',      icon: 'calendar' },
    { id: 'expenses', label: 'Receipts',    icon: 'dollar' },
    { id: 'comp',     label: 'Competition', icon: 'trophy' },
  ];
  return (
    <div style={{ borderBottom: '1px solid var(--color-bt-border)', margin: '20px 24px 0', display: 'flex' }}>
      {tabs.map(t => {
        const a = t.id === active;
        return (
          <div key={t.id} style={{
            flex: 1, padding: '10px 0', textAlign: 'center',
            display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4,
            color: a ? 'var(--color-bt-accent)' : 'var(--color-bt-text-dim)',
            borderBottom: a ? '2px solid var(--color-bt-accent)' : '2px solid transparent',
          }}>
            <ExIcon name={t.icon} size={16}/>
            <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase' }}>{t.label}</span>
          </div>
        );
      })}
    </div>
  );
}

function CrewWaitingBar({ count = 5, label = 'crew waiting on lodging' }) {
  const avatars = [
    { initials: 'BB', color: '#3b82f6' },
    { initials: 'MK', color: '#22c55e' },
    { initials: 'RL', color: '#f97316' },
    { initials: 'TS', color: '#06b6d4' },
    { initials: 'JD', color: '#a855f7' },
  ];
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 12,
      background: 'var(--color-bt-card)',
      border: '1px solid var(--color-bt-border)',
      borderRadius: 12, padding: '10px 14px',
    }}>
      <div style={{ display: 'flex' }}>
        {avatars.slice(0, count).map((a, i) => (
          <span key={i} style={{
            width: 28, height: 28, borderRadius: '50%',
            background: a.color, color: '#fff',
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 10, fontWeight: 600,
            border: '2px solid var(--color-bt-card)',
            marginLeft: i === 0 ? 0 : -8,
          }}>{a.initials}</span>
        ))}
      </div>
      <div style={{ flex: 1, fontSize: 13, color: 'var(--color-bt-text)' }}>
        <strong style={{ fontWeight: 600 }}>{count} {label}</strong>
        <span style={{ color: 'var(--color-bt-text-dim)' }}> — they'll see it next time they're in the app.</span>
      </div>
      <button style={{
        all: 'unset', cursor: 'pointer',
        padding: '6px 12px', borderRadius: 9999, fontSize: 12, fontWeight: 600,
        color: 'var(--color-bt-accent)', background: 'var(--color-bt-accent-faint)',
        border: '0.5px solid var(--color-bt-accent-border)',
        display: 'inline-flex', alignItems: 'center', gap: 5,
      }}>
        <ExIcon name="message" size={12} color="currentColor"/> Post to organizer chat
      </button>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════
// LODGING — barren before
// ════════════════════════════════════════════════════════════════════════
function LodgingBefore() {
  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <ExTopNav wide />
      <TripHeaderStrip>
        <span style={{ width: 80, height: 64, opacity: 0.4 }}>
          <svg viewBox="0 0 80 64"><path d="M2 28 L 12 22 L 26 24 L 40 18 L 56 22 L 72 16 L 78 30 L 70 42 L 58 44 L 44 38 L 32 42 L 18 38 L 8 42 Z" fill="rgba(255,255,255,0.10)"/></svg>
        </span>
      </TripHeaderStrip>
      <TabStrip active="lodging" />

      <div style={{ padding: '18px 24px 0', display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
        <div>
          <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--color-bt-accent)' }}>LODGING</div>
          <h2 style={{ margin: '6px 0 6px', fontSize: 24, fontWeight: 700 }}>Where everyone's staying</h2>
          <p style={{ margin: 0, fontSize: 13, color: 'var(--color-bt-text-dim)', lineHeight: 1.55, maxWidth: 480 }}>
            Drop in the places you're considering so the crew can compare — links, prices, sleep counts. Confirm the one(s) you book, and they're locked in as official trip details. Multi-property and multi-leg trips are fine — confirm as many as you need.
          </p>
        </div>
        <button style={{ all: 'unset', cursor: 'pointer', padding: '8px 14px', borderRadius: 12, background: 'var(--color-bt-card-raised)', border: '0.5px solid var(--color-bt-border)', fontSize: 12, color: 'var(--color-bt-text)' }}>+ Property</button>
      </div>

      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 8, color: 'var(--color-bt-text-dim)' }}>
        <span style={{ width: 36, height: 36, opacity: 0.5 }}>
          <ExIcon name="hotel" size={36} color="currentColor" />
        </span>
        <div style={{ fontSize: 14, fontWeight: 500 }}>No properties yet</div>
        <div style={{ fontSize: 12, maxWidth: 460, textAlign: 'center' }}>
          Add properties to compare places the crew is considering — confirm any once they're booked.
        </div>
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════
// LODGING — after (2-column: ghost cards + rail composer)
// ════════════════════════════════════════════════════════════════════════
function LodgingAfter() {
  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <ExTopNav wide />
      <TripHeaderStrip>
        <span style={{ width: 80, height: 64, opacity: 0.4 }}>
          <svg viewBox="0 0 80 64"><path d="M2 28 L 12 22 L 26 24 L 40 18 L 56 22 L 72 16 L 78 30 L 70 42 L 58 44 L 44 38 L 32 42 L 18 38 L 8 42 Z" fill="rgba(255,255,255,0.10)"/></svg>
        </span>
      </TripHeaderStrip>
      <TabStrip active="lodging" />

      <div style={{ padding: '18px 24px 0' }}>
        <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--color-bt-accent)' }}>LODGING</div>
        <h2 style={{ margin: '6px 0 6px', fontSize: 24, fontWeight: 700 }}>Where everyone's staying</h2>
        <p style={{ margin: 0, fontSize: 13, color: 'var(--color-bt-text-dim)', lineHeight: 1.55, maxWidth: 480 }}>
          Drop in the places you're considering, compare side-by-side, confirm what you book. Multi-property and multi-leg trips welcome.
        </p>
      </div>

      <div style={{ padding: '16px 24px 20px', display: 'grid', gridTemplateColumns: '1fr 300px', gap: 20, flex: 1, minHeight: 0 }}>
        <div style={{ minWidth: 0, display: 'flex', flexDirection: 'column', gap: 12 }}>
          <SampleHeader label="How a property will look" />
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, maxWidth: 540 }}>
            <SampleCard>
              <GhostCard
                tint="rgba(45,212,191,0.06)"
                border="rgba(45,212,191,0.25)"
                name="Sea Ranch Cottages"
                meta="$2,400 · sleeps 6 · 3.2mi"
                pills={['Hot tub', '5 ★', 'Pet OK']}
                img="#0d2c3a"
                confirmed
              />
            </SampleCard>
            <div style={{
              display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 8,
              padding: '4px 0', color: 'var(--color-bt-text-dim)', fontSize: 12, lineHeight: 1.5,
            }}>
              <p style={{ margin: 0 }}>Drop a VRBO / Airbnb / hotels.com link and we'll pull the photo, price, and sleeps count.</p>
              <p style={{ margin: 0 }}>The crew can compare across multiple properties. Lock one to make it the official trip lodging.</p>
            </div>
          </div>
        </div>

        <aside><AddPropertyComposer boosted /></aside>
      </div>
    </div>
  );
}

function GhostCard({ tint, border, name, meta, pills, img, confirmed }) {
  return (
    <div style={{
      background: tint, border: `1px solid ${border}`,
      borderRadius: 12, padding: 12,
      display: 'flex', flexDirection: 'column', gap: 8,
    }}>
      <div style={{
        height: 80, borderRadius: 8, background: img,
        display: 'flex', alignItems: 'flex-end', justifyContent: 'flex-end', padding: 8,
        backgroundImage: `linear-gradient(135deg, ${img} 0%, ${confirmed ? '#0d3a4f' : img} 100%)`,
      }}>
        {confirmed && (
          <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: '#0d1f1a', background: 'var(--color-bt-accent)', padding: '2px 6px', borderRadius: 4, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5"/></svg>
            Confirmed
          </span>
        )}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--color-bt-text)' }}>{name}</div>
        <div style={{ fontSize: 10, color: 'var(--color-bt-text-dim)', fontFamily: 'var(--font-mono)' }}>{meta}</div>
      </div>
      <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
        {pills.map(p => (
          <span key={p} style={{
            fontSize: 9, padding: '2px 6px', borderRadius: 9999,
            background: 'rgba(148,163,184,0.08)', color: 'var(--color-bt-text-dim)',
          }}>{p}</span>
        ))}
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════
// AGENDA — after (variable-length day list + on-deck + competition events)
// ════════════════════════════════════════════════════════════════════════
function AgendaAfter() {
  // 6-day trip (May 20–25). Demonstrates scaling. Pure HTML — no fixed grid.
  const days = [
    { num: 1, dow: 'Wednesday', date: 'May 20', items: [
      { time: '2:00p', title: 'Arrive · check in to VRBO',          kind: 'travel',     status: 'confirmed' },
      { time: '7:00p', title: 'Welcome dinner at Pine Crest Inn',   kind: 'dining',     status: 'draft' },
    ]},
    { num: 2, dow: 'Thursday',  date: 'May 21', items: [
      { time: '7:30a', title: 'Pinehurst No. 2',                    kind: 'golf',       status: 'confirmed',  event: 'Scramble' },
    ]},
    { num: 3, dow: 'Friday',    date: 'May 22', items: [
      { time: '7:30a', title: 'Pinehurst No. 4',                    kind: 'golf',       status: 'draft' },
      { time: '8:00p', title: 'Poker night',                        kind: 'side-game',  status: 'draft',      event: 'Poker' },
    ]},
    { num: 4, dow: 'Saturday',  date: 'May 23', items: [] },
    { num: 5, dow: 'Sunday',    date: 'May 24', items: [
      { time: '7:30a', title: 'Pinehurst No. 2',                    kind: 'golf',       status: 'draft' },
    ]},
    { num: 6, dow: 'Monday',    date: 'May 25', items: [
      { time: '11:00a', title: 'Brunch + travel',                   kind: 'travel',     status: 'draft' },
    ]},
  ];
  const unscheduled = [
    { title: 'Side trip to Charlie\u2019s', kind: 'side-game' },
    { title: 'Closest-to-the-pin contest', kind: 'side-game', event: 'CTP' },
  ];
  const competitionEvents = [
    { title: 'Scramble',  format: 'SCRAMBLE',   placed: true },
    { title: 'Poker',     format: 'POKER',      placed: true },
    { title: 'CTP',       format: 'CTP',        placed: false },
    { title: 'Sabotage',  format: 'SABOTAGE',   placed: false },
  ];

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <ExTopNav wide />
      <TripHeaderStrip>
        <span style={{ width: 80, height: 64, opacity: 0.4 }}>
          <svg viewBox="0 0 80 64"><path d="M2 28 L 12 22 L 26 24 L 40 18 L 56 22 L 72 16 L 78 30 L 70 42 L 58 44 L 44 38 L 32 42 L 18 38 L 8 42 Z" fill="rgba(255,255,255,0.10)"/></svg>
        </span>
      </TripHeaderStrip>
      <TabStrip active="schedule" />

      <div style={{ padding: '18px 24px 0', display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16 }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--color-bt-accent)' }}>AGENDA</div>
          <h2 style={{ margin: '6px 0 6px', fontSize: 24, fontWeight: 700 }}>What you're actually doing</h2>
          <p style={{ margin: 0, fontSize: 13, color: 'var(--color-bt-text-dim)', lineHeight: 1.55, maxWidth: 540 }}>
            Tee times, dinners, side games, anything else on the calendar. Treat it like a rough draft — once an item is ready for the crew, confirm it and it'll appear on their itinerary.
          </p>
        </div>
        <button style={{
          all: 'unset', cursor: 'pointer', flexShrink: 0,
          padding: '8px 14px', borderRadius: 12,
          background: 'var(--color-bt-card-raised)', border: '0.5px solid var(--color-bt-border)',
          fontSize: 12, color: 'var(--color-bt-text)', fontWeight: 500,
          display: 'inline-flex', alignItems: 'center', gap: 6,
        }}>
          <ExIcon name="plus" size={12} color="currentColor"/> Add to agenda
        </button>
      </div>

      {/* Two-column working surface: drag sources on left, day-by-day on right */}
      <div style={{
        padding: '18px 24px 24px', display: 'grid',
        gridTemplateColumns: '320px 1fr', gap: 24, flex: 1, minHeight: 0,
      }}>
        {/* LEFT — On Deck + Competition Events */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 18, minWidth: 0 }}>
          <AgendaDragSection
            title="ON DECK"
            hint="Drag these to a day to add it to the agenda"
            items={unscheduled.map(u => ({ ...u, draggable: true }))}
            emptyHint="Unscheduled items show up here."
            addCta="Plan something else"
          />
          <AgendaDragSection
            title="COMPETITION EVENTS"
            icon="trophy"
            hint="Drag onto an agenda item to add it to the schedule, or keep it unscheduled and complete it at any time."
            items={competitionEvents}
            kind="competition"
          />
        </div>

        {/* RIGHT — Variable-length day-by-day list */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14, minWidth: 0, overflow: 'auto' }}>
          <div>
            <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 11, fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--color-bt-text-dim)' }}>
              <ExIcon name="calendar" size={12} color="currentColor"/>
              DAY-BY-DAY
            </div>
            <div style={{ marginTop: 4, fontSize: 11, color: 'var(--color-bt-text-dim)', fontStyle: 'italic' }}>
              Drop an item onto a day to schedule it
            </div>
          </div>

          {days.map(d => <AgendaDay key={d.num} day={d} />)}
        </div>
      </div>
    </div>
  );
}

// ── On-deck / Competition Events list ──────────────────────────────────
function AgendaDragSection({ title, hint, items, icon, kind, emptyHint, addCta }) {
  return (
    <div>
      <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 11, fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--color-bt-text-dim)' }}>
        {icon && <ExIcon name={icon} size={12} color="currentColor"/>}
        {title}
      </div>
      {hint && (
        <div style={{ marginTop: 4, fontSize: 11, color: 'var(--color-bt-text-dim)', fontStyle: 'italic', lineHeight: 1.45 }}>{hint}</div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 10 }}>
        {items.map((it, i) => (
          kind === 'competition'
            ? <CompetitionChip key={i} event={it}/>
            : <DraggableAgendaItem key={i} item={it}/>
        ))}

        {/* Add-more CTA appears only for On Deck */}
        {addCta && (
          <button style={{
            all: 'unset', cursor: 'pointer', textAlign: 'center', boxSizing: 'border-box',
            padding: '10px 12px', borderRadius: 10,
            border: '1px dashed var(--color-bt-border)',
            color: 'var(--color-bt-accent)',
            fontSize: 12, fontWeight: 600,
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 4,
          }}>
            <ExIcon name="plus" size={12} color="currentColor"/> {addCta}
          </button>
        )}
      </div>
    </div>
  );
}

function DraggableAgendaItem({ item }) {
  return (
    <div style={{
      display: 'grid', gridTemplateColumns: 'auto auto 1fr auto', alignItems: 'center', gap: 8,
      background: 'var(--color-bt-card)',
      border: '1px solid var(--color-bt-border)',
      borderRadius: 10, padding: '8px 10px',
      cursor: 'grab',
    }}>
      <span style={{ color: 'var(--color-bt-text-dim)', display: 'inline-flex' }}>
        <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><circle cx="9" cy="6" r="1.5"/><circle cx="15" cy="6" r="1.5"/><circle cx="9" cy="12" r="1.5"/><circle cx="15" cy="12" r="1.5"/><circle cx="9" cy="18" r="1.5"/><circle cx="15" cy="18" r="1.5"/></svg>
      </span>
      <ExIcon name="calendar" size={12} color="var(--color-bt-text-dim)"/>
      <span style={{ fontSize: 13, fontWeight: 500, color: 'var(--color-bt-text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{item.title}</span>
      <span style={{ display: 'inline-flex', gap: 6, color: 'var(--color-bt-text-dim)' }}>
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20h9M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg>
      </span>
    </div>
  );
}

function CompetitionChip({ event }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 8,
      background: event.placed ? 'rgba(45,212,191,0.06)' : 'var(--color-bt-card)',
      border: `1px solid ${event.placed ? 'var(--color-bt-accent-border)' : 'var(--color-bt-border)'}`,
      borderRadius: 10, padding: '8px 10px',
      opacity: event.placed ? 0.55 : 1,
      cursor: event.placed ? 'default' : 'grab',
    }}>
      <span style={{
        width: 22, height: 22, borderRadius: 6, flexShrink: 0,
        background: 'var(--color-bt-accent-faint)', color: 'var(--color-bt-accent)',
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
      }}>
        <svg width="11" height="11" viewBox="0 0 100 100" fill="currentColor"><path d="M 28 8 L 38 8 L 76 26 L 38 44 L 38 75 L 33 92 L 28 75 Z"/></svg>
      </span>
      <span style={{ flex: 1, fontSize: 13, fontWeight: 500, color: 'var(--color-bt-text)' }}>{event.title}</span>
      <span style={{
        fontSize: 9, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase',
        color: 'var(--color-bt-accent)',
        padding: '2px 7px', borderRadius: 4,
        background: 'var(--color-bt-accent-faint)',
        border: '0.5px solid var(--color-bt-accent-border)',
      }}>{event.format}</span>
    </div>
  );
}

// ── Day row — variable-length day-by-day right column ──────────────────
function AgendaDay({ day }) {
  return (
    <div>
      <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 13, fontWeight: 600, color: 'var(--color-bt-text)', marginBottom: 6 }}>
        <ExIcon name="calendar" size={12} color="var(--color-bt-text-dim)"/>
        <strong style={{ fontWeight: 700 }}>Day {day.num}</strong>
        <span style={{ color: 'var(--color-bt-text-dim)', fontWeight: 400 }}> — {day.dow}, {day.date}</span>
      </div>

      {day.items.length === 0 ? (
        <div style={{
          padding: '14px 14px', borderRadius: 10,
          background: 'rgba(148,163,184,0.03)',
          border: '1px dashed rgba(148,163,184,0.20)',
          fontSize: 12, color: 'var(--color-bt-text-dim)', fontStyle: 'italic',
        }}>
          Nothing scheduled yet
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {day.items.map((it, i) => <AgendaItemRow key={i} item={it}/>)}
        </div>
      )}
    </div>
  );
}

function AgendaItemRow({ item }) {
  const kindMeta = {
    travel:    { color: '#60a5fa', icon: 'arrow-right' },
    dining:    { color: '#fb923c', icon: 'home' },
    golf:      { color: 'var(--color-bt-accent)', icon: 'sparkles' },
    'side-game': { color: '#fbbf24', icon: 'sparkles' },
  };
  const k = kindMeta[item.kind] || kindMeta.dining;
  const isDraft = item.status === 'draft';

  return (
    <div style={{
      display: 'grid', gridTemplateColumns: '60px auto 1fr auto auto', alignItems: 'center', gap: 10,
      background: 'var(--color-bt-card)',
      border: '1px solid var(--color-bt-border)',
      borderRadius: 10, padding: '10px 12px',
    }}>
      <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--color-bt-text-dim)', textAlign: 'right' }}>
        {item.time}
      </span>
      <span style={{
        width: 22, height: 22, borderRadius: 6, flexShrink: 0,
        background: `${k.color}1a`, color: k.color,
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
      }}><ExIcon name={k.icon} size={11} color="currentColor"/></span>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--color-bt-text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{item.title}</div>
        {item.event && (
          <div style={{ fontSize: 10, color: 'var(--color-bt-accent)', marginTop: 1, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            <ExIcon name="trophy" size={9} color="currentColor"/> {item.event}
          </div>
        )}
      </div>
      <span style={{
        fontSize: 9, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase',
        padding: '2px 6px', borderRadius: 4,
        color: isDraft ? 'var(--color-bt-text-dim)' : 'var(--color-bt-accent)',
        background: isDraft ? 'var(--color-bt-card-raised)' : 'var(--color-bt-accent-faint)',
        border: isDraft ? '0.5px dashed var(--color-bt-border)' : '0.5px solid var(--color-bt-accent-border)',
      }}>{isDraft ? 'DRAFT' : 'CONFIRMED'}</span>
      <span style={{ display: 'inline-flex', gap: 6, color: 'var(--color-bt-text-dim)' }}>
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20h9M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>
      </span>
    </div>
  );
}

Object.assign(window, { LodgingBefore, LodgingAfter, AgendaEmpty, AgendaAfter, ReceiptsAfter });

// ════════════════════════════════════════════════════════════════════════
// AGENDA — empty (just-set-up trip, no items yet)
// ════════════════════════════════════════════════════════════════════════
function AgendaEmpty() {
  // 6-day trip · all days unscheduled · on-deck and competition both empty
  const days = [
    { num: 1, dow: 'Wednesday', date: 'May 20', items: [] },
    { num: 2, dow: 'Thursday',  date: 'May 21', items: [] },
    { num: 3, dow: 'Friday',    date: 'May 22', items: [] },
    { num: 4, dow: 'Saturday',  date: 'May 23', items: [] },
    { num: 5, dow: 'Sunday',    date: 'May 24', items: [] },
    { num: 6, dow: 'Monday',    date: 'May 25', items: [] },
  ];

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <ExTopNav wide />
      <TripHeaderStrip>
        <span style={{ width: 80, height: 64, opacity: 0.4 }}>
          <svg viewBox="0 0 80 64"><path d="M2 28 L 12 22 L 26 24 L 40 18 L 56 22 L 72 16 L 78 30 L 70 42 L 58 44 L 44 38 L 32 42 L 18 38 L 8 42 Z" fill="rgba(255,255,255,0.10)"/></svg>
        </span>
      </TripHeaderStrip>
      <TabStrip active="schedule" />

      <div style={{ padding: '18px 24px 0', display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16 }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--color-bt-accent)' }}>AGENDA</div>
          <h2 style={{ margin: '6px 0 6px', fontSize: 24, fontWeight: 700 }}>What you're actually doing</h2>
          <p style={{ margin: 0, fontSize: 13, color: 'var(--color-bt-text-dim)', lineHeight: 1.55, maxWidth: 540 }}>
            Tee times, dinners, reservations — anything on the calendar. Drop items on a day to schedule them; keep them on deck to plan later.
          </p>
        </div>
        <button style={{
          all: 'unset', cursor: 'pointer', flexShrink: 0,
          padding: '8px 14px', borderRadius: 12,
          background: 'var(--color-bt-accent)', color: '#0a0e1a',
          fontSize: 12, fontWeight: 600,
          display: 'inline-flex', alignItems: 'center', gap: 6,
        }}>
          <ExIcon name="plus" size={12} color="currentColor"/> Add your first item
        </button>
      </div>

      <div style={{
        padding: '18px 24px 24px', display: 'grid',
        gridTemplateColumns: '320px 1fr', gap: 24, flex: 1, minHeight: 0,
      }}>
        {/* LEFT — empty On Deck + Competition off */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 18, minWidth: 0 }}>
          <div>
            <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--color-bt-text-dim)' }}>
              ON DECK
            </div>
            <div style={{ marginTop: 4, fontSize: 11, color: 'var(--color-bt-text-dim)', fontStyle: 'italic', lineHeight: 1.45 }}>
              Unscheduled items live here. Drag onto a day when ready.
            </div>
            <button style={{
              all: 'unset', cursor: 'pointer', textAlign: 'center', boxSizing: 'border-box',
              marginTop: 10, width: '100%',
              padding: '12px 12px', borderRadius: 10,
              border: '1px dashed var(--color-bt-accent)',
              color: 'var(--color-bt-accent)',
              background: 'var(--color-bt-accent-faint)',
              fontSize: 12, fontWeight: 600,
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4,
            }}>
              <ExIcon name="plus" size={12} color="currentColor"/> Plan something
            </button>
          </div>

          {/* Competition off — nudge to enable */}
          <div style={{
            background: 'var(--color-bt-card)',
            border: '1px dashed var(--color-bt-border)',
            borderRadius: 12, padding: 14,
          }}>
            <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 11, fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--color-bt-text-dim)' }}>
              <ExIcon name="trophy" size={12} color="currentColor"/>
              COMPETITION EVENTS
            </div>
            <div style={{ marginTop: 8, fontSize: 12, color: 'var(--color-bt-text-dim)', lineHeight: 1.5 }}>
              Turn on competition mode to define events (scrambles, side games, poker) and drag them onto agenda days.
            </div>
            <button style={{
              all: 'unset', cursor: 'pointer', marginTop: 10,
              color: 'var(--color-bt-accent)', fontSize: 12, fontWeight: 600,
              display: 'inline-flex', alignItems: 'center', gap: 4,
            }}>Enable competition <ExIcon name="arrow-right" size={11} color="currentColor"/></button>
          </div>
        </div>

        {/* RIGHT — variable-length day list, all empty */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14, minWidth: 0, overflow: 'auto' }}>
          <div>
            <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 11, fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--color-bt-text-dim)' }}>
              <ExIcon name="calendar" size={12} color="currentColor"/>
              DAY-BY-DAY
            </div>
            <div style={{ marginTop: 4, fontSize: 11, color: 'var(--color-bt-text-dim)', fontStyle: 'italic' }}>
              Drop an item onto a day to schedule it
            </div>
          </div>

          {days.map(d => <AgendaDay key={d.num} day={d} />)}
        </div>
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════
// RECEIPTS — after (matches the production receipt row + BALANCES section)
// ════════════════════════════════════════════════════════════════════════
function ReceiptsAfter() {
  // 3 ghost example receipts — same shape as production. "you" = Zach.
  // No team-color echoes in the main app — teams are competition-tab only.
  const ghostReceipts = [
    { title: 'VRBO — 3 nights',           paidBy: 'Buddy', split: '5 ways', yourShare: '$196.00', amount: '$980.00' },
    { title: 'Pinehurst No. 2 — Round 1', paidBy: 'Zach',  split: '5 ways', yourShare: '$145.00', amount: '$725.00', selfPaid: true },
    { title: 'Steak dinner + open bar',   paidBy: 'Ryan',  split: '4 ways', yourShare: '$120.00', amount: '$480.00' },
  ];

  // Zero-balance preview — matches production BALANCES row format
  const balances = [
    { name: 'Zach',  suffix: '(you)', amount: '$0.00' },
    { name: 'Llama', amount: '$0.00' },
    { name: 'Buddy', amount: '$0.00' },
    { name: 'Mike',  amount: '$0.00' },
    { name: 'Ryan',  amount: '$0.00' },
  ];

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <ExTopNav wide />
      <TripHeaderStrip>
        <span style={{ width: 80, height: 64, opacity: 0.4 }}>
          <svg viewBox="0 0 80 64"><path d="M2 28 L 12 22 L 26 24 L 40 18 L 56 22 L 72 16 L 78 30 L 70 42 L 58 44 L 44 38 L 32 42 L 18 38 L 8 42 Z" fill="rgba(255,255,255,0.10)"/></svg>
        </span>
      </TripHeaderStrip>
      <TabStrip active="expenses" />

      <div style={{ padding: '18px 24px 0' }}>
        <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--color-bt-accent)' }}>RECEIPTS</div>
        <h2 style={{ margin: '6px 0 6px', fontSize: 24, fontWeight: 700 }}>Track who paid for what</h2>
        <p style={{ margin: 0, fontSize: 13, color: 'var(--color-bt-text-dim)', lineHeight: 1.55, maxWidth: 500 }}>
          Log anything the crew pays for. We square balances so nobody chases anyone for money at the end.
        </p>
      </div>

      <div style={{ padding: '16px 24px 20px', display: 'grid', gridTemplateColumns: '1fr 300px', gap: 20, flex: 1, minHeight: 0 }}>
        <div style={{ minWidth: 0, display: 'flex', flexDirection: 'column', gap: 14 }}>
          <SampleHeader label="How a receipt will look" />

          {/* Single sample receipt — full opacity, framed as Example */}
          <SampleCard>
            <div style={{
              display: 'grid', gridTemplateColumns: 'auto 1fr auto auto', alignItems: 'center', gap: 14,
              padding: '12px 10px',
            }}>
              <span style={{
                width: 36, height: 36, borderRadius: 9, flexShrink: 0,
                background: 'var(--color-bt-accent-faint)', color: 'var(--color-bt-accent)',
                display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                fontFamily: 'var(--font-mono)', fontSize: 16, fontWeight: 700,
              }}>$</span>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--color-bt-text)' }}>Steak dinner + open bar</div>
                <div style={{ fontSize: 11, color: 'var(--color-bt-text-dim)', marginTop: 2 }}>
                  Paid by <strong style={{ color: 'var(--color-bt-text)', fontWeight: 600 }}>Ryan</strong>
                  <span style={{ margin: '0 8px' }}>·</span>
                  split 4 ways
                </div>
                <div style={{ fontSize: 11, color: 'var(--color-bt-accent)', marginTop: 2 }}>
                  Your share: <strong style={{ fontWeight: 600 }}>$120.00</strong>
                </div>
              </div>
              <div style={{ fontFamily: 'var(--font-mono)', fontSize: 15, fontWeight: 600, color: 'var(--color-bt-text)', minWidth: 70, textAlign: 'right' }}>$480.00</div>
              <div style={{ display: 'flex', gap: 4, color: 'var(--color-bt-text-dim)' }}>
                <span style={iconBtn()}><ExIcon name="users" size={14} color="currentColor"/></span>
                <span style={iconBtn()}><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20h9M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg></span>
                <span style={iconBtn()}><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg></span>
              </div>
            </div>
          </SampleCard>

          <p style={{ margin: 0, fontSize: 12, color: 'var(--color-bt-text-dim)', lineHeight: 1.5 }}>
            Log who paid and how to split it. By default everyone splits evenly — tap a receipt later to customize.
          </p>

          {/* BALANCES section — REAL, not example. Showing actual zero state. */}
          <div style={{ marginTop: 8 }}>
            <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--color-bt-accent)', marginBottom: 10 }}>
              BALANCES
            </div>
            <div style={{
              background: 'var(--color-bt-card)', border: '1px solid var(--color-bt-border)',
              borderRadius: 10, padding: '4px 16px',
            }}>
              {balances.map((b, i) => (
                <div key={b.name} style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  padding: '12px 0',
                  borderBottom: i < balances.length - 1 ? '1px solid var(--color-bt-subtle-border)' : 'none',
                }}>
                  <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--color-bt-text)' }}>
                    {b.name}{b.suffix && <span style={{ color: 'var(--color-bt-text-dim)', fontWeight: 400 }}> {b.suffix}</span>}
                  </span>
                  <span style={{ fontFamily: 'var(--font-mono)', fontSize: 14, fontWeight: 600, color: 'var(--color-bt-text-dim)' }}>{b.amount}</span>
                </div>
              ))}
            </div>
            <div style={{ marginTop: 10, fontSize: 11, color: 'var(--color-bt-text-dim)', fontStyle: 'italic' }}>
              Everyone's even — no receipts logged yet.
            </div>
          </div>
        </div>

        <aside><AddReceiptComposer boosted /></aside>
      </div>
    </div>
  );
}

function iconBtn() {
  return {
    width: 26, height: 26, borderRadius: 6, display: 'inline-flex',
    alignItems: 'center', justifyContent: 'center', cursor: 'pointer',
  };
}
