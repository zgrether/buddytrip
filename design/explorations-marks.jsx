// explorations-marks.jsx — 3 brand-identity directions (v2).
// v1 (6 generic mark options) was rejected — these are bigger,
// opinionated *systems* with mark + wordmark + application.

const TEAL  = 'var(--color-bt-accent)';
const PAPER = '#f4eedb';
const INK   = '#1a1a1a';
const NAVY  = '#0a0e1a';

// ════════════════════════════════════════════════════════════════════════
// CONCEPT A — "The Trophy"
// ════════════════════════════════════════════════════════════════════════
// The brand IS the passing trophy that's lived on four mantels. Sport-club
// vintage feel — engraved plaque, embossed leather, pennant. The app is
// the modern descendant of a hand-engraved cup.

function TrophyMark({ size = 100, color = TEAL }) {
  // Two-handled loving cup on a stepped base, with a star above.
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" fill="none">
      {/* star above */}
      <path d="M 50 6 L 53 13 L 60 14 L 55 19 L 56 26 L 50 23 L 44 26 L 45 19 L 40 14 L 47 13 Z"
        fill={color}/>
      {/* cup bowl */}
      <path d="M 30 32 L 70 32 L 66 60 Q 50 70 34 60 Z" fill={color}/>
      {/* handles */}
      <path d="M 30 36 Q 22 38 22 47 Q 22 56 30 56" stroke={color} strokeWidth="3.5" fill="none"/>
      <path d="M 70 36 Q 78 38 78 47 Q 78 56 70 56" stroke={color} strokeWidth="3.5" fill="none"/>
      {/* stem + base */}
      <rect x="46" y="60" width="8" height="10" fill={color}/>
      <rect x="36" y="70" width="28" height="6" fill={color}/>
      <rect x="32" y="76" width="36" height="6" fill={color}/>
      {/* engraving line on base */}
      <rect x="38" y="78" width="24" height="1.5" fill={NAVY} opacity="0.4"/>
    </svg>
  );
}

function ConceptA() {
  return (
    <div style={{
      width: '100%', height: '100%', borderRadius: 16, overflow: 'hidden',
      background: 'var(--color-bt-card)', border: '1px solid var(--color-bt-border)',
      boxShadow: 'var(--shadow-card)',
      display: 'flex', flexDirection: 'column',
    }}>
      {/* Big mark on a deep panel */}
      <div style={{
        background: 'linear-gradient(165deg, #0d2c3a 0%, #0a0e1a 100%)',
        padding: '34px 24px 26px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 18,
      }}>
        <TrophyMark size={88} color={TEAL} />
        <div style={{
          display: 'inline-flex', alignItems: 'center', gap: 10,
          color: '#f4eedb', fontFamily: 'Georgia, "Times New Roman", serif',
          fontSize: 26, fontWeight: 700, letterSpacing: '0.02em',
        }}>
          <TrophyMark size={22} color={TEAL}/>
          BuddyTrip
        </div>
        <div style={{
          fontSize: 9, fontWeight: 600, letterSpacing: '0.3em', textTransform: 'uppercase',
          color: 'rgba(244,238,219,0.5)',
        }}>· EST. 2021 ·</div>
      </div>

      {/* Engraved plaque application */}
      <div style={{ padding: '14px 18px', background: 'var(--color-bt-card-raised)', display: 'flex', flexDirection: 'column', gap: 6, flex: 1 }}>
        <div style={{ fontSize: 9, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--color-bt-text-dim)' }}>Engraved plaque · iOS app icon</div>
        <div style={{
          background: 'linear-gradient(160deg, #5c3a1f 0%, #3d2410 50%, #5c3a1f 100%)',
          borderRadius: 6, padding: '12px 14px',
          boxShadow: 'inset 0 1px 2px rgba(255,255,255,0.15), 0 2px 6px rgba(0,0,0,0.4)',
          display: 'flex', alignItems: 'center', gap: 12,
        }}>
          <TrophyMark size={36} color="#d4b078" />
          <div style={{ flex: 1, color: '#e8c98b', fontFamily: 'Georgia, serif' }}>
            <div style={{ fontSize: 9, letterSpacing: '0.15em', opacity: 0.7 }}>BBMI · 2024 CHAMPIONS</div>
            <div style={{ fontSize: 14, fontWeight: 700 }}>TEAM BANKS</div>
          </div>
        </div>
      </div>
      <Tagline>The app for the trophy that's lived on four mantels.</Tagline>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════
// CONCEPT B — "Tally"
// ════════════════════════════════════════════════════════════════════════
// Four upright marks + a diagonal slash = the universal symbol for "we
// kept score by hand." BuddyTrip is what comes next. The tally is the
// mark, the typographic motif, AND a recurring UI texture.

function TallyMark({ size = 100, color = TEAL }) {
  // 4 verticals + diagonal cross-out — classic 5-tally
  return (
    <svg width={size} height={size} viewBox="0 0 100 100">
      <rect x="14" y="18" width="8"  height="64" rx="2" fill={color}/>
      <rect x="32" y="18" width="8"  height="64" rx="2" fill={color}/>
      <rect x="50" y="18" width="8"  height="64" rx="2" fill={color}/>
      <rect x="68" y="18" width="8"  height="64" rx="2" fill={color}/>
      {/* diagonal slash */}
      <path d="M 8 78 L 88 22" stroke={color} strokeWidth="9" strokeLinecap="round"/>
    </svg>
  );
}

function ConceptB() {
  return (
    <div style={{
      width: '100%', height: '100%', borderRadius: 16, overflow: 'hidden',
      background: 'var(--color-bt-card)', border: '1px solid var(--color-bt-border)',
      boxShadow: 'var(--shadow-card)',
      display: 'flex', flexDirection: 'column',
    }}>
      <div style={{
        background: NAVY, padding: '28px 24px 22px',
        display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 18,
        position: 'relative', overflow: 'hidden',
      }}>
        {/* tally pattern background */}
        <svg width="100%" height="100%" style={{ position: 'absolute', inset: 0, opacity: 0.06 }}>
          {Array.from({ length: 18 }).map((_, i) => (
            <rect key={i} x={i * 26 - 20} y={i % 2 ? 140 : 200} width="4" height="40" fill={TEAL} transform={`rotate(-32 ${i*26} 180)`} />
          ))}
        </svg>

        <TallyMark size={72} color={TEAL} />
        <div style={{
          color: '#f1f5f9', fontFamily: 'var(--font-sans)',
          fontSize: 30, fontWeight: 800, letterSpacing: '-0.02em',
          textAlign: 'center', lineHeight: 1,
        }}>
          Buddy<span style={{ color: TEAL }}>|</span>Trip
        </div>
        <div style={{
          fontSize: 10, fontWeight: 700, letterSpacing: '0.18em', textTransform: 'uppercase',
          color: 'rgba(241,245,249,0.55)',
        }}>Keep score. Keep going.</div>
      </div>

      <div style={{ padding: '14px 18px', background: 'var(--color-bt-card-raised)', display: 'flex', flexDirection: 'column', gap: 8, flex: 1 }}>
        <div style={{ fontSize: 9, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--color-bt-text-dim)' }}>Live scoreboard application</div>
        <div style={{
          background: NAVY, borderRadius: 10, padding: '10px 12px',
          display: 'flex', alignItems: 'center', gap: 10,
        }}>
          <span style={{ fontSize: 10, color: 'var(--color-bt-text-dim)', width: 64, fontWeight: 600 }}>Team Banks</span>
          <span style={{ display: 'inline-flex', gap: 3, flex: 1 }}>
            {/* 24.5 pts rendered as 4 full tallies + 4 partial marks */}
            {Array.from({ length: 4 }).map((_, i) => (
              <TallyMark key={i} size={20} color={TEAL}/>
            ))}
            <span style={{ display: 'inline-flex', gap: 2, alignItems: 'center', marginLeft: 4 }}>
              <span style={{ width: 3, height: 16, background: TEAL, borderRadius: 1 }}/>
              <span style={{ width: 3, height: 16, background: TEAL, borderRadius: 1 }}/>
              <span style={{ width: 3, height: 16, background: TEAL, borderRadius: 1 }}/>
              <span style={{ width: 3, height: 16, background: TEAL, borderRadius: 1 }}/>
            </span>
          </span>
          <span style={{ color: TEAL, fontFamily: 'var(--font-mono)', fontSize: 16, fontWeight: 700 }}>24.5</span>
        </div>
      </div>
      <Tagline>Pencil and paper went digital. The mark stayed the same.</Tagline>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════
// CONCEPT C — "Stamp"
// ════════════════════════════════════════════════════════════════════════
// Each trip earns a stamp. The mark IS the stamp — circular patch with
// curved text. App generates a commemorative stamp per trip; users
// collect them. Big sports-pennant / passport energy.

function StampMark({ size = 100, label = 'BUDDYTRIP', year = '2026', glyph = true }) {
  const r = 46;
  const cx = 50, cy = 50;
  // SVG text-on-path for curved text
  return (
    <svg width={size} height={size} viewBox="0 0 100 100">
      <defs>
        <path id="stamp-top" d={`M ${cx-r+4} ${cy} A ${r-4} ${r-4} 0 0 1 ${cx+r-4} ${cy}`}/>
        <path id="stamp-bot" d={`M ${cx-r+4} ${cy} A ${r-4} ${r-4} 0 0 0 ${cx+r-4} ${cy}`}/>
      </defs>
      {/* outer ring */}
      <circle cx={cx} cy={cy} r={r} fill="none" stroke={TEAL} strokeWidth="3"/>
      <circle cx={cx} cy={cy} r={r-6} fill="none" stroke={TEAL} strokeWidth="1" opacity="0.5"/>
      {/* curved text top */}
      <text fontSize="9" fontFamily="-apple-system, sans-serif" fontWeight="800" letterSpacing="4" fill={TEAL}>
        <textPath href="#stamp-top" startOffset="50%" textAnchor="middle">{label}</textPath>
      </text>
      {/* curved text bottom */}
      <text fontSize="8" fontFamily="ui-monospace, monospace" fontWeight="600" letterSpacing="3" fill={TEAL} opacity="0.7">
        <textPath href="#stamp-bot" startOffset="50%" textAnchor="middle">· {year} ·</textPath>
      </text>
      {/* center mark */}
      {glyph && (
        <g transform="translate(50 50)">
          {/* small pennant */}
          <path d="M -8 -10 L -4 -10 L 12 -2 L -4 6 L -4 14 L -6 18 L -8 14 Z" fill={TEAL}/>
        </g>
      )}
    </svg>
  );
}

function ConceptC() {
  return (
    <div style={{
      width: '100%', height: '100%', borderRadius: 16, overflow: 'hidden',
      background: 'var(--color-bt-card)', border: '1px solid var(--color-bt-border)',
      boxShadow: 'var(--shadow-card)',
      display: 'flex', flexDirection: 'column',
    }}>
      <div style={{
        background: 'linear-gradient(165deg, #134e4a 0%, #0a0e1a 65%)',
        padding: '24px 24px 20px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16,
      }}>
        <StampMark size={120} label="BUDDYTRIP" year="2026" />
        <div style={{
          display: 'inline-flex', alignItems: 'center', gap: 7,
          color: '#f1f5f9', fontFamily: 'var(--font-sans)',
          fontSize: 20, fontWeight: 600, letterSpacing: '0.06em',
        }}>
          <svg width="18" height="18" viewBox="0 0 100 100"><path d="M 28 8 L 38 8 L 76 26 L 38 44 L 38 75 L 33 92 L 28 75 Z" fill={TEAL}/></svg>
          BuddyTrip
        </div>
      </div>

      <div style={{ padding: '14px 18px', background: 'var(--color-bt-card-raised)', display: 'flex', flexDirection: 'column', gap: 8, flex: 1 }}>
        <div style={{ fontSize: 9, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--color-bt-text-dim)' }}>Each trip earns a stamp · 6 collected</div>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'space-between' }}>
          {['BBMI · 2021', 'BBMI · 2022', 'BBMI · 2023', 'BBMI · 2024', 'BBMI · 2025', 'BBMI · 2026'].map((s, i) => (
            <div key={s} style={{
              flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4,
              opacity: i === 5 ? 1 : 0.55,
            }}>
              <StampMark size={42} label={'BBMI'} year={s.split(' · ')[1]} glyph={false} />
              <span style={{ fontSize: 8, color: 'var(--color-bt-text-dim)', fontFamily: 'var(--font-mono)' }}>'{s.split(' · ')[1].slice(2)}</span>
            </div>
          ))}
        </div>
      </div>
      <Tagline>Each trip becomes a collectible. The annual ritual, made visible.</Tagline>
    </div>
  );
}

function Tagline({ children }) {
  return (
    <div style={{
      padding: '10px 18px 14px',
      background: 'var(--color-bt-card)',
      borderTop: '1px solid var(--color-bt-subtle-border)',
      fontSize: 11, lineHeight: 1.45,
      color: 'var(--color-bt-text-dim)',
      fontStyle: 'italic',
    }}>{children}</div>
  );
}

Object.assign(window, {
  TrophyMark, TallyMark, StampMark,
  ConceptA, ConceptB, ConceptC,
});
