// explorations-atoms.jsx — shared helpers for explorations.html

// ── Inline lucide-style icons (stroke 1.75) ─────────────────────────────
const EX_ICON = {
  'map-pin': <><path d="M20 10c0 6-8 12-8 12S4 16 4 10a8 8 0 0 1 16 0Z"/><circle cx="12" cy="10" r="3"/></>,
  'calendar': <><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></>,
  'users': <><circle cx="9" cy="7" r="4"/><path d="M3 21v-2a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v2"/></>,
  'user-plus': <><circle cx="9" cy="7" r="4"/><path d="M3 21v-2a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v2"/><path d="M19 8v6M22 11h-6"/></>,
  'plus': <path d="M12 5v14M5 12h14"/>,
  'send': <path d="M22 2 11 13M22 2 15 22l-4-9-9-4z"/>,
  'check': <path d="M20 6 9 17l-5-5"/>,
  'sparkles': <><path d="M12 3l1.6 4.6L18 9l-4.4 1.4L12 15l-1.6-4.6L6 9l4.4-1.4Z"/><path d="M19 14l.8 2.2L22 17l-2.2.8L19 20l-.8-2.2L16 17l2.2-.8Z"/></>,
  'home': <><path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z"/><path d="M9 22V12h6v10"/></>,
  'bell': <><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/></>,
  'chevron-right': <path d="m9 6 6 6-6 6"/>,
  'compass': <><circle cx="12" cy="12" r="10"/><path d="m16.24 7.76-2.12 6.36-6.36 2.12 2.12-6.36 6.36-2.12z"/></>,
  'arrow-right': <path d="M5 12h14M13 6l6 6-6 6"/>,
};
function ExIcon({ name, size = 16, color = "currentColor", strokeWidth = 1.75, style }) {
  const p = EX_ICON[name];
  if (!p) return <span style={{ width: size, height: size, display: 'inline-block', ...style }} />;
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
      stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round"
      style={{ flexShrink: 0, ...style }}>{p}</svg>
  );
}

// ── Plate scaffolding for the mark cards ────────────────────────────────
function MarkPlate({ children }) {
  return (
    <div style={{
      width: '100%', height: '100%',
      background: 'var(--color-bt-card)',
      border: '1px solid var(--color-bt-border)',
      borderRadius: 14,
      padding: '20px 18px 16px',
      display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12,
      boxShadow: 'var(--shadow-card)',
    }}>{children}</div>
  );
}
function Lockup({ mark }) {
  return (
    <div style={{
      display: 'inline-flex', alignItems: 'center', gap: 7,
      fontSize: 18, fontWeight: 600, letterSpacing: '0.06em',
      color: 'var(--color-bt-text)',
    }}>
      {mark}
      BuddyTrip
    </div>
  );
}
function Note({ children }) {
  return (
    <div style={{
      marginTop: 'auto', textAlign: 'center', fontSize: 11,
      color: 'var(--color-bt-text-dim)', lineHeight: 1.4,
    }}>{children}</div>
  );
}

// ── Phone & window shells (for screen-level explorations) ───────────────
function PhoneShell({ children }) {
  return (
    <div style={{
      width: '100%', height: '100%',
      background: '#0a0e1a', borderRadius: 28,
      border: '6px solid #1a2233',
      overflow: 'hidden', position: 'relative',
      boxShadow: '0 30px 60px -20px rgba(0,0,0,0.5)',
    }}>
      <div style={{ height: 24, background: '#0a0e1a' }} />
      <div style={{ position: 'absolute', top: 8, left: '50%', transform: 'translateX(-50%)', width: 90, height: 22, background: '#000', borderRadius: 14 }} />
      <div style={{ background: 'var(--color-bt-base)', color: 'var(--color-bt-text)', height: 'calc(100% - 24px)' }}>{children}</div>
    </div>
  );
}
function WindowShell({ children, wide = false }) {
  return (
    <div style={{
      width: '100%', height: '100%',
      background: '#0a0e1a', borderRadius: 12,
      border: '1px solid var(--color-bt-border)',
      overflow: 'hidden', boxShadow: '0 30px 60px -20px rgba(0,0,0,0.5)',
    }}>
      <div style={{
        height: 32, background: 'rgba(0,0,0,0.3)',
        borderBottom: '1px solid var(--color-bt-subtle-border)',
        display: 'flex', alignItems: 'center', padding: '0 12px', gap: 6,
      }}>
        <span style={{ width: 11, height: 11, borderRadius: '50%', background: '#ff5f57' }}/>
        <span style={{ width: 11, height: 11, borderRadius: '50%', background: '#febc2e' }}/>
        <span style={{ width: 11, height: 11, borderRadius: '50%', background: '#28c840' }}/>
        <span style={{ marginLeft: 'auto', marginRight: 'auto', fontSize: 11, color: 'var(--color-bt-text-dim)', fontFamily: 'var(--font-mono)' }}>
          buddytrip-app.vercel.app/trips/bbmi-26/crew
        </span>
      </div>
      <div style={{ background: 'var(--color-bt-base)', color: 'var(--color-bt-text)', height: 'calc(100% - 32px)' }}>{children}</div>
    </div>
  );
}

// ── Small UI building blocks reused across screens ──────────────────────
function ExTopNav({ title = 'BuddyTrip', wide = false }) {
  return (
    <header style={{
      height: 52, padding: '0 16px',
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      background: 'var(--color-bt-nav-bg)', backdropFilter: 'blur(14px)',
      borderBottom: '1px solid var(--color-bt-subtle-border)',
    }}>
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7, fontSize: 16, fontWeight: 600, letterSpacing: '0.06em', color: 'var(--color-bt-text)' }}>
        <svg width="16" height="16" viewBox="0 0 100 100"><path d="M 28 8 L 38 8 L 76 26 L 38 44 L 38 75 L 33 92 L 28 75 Z" fill="var(--color-bt-accent)"/></svg>
        {title}
      </span>
      {wide && (
        <nav style={{ display: 'flex', gap: 22, fontSize: 13, color: 'var(--color-bt-text-dim)' }}>
          <span>Home</span><span style={{ color: 'var(--color-bt-accent)' }}>Crew</span><span>Lodging</span><span>Agenda</span><span>Receipts</span><span>Compete</span>
        </nav>
      )}
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, color: 'var(--color-bt-text-dim)' }}>
        <ExIcon name="bell" size={16} />
        <span style={{ width: 24, height: 24, borderRadius: '50%', background: 'var(--color-bt-card-raised)', color: 'var(--color-bt-accent)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, fontWeight: 600, border: '1.5px solid var(--color-bt-border)' }}>ZG</span>
      </span>
    </header>
  );
}

function StatChip({ label, value, accent }) {
  return (
    <div style={{
      flex: 1, padding: '10px 12px', borderRadius: 10,
      background: 'rgba(148,163,184,0.04)',
      border: '1px solid rgba(148,163,184,0.08)',
    }}>
      <div style={{ fontSize: 9, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--color-bt-text-dim)', marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 13, fontWeight: 500, color: accent || 'var(--color-bt-text)' }}>{value}</div>
    </div>
  );
}

Object.assign(window, { ExIcon, MarkPlate, Lockup, Note, PhoneShell, WindowShell, ExTopNav, StatChip });
