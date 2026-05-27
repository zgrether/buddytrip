// BuddyTrip UI kit — atoms.jsx
// Small, well-factored React components that mirror the production app.
// Reads CSS variables from ../../colors_and_type.css (imported by index.html).
// Icon stroke width is 1.75 to match the lucide defaults used in-app.

// ─── Icons ───────────────────────────────────────────────────────────────
// Hand-traced lucide paths. Stroke: 1.75. Caps/joins: round.
// Wrap in a single <BTIcon name=... size=... /> so callers stay short.
const _LUCIDE_PATHS = {
  "map-pin": <><path d="M20 10c0 6-8 12-8 12S4 16 4 10a8 8 0 0 1 16 0Z"/><circle cx="12" cy="10" r="3"/></>,
  "calendar": <><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></>,
  "trophy": <><path d="M6 9h12v3a6 6 0 0 1-12 0V9zM10 21h4M12 17v4"/><path d="M3 6h3v3H3zM18 6h3v3h-3z"/></>,
  "users": <><circle cx="9" cy="7" r="4"/><path d="M3 21v-2a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v2"/></>,
  "user-plus": <><circle cx="9" cy="7" r="4"/><path d="M3 21v-2a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v2"/><path d="M19 8v6M22 11h-6"/></>,
  "home": <><path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z"/><path d="M9 22V12h6v10"/></>,
  "hotel": <><path d="M3 12V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v7"/><path d="M2 12h20v6a2 2 0 0 1-2 2h-1l-1 2-1-2h-8l-1 2-1-2H4a2 2 0 0 1-2-2Z"/></>,
  "dollar": <path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>,
  "activity": <path d="M22 12h-4l-3 9L9 3l-3 9H2"/>,
  "bell": <><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/></>,
  "settings": <><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z"/></>,
  "plus": <path d="M12 5v14M5 12h14"/>,
  "chevron-down": <path d="m6 9 6 6 6-6"/>,
  "chevron-right": <path d="m9 6 6 6-6 6"/>,
  "chevron-up": <path d="m18 15-6-6-6 6"/>,
  "send": <path d="M22 2 11 13M22 2 15 22l-4-9-9-4z"/>,
  "message": <path d="M21 11.5a8.4 8.4 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.4 8.4 0 0 1-3.8-.9L3 21l1.9-5.7a8.5 8.5 0 1 1 16.1-3.8Z"/>,
  "user-check": <><circle cx="9" cy="7" r="4"/><path d="M3 21v-2a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v2"/><path d="m17 11 2 2 4-4"/></>,
  "lock": <><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></>,
  "check": <path d="M20 6 9 17l-5-5"/>,
  "x": <path d="M18 6 6 18M6 6l12 12"/>,
  "wifi": <><path d="M5 13a10 10 0 0 1 14 0"/><path d="M8.5 16.5a5 5 0 0 1 7 0"/><path d="M2 8.8a15 15 0 0 1 20 0"/><path d="M12 20h.01"/></>,
  "key": <><circle cx="7" cy="15" r="4"/><path d="m10 12 11-11M17 5l3 3M14 8l3 3"/></>,
  "layout-grid": <><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></>,
  "arrow-right": <path d="M5 12h14M13 6l6 6-6 6"/>,
  "arrow-left": <path d="M19 12H5M11 6l-6 6 6 6"/>,
  "more-horizontal": <><circle cx="5" cy="12" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="19" cy="12" r="1.5"/></>,
};

function BTIcon({ name, size = 16, color = "currentColor", strokeWidth = 1.75, style }) {
  const path = _LUCIDE_PATHS[name];
  if (!path) return <span style={{ width: size, height: size, display: 'inline-block', ...style }} />;
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
      stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round"
      style={{ flexShrink: 0, ...style }}>
      {path}
    </svg>
  );
}

// The teal flag pennant — the only branded glyph in the app.
function BTFlag({ size = 18, color = "var(--color-bt-accent)" }) {
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" style={{ flexShrink: 0, color }}>
      <path d="M 28 8 L 38 8 L 76 26 L 38 44 L 38 75 L 33 92 L 28 75 Z" fill="currentColor"/>
    </svg>
  );
}

// ─── Buttons ────────────────────────────────────────────────────────────
// Five variants × three sizes (style guide §5). Inline styles only;
// hover handled with onMouseEnter for simplicity in this static kit.
function BTButton({ variant = "primary", size = "md", icon, children, onClick, disabled, fullWidth, style }) {
  const PAD = { sm: '6px 12px', md: '10px 16px', lg: '12px 24px' };
  const FS  = { sm: 12, md: 14, lg: 14 };
  const variants = {
    primary:   { background: 'var(--color-bt-accent)', color: '#0d1f1a', border: 'none' },
    secondary: { background: 'var(--color-bt-card-raised)', color: 'var(--color-bt-text)', border: '0.5px solid var(--color-bt-border)' },
    ghost:     { background: 'transparent', color: 'var(--color-bt-text-dim)', border: '0.5px solid var(--color-bt-border)' },
    danger:    { background: 'var(--color-bt-danger)', color: '#fff', border: 'none' },
    dashed:    { background: 'transparent', color: 'var(--color-bt-accent)', border: '1.5px dashed var(--color-bt-accent)' },
  };
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6,
        padding: PAD[size], borderRadius: 12, fontFamily: 'var(--font-sans)',
        fontSize: FS[size], fontWeight: 500, cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.4 : 1, transition: 'opacity 0.15s',
        width: fullWidth ? '100%' : 'auto',
        ...variants[variant], ...(style || {}),
      }}
    >
      {icon && <BTIcon name={icon} size={size === 'sm' ? 12 : 14} />}
      {children}
    </button>
  );
}

// ─── Badges ─────────────────────────────────────────────────────────────
const STATUS_CONFIG = {
  idea:     { label: 'IDEA',     bg: 'var(--color-bt-blue-bg)',    fg: 'var(--color-bt-planning)' },
  planning: { label: 'PLANNING', bg: 'var(--color-bt-tag-bg)',     fg: 'var(--color-bt-accent)' },
  going:    { label: 'GOING',    bg: 'var(--color-bt-ready-bg)',   fg: 'var(--color-bt-ready)' },
  now:      { label: 'NOW',      bg: 'rgba(217,119,6,0.10)',       fg: 'var(--color-bt-warning)' },
  past:     { label: 'PAST',     bg: 'var(--color-bt-past-bg)',    fg: 'var(--color-bt-text-dim)' },
  saved:    { label: 'SAVED',    bg: 'var(--color-bt-past-bg)',    fg: 'var(--color-bt-text-dim)' },
};
function BTStatusBadge({ status, label }) {
  const c = STATUS_CONFIG[status] || STATUS_CONFIG.planning;
  return (
    <span style={{
      display: 'inline-block', padding: '3px 8px', borderRadius: 4,
      fontSize: 10, fontWeight: 700, letterSpacing: '0.1em',
      background: c.bg, color: c.fg,
    }}>{label ?? c.label}</span>
  );
}

function BTRoleBadge({ role }) {
  if (role === 'Member' || !role) return null;
  const color = role === 'Owner' ? 'var(--color-bt-owner)' : 'var(--color-bt-accent)';
  return (
    <span style={{
      display: 'inline-block', padding: '2px 7px', borderRadius: 4,
      fontSize: 10, fontWeight: 500, border: `1px solid ${color}`, color,
    }}>{role}</span>
  );
}

// ─── Avatars ────────────────────────────────────────────────────────────
function initialsOf(name) {
  const p = (name || '').trim().split(/\s+/).filter(Boolean);
  if (!p.length) return '?';
  return p.map(w => w[0] || '').join('').toUpperCase().slice(0, 2);
}
function BTAvatar({ name, size = 36, teamColor, icon, style }) {
  const isTeam = !!teamColor;
  return (
    <div style={{
      width: size, height: size, borderRadius: '50%',
      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
      background: isTeam ? teamColor : 'var(--color-bt-card-raised)',
      color: isTeam ? '#fff' : 'var(--color-bt-accent)',
      border: isTeam ? 'none' : '1.5px solid var(--color-bt-border)',
      fontWeight: 500, fontSize: Math.round(size * 0.36), lineHeight: 1,
      flexShrink: 0, ...(style || {}),
    }}>
      {icon ? <BTIcon name={icon} size={Math.round(size * 0.5)} /> : initialsOf(name)}
    </div>
  );
}

// ─── Nudge banner (style guide §4) ──────────────────────────────────────
function BTNudge({ tone = 'accent', icon = 'check', title, sub }) {
  const tones = {
    accent:  { bg: 'var(--color-bt-accent-faint)',  fg: 'var(--color-bt-accent)' },
    warning: { bg: 'var(--color-bt-warning-faint)', fg: 'var(--color-bt-warning)' },
  };
  const t = tones[tone];
  return (
    <div style={{
      background: 'var(--color-bt-card)', border: '1px solid var(--color-bt-border)',
      borderRadius: 12, padding: '12px 16px', display: 'flex',
      alignItems: 'center', gap: 12,
    }}>
      <span style={{
        width: 28, height: 28, borderRadius: 8, flexShrink: 0,
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        background: t.bg, color: t.fg,
      }}><BTIcon name={icon} size={14} /></span>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--color-bt-text)', lineHeight: 1.2 }}>{title}</div>
        {sub && <div style={{ fontSize: 11, color: 'var(--color-bt-text-dim)', marginTop: 2, lineHeight: 1.35 }}>{sub}</div>}
      </div>
    </div>
  );
}

// ─── Planning row (style guide §4 collapsible panel) ────────────────────
function BTPlanningRow({ icon = 'map-pin', title, sub, state = 'todo', open = false, onToggle, children }) {
  const isDone = state === 'done';
  return (
    <div style={{
      borderRadius: 12,
      border: '1px solid ' + (isDone ? 'var(--color-bt-accent-border)' : 'var(--color-bt-border)'),
      background: isDone ? 'var(--color-bt-tag-bg)' : 'var(--color-bt-card)',
      boxShadow: open ? 'var(--shadow-raised)' : 'var(--shadow-card)',
      overflow: 'hidden',
    }}>
      <button
        type="button" onClick={onToggle}
        style={{
          all: 'unset', display: 'flex', alignItems: 'center', gap: 12,
          padding: '14px 16px', width: '100%', cursor: 'pointer',
          boxSizing: 'border-box',
        }}>
        <span style={{
          width: 32, height: 32, borderRadius: 8, flexShrink: 0,
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          background: isDone ? 'var(--color-bt-tag-bg)' : 'var(--color-bt-accent-faint)',
          color: 'var(--color-bt-accent)',
          border: isDone ? '1px solid var(--color-bt-accent-border)' : 'none',
        }}><BTIcon name={icon} size={16} /></span>
        <span style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--color-bt-text)' }}>{title}</div>
          {sub && <div style={{ fontSize: 12, color: 'var(--color-bt-text-dim)', marginTop: 2 }}>{sub}</div>}
        </span>
        <BTIcon name={open ? 'chevron-up' : 'chevron-down'} size={16} color="var(--color-bt-text-dim)" />
      </button>
      {open && children && (
        <div style={{ padding: '0 16px 16px' }} className="bt-fade-in">{children}</div>
      )}
    </div>
  );
}

// ─── Vote cell (date poll) ──────────────────────────────────────────────
function BTVoteCell({ vote, onClick, compact = false }) {
  const map = {
    y: { bg: 'rgba(0,212,170,0.15)',  fg: 'var(--color-bt-accent)', glyph: '✓' },
    m: { bg: 'rgba(245,158,11,0.15)', fg: '#fbbf24',                glyph: '~' },
    n: { bg: 'rgba(239,68,68,0.15)',  fg: 'var(--color-bt-danger)', glyph: '✗' },
  };
  const empty = !vote;
  const c = vote ? map[vote] : null;
  const W = compact ? 28 : 36;
  const H = 22;
  return (
    <span onClick={onClick} style={{
      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
      width: W, height: H, borderRadius: 5,
      fontSize: 12, fontWeight: 700,
      background: empty ? 'transparent' : c.bg,
      color: empty ? 'var(--color-bt-text-dim)' : c.fg,
      border: empty ? '1px dashed var(--color-bt-border)' : 'none',
      cursor: onClick ? 'pointer' : 'default',
    }}>{empty ? '·' : c.glyph}</span>
  );
}

// ─── Live indicator (pulsing dot + LIVE pill) ───────────────────────────
function BTLiveBadge() {
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 5,
      fontSize: 10, fontWeight: 500, letterSpacing: '0.05em', textTransform: 'uppercase',
      color: 'var(--color-bt-danger)', padding: '3px 8px', borderRadius: 9999,
      background: 'rgba(239,68,68,0.08)', border: '0.5px solid rgba(239,68,68,0.25)',
    }}>
      <span style={{
        width: 6, height: 6, borderRadius: '50%', background: 'var(--color-bt-danger)',
        animation: 'btPulse 1.4s ease-in-out infinite',
      }}/>
      Live
    </span>
  );
}

// Keep these in window scope so the screens script can use them.
Object.assign(window, {
  BTIcon, BTFlag, BTButton, BTStatusBadge, BTRoleBadge,
  BTAvatar, BTNudge, BTPlanningRow, BTVoteCell, BTLiveBadge,
  initialsOf,
});
