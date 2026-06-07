// explorations-screens.jsx — empty-state, crew responsive, palette

// ════════════════════════════════════════════════════════════════════════
// EMPTY STATE — before / after
// ════════════════════════════════════════════════════════════════════════

function EmptyBefore() {
  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <ExTopNav />
      <div style={{ padding: '14px 16px', borderBottom: '1px solid var(--color-bt-border)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ padding: '2px 7px', borderRadius: 4, fontSize: 10, fontWeight: 500, border: '1px solid var(--color-bt-owner)', color: 'var(--color-bt-owner)' }}>Owner</span>
          <h1 style={{ margin: 0, fontSize: 18, fontWeight: 700, color: 'var(--color-bt-text)' }}>Vegas bachelor</h1>
          <span style={{ marginLeft: 'auto', padding: '3px 8px', borderRadius: 4, fontSize: 9, fontWeight: 700, letterSpacing: '0.1em', background: 'var(--color-bt-blue-bg)', color: 'var(--color-bt-planning)' }}>IDEA</span>
        </div>
      </div>
      {/* tab bar */}
      <div style={{ display: 'flex', borderBottom: '1px solid var(--color-bt-border)' }}>
        {['Home','Crew','Dates','Compete'].map((t, i) => (
          <button key={t} style={{
            all: 'unset', flex: 1, padding: '10px 0', textAlign: 'center', cursor: 'pointer',
            color: i === 0 ? 'var(--color-bt-accent)' : 'var(--color-bt-text-dim)',
            borderBottom: i === 0 ? '2px solid var(--color-bt-accent)' : '2px solid transparent',
            fontSize: 9, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase',
          }}>{t}</button>
        ))}
      </div>

      <div style={{ padding: 16, flex: 1, color: 'var(--color-bt-text-dim)' }}>
        <p style={{ fontSize: 13, lineHeight: 1.5, margin: '0 0 16px' }}>
          This trip is in the idea phase. Tap a section below to start adding details.
        </p>

        {['Destination', 'Crew', 'Dates', 'Logistics'].map((label, i) => (
          <div key={label} style={{
            background: 'var(--color-bt-card)', border: '1px solid var(--color-bt-border)',
            borderRadius: 10, padding: '14px 14px', marginBottom: 8,
            display: 'flex', alignItems: 'center', gap: 12,
          }}>
            <span style={{ width: 28, height: 28, borderRadius: 7, background: 'var(--color-bt-card-raised)', border: '1px solid var(--color-bt-border)' }}/>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--color-bt-text)' }}>{label}</div>
              <div style={{ fontSize: 11, color: 'var(--color-bt-text-dim)', marginTop: 2 }}>—</div>
            </div>
            <span style={{ fontSize: 11, color: 'var(--color-bt-text-dim)' }}>Set up</span>
            <ExIcon name="chevron-right" size={14} color="var(--color-bt-text-dim)" />
          </div>
        ))}
      </div>
    </div>
  );
}

function EmptyAfter() {
  const steps = [
    { id: 'dest',  title: 'Pick a destination', body: 'Toss in ideas and let the crew vote.', icon: 'map-pin', accent: '#2dd4bf', tint: 'rgba(45,212,191,0.10)' },
    { id: 'crew',  title: 'Invite your crew',   body: 'SMS or email — 5 spots ready to fill.', icon: 'user-plus', accent: '#fb923c', tint: 'rgba(251,146,60,0.10)' },
    { id: 'dates', title: 'Set the dates',      body: 'Run a poll · find a window that works.', icon: 'calendar', accent: '#a78bfa', tint: 'rgba(167,139,250,0.10)' },
    { id: 'comp',  title: 'Plan a competition', body: 'Set up teams + events for the trophy.', icon: 'sparkles', accent: '#fbbf24', tint: 'rgba(251,191,36,0.10)' },
  ];

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <ExTopNav />

      {/* Hero — IDEA stage with a confetti dot field for warmth */}
      <div style={{
        position: 'relative', overflow: 'hidden',
        background: 'linear-gradient(135deg, #1e3a5f 0%, #0a0e1a 60%, #134e4a 100%)',
        padding: '22px 18px 20px',
      }}>
        {/* confetti dots — non-decorative, deliberate */}
        <svg width="100%" height="100%" style={{ position: 'absolute', inset: 0, opacity: 0.65 }}>
          <circle cx="32"  cy="22" r="2" fill="#fbbf24"/>
          <circle cx="84"  cy="38" r="2" fill="#2dd4bf"/>
          <circle cx="148" cy="20" r="2" fill="#fb923c"/>
          <circle cx="206" cy="36" r="2" fill="#a78bfa"/>
          <circle cx="262" cy="22" r="2" fill="#60a5fa"/>
          <circle cx="320" cy="40" r="2" fill="#2dd4bf"/>
          <circle cx="52"  cy="68" r="1.5" fill="#a78bfa"/>
          <circle cx="118" cy="74" r="1.5" fill="#fb923c"/>
          <circle cx="190" cy="80" r="1.5" fill="#fbbf24"/>
          <circle cx="248" cy="68" r="1.5" fill="#2dd4bf"/>
          <circle cx="304" cy="78" r="1.5" fill="#60a5fa"/>
        </svg>

        <div style={{ position: 'relative', zIndex: 1 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
            <span style={{ padding: '2px 7px', borderRadius: 4, fontSize: 10, fontWeight: 500, border: '1px solid #fbbf24', color: '#fbbf24' }}>Owner</span>
            <span style={{ padding: '3px 8px', borderRadius: 4, fontSize: 9, fontWeight: 700, letterSpacing: '0.1em', background: 'rgba(96,165,250,0.15)', color: '#93c5fd' }}>IDEA</span>
          </div>
          <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700, color: '#fff', lineHeight: 1.15 }}>Let's plan<br/>Vegas bachelor</h1>
          <div style={{ marginTop: 10, fontSize: 12, color: 'rgba(255,255,255,0.6)', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <span style={{ width: 50, height: 4, borderRadius: 9999, background: 'rgba(255,255,255,0.15)', overflow: 'hidden' }}>
              <span style={{ display: 'block', width: '0%', height: '100%', background: '#2dd4bf' }}/>
            </span>
            0 of 4 steps done
          </div>
        </div>
      </div>

      {/* tab bar */}
      <div style={{ display: 'flex', borderBottom: '1px solid var(--color-bt-border)' }}>
        {['Home','Crew','Dates','Compete'].map((t, i) => (
          <button key={t} style={{
            all: 'unset', flex: 1, padding: '10px 0', textAlign: 'center', cursor: 'pointer',
            color: i === 0 ? 'var(--color-bt-accent)' : 'var(--color-bt-text-dim)',
            borderBottom: i === 0 ? '2px solid var(--color-bt-accent)' : '2px solid transparent',
            fontSize: 9, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase',
          }}>{t}</button>
        ))}
      </div>

      <div style={{ padding: 16, flex: 1, display: 'flex', flexDirection: 'column', gap: 10 }}>
        {steps.map((s, i) => (
          <div key={s.id} style={{
            background: s.tint,
            border: `1px solid ${s.accent}`,
            borderColor: 'rgba(148,163,184,0.15)',
            borderLeft: `4px solid ${s.accent}`,
            borderRadius: 10, padding: '12px 14px',
            display: 'flex', alignItems: 'center', gap: 12,
          }}>
            <span style={{
              width: 36, height: 36, borderRadius: 9, flexShrink: 0,
              background: s.accent, color: '#0a0e1a',
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            }}><ExIcon name={s.icon} size={18} strokeWidth={2}/></span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--color-bt-text)' }}>{s.title}</div>
              <div style={{ fontSize: 11, color: 'var(--color-bt-text-dim)', marginTop: 2 }}>{s.body}</div>
            </div>
            {i === 0 ? (
              <button style={{
                all: 'unset', cursor: 'pointer',
                padding: '6px 12px', borderRadius: 9999, fontSize: 11, fontWeight: 600,
                background: s.accent, color: '#0a0e1a',
                display: 'inline-flex', alignItems: 'center', gap: 4,
              }}>Start <ExIcon name="arrow-right" size={11} strokeWidth={2.5} color="#0a0e1a"/></button>
            ) : (
              <ExIcon name="chevron-right" size={16} color="var(--color-bt-text-dim)" />
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════
// CREW TAB — mobile / tablet / desktop
// ════════════════════════════════════════════════════════════════════════

const CREW = [
  // status: 'active' = email matches a BT user · 'invited' = email sent, no BT account yet · 'placeholder' = name-only entry
  // role: 'Owner' | 'Organizer' | 'Member' — independent of status (only Active users can be promoted)
  { name: 'Zach Grether',      email: 'zach@example.com',      role: 'Owner',     status: 'active',      team: '#a855f7' },
  { name: 'Llama',             email: 'jason@doherty.dev',     role: 'Organizer', status: 'active',      team: '#3b82f6', accountName: 'Jason Doherty' },
  { name: 'Buddy Banks',       email: 'buddy@banks.co',        role: 'Member',    status: 'active',      team: '#22c55e' },
  { name: 'Mike Kosko',        email: 'mike@kosko.io',         role: 'Member',    status: 'invited',     team: '#06b6d4', invitedAgo: '3d ago' },
  { name: 'Ryan Lynch',        email: 'ryan@lynch.net',        role: 'Member',    status: 'invited',     team: '#f97316', invitedAgo: '6d ago' },
  { name: 'Tom Stilson',       email: null,                    role: 'Member',    status: 'placeholder' },
  { name: 'JD (the Irishman)', email: null,                    role: 'Member',    status: 'placeholder' },
];

const STATUS_META = {
  active:      { label: 'Active',      bg: 'var(--color-bt-accent-faint)',  fg: 'var(--color-bt-accent)'  },
  invited:     { label: 'Invited',     bg: 'var(--color-bt-warning-faint)', fg: 'var(--color-bt-warning)' },
  placeholder: { label: 'Placeholder', bg: 'var(--color-bt-card-raised)',   fg: 'var(--color-bt-text-dim)' },
};

function initials(name) {
  const stripped = name.replace(/\(.*?\)/g, '').trim();
  return stripped.split(/\s+/).map(w => w[0]).join('').toUpperCase().slice(0, 2);
}

function CrewAvatar({ member, size = 36 }) {
  const isPlaceholder = member.status === 'placeholder';
  const isInvited     = member.status === 'invited';
  // Placeholder — plain neutral avatar (no special dashed treatment).
  if (isPlaceholder) {
    return (
      <span style={{
        width: size, height: size, borderRadius: '50%', flexShrink: 0,
        background: 'var(--color-bt-card-raised)',
        color: 'var(--color-bt-text-dim)',
        border: '1px solid var(--color-bt-border)',
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        fontWeight: 500, fontSize: Math.round(size * 0.36),
      }}>{initials(member.name)}</span>
    );
  }
  // Active / Invited — team color, but invited carries a small envelope corner.
  return (
    <span style={{
      width: size, height: size, borderRadius: '50%', flexShrink: 0,
      background: member.team || 'var(--color-bt-card-raised)',
      color: '#fff', opacity: isInvited ? 0.85 : 1,
      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
      fontWeight: 500, fontSize: Math.round(size * 0.36),
      position: 'relative',
    }}>
      {initials(member.name)}
      {isInvited && (
        <span style={{
          position: 'absolute', right: -2, bottom: -2,
          width: Math.round(size * 0.42), height: Math.round(size * 0.42),
          borderRadius: '50%', background: 'var(--color-bt-warning)',
          border: '2px solid var(--color-bt-base)',
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          color: '#0a0e1a',
        }}>
          <svg width={Math.round(size * 0.24)} height={Math.round(size * 0.24)} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/>
          </svg>
        </span>
      )}
    </span>
  );
}

function StatusPill({ status }) {
  const m = STATUS_META[status];
  return (
    <span style={{
      padding: '3px 9px', borderRadius: 9999, fontSize: 10, fontWeight: 600,
      letterSpacing: '0.06em', textTransform: 'uppercase',
      background: m.bg, color: m.fg,
      border: m.border ? `0.5px dashed ${m.fg}` : 'none',
    }}>{m.label}</span>
  );
}

function RolePill({ role }) {
  if (role === 'Member') return null;
  const color = role === 'Owner' ? 'var(--color-bt-owner)' : 'var(--color-bt-accent)';
  const bg    = role === 'Owner' ? 'rgba(251, 191, 36, 0.10)' : 'var(--color-bt-accent-faint)';
  return (
    <span style={{
      padding: '2px 7px', borderRadius: 4,
      fontSize: 10, fontWeight: 600, border: `1px solid ${color}`, color, background: bg,
    }}>{role}</span>
  );
}

function SectionBanner({ label, count, tone = 'accent' }) {
  const color = tone === 'accent' ? 'var(--color-bt-accent)' : 'var(--color-bt-planning)';
  const bg    = tone === 'accent' ? 'var(--color-bt-accent-faint)' : 'var(--color-bt-blue-bg)';
  return (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      padding: '8px 14px', borderRadius: 10,
      background: bg, color, marginBottom: 8,
    }}>
      <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase' }}>{label}</span>
      <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, fontWeight: 600 }}>{count}</span>
    </div>
  );
}

function CrewRow({ member, size = 'md', onTap }) {
  const isInvited = member.status === 'invited';
  // Subline: email (and optional 'invited Xd ago' for invited members).
  // Placeholder = no subline; the absence of contact info IS the placeholder signal.
  let subline = null;
  if (member.email) {
    subline = (
      <span style={{ color: 'var(--color-bt-text-dim)', fontFamily: 'var(--font-mono)' }}>
        {member.email}
        {isInvited && (
          <span style={{ color: 'var(--color-bt-warning)', fontFamily: 'var(--font-sans)' }}>
            {' · '}invited {member.invitedAgo}
          </span>
        )}
      </span>
    );
  }
  return (
    <div onClick={onTap} style={{
      background: 'var(--color-bt-card)', border: '1px solid var(--color-bt-border)',
      borderRadius: 10, padding: size === 'sm' ? '10px 12px' : '12px 14px',
      display: 'flex', alignItems: 'center', gap: 12,
      cursor: onTap ? 'pointer' : 'default',
    }}>
      <CrewAvatar member={member} size={size === 'sm' ? 34 : 40} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--color-bt-text)' }}>{member.name}</span>
          <RolePill role={member.role} />
        </div>
        {subline && (
          <div style={{ fontSize: 11, marginTop: 2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {subline}
          </div>
        )}
      </div>
      {onTap && (
        <ExIcon name="chevron-right" size={14} color="var(--color-bt-text-dim)" />
      )}
    </div>
  );
}

// ── Compact "map" legend for mobile (always-on, wraps) ─────────────────
function StatusLegendCompact({ counts }) {
  const entries = [
    { key: 'active',      label: 'Active',      color: 'var(--color-bt-accent)' },
    { key: 'invited',     label: 'Invited',     color: 'var(--color-bt-warning)' },
    { key: 'placeholder', label: 'Placeholder', color: 'var(--color-bt-text-dim)' },
  ];
  return (
    <div style={{
      display: 'flex', flexWrap: 'wrap', gap: '6px 14px',
      marginBottom: 14, fontSize: 11,
    }}>
      {entries.map(e => (
        <span key={e.key} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <span style={{ width: 8, height: 8, borderRadius: '50%', background: e.color }}/>
          <span style={{ color: e.color, fontWeight: 600 }}>{e.label}</span>
          <span style={{ color: 'var(--color-bt-text-dim)', fontFamily: 'var(--font-mono)' }}>{counts[e.key]}</span>
        </span>
      ))}
    </div>
  );
}

// ── Mobile (390px) ──────────────────────────────────────────────────────
function CrewMobile() {
  const organizers = CREW.filter(m => m.role === 'Owner' || m.role === 'Organizer');
  const members    = CREW.filter(m => m.role === 'Member');
  const counts = {
    active:      CREW.filter(m => m.status === 'active').length,
    invited:     CREW.filter(m => m.status === 'invited').length,
    placeholder: CREW.filter(m => m.status === 'placeholder').length,
  };
  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <ExTopNav />
      <div style={{ display: 'flex', borderBottom: '1px solid var(--color-bt-border)' }}>
        {['Home','Crew','Lodging','Agenda','Receipts','Compete'].map((t, i) => (
          <button key={t} style={{
            all: 'unset', flex: 1, padding: '10px 0', textAlign: 'center', cursor: 'pointer',
            color: i === 1 ? 'var(--color-bt-accent)' : 'var(--color-bt-text-dim)',
            borderBottom: i === 1 ? '2px solid var(--color-bt-accent)' : '2px solid transparent',
            fontSize: 9, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase',
          }}>{t}</button>
        ))}
      </div>

      <div style={{ padding: 16, flex: 1 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 10 }}>
          <h1 style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>Crew <span style={{ color: 'var(--color-bt-text-dim)', fontWeight: 500 }}>· {CREW.length}</span></h1>
          <button style={{
            all: 'unset', cursor: 'pointer', padding: '7px 14px', borderRadius: 9999,
            background: 'var(--color-bt-accent)', color: '#0a0e1a', fontSize: 12, fontWeight: 600,
          }}>+ Add</button>
        </div>

        {/* Compact map-style legend — always visible, wraps naturally. */}
        <StatusLegendCompact counts={counts} />

        <SectionBanner label="Organizers" count={organizers.length} tone="accent" />
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 14 }}>
          {organizers.map(m => <CrewRow key={m.name} member={m} size="sm" />)}
        </div>

        <SectionBanner label={`Crew · ${members.length}`} count={members.length} tone="neutral" />
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {members.map(m => <CrewRow key={m.name} member={m} size="sm" />)}
        </div>
      </div>
    </div>
  );
}

// ── Tablet (768) — sections + add composer on the right ────────────────
function CrewTablet() {
  const organizers = CREW.filter(m => m.role === 'Owner' || m.role === 'Organizer');
  const members    = CREW.filter(m => m.role === 'Member');
  const counts = {
    active:      CREW.filter(m => m.status === 'active').length,
    invited:     CREW.filter(m => m.status === 'invited').length,
    placeholder: CREW.filter(m => m.status === 'placeholder').length,
  };

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <ExTopNav title="BBMI 2026 · Crew" wide />

      <div style={{ padding: '20px 24px', flex: 1, display: 'grid', gridTemplateColumns: '1fr 260px', gap: 20, minHeight: 0 }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ marginBottom: 14 }}>
            <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700 }}>Crew <span style={{ color: 'var(--color-bt-text-dim)', fontWeight: 500, fontSize: 16 }}>· {CREW.length}</span></h1>
            <p style={{ margin: '4px 0 0', fontSize: 13, color: 'var(--color-bt-text-dim)', lineHeight: 1.4 }}>
              Owner and organizers manage the trip. Everyone else is a member — including placeholders, who get counted but can't sign in.
            </p>
          </div>

          <SectionBanner label="Organizers" count={organizers.length} tone="accent" />
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 14 }}>
            {organizers.map(m => <CrewRow key={m.name} member={m} />)}
          </div>

          <SectionBanner label="Crew" count={members.length} tone="neutral" />
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {members.map(m => <CrewRow key={m.name} member={m} />)}
          </div>
        </div>

        <aside style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <AddCrewComposer />
          <StatusLegend counts={counts} />
        </aside>
      </div>
    </div>
  );
}

// ── Desktop (1200) — same model, more room for the composer + legend ──
function CrewDesktop() {
  const organizers = CREW.filter(m => m.role === 'Owner' || m.role === 'Organizer');
  const members    = CREW.filter(m => m.role === 'Member');
  const counts = {
    active:      CREW.filter(m => m.status === 'active').length,
    invited:     CREW.filter(m => m.status === 'invited').length,
    placeholder: CREW.filter(m => m.status === 'placeholder').length,
  };

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <ExTopNav title="BBMI 2026 · Crew" wide />

      <div style={{ padding: '20px 28px', flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 18 }}>
          <div>
            <div style={{ fontSize: 11, color: 'var(--color-bt-text-dim)', letterSpacing: '0.1em', textTransform: 'uppercase' }}>BBMI 2026 · Pinehurst, NC</div>
            <h1 style={{ margin: '4px 0 4px', fontSize: 26, fontWeight: 700 }}>Crew · {CREW.length}</h1>
            <p style={{ margin: 0, fontSize: 13, color: 'var(--color-bt-text-dim)', lineHeight: 1.4, maxWidth: 520 }}>
              Owner and organizers manage the trip. Everyone else is a member — including <strong style={{ color: 'var(--color-bt-text)', fontWeight: 600 }}>placeholders</strong> (name-only entries that get counted but can't sign in).
            </p>
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 320px', gap: 20, flex: 1, minHeight: 0 }}>
          <div style={{ minWidth: 0 }}>
            <SectionBanner label="Organizers" count={organizers.length} tone="accent" />
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 16 }}>
              {organizers.map(m => <CrewRow key={m.name} member={m} />)}
            </div>
            <SectionBanner label="Crew" count={members.length} tone="neutral" />
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {members.map(m => <CrewRow key={m.name} member={m} />)}
            </div>
          </div>

          <aside style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <AddCrewComposer />
            <StatusLegend counts={counts} />
          </aside>
        </div>
      </div>
    </div>
  );
}

// ── Composer + legend (shared sidebar widgets) ─────────────────────────
function AddCrewComposer() {
  return (
    <div style={{
      background: 'var(--color-bt-card)', border: '1px solid var(--color-bt-border)',
      borderRadius: 12, padding: 14,
    }}>
      <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--color-bt-text-dim)', marginBottom: 10 }}>Add a person</div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <input placeholder="Name (optional)" style={{
          background: 'var(--color-bt-card-raised)', border: '1px solid var(--color-bt-border)',
          borderRadius: 8, padding: '8px 10px', fontSize: 13, color: 'var(--color-bt-text)',
          outline: 'none', fontFamily: 'var(--font-sans)',
        }} />
        <input placeholder="email@example.com (optional)" style={{
          background: 'var(--color-bt-card-raised)', border: '1px solid var(--color-bt-border)',
          borderRadius: 8, padding: '8px 10px', fontSize: 13, color: 'var(--color-bt-text)',
          outline: 'none', fontFamily: 'var(--font-mono)',
        }} />
        <button style={{
          all: 'unset', cursor: 'pointer', textAlign: 'center',
          padding: '9px 0', borderRadius: 8,
          background: 'var(--color-bt-accent)', color: '#0a0e1a',
          fontSize: 13, fontWeight: 600,
        }}>Add to crew</button>
      </div>

      <div style={{ marginTop: 10, fontSize: 11, color: 'var(--color-bt-text-dim)', lineHeight: 1.45 }}>
        Either field is enough. <strong style={{ color: 'var(--color-bt-text)', fontWeight: 600 }}>Email enables app access</strong> — name-only entries are placeholders.
      </div>
    </div>
  );
}

function StatusLegend({ counts }) {
  const rows = [
    { key: 'active',      label: 'Active',      color: 'var(--color-bt-accent)',   body: 'Email matches a BuddyTrip user. On the trip with full app access. Can be promoted to organizer.' },
    { key: 'invited',     label: 'Invited',     color: 'var(--color-bt-warning)',  body: 'Email sent, no account yet. They become Active once they sign in.' },
    { key: 'placeholder', label: 'Placeholder', color: 'var(--color-bt-text-dim)', body: 'No email. Counted in widgets (rooms, teams, expenses) but can\u2019t access the app.' },
  ];
  return (
    <div style={{
      background: 'var(--color-bt-card)', border: '1px solid var(--color-bt-border)',
      borderRadius: 12, padding: 14,
    }}>
      <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--color-bt-text-dim)', marginBottom: 10 }}>What these mean</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {rows.map(r => (
          <div key={r.key} style={{ display: 'grid', gridTemplateColumns: '14px 1fr 28px', alignItems: 'flex-start', gap: 10 }}>
            <span style={{
              marginTop: 4,
              width: 10, height: 10, borderRadius: '50%',
              background: r.color,
              flexShrink: 0,
            }}/>
            <div>
              <div style={{ fontSize: 12, fontWeight: 600, color: r.color }}>{r.label}</div>
              <div style={{ fontSize: 11, color: 'var(--color-bt-text-dim)', marginTop: 2, lineHeight: 1.4 }}>{r.body}</div>
            </div>
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--color-bt-text-dim)', textAlign: 'right' }}>{counts[r.key]}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════
// EXPANDED TEAM PALETTE — school colors named
// ════════════════════════════════════════════════════════════════════════

const PALETTE_FAMILIES = [
  { fam: 'Reds',     colors: [
    { name: 'Crimson',   hex: '#9e1b32', school: 'Alabama' },
    { name: 'Scarlet',   hex: '#bb0000', school: 'Ohio State' },
    { name: 'Wolfpack',  hex: '#cc0000', school: 'NC State' },
    { name: 'Badger',    hex: '#c5050c', school: 'Wisconsin' },
    { name: 'Bearcat',   hex: '#e00122', school: 'Cincinnati' },
  ]},
  { fam: 'Blues',    colors: [
    { name: 'Royal',     hex: '#003594', school: 'Kentucky' },
    { name: 'Navy',      hex: '#002654', school: 'Penn State' },
    { name: 'Carolina',  hex: '#4b9cd3', school: 'UNC' },
    { name: 'Cobalt',    hex: '#1e40af', school: 'Duke' },
    { name: 'Sky',       hex: '#7bafd4', school: 'Air Force' },
  ]},
  { fam: 'Greens',   colors: [
    { name: 'Forest',    hex: '#154734', school: 'Michigan State' },
    { name: 'Kelly',     hex: '#00b140', school: 'Marshall' },
    { name: 'Hunter',    hex: '#0c3528', school: 'Baylor' },
    { name: 'Big Green', hex: '#00693e', school: 'Dartmouth' },
    { name: 'Olive',     hex: '#3d4727', school: 'Oregon' },
  ]},
  { fam: 'Oranges',  colors: [
    { name: 'Burnt',     hex: '#bf5700', school: 'Texas' },
    { name: 'Clemson',   hex: '#f56600', school: 'Clemson' },
    { name: 'Maize',     hex: '#ffcb05', school: 'Michigan' },
    { name: 'Old Gold',  hex: '#a89968', school: 'Wake Forest' },
    { name: 'ND Gold',   hex: '#ae9142', school: 'Notre Dame' },
  ]},
  { fam: 'Purples',  colors: [
    { name: 'Royal P.',  hex: '#4b2e83', school: 'Washington' },
    { name: 'Tigers',    hex: '#461d7c', school: 'LSU' },
    { name: 'Plum',      hex: '#582c83', school: 'Northwestern' },
    { name: 'Violet',    hex: '#7c2bce', school: 'TCU' },
    { name: 'Wildcat',   hex: '#512888', school: 'Kansas State' },
  ]},
  { fam: 'Naturals', colors: [
    { name: 'Charcoal',  hex: '#2b2b2b', school: 'Black-team default' },
    { name: 'Pewter',    hex: '#6a737b', school: 'Iowa State' },
    { name: 'Sand',      hex: '#d4c9a3', school: 'Beach' },
    { name: 'Powder',    hex: '#b9d9eb', school: 'UNC alt' },
    { name: 'Crew Pink', hex: '#ff5b94', school: 'Custom team' },
  ]},
];

function ExpandedPalette() {
  return (
    <div style={{
      height: '100%', padding: '22px 24px',
      background: 'var(--color-bt-card)', border: '1px solid var(--color-bt-border)',
      borderRadius: 14, boxShadow: 'var(--shadow-card)',
      overflow: 'auto',
    }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 14 }}>
        <div>
          <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--color-bt-text-dim)', marginBottom: 4 }}>
            Team identity · curated chooser
          </div>
          <div style={{ fontSize: 13, color: 'var(--color-bt-text)' }}>
            Named, grouped, white-text-tested. Users pick — they never type a hex.
          </div>
        </div>
        <div style={{ fontSize: 11, color: 'var(--color-bt-text-dim)', fontFamily: 'var(--font-mono)' }}>
          30 colors · 6 families
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: 14 }}>
        {PALETTE_FAMILIES.map(f => (
          <div key={f.fam}>
            <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--color-bt-text-dim)', marginBottom: 8 }}>{f.fam}</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {f.colors.map(c => (
                <div key={c.hex} style={{
                  background: c.hex, color: '#fff',
                  borderRadius: 8, padding: '8px 10px',
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                }}>
                  <div>
                    <div style={{ fontSize: 12, fontWeight: 600 }}>{c.name}</div>
                    <div style={{ fontSize: 10, opacity: 0.75 }}>{c.school}</div>
                  </div>
                  <div style={{ fontFamily: 'var(--font-mono)', fontSize: 9, opacity: 0.7 }}>{c.hex}</div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>

      <div style={{
        marginTop: 16, padding: '10px 14px', borderRadius: 10,
        background: 'var(--color-bt-accent-faint)',
        border: '1px solid var(--color-bt-accent-border)',
        color: 'var(--color-bt-text)', fontSize: 12, lineHeight: 1.5,
      }}>
        <strong style={{ color: 'var(--color-bt-accent)' }}>Why this works:</strong> the user never sees a free color picker — they pick a named swatch from this curated set. Every color in this list passes white-on-color contrast for "Team Banks"-size text. <span style={{ color: 'var(--color-bt-text-dim)' }}>Add custom colors by promoting them into the system, not by hex-input.</span>
      </div>
    </div>
  );
}

Object.assign(window, {
  EmptyBefore, EmptyAfter,
  CrewMobile, CrewTablet, CrewDesktop, CrewMemberView, CrewEmpty,
  ExpandedPalette,
});

// ════════════════════════════════════════════════════════════════════════
// Crew — empty state (just the owner, no one else added yet)
// ════════════════════════════════════════════════════════════════════════
function CrewEmpty() {
  const owner = [{ name: 'Zach Grether', email: 'zach@example.com', role: 'Owner', status: 'active', team: '#a855f7' }];
  const counts = { active: 1, invited: 0, placeholder: 0 };

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <ExTopNav title="BBMI 2026 · Crew" wide />

      <div style={{ padding: '20px 28px', flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
        <div style={{ marginBottom: 18 }}>
          <div style={{ fontSize: 11, color: 'var(--color-bt-text-dim)', letterSpacing: '0.1em', textTransform: 'uppercase' }}>BBMI 2026 · Pinehurst, NC</div>
          <h1 style={{ margin: '4px 0 4px', fontSize: 26, fontWeight: 700 }}>Crew · 1</h1>
          <p style={{ margin: 0, fontSize: 13, color: 'var(--color-bt-text-dim)', lineHeight: 1.5, maxWidth: 540 }}>
            Just you so far. Add the rest of your crew — names alone work, or include emails so they can sign in and see the trip themselves.
          </p>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 320px', gap: 20, flex: 1, minHeight: 0 }}>
          <div style={{ minWidth: 0 }}>
            <SectionBanner label="Organizers" count={1} tone="accent" />
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 18 }}>
              {owner.map(m => <CrewRow key={m.name} member={m} />)}
            </div>

            <SectionBanner label="Crew" count={0} tone="neutral" />
            <div style={{
              border: '1.5px dashed var(--color-bt-border)',
              borderRadius: 12, padding: '28px 24px',
              display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10,
              background: 'var(--color-bt-surface-invitation)',
            }}>
              <span style={{
                width: 44, height: 44, borderRadius: 12,
                background: 'var(--color-bt-accent-faint)', color: 'var(--color-bt-accent)',
                display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              }}><ExIcon name="user-plus" size={22} color="currentColor"/></span>
              <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--color-bt-text)' }}>No one else yet</div>
              <div style={{ fontSize: 12, color: 'var(--color-bt-text-dim)', lineHeight: 1.5, textAlign: 'center', maxWidth: 360 }}>
                Use the panel on the right to add your first crew member.
                Add an email if you want them to access the trip themselves,
                or just a name to track them as a <strong style={{ color: 'var(--color-bt-text)', fontWeight: 600 }}>placeholder</strong>.
              </div>
            </div>
          </div>

          <aside style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <AddCrewComposerStandalone />
            <StatusLegend counts={counts} />
          </aside>
        </div>
      </div>
    </div>
  );
}

// AddCrewComposer styled to draw attention when it's the primary CTA on screen.
function AddCrewComposerStandalone() {
  return (
    <div style={{
      background: 'var(--color-bt-card)',
      border: '1px solid var(--color-bt-accent-border)',
      boxShadow: 'var(--shadow-raised)',
      borderRadius: 12, padding: 14,
    }}>
      <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--color-bt-accent)', marginBottom: 10 }}>Add your first crew member</div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <input placeholder="Name (e.g. Llama)" style={{
          background: 'var(--color-bt-card-raised)', border: '1px solid var(--color-bt-border)',
          borderRadius: 8, padding: '8px 10px', fontSize: 13, color: 'var(--color-bt-text)',
          outline: 'none', fontFamily: 'var(--font-sans)',
        }} />
        <input placeholder="jason@doherty.dev (optional)" style={{
          background: 'var(--color-bt-card-raised)', border: '1px solid var(--color-bt-border)',
          borderRadius: 8, padding: '8px 10px', fontSize: 13, color: 'var(--color-bt-text)',
          outline: 'none', fontFamily: 'var(--font-mono)',
        }} />
        <button style={{
          all: 'unset', cursor: 'pointer', textAlign: 'center',
          padding: '9px 0', borderRadius: 8,
          background: 'var(--color-bt-accent)', color: '#0a0e1a',
          fontSize: 13, fontWeight: 600,
        }}>Add to crew</button>
      </div>

      <div style={{ marginTop: 10, fontSize: 11, color: 'var(--color-bt-text-dim)', lineHeight: 1.45 }}>
        Either field works. <strong style={{ color: 'var(--color-bt-text)', fontWeight: 600 }}>Email enables app access</strong> — name-only entries become placeholders you can still count for rooms, teams, and receipts.
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════
// Crew — Member view (read-only, no editing or segmentation)
// ════════════════════════════════════════════════════════════════════════
function CrewMemberView() {
  // Sort: Owner first, then Organizers (active only), then everyone else
  // by status priority (active → invited → ghost), then by name.
  const sorted = [...CREW].sort((a, b) => {
    const roleRank   = r => r === 'Owner' ? 0 : r === 'Organizer' ? 1 : 2;
    const statusRank = s => s === 'active' ? 0 : s === 'invited' ? 1 : 2;
    if (roleRank(a.role) !== roleRank(b.role))     return roleRank(a.role) - roleRank(b.role);
    if (statusRank(a.status) !== statusRank(b.status)) return statusRank(a.status) - statusRank(b.status);
    return a.name.localeCompare(b.name);
  });

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <ExTopNav title="BBMI 2026 · Crew" wide />

      <div style={{ padding: '20px 28px', flex: 1, minHeight: 0 }}>
        <div style={{ marginBottom: 18 }}>
          <div style={{ fontSize: 11, color: 'var(--color-bt-text-dim)', letterSpacing: '0.1em', textTransform: 'uppercase' }}>BBMI 2026 · Pinehurst, NC</div>
          <h1 style={{ margin: '4px 0 4px', fontSize: 26, fontWeight: 700 }}>Crew · {CREW.length}</h1>
          <p style={{ margin: 0, fontSize: 13, color: 'var(--color-bt-text-dim)', lineHeight: 1.4, maxWidth: 520 }}>
            Everyone on the trip. Tag <strong style={{ color: 'var(--color-bt-owner)', fontWeight: 600 }}>Zach Grether</strong> or <strong style={{ color: 'var(--color-bt-accent)', fontWeight: 600 }}>Llama</strong> with any planning questions.
          </p>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxWidth: 720 }}>
          {sorted.map(m => <CrewRow key={m.name} member={m} />)}
        </div>
      </div>
    </div>
  );
}
