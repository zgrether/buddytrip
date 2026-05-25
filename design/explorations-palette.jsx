// explorations-palette.jsx — side-by-side palette comparison.
// Three variants of the same trip-home view:
//   1. Current      — bt-base #0a0e1a, bt-card #111827, bt-card-raised #1a2130
//   2. A: Lifted    — same base, bt-card #161e2f, bt-card-raised #1f2a40
//   3. A+C: Lifted + warm — A's surfaces + active use of amber / orange / blue

const PALETTES = {
  current: {
    name: 'Current',
    note: 'Surfaces 3–5% apart in lightness — separation reads as mushy.',
    overrides: {},
    warm: false,
  },
  lifted: {
    name: 'A · Lifted surfaces',
    note: 'Same hue family, but bt-card and bt-card-raised step up 5–8% so elevation is unambiguous.',
    overrides: {
      '--color-bt-card':        '#161e2f',
      '--color-bt-card-raised': '#1f2a40',
      '--color-bt-card-float':  '#2a3654',
      '--color-bt-border':      'rgba(148, 163, 184, 0.18)',
    },
    warm: false,
  },
  warmer: {
    name: 'A + C · Lifted + warm accents',
    note: 'Same surfaces as A, plus actively using the existing amber / orange / team colors instead of letting teal carry everything alone.',
    overrides: {
      '--color-bt-card':        '#161e2f',
      '--color-bt-card-raised': '#1f2a40',
      '--color-bt-card-float':  '#2a3654',
      '--color-bt-border':      'rgba(148, 163, 184, 0.18)',
    },
    warm: true,
  },
};

function PaletteArtboard({ variant }) {
  const p = PALETTES[variant];
  return (
    <div style={{
      width: '100%', height: '100%', overflow: 'hidden', borderRadius: 16,
      border: '1px solid var(--color-bt-border)', boxShadow: 'var(--shadow-card)',
      ...p.overrides,
      background: 'var(--color-bt-base)',
      color: 'var(--color-bt-text)',
      display: 'flex', flexDirection: 'column',
    }}>
      {/* Header tag */}
      <div style={{
        padding: '12px 16px', borderBottom: '1px solid var(--color-bt-subtle-border)',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--color-bt-accent)' }}>{p.name}</span>
          {variant === 'current' && (
            <span style={{ padding: '2px 6px', borderRadius: 4, background: 'var(--color-bt-card-raised)', color: 'var(--color-bt-text-dim)', fontSize: 9, letterSpacing: '0.08em', textTransform: 'uppercase', fontWeight: 700 }}>SHIPPING</span>
          )}
          {variant === 'warmer' && (
            <span style={{ padding: '2px 6px', borderRadius: 4, background: 'rgba(251,191,36,0.10)', color: '#fbbf24', fontSize: 9, letterSpacing: '0.08em', textTransform: 'uppercase', fontWeight: 700 }}>RECOMMENDED</span>
          )}
        </div>
      </div>

      <MiniTripPage warm={p.warm} />

      {/* Footnote */}
      <div style={{
        padding: '10px 16px', borderTop: '1px solid var(--color-bt-subtle-border)',
        background: 'var(--color-bt-card)',
        fontSize: 11, color: 'var(--color-bt-text-dim)', lineHeight: 1.4,
      }}>{p.note}</div>
    </div>
  );
}

function MiniTripPage({ warm }) {
  return (
    <div style={{ flex: 1, padding: 14, display: 'flex', flexDirection: 'column', gap: 12, overflow: 'auto' }}>
      {/* Hero card — destination locked, has countdown */}
      <div style={{
        position: 'relative', overflow: 'hidden', borderRadius: 14,
        background: warm
          ? 'linear-gradient(125deg, #1f3340 0%, #1a2a3a 55%, #2a2419 100%)'
          : 'linear-gradient(135deg, #0d2c3a 0%, #1a3a4f 50%, #0d2533 100%)',
        boxShadow: 'var(--shadow-raised)',
      }}>
        <div style={{ padding: '14px 16px 10px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{
              padding: '2px 7px', borderRadius: 4, fontSize: 10, fontWeight: 500,
              border: `1px solid ${warm ? '#fbbf24' : 'var(--color-bt-owner)'}`,
              color: warm ? '#fbbf24' : 'var(--color-bt-owner)',
              background: warm ? 'rgba(251,191,36,0.08)' : 'transparent',
            }}>Owner</span>
            <h1 style={{ margin: 0, fontSize: 18, fontWeight: 700, color: '#fff' }}>BBMI 2026</h1>
          </div>
          <div style={{ marginTop: 6, fontSize: 12, color: 'rgba(255,255,255,0.7)', display: 'flex', alignItems: 'center', gap: 4 }}>
            <ExIcon name="map-pin" size={11} color="currentColor"/> Pinehurst No. 2 · NC
          </div>
          <div style={{ marginTop: 4, fontSize: 11, color: 'rgba(255,255,255,0.5)', display: 'flex', alignItems: 'center', gap: 4 }}>
            <ExIcon name="calendar" size={10} color="currentColor"/> Sep 12 – Sep 15
          </div>
        </div>
        <div style={{
          borderTop: '1px solid rgba(148,163,184,.15)',
          background: warm ? 'rgba(251,191,36,0.08)' : 'var(--color-bt-accent-faint)',
          padding: '6px 16px', fontSize: 11, fontWeight: 600,
          letterSpacing: '0.04em',
          color: warm ? '#fbbf24' : 'var(--color-bt-accent)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5,
        }}>
          <span style={{
            width: 5, height: 5, borderRadius: '50%',
            background: warm ? '#fbbf24' : 'var(--color-bt-accent)',
            animation: 'btPulse 1.4s ease-in-out infinite',
          }}/>
          Starts in 32 days
        </div>
      </div>

      {/* Nudge */}
      <div style={{
        background: 'var(--color-bt-card)', border: '1px solid var(--color-bt-border)',
        borderRadius: 10, padding: '10px 12px',
        display: 'flex', alignItems: 'center', gap: 10,
      }}>
        <span style={{
          width: 26, height: 26, borderRadius: 7, flexShrink: 0,
          background: 'var(--color-bt-warning-faint)', color: 'var(--color-bt-warning)',
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        }}><ExIcon name="user-plus" size={12} color="currentColor"/></span>
        <div>
          <div style={{ fontSize: 12, fontWeight: 600 }}>2 crew haven't RSVP'd</div>
          <div style={{ fontSize: 10, color: 'var(--color-bt-text-dim)', marginTop: 1 }}>Tom and Ryan — last reminder 3 days ago.</div>
        </div>
      </div>

      {/* Section header */}
      <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--color-bt-text-dim)' }}>Planning</div>

      {/* Two planning rows */}
      <div style={{
        background: 'var(--color-bt-tag-bg)',
        border: '1px solid var(--color-bt-accent-border)',
        borderRadius: 10, padding: '10px 12px',
        display: 'flex', alignItems: 'center', gap: 10,
      }}>
        <span style={{
          width: 28, height: 28, borderRadius: 7, flexShrink: 0,
          background: warm ? 'rgba(45,212,191,0.15)' : 'var(--color-bt-accent-faint)',
          color: 'var(--color-bt-accent)',
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        }}><ExIcon name="map-pin" size={14} color="currentColor"/></span>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 13, fontWeight: 600 }}>Destination</div>
          <div style={{ fontSize: 11, color: 'var(--color-bt-text-dim)', marginTop: 1 }}>Pinehurst No. 2 — locked ✓</div>
        </div>
        <ExIcon name="chevron-down" size={14} color="var(--color-bt-text-dim)"/>
      </div>

      <div style={{
        background: 'var(--color-bt-card)', border: '1px solid var(--color-bt-border)',
        borderRadius: 10, padding: '10px 12px',
        display: 'flex', alignItems: 'center', gap: 10,
      }}>
        <span style={{
          width: 28, height: 28, borderRadius: 7, flexShrink: 0,
          background: warm ? 'rgba(96,165,250,0.15)' : 'var(--color-bt-card-raised)',
          color: warm ? 'var(--color-bt-planning)' : 'var(--color-bt-accent)',
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        }}><ExIcon name="users" size={14} color="currentColor"/></span>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 13, fontWeight: 600 }}>Crew</div>
          <div style={{ fontSize: 11, color: 'var(--color-bt-text-dim)', marginTop: 1 }}>3 of 5 confirmed · 2 pending</div>
        </div>
        <ExIcon name="chevron-down" size={14} color="var(--color-bt-text-dim)"/>
      </div>

      {/* Day strip */}
      <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--color-bt-text-dim)', marginTop: 4 }}>4-day arc</div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 6 }}>
        {[
          { dow: 'THU', accent: warm ? '#fbbf24' : '#fbbf24' },
          { dow: 'FRI', accent: warm ? '#2dd4bf' : '#2dd4bf' },
          { dow: 'SAT', accent: warm ? '#2dd4bf' : '#2dd4bf' },
          { dow: 'SUN', accent: warm ? '#fb923c' : '#fb923c' },
        ].map(d => (
          <div key={d.dow} style={{
            background: 'var(--color-bt-card)', border: '1px solid var(--color-bt-border)',
            borderRadius: 8, padding: '8px 6px', textAlign: 'center',
            borderTop: `3px solid ${d.accent}`,
          }}>
            <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.12em', color: d.accent }}>{d.dow}</div>
            <div style={{ fontSize: 11, fontWeight: 600, marginTop: 2 }}>{ d.dow === 'THU' ? 'Arr' : d.dow === 'FRI' ? 'R1' : d.dow === 'SAT' ? 'R2' : 'Dep' }</div>
          </div>
        ))}
      </div>

      {/* Warm variant: extra colorful side-games tile */}
      {warm && (
        <div style={{
          marginTop: 4,
          background: 'linear-gradient(115deg, rgba(251,191,36,0.10), rgba(251,146,60,0.05))',
          border: '1px solid rgba(251,191,36,0.30)',
          borderRadius: 10, padding: '10px 12px',
          display: 'flex', alignItems: 'center', gap: 10,
        }}>
          <span style={{
            width: 26, height: 26, borderRadius: 7, flexShrink: 0,
            background: '#fbbf24', color: '#0a0e1a',
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          }}><ExIcon name="sparkles" size={14} color="currentColor"/></span>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: '#fbbf24' }}>Side games tonight</div>
            <div style={{ fontSize: 10, color: 'var(--color-bt-text-dim)', marginTop: 1 }}>Hammerschlagen + poker · score it live</div>
          </div>
          <span style={{
            padding: '4px 9px', borderRadius: 9999, fontSize: 10, fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase',
            background: '#fb923c', color: '#0a0e1a',
          }}>2× pts</span>
        </div>
      )}

      {/* Receipt row */}
      <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--color-bt-text-dim)', marginTop: 4 }}>Latest receipt</div>
      <div style={{
        display: 'grid', gridTemplateColumns: 'auto 1fr auto', alignItems: 'center', gap: 10,
        background: 'var(--color-bt-card-raised)', borderRadius: 10, padding: '10px 12px',
      }}>
        <span style={{
          width: 30, height: 30, borderRadius: 7, flexShrink: 0,
          background: 'var(--color-bt-accent-faint)', color: 'var(--color-bt-accent)',
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          fontFamily: 'var(--font-mono)', fontSize: 14, fontWeight: 700,
        }}>$</span>
        <div>
          <div style={{ fontSize: 12, fontWeight: 600 }}>Steak dinner + open bar</div>
          <div style={{ fontSize: 10, color: 'var(--color-bt-text-dim)', marginTop: 1 }}>
            Paid by <strong style={{ color: warm ? '#fb923c' : 'var(--color-bt-text)', fontWeight: 600 }}>Ryan</strong> · split 4 ways
          </div>
          <div style={{ fontSize: 10, color: 'var(--color-bt-accent)', marginTop: 1 }}>Your share: <strong style={{ fontWeight: 600 }}>$120.00</strong></div>
        </div>
        <div style={{ fontFamily: 'var(--font-mono)', fontSize: 14, fontWeight: 600 }}>$480.00</div>
      </div>
    </div>
  );
}

Object.assign(window, { PaletteArtboard });
